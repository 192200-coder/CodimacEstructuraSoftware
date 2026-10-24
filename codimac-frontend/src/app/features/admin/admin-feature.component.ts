import { Component, effect, HostListener, signal, untracked } from "@angular/core"
import { FechaPipe } from "../../shared/fecha.pipe"
import { FormsModule } from "@angular/forms"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import type { DialogKind } from "../../core/models"
import { IconComponent } from "../../shared/icon.component"
import { MapLocationPickerComponent } from "../../shared/map-location-picker.component"
import { NumeroPipe } from "../../shared/numero.pipe"
import { StatusBadgeComponent } from "../../shared/status-badge.component"
import { ApiRequestError, type AuditEvent, type RemoteIndicator } from "../../../lib/codimac-api"
import { HistoryPageComponent } from "../dispatcher/history-page.component"
import {
  filtrarPorCierre,
  formatearDuracion,
  resumirIndicadores,
} from "../../../dominio/indicadores"
import {
  normalizarPlaca,
  ROLES_USUARIO,
  TIPOS_VEHICULO,
  UNIDADES_PRODUCTO,
  validarParametros,
  validarProducto,
  validarUsuario,
  validarVehiculo,
  type ErroresCampo,
} from "../../../dominio/validaciones"

interface RouteParameters {
  warehouse_latitude: string | number
  warehouse_longitude: string | number
  fuel_price: string | number
  minutes_per_stop: string | number
  service_radius_km?: string | number
}

interface UserRecord {
  id: string
  email: string
  display_name: string
  phone: string | null
  role: string
  active: boolean
}

interface ProductRecord {
  id: string
  name: string
  unit: string
  weight_kg: number | string
  total_stock: number | string
}

interface VehicleRecord {
  id: string
  plate: string
  vehicle_type: string
  capacity_kg: number | string
  average_speed_kmh: number | string
  fuel_efficiency_km_l: number | string
  available: boolean
}

type EditableSection = "Usuarios" | "Productos" | "Vehículos"

const createDialogs: Record<EditableSection, DialogKind> = {
  Usuarios: "user",
  Productos: "product",
  "Vehículos": "vehicle",
}

const createLabels: Record<EditableSection, string> = {
  Usuarios: "Crear usuario",
  Productos: "Nuevo producto",
  "Vehículos": "Nuevo vehículo",
}

const backendFieldNames: Record<string, string> = {
  weight_kg: "weightKg",
  vehicle_type: "vehicleType",
  capacity_kg: "capacityKg",
  average_speed_kmh: "averageSpeedKmh",
  fuel_efficiency_km_l: "fuelEfficiencyKmL",
  warehouseLatitude: "warehouse",
  warehouseLongitude: "warehouse",
}

@Component({
  selector: "codimac-admin",
  standalone: true,
  imports: [FechaPipe, FormsModule, HistoryPageComponent, IconComponent, MapLocationPickerComponent, NumeroPipe, StatusBadgeComponent],
  templateUrl: "./admin-feature.component.html",
})
export class AdminFeatureComponent {
  readonly roles = ROLES_USUARIO
  readonly units = UNIDADES_PRODUCTO
  readonly vehicleTypes = TIPOS_VEHICULO
  readonly duration = formatearDuracion
  readonly loadingDemoData = signal(false)
  readonly confirmingDemoData = signal(false)
  readonly confirmingReset = signal(false)
  readonly demoResetEnabled = signal(false)
  readonly loadError = signal("")
  readonly loaded = signal(false)
  readonly search = signal("")
  readonly users = signal<UserRecord[]>([])
  readonly products = signal<ProductRecord[]>([])
  readonly vehicles = signal<VehicleRecord[]>([])
  readonly indicators = signal<RemoteIndicator[]>([])
  readonly indicatorsFrom = signal("")
  readonly indicatorsTo = signal("")
  readonly editingId = signal("")
  readonly saving = signal(false)
  readonly errors = signal<ErroresCampo>({})
  readonly formError = signal("")
  readonly auditEvents = signal<AuditEvent[]>([])
  readonly auditTotal = signal(0)
  readonly auditOffset = signal(0)
  readonly auditLimit = 25
  readonly parametersErrors = signal<ErroresCampo>({})
  readonly confirmingParameters = signal(false)
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
  editWeightKg: number | null = 0
  editPlate = ""
  editVehicleType = ""
  editCapacityKg: number | null = 0
  editSpeedKmh: number | null = 0
  editFuelEfficiency: number | null = 0
  editAvailable = true
  warehouseLatitude = -13.6366
  warehouseLongitude = -72.8814
  fuelPrice: number | null = 6.2
  minutesPerStop: number | null = 8
  serviceRadiusKm: number | null = 50
  parametersConfigured = false
  private originalUnit = ""

