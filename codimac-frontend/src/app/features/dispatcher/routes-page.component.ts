import { Component, effect, signal, OnDestroy } from "@angular/core"
import { FechaPipe } from "../../shared/fecha.pipe"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import type { AssignmentNotice, RemoteOrder, RemoteRouteSummary } from "../../../lib/codimac-api"
import type { CriterioRuta, DestinoRuta, Vehiculo } from "../../../dominio/modelos"
import { generarAlternativas, ordenarPorPrioridad, recorridoReferencia } from "../../../dominio/rutas"
import {
  calcularAvisosFechaLimite,
  calcularPesoPedidosKg,
  excedeCapacidadCarga,
  formatearKg,
  parsearKg,
  porcentajeLlenado,
  pedidosQueSuperanFlota,
  sugerirDivisionCarga,
} from "../../../dominio/planificacion-ruta-ui"
import { IconComponent } from "../../shared/icon.component"
import { NumeroPipe } from "../../shared/numero.pipe"
import { StatusBadgeComponent } from "../../shared/status-badge.component"

interface Resource {
  id: string
  display_name?: string
  phone?: string | null
  plate?: string
  vehicle_type?: string
  capacity_kg?: number | string
  average_speed_kmh?: number
  fuel_efficiency_km_l?: number
}

const MAX_SELECTED_ORDERS = 30
const MAX_STOPS_PER_ROUTE = 10

interface RouteParameters {
  warehouse_latitude: number
  warehouse_longitude: number
  fuel_price: number
  minutes_per_stop: number
}

interface SplitGroup {
  key: number
  vehicleId: string
  driverId: string
  orderIds: string[]
}

