import { Component, HostListener, OnInit, signal } from "@angular/core"
import { FormsModule } from "@angular/forms"
import { AppStateService } from "../core/app-state.service"
import { CodimacApiService } from "../core/codimac-api.service"
import type { DialogKind } from "../core/models"
import { IconComponent } from "../shared/icon.component"
import { NumeroPipe } from "../shared/numero.pipe"
import { MapLocationPickerComponent } from "../shared/map-location-picker.component"
import { ApiRequestError, type DriverAvailability, type InventoryAdjustmentReason } from "../../lib/codimac-api"
import { advertenciaAreaServicio } from "../../dominio/clientes"
import { formatearKg } from "../../dominio/planificacion-ruta-ui"
import {
  inicioDeHoyLocal,
  MOTIVOS_AJUSTE,
  normalizarPlaca,
  ROLES_USUARIO,
  TIPOS_VEHICULO,
  UNIDADES_PRODUCTO,
  validarCliente,
  validarMovimientoInventario,
  validarPedido,
  validarProducto,
  validarUsuario,
  validarVehiculo,
  type ErroresCampo,
} from "../../dominio/validaciones"
import { StatusBadgeComponent } from "../shared/status-badge.component"

const titles: Record<DialogKind, string> = {
  order: "Nuevo pedido",
  client: "Nuevo cliente",
  "inventory-entry": "Registrar entrada",
  "inventory-adjust": "Ajustar existencias",
  user: "Nuevo usuario",
  product: "Nuevo producto",
  vehicle: "Nuevo vehículo",
  resources: "Disponibilidad de recursos",
}

/** Nombre del campo en el backend → clave del error en este formulario. */
const backendFieldNames: Record<string, string> = {
  weight_kg: "weightKg",
  total_stock: "totalStock",
  vehicle_type: "vehicleType",
  capacity_kg: "capacityKg",
  average_speed_kmh: "averageSpeedKmh",
  fuel_efficiency_km_l: "fuelEfficiencyKmL",
  latitude: "location",
  longitude: "location",
}

interface CatalogOption {
  id: string
  name?: string
  unit?: string
  total_stock?: string | number
  reserved_stock?: string | number
}

@Component({
  selector: "codimac-form-dialog",
  standalone: true,
  imports: [FormsModule, IconComponent, MapLocationPickerComponent, NumeroPipe, StatusBadgeComponent],
  templateUrl: "./form-dialog.component.html",
})
export class FormDialogComponent implements OnInit {
  readonly units = UNIDADES_PRODUCTO
  readonly vehicleTypes = TIPOS_VEHICULO
  readonly roles = ROLES_USUARIO
  readonly reasons = MOTIVOS_AJUSTE
  readonly minDeadline = inicioDeHoyLocal()
  readonly loading = signal(false)
  readonly catalogLoading = signal(true)
  readonly clients = signal<CatalogOption[]>([])
  readonly products = signal<CatalogOption[]>([])
  /** Errores por campo, mostrados junto al campo y dentro del modal (RNF-24). */
  readonly errors = signal<ErroresCampo>({})
  /** Error que no pertenece a un campo: se muestra como banner dentro del modal (M-01). */
  readonly formError = signal("")
  readonly resourcesLoading = signal(false)
  /** RF-03.1: choferes con su disponibilidad; el despachador la cambia aquí. */
  readonly drivers = signal<DriverAvailability[]>([])
  readonly driverSaving = signal("")
  readonly resourceRows = signal<Array<{
    type: "Chofer" | "Vehículo"
    name: string
    detail: string
    status: "Disponible" | "En ruta"
  }>>([])
  private readonly touched = new Set<string>()
  private submitted = false