  constructor(
    readonly state: AppStateService,
    private readonly api: CodimacApiService,
  ) {
    effect(() => {
      const online = this.state.isOnline()
      const section = this.state.active()
      this.state.catalogRefresh()
      untracked(() => {
        this.search.set("")
        if (online) void this.loadSection(section)
      })
    })
  }

  get section(): string {
    return this.state.active()
  }

  get isEditableSection(): boolean {
    return this.section === "Usuarios" || this.section === "Productos" || this.section === "Vehículos"
  }

  get createLabel(): string {
    return this.isEditableSection ? createLabels[this.section as EditableSection] : ""
  }

  openCreateDialog(): void {
    if (this.isEditableSection) this.state.openDialog(createDialogs[this.section as EditableSection])
  }

  setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value)
  }

  private matches(text: string): boolean {
    const query = this.search().trim().toLocaleLowerCase("es-PE")
    return !query || text.toLocaleLowerCase("es-PE").includes(query)
  }

  get filteredUsers(): UserRecord[] {
    return this.users().filter((user) => this.matches(`${user.display_name} ${user.email} ${user.role} ${user.phone ?? ""}`))
  }

  get filteredProducts(): ProductRecord[] {
    return this.products().filter((product) => this.matches(`${product.name} ${product.unit}`))
  }

  get filteredVehicles(): VehicleRecord[] {
    return this.vehicles().filter((vehicle) => this.matches(`${vehicle.plate} ${vehicle.vehicle_type}`))
  }

  isSelf(user: UserRecord): boolean {
    return user.id === this.state.userId()
  }

  get editingSelf(): boolean {
    return this.editingId() === this.state.userId()
  }

  // ── Indicadores (P-A01) y ruta elegida vs referencia (P-A06) ──────────────────────────
  get filteredIndicators(): RemoteIndicator[] {
    return filtrarPorCierre(this.indicators(), this.indicatorsFrom(), this.indicatorsTo())
  }

  get summary() {
    return resumirIndicadores(this.filteredIndicators)
  }

  barWidth(value: number, other: number): number {
    const max = Math.max(value, other)
    return max > 0 ? Math.round((value / max) * 100) : 0
  }

  routeSavings(row: RemoteIndicator): number | null {
    if (row.reference_minutes === null || row.reference_minutes === undefined) return null
    return Number(row.reference_minutes) - Number(row.estimated_minutes ?? 0)
  }

  setIndicatorsFrom(event: Event): void {
    this.indicatorsFrom.set((event.target as HTMLInputElement).value)
  }

  setIndicatorsTo(event: Event): void {
    this.indicatorsTo.set((event.target as HTMLInputElement).value)
  }

  // ── Edición en modal (M-01 para usuarios) ─────────────────────────────────────────────
  startEditUser(user: UserRecord): void {
    this.resetEditState(user.id)
    this.editName = user.display_name
    this.editPhone = user.phone ?? ""
    this.editRole = user.role
    this.editActive = user.active
    this.editPassword = ""
  }

  startEditProduct(product: ProductRecord): void {
    this.resetEditState(product.id)
    this.editName = product.name
    this.editUnit = product.unit
    this.originalUnit = product.unit
    this.editWeightKg = Number(product.weight_kg)
  }

  startEditVehicle(vehicle: VehicleRecord): void {
    this.resetEditState(vehicle.id)
    this.editPlate = vehicle.plate
    this.editVehicleType = vehicle.vehicle_type
    this.editCapacityKg = Number(vehicle.capacity_kg)
    this.editSpeedKmh = Number(vehicle.average_speed_kmh)
    this.editFuelEfficiency = Number(vehicle.fuel_efficiency_km_l)
    this.editAvailable = vehicle.available
  }

  private resetEditState(id: string): void {
    this.editingId.set(id)
    this.errors.set({})
    this.formError.set("")
  }

  /** Unidades de la lista más la actual, para no perder valores registrados antes de la v1.1. */
  get editUnitOptions(): string[] {
    return this.originalUnit && !(UNIDADES_PRODUCTO as readonly string[]).includes(this.originalUnit)
      ? [this.originalUnit, ...UNIDADES_PRODUCTO]
      : [...UNIDADES_PRODUCTO]
  }

  error(field: string): string {
    return this.errors()[field] ?? ""
  }

  private validateEdit(): ErroresCampo {
    if (this.section === "Usuarios") {
      return validarUsuario(
        { name: this.editName, email: "", password: this.editPassword, role: this.editRole, phone: this.editPhone },
        { creando: false },
      )
    }
    if (this.section === "Productos") {
      return validarProducto({ name: this.editName, unit: this.editUnit, weightKg: this.editWeightKg })
    }
    return validarVehiculo({
      plate: this.editPlate,
      vehicleType: this.editVehicleType,
      capacityKg: this.editCapacityKg,
      averageSpeedKmh: this.editSpeedKmh,
      fuelEfficiencyKmL: this.editFuelEfficiency,
    })
  }

  validateField(field: string): void {
    if (field === "plate") this.editPlate = normalizarPlaca(this.editPlate)
    const message = this.validateEdit()[field]
    this.errors.update((errors) => {
      const { [field]: _previous, ...rest } = errors
      return message ? { ...rest, [field]: message } : rest
    })
  }

  async saveEdit(): Promise<void> {
    const section = this.section
    const id = this.editingId()
    if (!id || this.saving()) return
    const errors = this.validateEdit()
    this.errors.set(errors)
    this.formError.set("")
    if (Object.keys(errors).length) {
      const first = Object.keys(errors)[0]
      queueMicrotask(() => document.querySelector<HTMLElement>(`.admin-edit-dialog [data-error-key="${first}"]`)?.focus())
      return
    }
    this.saving.set(true)
    try {
      let message = ""
      if (section === "Usuarios") {
        await this.api.updateAdminUser(id, {
          name: this.editName.trim(),
          phone: this.editPhone.trim() || null,
          // RF-00.7: el administrador no puede desactivarse ni quitarse su propio rol.
          ...(this.editingSelf ? {} : { role: this.editRole, active: this.editActive }),
          ...(this.editPassword ? { password: this.editPassword } : {}),
        })
        message = "Usuario actualizado."
      } else if (section === "Productos") {
        await this.api.updateCatalogRecord("products", id, {
          name: this.editName.trim(),
          weight_kg: Number(this.editWeightKg),
          ...(this.editUnit !== this.originalUnit ? { unit: this.editUnit } : {}),
        })
        message = "Producto actualizado."
      } else if (section === "Vehículos") {
        await this.api.updateCatalogRecord("vehicles", id, {
          plate: normalizarPlaca(this.editPlate),
          vehicle_type: this.editVehicleType,
          capacity_kg: Number(this.editCapacityKg),
          average_speed_kmh: Number(this.editSpeedKmh),
          fuel_efficiency_km_l: Number(this.editFuelEfficiency),
          available: this.editAvailable,
        })
        message = "Vehículo actualizado."
      } else {
        return
      }
      this.editingId.set("")
      await this.loadSection(section)
      this.state.highlight(id)
      this.state.showToast(message)
    } catch (error) {
      this.applyServerError(error, this.errors)
    } finally {
      this.saving.set(false)
    }
  }

  private applyServerError(error: unknown, target: typeof this.errors): void {
    if (error instanceof ApiRequestError && error.fields.length) {
      target.set(Object.fromEntries(error.fields.map(({ field, message }) => [backendFieldNames[field] ?? field, message])))
      this.formError.set(error.message === "Revisa los campos marcados." ? "" : error.message)
      return
    }
    this.formError.set(error instanceof Error ? error.message : "No se pudieron guardar los cambios.")
  }

  cancelEdit(): void {
    if (!this.saving()) this.editingId.set("")
  }

  @HostListener("document:keydown.escape")
  closeOnEscape(): void {
    this.cancelEdit()
    if (!this.loadingDemoData()) {
      this.confirmingDemoData.set(false)
      this.confirmingReset.set(false)
    }
  }

  // ── Parámetros (P-A05) ────────────────────────────────────────────────────────────────
  updateWarehouseLocation(location: { latitude: number; longitude: number }): void {
    this.warehouseLatitude = Number(location.latitude.toFixed(6))
    this.warehouseLongitude = Number(location.longitude.toFixed(6))
  }

  parameterError(field: string): string {
    return this.parametersErrors()[field] ?? ""
  }

  private validateParameters(): ErroresCampo {
    return validarParametros({
      fuelPrice: this.fuelPrice,
      minutesPerStop: this.minutesPerStop,
      serviceRadiusKm: this.serviceRadiusKm,
      warehouseLatitude: this.warehouseLatitude,
      warehouseLongitude: this.warehouseLongitude,
    })
  }

  validateParameter(field: string): void {
    const message = this.validateParameters()[field]
    this.parametersErrors.update((errors) => {
      const { [field]: _previous, ...rest } = errors
      return message ? { ...rest, [field]: message } : rest
    })
  }

  /** "Botón Guardar con confirmación": primero valida y pide confirmar el cambio. */
  requestSaveParameters(): void {
    const errors = this.validateParameters()
    this.parametersErrors.set(errors)
    this.formError.set("")
    this.confirmingParameters.set(Object.keys(errors).length === 0)
  }

  async saveParameters(): Promise<void> {
    if (this.saving()) return
    this.saving.set(true)
    try {
      await this.api.updateParameters({
        warehouseLatitude: Number(this.warehouseLatitude),
        warehouseLongitude: Number(this.warehouseLongitude),
        fuelPrice: Number(this.fuelPrice),
        minutesPerStop: Number(this.minutesPerStop),
        serviceRadiusKm: Number(this.serviceRadiusKm),
      })
      this.parametersConfigured = true
      this.confirmingParameters.set(false)
      this.state.showToast("Parámetros guardados.")
    } catch (error) {
      this.confirmingParameters.set(false)
      this.applyServerError(error, this.parametersErrors)
    } finally {
      this.saving.set(false)
    }
  }

  // ── Datos de ejemplo (P-A08) ──────────────────────────────────────────────────────────
  async loadDemoData(): Promise<void> {
    if (this.loadingDemoData()) return
    this.loadingDemoData.set(true)
    try {
      const result = await this.api.loadDemoData()
      this.confirmingDemoData.set(false)
      this.refreshAfterDemoData()
      this.state.showToast(result.operationalDataLoaded
        ? "Datos de ejemplo cargados."
        : "Catálogos completados. Los pedidos de ejemplo ya existían; usa Restablecer para empezar de cero.", "success", 6000)
    } catch (error) {
      this.state.showError(error, "No se pudieron cargar los datos de ejemplo.")
    } finally {
      this.loadingDemoData.set(false)
    }
  }

  /** M-05: borra pedidos, repartos, inventario y catálogos y recarga el ejemplo. */
  async resetDemoData(): Promise<void> {
    if (this.loadingDemoData()) return
    this.loadingDemoData.set(true)
    try {
      await this.api.resetDemoData()
      this.confirmingReset.set(false)
      this.refreshAfterDemoData()
      this.state.showToast("Datos de ejemplo restablecidos.")
    } catch (error) {
      this.confirmingReset.set(false)
      this.state.showError(error, "No se pudieron restablecer los datos de ejemplo.")
    } finally {
      this.loadingDemoData.set(false)
    }
  }

  private refreshAfterDemoData(): void {
    this.state.catalogRefresh.update((value) => value + 1)
    this.state.ordersRefresh.update((value) => value + 1)
    this.state.inventoryRefresh.update((value) => value + 1)
  }

  // ── Auditoría (P-A07) ─────────────────────────────────────────────────────────────────
  get auditPageEnd(): number {
    return Math.min(this.auditOffset() + this.auditLimit, this.auditTotal())
  }

  applyAuditFilters(): void {
    this.auditOffset.set(0)
    void this.loadAuditEvents()
  }

  clearAuditFilters(): void {
    this.auditDesde = ""
    this.auditHasta = ""
    this.auditUsuario = ""
    this.auditEntidad = ""
    this.auditAccion = ""
    this.applyAuditFilters()
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

  auditEntries(value: Record<string, unknown> | null): Array<[string, string]> {
    if (!value) return []
    return Object.entries(value).map(([key, entry]) => [
      key,
      entry === null || entry === undefined ? "—" : typeof entry === "object" ? JSON.stringify(entry) : String(entry),
    ])
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
      this.loadError.set("")
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : "No se pudo cargar la auditoría.")
    }
  }

  private async loadSection(section: string): Promise<void> {
    this.loaded.set(false)
    try {
      if (section === "Usuarios") {
        this.users.set((await this.api.getAdminUsers()).users)
      } else if (section === "Productos") {
        this.products.set(await this.api.getCatalog<ProductRecord[]>("products"))
      } else if (section === "Vehículos") {
        this.vehicles.set(await this.api.getCatalog<VehicleRecord[]>("vehicles"))
      } else if (section === "Auditoría") {
        await this.loadAuditEvents()
      } else if (section === "Indicadores") {
        this.indicators.set((await this.api.getIndicators()).indicators)
      } else if (section === "Datos de ejemplo") {
        this.demoResetEnabled.set((await this.api.getDemoDataStatus()).resetEnabled)
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
      this.loadError.set("")
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : `No se pudo cargar ${section.toLowerCase()}.`)
    } finally {
      this.loaded.set(true)
    }
  }
}