@Component({
  selector: "codimac-routes-page",
  standalone: true,
  imports: [FechaPipe, IconComponent, NumeroPipe, StatusBadgeComponent],
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
  readonly routeStatus = signal("")
  readonly plannedVehicleId = signal("")
  readonly loading = signal(false)
  readonly monitoredRoute = signal<RemoteRouteSummary | null>(null)
  readonly activeRoutes = signal<RemoteRouteSummary[]>([])
  readonly pendingRoutes = signal<RemoteRouteSummary[]>([])
  readonly closedRoutes = signal<RemoteRouteSummary[]>([])
  readonly splitGroups = signal<SplitGroup[]>([])
  readonly assignmentNotice = signal<AssignmentNotice | null>(null)
  /** Confirmación propia (botón rojo) para retirar o cancelar un reparto sin salir. */
  readonly pendingRetire = signal<{ id: string; code: string; status: string } | null>(null)
  private nextGroupKey = 1

  calcularPeso(order: RemoteOrder): string {
    return formatearKg(calcularPesoPedidosKg([order]))
  }
  private monitorTimer: ReturnType<typeof setInterval> | null = null
  private alternativeCacheKey = ""
  private alternativeCache: ReturnType<typeof generarAlternativas> = []

  constructor(
    readonly state: AppStateService,
    private readonly api: CodimacApiService,
  ) {
    effect(() => {
      this.state.ordersRefresh()
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
    this.closedRoutes.set(routes.filter((route) => route.status === "Cerrada").slice(0, 5))
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

  /** RF-01.10: pedidos Listo ordenados por prioridad (RN-04). */
  get readyOrders(): RemoteOrder[] {
    const ready = this.orders().filter((order) => order.status === "Listo" && !order.active_route_id)
    const byId = new Map(ready.map((order) => [order.id, order]))
    return ordenarPorPrioridad(ready.map((order) => ({
      id: order.id,
      ...(order.deadline_at ? { fechaLimite: order.deadline_at } : {}),
      ...(order.ordered_at ? { fechaPedido: order.ordered_at } : {}),
    }))).map(({ id }) => byId.get(id)!)
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
    return this.orders().filter((order) =>
      selected.has(order.id) && order.status === "Listo",
    )
  }

  private destinationsFor(orders: RemoteOrder[]): DestinoRuta[] {
    return orders.flatMap((order) => {
      const client = order.clients
      if (client?.latitude === undefined || client.longitude === undefined) return []
      return [{
        id: order.id,
        etiqueta: `${order.code} · ${client.name}`,
        coordenadas: { latitud: Number(client.latitude), longitud: Number(client.longitude) },
        ...(order.deadline_at ? { fechaLimite: order.deadline_at } : {}),
        ...(order.ordered_at ? { fechaPedido: order.ordered_at } : {}),
      }]
    })
  }

  private estimationVehicle(resource: Resource): Vehiculo {
    return {
      id: resource.id,
      placa: resource.plate ?? "",
      capacidadKg: parsearKg(resource.capacity_kg),
      velocidadPromedioKmh: Number(resource.average_speed_kmh),
      rendimientoKmLitro: Number(resource.fuel_efficiency_km_l),
      disponible: true,
    }
  }

  /** RN-09: mismas paradas en orden de prioridad, con la misma matriz que la ruta elegida. */
  private referenceFor(orders: RemoteOrder[], vehicle: Resource | undefined) {
    const parameters = this.parameters()
    const destinations = this.destinationsFor(orders)
    if (!parameters || !vehicle?.average_speed_kmh || !destinations.length || destinations.length !== orders.length) {
      return null
    }
    return recorridoReferencia(
      { latitud: Number(parameters.warehouse_latitude), longitud: Number(parameters.warehouse_longitude) },
      destinations,
      this.estimationVehicle(vehicle),
      Number(parameters.fuel_price),
      Number(parameters.minutes_per_stop),
    )
  }

  get reference() {
    return this.referenceFor(this.selectedOrders, this.vehicleById(this.selectedVehicleId()))
  }

  get estimationVehiclePlate(): string {
    return this.vehicleById(this.plannedVehicleId())?.plate ?? ""
  }

  setEstimationVehicle(event: Event): void {
    this.selectedVehicleId.set((event.target as HTMLSelectElement).value)
    this.selectedAlternative.set(0)
  }

  get alternatives() {
    const orders = this.selectedOrders
    const parameters = this.parameters()
    const vehicle = this.resources().vehicles.find(
      (resource) => resource.id === this.selectedVehicleId(),
    )
    if (!orders.length || !parameters || !vehicle?.average_speed_kmh || !vehicle.fuel_efficiency_km_l) return []
    const destinations = this.destinationsFor(orders)
    if (destinations.length !== orders.length) return []
    const cacheKey = JSON.stringify([
      destinations.map((destination) => [
        destination.id,
        destination.etiqueta,
        destination.coordenadas.latitud,
        destination.coordenadas.longitud,
      ]),
      vehicle.id,
      vehicle.average_speed_kmh,
      vehicle.fuel_efficiency_km_l,
      parameters.warehouse_latitude,
      parameters.warehouse_longitude,
      parameters.fuel_price,
      parameters.minutes_per_stop,
      this.criterion(),
    ])
    if (cacheKey === this.alternativeCacheKey) return this.alternativeCache
    this.alternativeCache = generarAlternativas(
      { latitud: Number(parameters.warehouse_latitude), longitud: Number(parameters.warehouse_longitude) },
      destinations,
      this.estimationVehicle(vehicle),
      Number(parameters.fuel_price),
      Number(parameters.minutes_per_stop),
      this.criterion(),
    )
    this.alternativeCacheKey = cacheKey
    return this.alternativeCache
  }

  get alternativeRows() {
    return this.alternatives.map((route, index) => ({
      code: ["A", "B", "C"][index] ?? "A",
      title: ["Recomendada", "Alternativa", "Respaldo"][index] ?? "Alternativa",
      stops: route.orden.map((stop) => stop.etiqueta).join(" → "),
      distance: `${route.distanciaKm.toFixed(1)} km`,
      time: `${Math.round(route.tiempoMinutos)} min`,
      liters: `${route.litros.toFixed(2)} L`,
      cost: `S/ ${route.costoCombustible.toFixed(2)}`,
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

  readonly formatKg = formatearKg

  get selectedVehicleCapacity(): number | undefined {
    const vehicle = this.resources().vehicles.find((item) => item.id === this.selectedVehicleId())
    if (!vehicle) return undefined
    const capacity = parsearKg(vehicle.capacity_kg)
    return Number.isFinite(capacity) ? capacity : undefined
  }

  /** Sin vehículo elegido no hay nada que comparar: la falta de selección no es sobrecarga. */
  get capacityExceeded(): boolean {
    if (!this.selectedVehicleId()) return false
    return excedeCapacidadCarga(this.selectedWeightKg, this.selectedVehicleCapacity)
  }

  private orderWeight(orderId: string): number {
    const order = this.orders().find((item) => item.id === orderId)
    return order ? calcularPesoPedidosKg([order]) : 0
  }

  private vehicleById(id: string): Resource | undefined {
    return this.resources().vehicles.find((vehicle) => vehicle.id === id)
  }

  get maxFleetCapacity(): number {
    return Math.max(0, ...this.resources().vehicles.map((vehicle) => parsearKg(vehicle.capacity_kg ?? 0) || 0))
  }

  /** La carga no cabe en el vehículo elegido ni en ningún vehículo individual de la flota. */
  get needsSplit(): boolean {
    const weight = Number(this.selectedWeightKg)
    if (!this.selectedOrderIds().length || !this.resources().vehicles.length) return false
    return this.selectedOrderIds().length > MAX_STOPS_PER_ROUTE ||
      weight > this.maxFleetCapacity ||
      this.capacityExceeded
  }

  get suggestedSplitCount(): number {
    const split = this.computeSuggestion()
    const missing = split.sinAsignar.length ? 1 : 0
    return Math.max(2, split.grupos.length + missing)
  }

  private computeSuggestion() {
    return sugerirDivisionCarga(
      this.selectedOrders.map((order) => ({ id: order.id, pesoKg: calcularPesoPedidosKg([order]) })),
      this.resources().vehicles.map((vehicle) => ({
        id: vehicle.id,
        capacidadKg: parsearKg(vehicle.capacity_kg ?? 0) || 0,
      })),
    )
  }

  async openSplitAssistant(): Promise<void> {
    if (!this.selectedOrderIds().length) {
      this.state.showToast("Selecciona al menos un pedido Listo.")
      return
    }
    this.loading.set(true)
    try {
      this.resources.set(await this.api.getResources())
      this.splitGroups.set([])
      this.suggestSplit()
      this.step.set(4)
    } catch (error) {
      this.state.showToast(error instanceof Error
        ? `No se pudo actualizar la disponibilidad: ${error.message}`
        : "No se pudo actualizar la disponibilidad de la flota.")
    } finally {
      this.loading.set(false)
    }
  }

  suggestSplit(): void {
    const { grupos, sinAsignar } = this.computeSuggestion()
    const drivers = this.resources().drivers
    this.splitGroups.set(grupos.map((grupo, index) => ({
      key: this.nextGroupKey++,
      vehicleId: grupo.vehiculoId,
      driverId: drivers[index]?.id ?? "",
      orderIds: grupo.pedidoIds,
    })))
    if (sinAsignar.length) {
      this.state.showToast(
        `${sinAsignar.length} pedido(s) no caben en la flota disponible; asígnalos manualmente o libera vehículos.`,
      )
    }
  }

  get unassignedSplitOrders(): RemoteOrder[] {
    const assigned = new Set(this.splitGroups().flatMap((group) => group.orderIds))
    return this.selectedOrders.filter((order) => !assigned.has(order.id))
  }

  get canAddSplitGroup(): boolean {
    const groups = this.splitGroups()
    return groups.length < this.resources().vehicles.length && groups.length < this.resources().drivers.length
  }

  addSplitGroup(): number | null {
    const groups = this.splitGroups()
    const usedVehicles = new Set(groups.map((group) => group.vehicleId))
    const usedDrivers = new Set(groups.map((group) => group.driverId))
    const vehicle = this.resources().vehicles.find((item) => !usedVehicles.has(item.id))
    const driver = this.resources().drivers.find((item) => !usedDrivers.has(item.id))
    if (!vehicle || !driver) {
      this.state.showToast("No hay más vehículos o choferes disponibles para otra ruta.")
      return null
    }
    const key = this.nextGroupKey++
    this.splitGroups.set([...groups, { key, vehicleId: vehicle.id, driverId: driver.id, orderIds: [] }])
    return key
  }

  removeSplitGroup(key: number): void {
    this.splitGroups.set(this.splitGroups().filter((group) => group.key !== key))
  }

  private updateGroup(key: number, change: Partial<SplitGroup>): void {
    this.splitGroups.set(this.splitGroups().map((group) => group.key === key ? { ...group, ...change } : group))
  }

  setGroupVehicle(key: number, vehicleId: string): void {
    this.updateGroup(key, { vehicleId })
  }

  setGroupDriver(key: number, driverId: string): void {
    this.updateGroup(key, { driverId })
  }

  /** Reasigna un pedido: "0" lo deja sin asignar, "new" abre una ruta nueva y un número lo mueve a esa ruta. */
  reassignOrder(orderId: string, destination: string): void {
    if (destination === "new") {
      const key = this.addSplitGroup()
      if (key !== null) this.moveOrder(orderId, key)
      return
    }
    this.moveOrder(orderId, Number(destination))
  }

  /** Mueve un pedido a una ruta del lote; key 0 lo deja sin asignar. */
  moveOrder(orderId: string, key: number): void {
    const target = this.splitGroups().find((group) => group.key === key)
    if (target && target.orderIds.length >= MAX_STOPS_PER_ROUTE && !target.orderIds.includes(orderId)) {
      this.state.showToast(`Una ruta admite hasta ${MAX_STOPS_PER_ROUTE} paradas.`)
      return
    }
    this.splitGroups.set(this.splitGroups().map((group) => {
      const without = group.orderIds.filter((id) => id !== orderId)
      return group.key === key ? { ...group, orderIds: [...without, orderId] } : { ...group, orderIds: without }
    }))
  }

  groupOrders(group: SplitGroup): RemoteOrder[] {
    return group.orderIds
      .map((id) => this.orders().find((order) => order.id === id))
      .filter((order): order is RemoteOrder => order !== undefined)
  }

  groupWeight(group: SplitGroup): number {
    return group.orderIds.reduce((sum, id) => sum + this.orderWeight(id), 0)
  }

  groupCapacity(group: SplitGroup): number {
    return parsearKg(this.vehicleById(group.vehicleId)?.capacity_kg ?? 0) || 0
  }

  groupFill(group: SplitGroup): number {
    return porcentajeLlenado(this.groupWeight(group), this.groupCapacity(group))
  }

  groupExceeded(group: SplitGroup): boolean {
    return excedeCapacidadCarga(this.groupWeight(group), this.groupCapacity(group))
  }

  /** Rutas con al menos un pedido; las tarjetas vacías se ignoran al crear. */
  get activeSplitGroups(): SplitGroup[] {
    return this.splitGroups().filter((group) => group.orderIds.length > 0)
  }

  /** Pedidos sin asignar cuyo peso individual supera cualquier vehículo de la flota. */
  get oversizedOrderIds(): Set<string> {
    return new Set(pedidosQueSuperanFlota(
      this.selectedOrders.map((order) => ({ id: order.id, pesoKg: calcularPesoPedidosKg([order]) })),
      this.resources().vehicles.map((vehicle) => ({
        id: vehicle.id,
        capacidadKg: parsearKg(vehicle.capacity_kg ?? 0) || 0,
      })),
    ))
  }

  get unassignedWeightKg(): number {
    return calcularPesoPedidosKg(this.unassignedSplitOrders)
  }

  /** Motivo por el que no se puede crear aún; vacío si se puede. Los pedidos sin asignar no bloquean. */
  get splitBlocker(): string {
    const groups = this.activeSplitGroups
    if (this.loading()) return "Guardando…"
    if (!groups.length) return "Asigna al menos un pedido a una ruta."
    if (new Set(groups.map((group) => group.vehicleId)).size !== groups.length) {
      return "Cada ruta necesita un vehículo distinto."
    }
    if (groups.some((group) => !group.driverId) ||
      new Set(groups.map((group) => group.driverId)).size !== groups.length) {
      return "Cada ruta necesita un chofer distinto."
    }
    if (groups.some((group) => !this.vehicleById(group.vehicleId) ||
      !this.resources().drivers.some((driver) => driver.id === group.driverId))) {
      return "Un vehículo o chofer ya no está disponible. Actualiza la asignación."
    }
    if (groups.some((group) => this.groupExceeded(group))) {
      return "Hay rutas que superan la capacidad de su vehículo."
    }
    return ""
  }

  get canCreateSplit(): boolean {
    return this.splitBlocker === ""
  }

  async createSplitRoutes(): Promise<void> {
    if (!this.canCreateSplit) return
    const parameters = this.parameters()
    if (!parameters) {
      this.state.showToast("Completa la ubicación del almacén y los parámetros de ruta.")
      return
    }
    const routes = []
    for (const group of this.activeSplitGroups) {
      const vehicle = this.vehicleById(group.vehicleId)
      const destinations = this.groupOrders(group).flatMap((order) => {
        const client = order.clients
        if (client?.latitude === undefined || client.longitude === undefined) return []
        return [{
          id: order.id,
          etiqueta: `${order.code} · ${client.name}`,
          coordenadas: { latitud: Number(client.latitude), longitud: Number(client.longitude) },
        }]
      })
      const best = vehicle && destinations.length === group.orderIds.length
        ? generarAlternativas(
          { latitud: Number(parameters.warehouse_latitude), longitud: Number(parameters.warehouse_longitude) },
          destinations,
          this.estimationVehicle(vehicle),
          Number(parameters.fuel_price),
          Number(parameters.minutes_per_stop),
          this.criterion(),
        )[0]
        : undefined
      if (!best) {
        this.state.showToast("No se pudo calcular la secuencia de una ruta: revisa coordenadas y parámetros.", "error")
        return
      }
      const reference = this.referenceFor(this.groupOrders(group), vehicle)
      routes.push({
        orderIds: best.orden.map((stop) => stop.id),
        distanceKm: best.distanciaKm,
        estimatedMinutes: Math.round(best.tiempoMinutos),
        estimatedLiters: best.litros,
        estimatedCost: best.costoCombustible,
        ...(reference
          ? { referenceKm: reference.distanciaKm, referenceMinutes: Math.round(reference.tiempoMinutos) }
          : {}),
        driverId: group.driverId,
        vehicleId: group.vehicleId,
      })
    }
    const leftover = this.unassignedSplitOrders.length
    this.loading.set(true)
    try {
      const created = await this.api.createRouteBatch({ routes })
      this.splitGroups.set([])
      this.selectedOrderIds.set([])
      this.step.set(0)
      await this.loadRouteData()
      this.state.showToast(
        `${created.routes.length} rutas creadas, aprobadas y asignadas: ${created.routes.map((route) => route.code).join(", ")}.` +
          (leftover ? ` ${leftover} pedido(s) siguen en Listo con su reserva intacta.` : ""),
      )
    } catch (error) {
      this.state.showToast(error instanceof Error
        ? `No se creó ninguna ruta: ${error.message}`
        : "No se pudieron crear las rutas; no se guardó ningún cambio.")
      try {
        this.resources.set(await this.api.getResources())
      } catch { /* la disponibilidad se refresca en la siguiente carga */ }
    } finally {
      this.loading.set(false)
    }
  }

  get canAssignRoute(): boolean {
    return !this.loading() &&
      this.selectedOrderIds().length > 0 &&
      Boolean(this.routeId()) &&
      this.routeStatus() === "Aprobada" &&
      Boolean(this.selectedDriverId()) &&
      Boolean(this.selectedVehicleId()) &&
      this.resources().drivers.some((driver) => driver.id === this.selectedDriverId()) &&
      this.resources().vehicles.some((vehicle) => vehicle.id === this.selectedVehicleId()) &&
      !this.capacityExceeded
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
      this.state.showToast("No hay coordenadas suficientes para mostrar esta ruta.", "error")
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
    if (checked && current.length >= MAX_SELECTED_ORDERS) {
      this.state.showToast(`Puedes seleccionar hasta ${MAX_SELECTED_ORDERS} pedidos por planificación.`)
      return
    }
    this.selectedOrderIds.set(checked ? [...current, id] : current.filter((value) => value !== id))
  }

  openMonitor(route: RemoteRouteSummary): void {
    this.routeId.set(route.id)
    this.routeCode.set(route.code)
    this.routeStatus.set(route.status)
    this.monitoredRoute.set(route)
    this.assignmentNotice.set(null)
    this.step.set(3)
    this.startRouteMonitor()
  }

  startNewRoute(): void {
    this.routeId.set("")
    this.routeCode.set("")
    this.routeStatus.set("")
    this.plannedVehicleId.set("")
    this.selectedOrderIds.set([])
    this.monitoredRoute.set(null)
    this.assignmentNotice.set(null)
    this.step.set(0)
  }

  canGoToStep(target: number): boolean {
    if (target === this.step()) return true
    if (this.routeId()) {
      const status = this.monitoredRoute()?.status ?? this.routeStatus()
      if (target === 2) return status === "Aprobada"
      return target === 3 && (status === "Asignada" || status === "En curso" || status === "Cerrada")
    }
    if (target === 0) return true
    if (target === 1) return this.selectedOrders.length > 0
    return false
  }

  stepBlockedReason(target: number): string | null {
    if (this.canGoToStep(target)) return null
    if (target === 3) return "Disponible cuando exista un reparto asignado o en curso."
    if (target === 2) return "Aprueba una ruta antes de asignar chofer y vehículo."
    if (this.routeId()) return "Este reparto ya fue aprobado."
    return "Selecciona al menos un pedido Listo."
  }

  goToStep(target: number): void {
    if (this.canGoToStep(target)) this.step.set(target)
  }

  get selectedSavingsMinutes(): number | null {
    const alternative = this.alternativeRows[this.selectedAlternative()]
    const reference = this.reference
    if (!alternative || !reference) return null
    return Math.round(reference.tiempoMinutos) - alternative.estimatedMinutes
  }

  /** P-D07 → paso 6 del flujo: guarda la alternativa elegida (Calculada) y la aprueba (Aprobada). */
  async approveSelectedAlternative(): Promise<void> {
    const alternative = this.alternativeRows[this.selectedAlternative()]
    if (!alternative) {
      this.state.showToast(
        "Completa la ubicación del almacén y los parámetros de ruta, y verifica las coordenadas de los clientes.",
        "error",
      )
      return
    }
    if (this.capacityExceeded) {
      this.state.showToast(
        `El peso del reparto (${formatearKg(this.selectedWeightKg)} kg) supera la capacidad del vehículo (${formatearKg(this.selectedVehicleCapacity)} kg).`,
        "error",
      )
      return
    }
    this.loading.set(true)
    try {
      const reference = this.reference
      const created = await this.api.createRoute({
        orderIds: alternative.orderIds,
        distanceKm: alternative.distanceKm,
        estimatedMinutes: alternative.estimatedMinutes,
        estimatedLiters: alternative.estimatedLiters,
        estimatedCost: alternative.estimatedCost,
        ...(reference
          ? { referenceKm: reference.distanciaKm, referenceMinutes: Math.round(reference.tiempoMinutos) }
          : {}),
      })
      this.routeId.set(created.routeId)
      this.routeCode.set(created.code)
      this.routeStatus.set(created.status)
      this.plannedVehicleId.set(this.selectedVehicleId())
      this.selectedOrderIds.set(alternative.orderIds)
      await this.api.approveRoute(created.routeId)
      this.routeStatus.set("Aprobada")
      const resources = await this.api.getResources()
      this.resources.set(resources)
      if (!resources.drivers.some((driver) => driver.id === this.selectedDriverId())) {
        this.selectedDriverId.set(resources.drivers[0]?.id ?? "")
      }
      if (!resources.vehicles.some((vehicle) => vehicle.id === this.selectedVehicleId())) {
        this.selectedVehicleId.set(resources.vehicles[0]?.id ?? "")
      }
      this.step.set(2)
      this.state.showToast(`Ruta ${created.code} aprobada con ${alternative.orderIds.length} paradas.`)
    } catch (error) {
      const saved = this.routeId() ? `La ruta ${this.routeCode()} quedó en ${this.routeStatus()}. ` : ""
      this.state.showToast(
        `${saved}${error instanceof Error ? error.message : "No se pudo aprobar la ruta."}`,
        "error",
        6000,
      )
      await this.loadRouteData()
    } finally {
      this.loading.set(false)
    }
  }

  /** Paso 7 del flujo: asigna chofer y vehículo a la ruta Aprobada y muestra el resultado del aviso. */
  async confirmAssignment(): Promise<void> {
    const routeId = this.routeId()
    if (!routeId || this.routeStatus() !== "Aprobada") {
      this.state.showToast("Aprueba la ruta antes de asignar chofer y vehículo.", "error")
      return
    }
    if (!this.selectedDriverId() || !this.selectedVehicleId()) {
      this.state.showToast("Elige un chofer y un vehículo disponibles.", "error")
      return
    }
    if (excedeCapacidadCarga(this.selectedWeightKg, this.selectedVehicleCapacity)) {
      this.state.showToast(
        `El peso del reparto (${formatearKg(this.selectedWeightKg)} kg) supera la capacidad del vehículo (${formatearKg(this.selectedVehicleCapacity)} kg).`,
        "error",
      )
      return
    }
    this.loading.set(true)
    try {
      const result = await this.api.assignRoute(routeId, this.selectedDriverId(), this.selectedVehicleId())
      this.routeStatus.set("Asignada")
      this.assignmentNotice.set(result.notification ?? null)
    } catch (error) {
      this.state.showError(error, "No se pudo asignar el reparto.")
      try {
        const [routes, resources] = await Promise.all([this.api.getRoutes(), this.api.getResources()])
        this.resources.set(resources)
        const currentRoute = routes.find((route) => route.id === routeId)
        if (currentRoute) {
          this.routeStatus.set(currentRoute.status)
          this.monitoredRoute.set(currentRoute)
          if (currentRoute.status === "Asignada" || currentRoute.status === "En curso") this.step.set(3)
        }
      } catch {
        // La siguiente carga del monitor vuelve a consultar el estado.
      }
      return
    } finally {
      this.loading.set(false)
    }
    this.step.set(3)
    this.state.showToast(`Reparto ${this.routeCode()} asignado.`)
    await this.loadRouteData()
    this.startRouteMonitor()
  }

  requestRetire(route: { id: string; code: string; status: string }): void {
    this.pendingRetire.set(route)
  }

  closeRetire(): void {
    if (!this.loading()) this.pendingRetire.set(null)
  }

  async confirmRetire(): Promise<void> {
    const route = this.pendingRetire()
    if (!route || this.loading()) return
    const assigned = route.status === "Asignada"
    this.loading.set(true)
    try {
      await this.api.cancelPendingRoute(route.id)
      this.pendingRetire.set(null)
      if (this.routeId() === route.id) this.startNewRoute()
      await this.loadRouteData()
      this.state.showToast(assigned
        ? `Reparto ${route.code} cancelado; chofer y vehículo quedaron disponibles.`
        : `Reparto ${route.code} retirado; sus pedidos volvieron a Listo para planificarlos.`)
    } catch (error) {
      this.state.showError(error, "No se pudo retirar el reparto.")
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
      this.state.showError(error, "No se pudo aprobar el reparto.")
    } finally {
      this.loading.set(false)
    }
  }

  confirmedStopCount(route: RemoteRouteSummary | null): number {
    return route?.route_stops.filter((stop) => stop.status === "Entregada" || stop.status === "No entregada").length ?? 0
  }

  incidentCount(route: RemoteRouteSummary | null): number {
    return route?.route_stops.filter((stop) => stop.status === "Incidencia").length ?? 0
  }

  async assignRecoveredRoute(route: RemoteRouteSummary): Promise<void> {
    if (route.status !== "Aprobada") return
    this.loading.set(true)
    try {
      const [orders, resources] = await Promise.all([
        this.api.getOrders(),
        this.api.getResources(),
      ])
      this.orders.set(orders)
      this.resources.set(resources)
      this.selectedDriverId.set(resources.drivers[0]?.id ?? "")
      this.selectedVehicleId.set(resources.vehicles[0]?.id ?? "")
      this.selectedOrderIds.set(route.route_stops.map((stop) => stop.order_id))
      this.routeId.set(route.id)
      this.routeCode.set(route.code)
      this.routeStatus.set(route.status)
      this.monitoredRoute.set(route)
      this.step.set(2)
    } catch (error) {
      this.state.showError(error, `No se pudo recuperar la ruta ${route.code}.`)
    } finally {
      this.loading.set(false)
    }
  }
}
