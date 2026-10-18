import { DatePipe } from "@angular/common"
import { Component, effect, signal } from "@angular/core"
import { FormsModule } from "@angular/forms"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import { IconComponent } from "../../shared/icon.component"
import { MapLocationPickerComponent } from "../../shared/map-location-picker.component"
import { StatusBadgeComponent } from "../../shared/status-badge.component"
import type { AuditEvent } from "../../../lib/codimac-api"
import { HistoryPageComponent } from "../dispatcher/history-page.component"

interface RouteParameters {
  warehouse_latitude: string | number
  warehouse_longitude: string | number
  fuel_price: string | number
  minutes_per_stop: string | number
  service_radius_km?: string | number
}

@Component({
  selector: "codimac-admin",
  standalone: true,
  imports: [DatePipe, FormsModule, HistoryPageComponent, IconComponent, MapLocationPickerComponent, StatusBadgeComponent],
  templateUrl: "./admin-feature.component.html",
})
export class AdminFeatureComponent {
  readonly loadingDemoData = signal(false)
  readonly editingId = signal("")
  readonly auditEvents = signal<AuditEvent[]>([])
  readonly auditTotal = signal(0)
  readonly auditOffset = signal(0)
  readonly auditLimit = 25
  auditDesde = ""
  auditHasta = ""
  auditUsuario = ""
  auditEntidad = ""
  auditAccion = ""
  editName = ""
  editPhone = ""
  editRole = "Despachador"
  editActive = true
  editPassword = ""
  editUnit = ""
  editWeightKg = 0
  editPlate = ""
  editVehicleType = ""
  editCapacityKg = 0
  editSpeedKmh = 0
  editFuelEfficiency = 0
  editAvailable = true
  warehouseLatitude = -13.6366
  warehouseLongitude = -72.8814
  fuelPrice = 6.2
  minutesPerStop = 8
  serviceRadiusKm = 50
  parametersConfigured = false

  constructor(
    readonly state: AppStateService,
    private readonly api: CodimacApiService,
  ) {
    effect(() => {
      const online = this.state.isOnline()
      const section = this.state.active()
      this.state.catalogRefresh()
      if (online) void this.loadSection(section)
    })
  }

  metricRows = [
    ["Entregas", "—", "Rutas cerradas"],
    ["Incidencias", "—", "Rutas cerradas"],
    ["Tiempo total", "—", "Rutas cerradas"],
    ["Kilómetros", "—", "Rutas cerradas"],
    ["Combustible", "—", "Costo estimado"],
  ]

  tableData: Record<string, { headers: string[]; rows: string[][] }> = {
    Usuarios: {
      headers: ["Nombre", "Correo", "Celular", "Rol", "Estado"],
      rows: [],
    },
    Productos: {
      headers: ["Producto", "Unidad", "Peso", "Stock inicial"],
      rows: [],
    },
    "Vehículos": {
      headers: ["Placa", "Tipo", "Capacidad", "Disponibilidad"],
      rows: [],
    },
    "Auditoría": {
      headers: ["Fecha y hora", "Usuario", "Entidad", "Cambio"],
      rows: [],
    },
  }
  recordIds: Record<string, string[]> = {
    Usuarios: [],
    Productos: [],
    "Vehículos": [],
    "Auditoría": [],
  }

  get selectedData() {
    return this.tableData[this.state.active()]
  }

  get auditPageEnd(): number {
    return Math.min(this.auditOffset() + this.auditLimit, this.auditTotal())
  }

  openCreateDialog(): void {
    const section = this.state.active()
    const message =
      section === "Auditoría"
        ? "Exportar auditoría"
        : `Formulario de ${section.toLowerCase()} abierto`
    this.state.action(message)
  }

  updateWarehouseLocation(location: { latitude: number; longitude: number }): void {
    this.warehouseLatitude = Number(location.latitude.toFixed(6))
    this.warehouseLongitude = Number(location.longitude.toFixed(6))
  }

  async saveParameters(): Promise<void> {
    try {
      await this.api.updateParameters({
        warehouseLatitude: Number(this.warehouseLatitude),
        warehouseLongitude: Number(this.warehouseLongitude),
        fuelPrice: Number(this.fuelPrice),
        minutesPerStop: Number(this.minutesPerStop),
        serviceRadiusKm: Number(this.serviceRadiusKm),
      })
      this.parametersConfigured = true
      this.state.showToast("Parámetros de ruta guardados correctamente.")
    } catch (error) {
      this.state.showToast(error instanceof Error ? error.message : "No se pudieron guardar los parámetros.")
    }
  }