  name = ""
  contact = ""
  address = ""
  reference = ""
  latitude: number | null = null
  longitude: number | null = null
  warehouseLatitude = -13.6366
  warehouseLongitude = -72.8814
  serviceRadiusKm = 50
  clientId = ""
  productId = ""
  quantity: number | null = 1
  reason: InventoryAdjustmentReason | "" = ""
  detail = ""
  observation = ""
  adjustmentDirection: "Aumentar" | "Disminuir" | "" = ""
  deadlineAt = ""
  email = ""
  role = ""
  phone = ""
  password = ""
  unit = ""
  weightKg: number | null = null
  totalStock: number | null = 0
  plate = ""
  vehicleType = "Camioneta"
  capacityKg: number | null = 1500
  averageSpeedKmh: number | null = 30
  fuelEfficiencyKmL: number | null = 10
  orderItems: Array<{ productId: string; quantity: number | null }> = [{ productId: "", quantity: 1 }]

  constructor(
    readonly state: AppStateService,
    private readonly api: CodimacApiService,
  ) {}

  async ngOnInit(): Promise<void> {
    if (!this.state.isOnline()) {
      this.catalogLoading.set(false)
      return
    }
    try {
      if (this.kind === "order") {
        const [clients, products] = await Promise.all([
          this.api.getCatalog<CatalogOption[]>("clients"),
          this.api.getCatalog<CatalogOption[]>("products"),
        ])
        this.clients.set(clients)
        this.products.set(products)
      }
      if (this.kind === "client") {
        const parameters = await this.api.getCatalog<{
          warehouse_latitude: number | string
          warehouse_longitude: number | string
          service_radius_km?: number | string
        } | null>("parameters")
        if (parameters) {
          this.warehouseLatitude = Number(parameters.warehouse_latitude)
          this.warehouseLongitude = Number(parameters.warehouse_longitude)
          this.serviceRadiusKm = Number(parameters.service_radius_km ?? 50)
        }
      }
      if (this.kind === "inventory-entry" || this.kind === "inventory-adjust") {
        const products = await this.api.getCatalog<CatalogOption[]>("products")
        this.products.set(products)
        this.productId = products[0]?.id ?? ""
      }
      if (this.kind === "resources") {
        this.resourcesLoading.set(true)
        const [resources, routes, drivers] = await Promise.all([
          this.api.getResources(),
          this.api.getRoutes(),
          this.api.getDrivers(),
        ])
        const busy = routes.filter((route) => route.status === "Asignada" || route.status === "En curso")
        this.drivers.set(drivers)
        this.resourceRows.set([
          ...resources.vehicles.map((vehicle) => ({
            type: "Vehículo" as const,
            name: `${vehicle.vehicle_type} · ${vehicle.plate}`,
            detail: `Capacidad ${formatearKg(vehicle.capacity_kg)} kg`,
            status: "Disponible" as const,
          })),
          ...busy.filter((route) => route.vehicle_plate).map((route) => ({
            type: "Vehículo" as const,
            name: route.vehicle_plate ?? "",
            detail: `Reparto ${route.code}`,
            status: "En ruta" as const,
          })),
        ])
      }
    } catch (error) {
      this.formError.set(error instanceof Error ? error.message : "No se pudieron cargar los catálogos.")
    } finally {
      this.resourcesLoading.set(false)
      this.catalogLoading.set(false)
    }
  }

  async toggleDriver(driver: DriverAvailability): Promise<void> {
    if (this.driverSaving()) return
    this.driverSaving.set(driver.id)
    this.formError.set("")
    try {
      await this.api.setDriverAvailability(driver.id, !driver.available)
      this.drivers.update((list) => list.map((item) => item.id === driver.id ? { ...item, available: !driver.available } : item))
      this.state.ordersRefresh.update((value) => value + 1)
      this.state.showToast(`${driver.display_name} marcado como ${driver.available ? "no disponible" : "disponible"}.`)
    } catch (error) {
      this.formError.set(error instanceof Error ? error.message : "No se pudo cambiar la disponibilidad.")
    } finally {
      this.driverSaving.set("")
    }
  }

  driverStatus(driver: DriverAvailability): string {
    if (driver.active_route_code) return "En ruta"
    return driver.available ? "Disponible" : "No disponible"
  }

