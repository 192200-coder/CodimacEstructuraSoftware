import { Component, effect, signal, OnDestroy } from "@angular/core"
import { DatePipe } from "@angular/common"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import type { RemoteOrder } from "../../../lib/codimac-api"
import type { RemoteRouteSummary } from "../../../lib/codimac-api"
import type { CriterioRuta } from "../../../dominio/modelos"
import { generarAlternativas } from "../../../dominio/rutas"
import {
  calcularAvisosFechaLimite,
  calcularPesoPedidosKg,
} from "../../../dominio/planificacion-ruta-ui"
import { IconComponent } from "../../shared/icon.component"
import { StatusBadgeComponent } from "../../shared/status-badge.component"

interface Resource {
  id: string
  display_name?: string
  plate?: string
  vehicle_type?: string
  capacity_kg?: number
  average_speed_kmh?: number
  fuel_efficiency_km_l?: number
}

interface RouteParameters {
  warehouse_latitude: number
  warehouse_longitude: number
  fuel_price: number
  minutes_per_stop: number
}

@Component({
  selector: "codimac-routes-page",
  standalone: true,
  imports: [DatePipe, IconComponent, StatusBadgeComponent],
  templateUrl: "./routes-page.component.html",
})
export class RoutesPageComponent implements OnDestroy {
  readonly step = signal(0)
  readonly criterion = signal<CriterioRuta>("tiempo")
  readonly selectedAlternative = signal(0)
  readonly orders = signal<RemoteOrder[]>([])
  readonly resources = signal<{ drivers: Resource[]; vehicles: Resource[] }>({ drivers: [], vehicles: [] })
  readonly parameters = signal<RouteParameters | null>(null)
  readonly selectedOrderIds = signal<string[]>([])
  readonly selectedDriverId = signal("")
  readonly selectedVehicleId = signal("")
  readonly routeId = signal("")
  readonly routeCode = signal("")
  readonly plannedVehicleId = signal("")
  readonly loading = signal(false)
  readonly monitoredRoute = signal<RemoteRouteSummary | null>(null)
  readonly activeRoutes = signal<RemoteRouteSummary[]>([])
  readonly pendingRoutes = signal<RemoteRouteSummary[]>([])
  private monitorTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    readonly state: AppStateService,
    private readonly api: CodimacApiService,
  ) {
    effect(() => {
      if (this.state.isOnline()) void this.loadRouteData()
    })
  }

  private async loadRouteData(): Promise<void> {
    this.loading.set(true)
    try {
      const [orders, resources, parameters] = await Promise.all([
        this.api.getOrders(),
        this.api.getResources(),
        this.api.getCatalog<RouteParameters | null>("parameters"),
      ])
      this.orders.set(orders)
      this.resources.set(resources)
      this.parameters.set(parameters)
      this.selectedDriverId.set(resources.drivers[0]?.id ?? "")
      this.selectedVehicleId.set(resources.vehicles[0]?.id ?? "")
      await this.refreshMonitoredRoute()
      if (this.activeRoutes().length) this.startRouteMonitor()
    } catch (error) {
      this.state.showToast(error instanceof Error ? error.message : "No se pudieron cargar pedidos y recursos.")
    } finally {
      this.loading.set(false)
    }

  }

  ngOnDestroy(): void {
    if (this.monitorTimer !== null) clearInterval(this.monitorTimer)
  }

  private async refreshMonitoredRoute(): Promise<void> {
    const routes = await this.api.getRoutes()
    this.pendingRoutes.set(routes.filter((route) =>
      route.status === "Calculada" || route.status === "Aprobada",
    ))
    this.activeRoutes.set(
      routes.filter((route) => route.status === "Asignada" || route.status === "En curso"),
    )
    const route = routes.find((item) => item.id === this.routeId()) ?? null
    this.monitoredRoute.set(route)
    if (!this.activeRoutes().length && this.monitorTimer !== null) {
      clearInterval(this.monitorTimer)
      this.monitorTimer = null
    }
  }

  private startRouteMonitor(): void {
    if (this.monitorTimer !== null) clearInterval(this.monitorTimer)
    this.monitorTimer = setInterval(() => {
      void this.refreshMonitoredRoute().catch((error: unknown) => {
        if (this.monitorTimer !== null) clearInterval(this.monitorTimer)
        this.monitorTimer = null
        this.state.showToast(
          error instanceof Error
            ? `No se pudo actualizar el monitor: ${error.message}`
            : "No se pudo actualizar el monitor del reparto.",
        )
      })
    }, 15_000)
  }

  get readyOrders(): RemoteOrder[] {
    return this.orders().filter((order) => order.status === "Listo" && !order.active_route_id)
  }

  get deadlineWarnings(): string[] {
    const route = this.alternativeRows[this.selectedAlternative()]
    const parameters = this.parameters()
    const vehicle = this.resources().vehicles.find(
      (resource) => resource.id === this.selectedVehicleId(),
    )
    if (!route || !parameters || !vehicle?.average_speed_kmh) return []
    return calcularAvisosFechaLimite({
      orderIds: route.orderIds,
      orders: this.selectedOrders,
      origin: {
        latitud: Number(parameters.warehouse_latitude),
        longitud: Number(parameters.warehouse_longitude),
      },
      averageSpeedKmh: Number(vehicle.average_speed_kmh),
      minutesPerStop: Number(parameters.minutes_per_stop),
      now: new Date(),
    })
  }

  get selectedOrders(): RemoteOrder[] {
    const selected = new Set(this.selectedOrderIds())
    return this.readyOrders.filter((order) => selected.has(order.id))
  }

  get alternatives() {
    if (!this.selectedOrders.length) return []
    const parameters = this.parameters()
    const vehicle = this.resources().vehicles.find(
      (resource) => resource.id === this.selectedVehicleId(),
    )
    if (!parameters || !vehicle?.average_speed_kmh || !vehicle.fuel_efficiency_km_l) return []
    const destinations = this.selectedOrders.flatMap((order) => {
      const client = order.clients
      if (client?.latitude === undefined || client.longitude === undefined) return []
      return [{
        id: order.id,
        etiqueta: `${order.code} · ${client.name}`,
        coordenadas: { latitud: Number(client.latitude), longitud: Number(client.longitude) },
      }]
    })
    if (destinations.length !== this.selectedOrders.length) return []
    return generarAlternativas(
      { latitud: Number(parameters.warehouse_latitude), longitud: Number(parameters.warehouse_longitude) },
      destinations,
      {
        id: vehicle.id,
        placa: vehicle.plate ?? "",
        capacidadKg: Number(vehicle.capacity_kg),
        velocidadPromedioKmh: Number(vehicle.average_speed_kmh),
        rendimientoKmLitro: Number(vehicle.fuel_efficiency_km_l),
        disponible: true,
      },
      Number(parameters.fuel_price),
      Number(parameters.minutes_per_stop),
      this.criterion(),
    )
  }

  get alternativeRows() {
    return this.alternatives.map((route, index) => ({
      code: ["A", "B", "C"][index] ?? "A",
      title: ["Recomendada", "Alternativa", "Respaldo"][index] ?? "Alternativa",
      stops: route.orden.map((stop) => stop.etiqueta).join(" → "),
      distance: `${route.distanciaKm.toFixed(1).replace(".", ",")} km`,
      time: `${Math.round(route.tiempoMinutos)} min`,
      cost: `S/ ${route.costoCombustible.toFixed(2).replace(".", ",")}`,
      distanceKm: route.distanciaKm,
      estimatedMinutes: Math.round(route.tiempoMinutos),
      estimatedLiters: route.litros,
      estimatedCost: route.costoCombustible,
      orderIds: route.orden.map((stop) => stop.id),
    }))
  }

  get selectedRouteOrders(): RemoteOrder[] {
    const orderById = new Map(this.selectedOrders.map((order) => [order.id, order]))
    const route = this.alternativeRows[this.selectedAlternative()]
    return (route?.orderIds ?? this.selectedOrderIds())
      .map((id) => orderById.get(id))
      .filter((order): order is RemoteOrder => order !== undefined)
  }

  get selectedWeightKg(): number {
    return calcularPesoPedidosKg(this.selectedOrders)
  }

  get selectedVehicleCapacity(): number | undefined {
    return this.resources().vehicles.find(
      (vehicle) => vehicle.id === this.selectedVehicleId(),
    )?.capacity_kg
  }

  changeCriterion(event: Event): void {
    const value = (event.target as HTMLSelectElement).value
    if (value === "tiempo" || value === "combustible" || value === "equilibrio") {
      this.criterion.set(value)
      this.selectedAlternative.set(0)
    }
  }

  openAlternativeMap(): void {
    const alternative = this.alternativeRows[this.selectedAlternative()]
    const parameters = this.parameters()
    if (!alternative || !parameters) return
    const points = alternative.orderIds
      .map((id) => this.selectedOrders.find((order) => order.id === id)?.clients)
      .filter((client) => client?.latitude !== undefined && client.longitude !== undefined)
      .map((client) => `${client!.latitude},${client!.longitude}`)
    if (!points.length) {
      this.state.showToast("No hay coordenadas suficientes para mostrar esta ruta.")
      return
    }
    const origin = `${parameters.warehouse_latitude},${parameters.warehouse_longitude}`
    const destination = points.pop()!
    const waypoints = points.length ? `&waypoints=${encodeURIComponent(points.join("|"))}` : ""
    window.open(
      `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${waypoints}`,
      "_blank",
      "noopener,noreferrer",
    )
  }

  toggleOrder(id: string, checked: boolean): void {
    const current = this.selectedOrderIds()
    if (checked && current.length >= 10) {
      this.state.showToast("Un reparto admite hasta 10 pedidos.")
      return
    }
    this.selectedOrderIds.set(checked ? [...current, id] : current.filter((value) => value !== id))
  }

  openMonitor(route: RemoteRouteSummary): void {
    this.routeId.set(route.id)
    this.routeCode.set(route.code)
    this.monitoredRoute.set(route)
    this.step.set(3)
    this.startRouteMonitor()
  }

  startNewRoute(): void {
    this.routeId.set("")
    this.routeCode.set("")
    this.plannedVehicleId.set("")
    this.selectedOrderIds.set([])
    this.monitoredRoute.set(null)
    this.step.set(0)
  }

  async approveRoute(): Promise<void> {
    if (!this.selectedOrderIds().length) {
      this.state.showToast("Selecciona al menos un pedido Listo.")
      return
    }
    if (!this.alternativeRows.length) {
      this.state.showToast("Completa la ubicación del almacén y los parámetros de ruta, y verifica las coordenadas de los clientes.")
      return
    }
    const alternative = this.alternativeRows[this.selectedAlternative()]
    if (!alternative) {
      this.state.showToast("No hay una alternativa de ruta disponible.")
      return
    }
    this.selectedOrderIds.set(alternative.orderIds)
    this.loading.set(true)
    try {
      if (!this.routeId()) {
        const result = await this.api.createRoute({
          orderIds: alternative.orderIds,
          distanceKm: alternative.distanceKm,
          estimatedMinutes: alternative.estimatedMinutes,
          estimatedLiters: alternative.estimatedLiters,
          estimatedCost: alternative.estimatedCost,
        })
        this.routeId.set(result.routeId)
        this.routeCode.set(result.code)
        this.plannedVehicleId.set(this.selectedVehicleId())
      }
      await this.api.approveRoute(this.routeId())
      this.state.showToast(`Reparto ${this.routeCode()} aprobado. Ahora asigna chofer y vehículo.`)
      this.step.set(2)
    } catch (error) {
      this.state.showToast(error instanceof Error ? error.message : "No se pudo aprobar el reparto.")
      return
    } finally {
      this.loading.set(false)
    }
    try {
      await this.refreshMonitoredRoute()
    } catch (error) {
      this.state.showToast(error instanceof Error
        ? `El reparto se aprobó, pero no se pudo actualizar la lista: ${error.message}`
        : "El reparto se aprobó, pero no se pudo actualizar la lista.")
    }
  }

  async confirmAssignment(): Promise<void> {
    if (!this.state.isOnline()) {
      this.state.showToast("Inicia sesión para asignar un reparto.")
      return
    }
    if (!this.selectedDriverId() || !this.selectedVehicleId()) {
      this.state.showToast("Selecciona un chofer y un vehículo cargados desde el backend.")
      return
    }
    const capacity = this.selectedVehicleCapacity
    if (capacity === undefined || this.selectedWeightKg > capacity) {
      this.state.showToast("La carga del reparto supera la capacidad del vehículo seleccionado.")
      return
    }
    const alternative = this.alternativeRows[this.selectedAlternative()]
    if (!alternative) {
      this.state.showToast("No hay una alternativa válida para el vehículo seleccionado.")
      return
    }
    this.loading.set(true)
    try {
      if (!this.routeId()) {
        throw new Error("Aprueba primero la ruta calculada.")
      }
      await this.api.assignRoute(this.routeId(), this.selectedDriverId(), this.selectedVehicleId())
    } catch (error) {
      this.state.showToast(error instanceof Error ? error.message : "No se pudo asignar el reparto.")
      return
    } finally {
      this.loading.set(false)
    }
    this.step.set(3)
    this.state.showToast("Reparto asignado correctamente.")
    try {
      await this.refreshMonitoredRoute()
      if (this.activeRoutes().length) this.startRouteMonitor()
    } catch (error) {
      this.state.showToast(
        error instanceof Error
          ? `El reparto se asignó, pero no se pudo cargar su monitor: ${error.message}`
          : "El reparto se asignó, pero no se pudo cargar su monitor.",
      )
    }
  }

  async cancelPendingRoute(): Promise<void> {
    const routeId = this.routeId()
    if (!routeId) return
    if (!window.confirm("¿Retirar este reparto sin asignar y liberar sus pedidos para volver a armarlos?")) return
    this.loading.set(true)
    try {
      await this.api.cancelPendingRoute(routeId)
      this.routeId.set("")
      this.routeCode.set("")
      this.plannedVehicleId.set("")
      this.selectedOrderIds.set([])
      this.step.set(0)
      await this.loadRouteData()
      this.state.showToast("Reparto retirado; los pedidos quedaron disponibles nuevamente.")
    } catch (error) {
      this.state.showToast(error instanceof Error ? error.message : "No se pudo retirar el reparto.")
    } finally {
      this.loading.set(false)
    }
  }

  async retirePendingRoute(route: RemoteRouteSummary): Promise<void> {
    if (!window.confirm(`¿Retirar el reparto ${route.code} y liberar sus pedidos?`)) return
    this.loading.set(true)
    try {
      await this.api.cancelPendingRoute(route.id)
      await this.loadRouteData()
      this.state.showToast(`Reparto ${route.code} retirado; sus pedidos quedaron disponibles para volver a planificarlos.`)
    } catch (error) {
      this.state.showToast(
        error instanceof Error
          ? `No se pudo retirar el reparto: ${error.message}`
          : "No se pudo retirar el reparto.",
      )
    } finally {
      this.loading.set(false)
    }
  }

  async approveRecoveredRoute(route: RemoteRouteSummary): Promise<void> {
    this.loading.set(true)
    try {
      await this.api.approveRoute(route.id)
      await this.loadRouteData()
      this.state.showToast(`Reparto ${route.code} aprobado.`)
    } catch (error) {
      this.state.showToast(error instanceof Error ? error.message : "No se pudo aprobar el reparto.")
    } finally {
      this.loading.set(false)
    }
  }

  async notifyDriver(): Promise<void> {
    this.state.showToast("La asignación quedó registrada. No se envió un aviso al chofer porque no hay un proveedor configurado.")
  }
}