  async loadDemoData(): Promise<void> {
      if (!window.confirm("Se agregarán los datos demostrativos que falten. Los registros existentes no se eliminarán ni modificarán. ¿Deseas continuar?")) {
        return
      }
      this.loadingDemoData.set(true)
      try {
        await this.api.loadDemoData()
        this.state.catalogRefresh.update((value) => value + 1)
        this.state.showToast("Datos de ejemplo inicializados correctamente")
      } catch (error) {
        this.state.showToast(error instanceof Error ? error.message : "No se pudieron cargar los datos demostrativos.")
      } finally {
        this.loadingDemoData.set(false)
      }
    }

  startEdit(index: number): void {
    const section = this.state.active()
    const row = this.tableData[section]?.rows[index]
    const id = this.recordIds[section]?.[index]
    if (!row || !id) return
    this.editingId.set(id)
    if (section === "Usuarios") {
      this.editName = row[0]
      this.editPhone = row[2] === "—" ? "" : row[2]
      this.editRole = row[3]
      this.editActive = row[4] === "Activo"
      this.editPassword = ""
    } else if (section === "Productos") {
      this.editName = row[0]
      this.editUnit = row[1]
      this.editWeightKg = Number.parseFloat(row[2])
    } else if (section === "Vehículos") {
      this.editPlate = row[0]
      this.editVehicleType = row[1]
      this.editCapacityKg = Number.parseFloat(row[2])
      const resource = this.vehicleRecords.find((item) => item.id === id)
      this.editSpeedKmh = resource?.averageSpeedKmh ?? 30
      this.editFuelEfficiency = resource?.fuelEfficiency ?? 10
      this.editAvailable = row[3] === "Disponible"
    }
  }

  async saveEdit(): Promise<void> {
    const section = this.state.active()
    const id = this.editingId()
    if (!id) return
    try {
      if (section === "Usuarios") {
        await this.api.updateAdminUser(id, {
          name: this.editName.trim(),
          phone: this.editPhone.trim() || null,
          role: this.editRole,
          active: this.editActive,
          ...(this.editPassword ? { password: this.editPassword } : {}),
        })
      } else if (section === "Productos") {
        await this.api.updateCatalogRecord("products", id, {
          name: this.editName.trim(),
          unit: this.editUnit.trim(),
          weight_kg: Number(this.editWeightKg),
        })
      } else if (section === "Vehículos") {
        await this.api.updateCatalogRecord("vehicles", id, {
          plate: this.editPlate.trim(),
          vehicle_type: this.editVehicleType,
          capacity_kg: Number(this.editCapacityKg),
          average_speed_kmh: Number(this.editSpeedKmh),
          fuel_efficiency_km_l: Number(this.editFuelEfficiency),
          available: this.editAvailable,
        })
      } else {
        return
      }
      this.editingId.set("")
      await this.loadSection(section)
      this.state.showToast("Cambios guardados correctamente.")
    } catch (error) {
      this.state.showToast(error instanceof Error ? error.message : "No se pudieron guardar los cambios.")
    }
  }

  cancelEdit(): void {
    this.editingId.set("")
  }

  applyAuditFilters(): void {
    this.auditOffset.set(0)
    void this.loadAuditEvents()
  }

  previousAuditPage(): void {
    this.auditOffset.update((offset) => Math.max(0, offset - this.auditLimit))
    void this.loadAuditEvents()
  }

  nextAuditPage(): void {
    if (this.auditOffset() + this.auditLimit >= this.auditTotal()) return
    this.auditOffset.update((offset) => offset + this.auditLimit)
    void this.loadAuditEvents()
  }

  formatAuditValue(value: Record<string, unknown> | null): string {
    return value === null ? "—" : JSON.stringify(value)
  }