  goToPlanning(): void {
    this.close()
    this.state.selectSection("Repartos")
  }

  get kind(): DialogKind {
    return this.state.dialog() ?? "order"
  }

  get title(): string {
    return titles[this.kind]
  }

  get informational(): boolean {
    return this.kind === "resources"
  }

  get selectedInventoryProduct(): CatalogOption | undefined {
    return this.products().find((product) => product.id === this.productId)
  }

  get selectedInventoryAvailable(): number | null {
    const product = this.selectedInventoryProduct
    if (!product || product.total_stock === undefined || product.reserved_stock === undefined) return null
    return Number(product.total_stock) - Number(product.reserved_stock)
  }

  get adjustmentPreview(): number | null {
    const current = this.selectedInventoryProduct?.total_stock
    if (current === undefined || !this.adjustmentDirection || !Number.isFinite(Number(this.quantity))) return null
    const adjustment = Number(this.quantity) * (this.adjustmentDirection === "Aumentar" ? 1 : -1)
    return Number(current) + adjustment
  }

  get adjustmentBelowReserved(): boolean {
    const reserved = this.selectedInventoryProduct?.reserved_stock
    return reserved !== undefined && this.adjustmentPreview !== null
      ? this.adjustmentPreview < Number(reserved)
      : false
  }

  setAdjustmentDirection(direction: "Aumentar" | "Disminuir"): void {
    this.adjustmentDirection = direction
    this.touched.add("direction")
    this.revalidate()
  }

  availableStock(productId: string): number | null {
    const product = this.products().find((option) => option.id === productId)
    if (!product || product.total_stock === undefined || product.reserved_stock === undefined) {
      return null
    }
    return Number(product.total_stock) - Number(product.reserved_stock)
  }

  productUnit(productId: string): string {
    return this.products().find((product) => product.id === productId)?.unit ?? ""
  }

  orderLineQuantity(item: { productId: string; quantity: number | null }): string {
    const quantity = Number.isFinite(Number(item.quantity))
      ? new Intl.NumberFormat("es-PE", { maximumFractionDigits: 3 }).format(Number(item.quantity))
      : "0"
    return `${quantity} ${this.productUnit(item.productId) || "unid."}`
  }

  get orderQuantitySummary(): string {
    const totalsByUnit = new Map<string, number>()
    for (const item of this.orderItems) {
      const quantity = Number(item.quantity)
      if (!item.productId || !Number.isFinite(quantity) || quantity <= 0) continue
      const unit = this.productUnit(item.productId) || "unid."
      totalsByUnit.set(unit, (totalsByUnit.get(unit) ?? 0) + quantity)
    }
    if (totalsByUnit.size === 0) return "sin productos seleccionados"
    return [...totalsByUnit]
      .map(([unit, quantity]) =>
        `${new Intl.NumberFormat("es-PE", { maximumFractionDigits: 3 }).format(quantity)} ${unit}`,
      )
      .join(" · ")
  }

  error(field: string): string {
    return this.errors()[field] ?? ""
  }

  /** Valida al salir del campo (RNF-24); el primer envío muestra todos los errores. */
  touch(field: string): void {
    this.touched.add(field)
    if (field === "plate") this.plate = normalizarPlaca(this.plate)
    this.revalidate()
  }

  /** Recalcula los errores visibles al editar, sin mostrar errores de campos no tocados. */
  revalidate(): void {
    this.formError.set("")
    const all = this.validate()
    this.errors.set(Object.fromEntries(
      Object.entries(all).filter(([field]) => this.submitted || this.touched.has(field)),
    ))
  }

  private validate(): ErroresCampo {
    switch (this.kind) {
      case "order":
        return validarPedido(
          { clientId: this.clientId, deadlineAt: this.deadlineAt, items: this.orderItems },
          (productId) => {
            const available = this.availableStock(productId)
            const product = this.products().find((option) => option.id === productId)
            return available === null ? null : { disponible: available, nombre: product?.name ?? "este producto" }
          },
        )
      case "client":
        return validarCliente({
          name: this.name,
          contact: this.contact,
          address: this.address,
          reference: this.reference,
          latitude: this.latitude,
          longitude: this.longitude,
        })
      case "inventory-entry":
      case "inventory-adjust": {
        const product = this.selectedInventoryProduct
        return validarMovimientoInventario({
          tipo: this.kind === "inventory-entry" ? "Entrada" : "Ajuste",
          productId: this.productId,
          quantity: this.quantity,
          direction: this.adjustmentDirection,
          reason: this.reason,
          detail: this.detail,
          existencias: product?.total_stock === undefined ? undefined : Number(product.total_stock),
          reservadas: product?.reserved_stock === undefined ? undefined : Number(product.reserved_stock),
        })
      }
      case "user":
        return validarUsuario(
          { name: this.name, email: this.email, password: this.password, role: this.role, phone: this.phone },
          { creando: true },
        )
      case "product":
        return validarProducto({
          name: this.name,
          unit: this.unit,
          weightKg: this.weightKg,
          totalStock: this.totalStock,
        })
      case "vehicle":
        return validarVehiculo({
          plate: this.plate,
          vehicleType: this.vehicleType,
          capacityKg: this.capacityKg,
          averageSpeedKmh: this.averageSpeedKmh,
          fuelEfficiencyKmL: this.fuelEfficiencyKmL,
        })
      default:
        return {}
    }
  }

  private focusFirstError(errors: ErroresCampo): void {
    const keys = Object.keys(errors)
    if (!keys.length) return
    queueMicrotask(() => {
      const target = [...document.querySelectorAll<HTMLElement>(".dialog [data-error-key]")]
        .find((element) => keys.includes(element.dataset["errorKey"] ?? ""))
      target?.focus()
    })
  }

  close(): void {
    if (this.loading()) return
    this.state.dialog.set(null)
  }

  addOrderItem(): void {
    this.orderItems = [...this.orderItems, { productId: "", quantity: 1 }]
    this.revalidate()
  }

  removeOrderItem(index: number): void {
    if (this.orderItems.length > 1) {
      this.orderItems = this.orderItems.filter((_item, itemIndex) => itemIndex !== index)
      this.revalidate()
    }
  }

  @HostListener("document:keydown.escape")
  closeOnEscape(): void {
    if (this.state.dialog()) this.close()
  }