  private async loadAuditEvents(): Promise<void> {
    try {
      const { events, total } = await this.api.getAdminAuditEvents({
        desde: this.auditDesde ? new Date(this.auditDesde).toISOString() : undefined,
        hasta: this.auditHasta ? new Date(this.auditHasta).toISOString() : undefined,
        usuario: this.auditUsuario.trim() || undefined,
        entidad: this.auditEntidad || undefined,
        accion: this.auditAccion.trim() || undefined,
        limit: this.auditLimit,
        offset: this.auditOffset(),
      })
      this.auditEvents.set(events)
      this.auditTotal.set(total)
    } catch (error) {
      this.state.showToast(error instanceof Error ? error.message : "No se pudo cargar la auditoría.")
    }
  }

  private vehicleRecords: Array<{
    id: string
    averageSpeedKmh: number
    fuelEfficiency: number
  }> = []

  private async loadSection(section: string): Promise<void> {
    try {
      if (section === "Usuarios") {
        const { users } = await this.api.getAdminUsers()
        this.recordIds["Usuarios"] = users.map((user) => user.id)
        this.tableData["Usuarios"].rows = users.map((user) => [
          user.display_name,
          user.email,
          user.phone ?? "—",
          user.role,
          user.active ? "Activo" : "Inactivo",
        ])
      } else if (section === "Productos") {
        const products = await this.api.getCatalog<Array<{
          name: string
          unit: string
          weight_kg: number | string
          total_stock: number | string
          id: string
        }>>("products")
        this.recordIds["Productos"] = products.map((product) => product.id)
        this.tableData["Productos"].rows = products.map((product) => [
          product.name,
          product.unit,
          `${product.weight_kg} kg`,
          String(product.total_stock),
        ])
      } else if (section === "Vehículos") {
        const vehicles = await this.api.getCatalog<Array<{
          plate: string
          vehicle_type: string
          capacity_kg: number | string
          available: boolean
          id: string
          average_speed_kmh: number | string
          fuel_efficiency_km_l: number | string
        }>>("vehicles")
        this.recordIds["Vehículos"] = vehicles.map((vehicle) => vehicle.id)
        this.vehicleRecords = vehicles.map((vehicle) => ({
          id: vehicle.id,
          averageSpeedKmh: Number(vehicle.average_speed_kmh),
          fuelEfficiency: Number(vehicle.fuel_efficiency_km_l),
        }))
        this.tableData["Vehículos"].rows = vehicles.map((vehicle) => [
          vehicle.plate,
          vehicle.vehicle_type,
          `${vehicle.capacity_kg} kg`,
          vehicle.available ? "Disponible" : "No disponible",
        ])
      } else if (section === "Auditoría") {
        await this.loadAuditEvents()
      } else if (section === "Historial") {
        const { events } = await this.api.getAdminEvents()
        this.tableData["Auditoría"].rows = events.map((event) => [
          new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeStyle: "short" }).format(new Date(event.created_at)),
          event.user,
          event.role,
          event.message,
        ])
      } else if (section === "Indicadores") {
        const { indicators } = await this.api.getIndicators()
        const total = (key: string) => indicators.reduce((sum, row) => sum + Number(row[key] ?? 0), 0)
        const minutes = total("estimated_minutes")
        this.metricRows = [
          ["Entregas", String(total("delivered")), "Rutas cerradas"],
          ["Incidencias", String(total("incidents")), "Rutas cerradas"],
          ["Tiempo total", `${Math.floor(minutes / 60)} h`, `${minutes % 60} min`],
          ["Kilómetros", `${total("distance_km").toFixed(1)} km`, "Rutas cerradas"],
          ["Combustible", `S/ ${total("estimated_cost").toFixed(2)}`, "Costo estimado"],
        ]
      } else if (section === "Parámetros") {
        const parameters = await this.api.getCatalog<RouteParameters | null>("parameters")
        this.parametersConfigured = parameters !== null
        if (parameters) {
          this.warehouseLatitude = Number(parameters.warehouse_latitude)
          this.warehouseLongitude = Number(parameters.warehouse_longitude)
          this.fuelPrice = Number(parameters.fuel_price)
          this.minutesPerStop = Number(parameters.minutes_per_stop)
          this.serviceRadiusKm = Number(parameters.service_radius_km ?? 50)
        }
      }
    } catch (error) {
      this.state.showToast(error instanceof Error ? error.message : `No se pudo cargar ${section.toLowerCase()}.`)
    }
  }
}