  async save(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (this.loading()) return
    const kind = this.kind
    this.submitted = true
    this.formError.set("")
    const errors = this.validate()
    this.errors.set(errors)
    if (Object.keys(errors).length) {
      this.focusFirstError(errors)
      return
    }
    if (!this.state.isOnline()) {
      this.formError.set("Inicia sesión para guardar cambios.")
      return
    }
    this.loading.set(true)
    try {
      let message = ""
      let createdId = ""
      switch (kind) {
        case "order": {
          const result = await this.api.createOrder({
            clientId: this.clientId,
            deadlineAt: this.deadlineAt ? new Date(this.deadlineAt).toISOString() : null,
            items: this.orderItems.map((item) => ({
              productId: item.productId,
              quantity: Number(item.quantity),
            })),
          })
          this.state.ordersRefresh.update((value) => value + 1)
          createdId = result.order.id
          message = `Pedido ${result.order.code} registrado.`
          break
        }
        case "client": {
          const created = await this.api.createCatalogRecord("clients", {
            name: this.name.trim(),
            contact: this.contact.trim(),
            address: this.address.trim(),
            reference: this.reference.trim(),
            latitude: this.latitude,
            longitude: this.longitude,
          }) as { data?: { id?: string } }
          createdId = created.data?.id ?? ""
          message = "Cliente registrado."
          break
        }
        case "inventory-entry": {
          await this.api.adjustInventory(this.productId, {
            type: "Entrada",
            quantity: Number(this.quantity),
            ...(this.observation.trim() ? { observation: this.observation.trim() } : {}),
          })
          this.state.inventoryRefresh.update((value) => value + 1)
          message = `Entrada registrada: +${Number(this.quantity)} unidades de ${this.selectedInventoryProduct?.name ?? "producto"}.`
          break
        }
        case "inventory-adjust": {
          await this.api.adjustInventory(this.productId, {
            type: "Ajuste",
            quantity: Number(this.quantity),
            direction: this.adjustmentDirection as "Aumentar" | "Disminuir",
            reason: this.reason as InventoryAdjustmentReason,
            ...(this.reason === "Otro" ? { detail: this.detail.trim() } : {}),
          })
          this.state.inventoryRefresh.update((value) => value + 1)
          const sign = this.adjustmentDirection === "Aumentar" ? "+" : "−"
          message = `Ajuste registrado: ${sign}${Number(this.quantity)} unidades de ${this.selectedInventoryProduct?.name ?? "producto"}.`
          break
        }
        case "user": {
          const created = await this.api.createAdminUser({
            name: this.name.trim(),
            email: this.email.trim(),
            password: this.password,
            role: this.role,
            ...(this.role === "Chofer" && this.phone.trim() ? { phone: this.phone.trim() } : {}),
          }) as { user?: { id?: string } }
          createdId = created.user?.id ?? ""
          message = "Usuario registrado."
          break
        }
        case "product": {
          const created = await this.api.createCatalogRecord("products", {
            name: this.name.trim(),
            unit: this.unit,
            weight_kg: Number(this.weightKg),
            total_stock: Number(this.totalStock ?? 0),
          }) as { data?: { id?: string } }
          createdId = created.data?.id ?? ""
          message = "Producto registrado."
          break
        }
        case "vehicle": {
          const created = await this.api.createCatalogRecord("vehicles", {
            plate: normalizarPlaca(this.plate),
            vehicle_type: this.vehicleType,
            capacity_kg: Number(this.capacityKg),
            average_speed_kmh: Number(this.averageSpeedKmh),
            fuel_efficiency_km_l: Number(this.fuelEfficiencyKmL),
          }) as { data?: { id?: string } }
          createdId = created.data?.id ?? ""
          message = "Vehículo registrado."
          break
        }
        default:
          throw new Error("Esta acción no está disponible.")
      }
      if (["client", "user", "product", "vehicle"].includes(kind)) {
        this.state.catalogRefresh.update((value) => value + 1)
      }
      if (createdId) this.state.highlight(createdId)
      // RNF-23: al guardar con éxito el modal se cierra y la lista se actualiza sola.
      this.loading.set(false)
      this.close()
      this.state.showToast(message)
    } catch (error) {
      this.applyServerError(error)
    } finally {
      this.loading.set(false)
    }
  }

  /** Lleva los errores del backend al campo que corresponde; el resto queda en el banner del modal. */
  private applyServerError(error: unknown): void {
    if (error instanceof ApiRequestError && error.fields.length) {
      const fieldErrors: ErroresCampo = {}
      for (const { field, message } of error.fields) {
        const key = (backendFieldNames[field] ?? field)
          .replace(/\.quantity$/, ".cantidad")
          .replace(/\.productId$/, ".producto")
        fieldErrors[key] ??= message
      }
      this.errors.set(fieldErrors)
      this.formError.set(error.message === "Revisa los campos marcados." ? "" : error.message)
      this.focusFirstError(fieldErrors)
      return
    }
    this.formError.set(error instanceof Error ? error.message : "No se pudo guardar. Inténtalo de nuevo.")
  }

  get serviceAreaWarning() {
    if (this.latitude === null || this.longitude === null) return null
    return advertenciaAreaServicio(
      { latitud: this.warehouseLatitude, longitud: this.warehouseLongitude },
      { latitud: this.latitude, longitud: this.longitude },
      this.serviceRadiusKm,
    )
  }

  updateLocation(location: { latitude: number; longitude: number }): void {
    this.latitude = location.latitude
    this.longitude = location.longitude
    this.touched.add("location")
    this.revalidate()
  }
}
