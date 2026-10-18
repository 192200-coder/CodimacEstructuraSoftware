import { Component, HostListener, OnInit, signal } from "@angular/core"
import { FormsModule } from "@angular/forms"
import { AppStateService } from "../core/app-state.service"
import { CodimacApiService } from "../core/codimac-api.service"
import type { DialogKind } from "../core/models"
import { IconComponent } from "../shared/icon.component"
import { NumeroPipe } from "../shared/numero.pipe"
import { MapLocationPickerComponent } from "../shared/map-location-picker.component"
import { ApiRequestError, type InventoryAdjustmentReason } from "../../lib/codimac-api"
import { advertenciaAreaServicio, validarDatosCliente } from "../../dominio/clientes"
import { formatearKg } from "../../dominio/planificacion-ruta-ui"
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
  notifications: "Alertas operativas",
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
  readonly loading = signal(false)
  readonly clients = signal<CatalogOption[]>([])
  readonly products = signal<CatalogOption[]>([])
  readonly inventoryProducts = signal<CatalogOption[]>([])
  readonly orderFieldErrors = signal<Record<string, string>>({})
  readonly inventoryFieldErrors = signal<Record<string, string>>({})
  readonly clientErrors = signal<string[]>([])
  readonly userFieldErrors = signal<Record<string, string>>({})
  readonly resourcesLoading = signal(false)
  readonly resourceRows = signal<Array<{
    type: "Chofer" | "Vehículo"
    name: string
    detail: string
    status: "Disponible" | "En ruta"
  }>>([])

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
  quantity = 1
  reason: InventoryAdjustmentReason | "" = ""
  detail = ""
  observation = ""
  adjustmentDirection: "Aumentar" | "Disminuir" = "Disminuir"
  deadlineAt = ""
  email = ""
  role = "Despachador"
  phone = ""
  password = ""
  unit = ""
  weightKg = 0
  totalStock = 0
  plate = ""
  vehicleType = "Camioneta"
  capacityKg = 1500
  averageSpeedKmh = 30
  fuelEfficiencyKmL = 10
  orderItems: Array<{ productId: string; quantity: number }> = [{ productId: "", quantity: 1 }]

  constructor(
    readonly state: AppStateService,
    private readonly api: CodimacApiService,
  ) {}

  async ngOnInit(): Promise<void> {
    if (!this.state.isOnline()) return
    try {
      if (this.kind === "order" || this.kind === "client") {
        const clients = await this.api.getCatalog<CatalogOption[]>("clients")
        this.clients.set(clients)
        this.clientId = clients[0]?.id ?? ""
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
      if (this.kind === "order" || this.kind === "product") {
        const products = await this.api.getCatalog<CatalogOption[]>("products")
        this.products.set(products)
        this.productId = products[0]?.id ?? ""
        this.orderItems[0].productId = products[0]?.id ?? ""
      }
      if (this.kind === "inventory-entry" || this.kind === "inventory-adjust") {
        const products = await this.api.getCatalog<CatalogOption[]>("products")
        this.inventoryProducts.set(products)
        this.productId = products[0]?.id ?? ""
      }
      if (this.kind === "resources") {
        this.resourcesLoading.set(true)
        const [resources, routes] = await Promise.all([this.api.getResources(), this.api.getRoutes()])
        const busy = routes.filter((route) => route.status === "Asignada" || route.status === "En curso")
        this.resourceRows.set([
          ...resources.drivers.map((driver) => ({
            type: "Chofer" as const,
            name: driver.display_name,
            detail: driver.phone ?? "Celular no registrado",
            status: "Disponible" as const,
          })),
          ...busy.filter((route) => route.driver_name).map((route) => ({
            type: "Chofer" as const,
            name: route.driver_name ?? "",
            detail: `Reparto ${route.code}`,
            status: "En ruta" as const,
          })),
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
      this.state.showToast(error instanceof Error ? error.message : "No se pudieron cargar los catálogos.")
    } finally {
      this.resourcesLoading.set(false)
    }
  }

  goToPlanning(): void {
    this.close()
    this.state.selectSection("Repartos")
  }

  get kind(): DialogKind {
    return this.state.dialog() ?? "order"
  }

  get selectedInventoryProduct(): CatalogOption | undefined {
    return this.inventoryProducts().find((product) => product.id === this.productId)
  }

  get selectedInventoryAvailable(): number | null {
    const product = this.selectedInventoryProduct
    if (!product || product.total_stock === undefined || product.reserved_stock === undefined) return null
    return Number(product.total_stock) - Number(product.reserved_stock)
  }

  get adjustmentPreview(): number | null {
    const current = this.selectedInventoryProduct?.total_stock
    if (current === undefined || !Number.isFinite(Number(this.quantity))) return null
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
    this.clearInventoryErrors()
  }

  get title(): string {
    return titles[this.kind]
  }

  get informational(): boolean {
    return ["resources", "notifications"].includes(this.kind)
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

  orderLineQuantity(item: { productId: string; quantity: number }): string {
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

  orderItemError(index: number): string {
    const item = this.orderItems[index]
    if (!item) return ""
    const fieldError = this.orderFieldErrors()[`lineas[${index}].cantidad`]
    if (fieldError) return fieldError
    const available = this.availableStock(item.productId)
    if (available === null || Number(item.quantity) <= available) return ""
    const product = this.products().find((option) => option.id === item.productId)
    const name = product?.name ?? "este producto"
    return `Solo hay ${available} unidades disponibles de ${name}; faltan ${Number(item.quantity) - available}.`
  }

  clearOrderErrors(): void {
    this.orderFieldErrors.set({})
  }

  clearInventoryErrors(): void {
    this.inventoryFieldErrors.set({})
  }

  inventoryFieldError(field: string): string {
    return this.inventoryFieldErrors()[field] ?? ""
  }

  userFieldError(field: string): string {
    return this.userFieldErrors()[field] ?? ""
  }

  clearUserFieldError(field: string): void {
    this.userFieldErrors.update((errors) =>
      Object.fromEntries(Object.entries(errors).filter(([key]) => key !== field)),
    )
  }

  private focusFirstInventoryError(fields: Array<{ field: string }>): void {
    const firstField = fields.find(({ field }) =>
      ["productId", "quantity", "observation", "direction", "reason", "detail"].includes(field),
    )?.field
    if (!firstField) return
    queueMicrotask(() => {
      document.querySelector<HTMLElement>(`[name="${firstField}"]`)?.focus()
    })
  }

  private validateInventory(kind: "inventory-entry" | "inventory-adjust"): boolean {
    const errors: Record<string, string> = {}
    if (!this.productId) errors["productId"] = "Selecciona un producto."
    if (!Number.isFinite(Number(this.quantity)) || Number(this.quantity) <= 0) {
      errors["quantity"] = "Ingresa una cantidad mayor que cero."
    }
    if (kind === "inventory-adjust") {
      if (!this.reason) errors["reason"] = "Selecciona un motivo para el ajuste."
      if (this.reason === "Otro" && (this.detail.trim().length < 5 || this.detail.trim().length > 120)) {
        errors["detail"] = "El detalle debe tener entre 5 y 120 caracteres."
      }
    }
    this.inventoryFieldErrors.set(errors)
    this.focusFirstInventoryError(Object.keys(errors).map((field) => ({ field })))
    return Object.keys(errors).length === 0
  }

  close(): void {
    this.state.dialog.set(null)
  }

  addOrderItem(): void {
    this.clearOrderErrors()
    this.orderItems = [...this.orderItems, { productId: "", quantity: 1 }]
  }

  removeOrderItem(index: number): void {
    if (this.orderItems.length > 1) {
      this.clearOrderErrors()
      this.orderItems = this.orderItems.filter((_item, itemIndex) => itemIndex !== index)
    }
  }

  @HostListener("document:keydown.escape")
  closeOnEscape(): void {
    if (this.state.dialog()) this.close()
  }

  async save(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    const kind = this.kind
    this.clearOrderErrors()
    this.clientErrors.set([])
    this.userFieldErrors.set({})
    if (kind === "user") {
      const errors: Record<string, string> = {}
      if (this.name.trim().length < 2) errors["name"] = "Ingresa el nombre completo."
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())) {
        errors["email"] = "Ingresa un correo válido."
      }
      if (this.password.length < 10) {
        errors["password"] = "La contraseña debe tener al menos 10 caracteres."
      }
      if (this.phone.trim() && !/^9\d{8}$/.test(this.phone.trim())) {
        errors["phone"] = "El celular debe tener 9 dígitos y comenzar con 9."
      }
      if (Object.keys(errors).length) {
        this.userFieldErrors.set(errors)
        return
      }
    }
    if (kind === "client") {
      const errors = validarDatosCliente({
        contact: this.contact.trim(),
        address: this.address,
        reference: this.reference,
        latitude: this.latitude,
        longitude: this.longitude,
      })
      if (errors.length) {
        this.clientErrors.set(errors)
        return
      }
    }
    if (kind === "inventory-entry" || kind === "inventory-adjust") {
      if (!this.validateInventory(kind)) return
    }
    this.clearInventoryErrors()
    if (!this.state.isOnline()) {
      this.state.showToast("Inicia sesión para guardar cambios en el backend.")
      return
    }
    this.loading.set(true)
    try {
      switch (kind) {
        case "order":
          if (!this.clientId || this.orderItems.some((item) => !item.productId || item.quantity <= 0)) {
            throw new Error("Selecciona un cliente y al menos un producto con cantidad positiva.")
          }
          if (new Set(this.orderItems.map((item) => item.productId)).size !== this.orderItems.length) {
            throw new Error("Cada producto debe aparecer una sola vez en el pedido.")
          }
          {
          const result = await this.api.createOrder({
            clientId: this.clientId,
            deadlineAt: this.deadlineAt ? new Date(this.deadlineAt).toISOString() : null,
            items: this.orderItems.map((item) => ({
              productId: item.productId,
              quantity: Number(item.quantity),
            })),
          })
          this.close()
          this.state.ordersRefresh.update((value) => value + 1)
          this.state.showToast(`Pedido ${result.order.code} creado. El cliente puede consultar con el código del pedido y los últimos cuatro dígitos de su teléfono.`)
          break
          }
        case "client":
          if (this.latitude === null || this.longitude === null) {
            throw new Error("Selecciona la ubicación del cliente en el mapa.")
          }
          await this.api.createCatalogRecord("clients", {
            name: this.name,
            contact: this.contact.trim(),
            address: this.address.trim(),
            reference: this.reference.trim(),
            latitude: this.latitude,
            longitude: this.longitude,
          })
          break
        case "inventory-entry":
          if (!this.productId) throw new Error("Selecciona un producto.")
          await this.api.adjustInventory(this.productId, {
            type: "Entrada",
            quantity: Number(this.quantity),
            ...(this.observation.trim() ? { observation: this.observation.trim() } : {}),
          })
          this.state.inventoryRefresh.update((value) => value + 1)
          break
        case "inventory-adjust":
          if (!this.reason) {
            const errors = [{ field: "reason" }]
            this.inventoryFieldErrors.set({ reason: "Selecciona un motivo para el ajuste." })
            this.focusFirstInventoryError(errors)
            return
          }

          await this.api.adjustInventory(this.productId, {
            type: "Ajuste",
            quantity: Number(this.quantity),
            direction: this.adjustmentDirection,
            reason: this.reason,
            ...(this.reason === "Otro" ? { detail: this.detail.trim() } : {}),
          })
          this.state.inventoryRefresh.update((value) => value + 1)
          break
        case "user":
          await this.api.createAdminUser({
            name: this.name,
            email: this.email,
            password: this.password,
            role: this.role,
            ...(this.phone.trim() ? { phone: this.phone.trim() } : {}),
          })
          break
        case "product":
          await this.api.createCatalogRecord("products", {
            name: this.name,
            unit: this.unit,
            weight_kg: Number(this.weightKg),
            total_stock: Number(this.totalStock),
          })
          break
        case "vehicle":
          await this.api.createCatalogRecord("vehicles", {
            plate: this.plate,
            vehicle_type: this.vehicleType,
            capacity_kg: Number(this.capacityKg),
            average_speed_kmh: Number(this.averageSpeedKmh),
            fuel_efficiency_km_l: Number(this.fuelEfficiencyKmL),
          })
          break
        default:
          throw new Error("Esta acción no está disponible.")
      }
      if (["client", "user", "product", "vehicle"].includes(kind)) {
        this.state.catalogRefresh.update((value) => value + 1)
      }
      if (kind !== "order") {
        const title = this.title
        this.close()
        this.state.showToast(`${title} guardado correctamente.`)
      }
    } catch (error) {
      if (kind === "user" && error instanceof ApiRequestError) {
        const fieldErrors = Object.fromEntries(
          error.fields.map(({ field, message }) => [field, message]),
        )
        if (error.code === "CONFLICT" && !Object.keys(fieldErrors).length) {
          fieldErrors["email"] = "Este correo ya está registrado."
        }
        if (Object.keys(fieldErrors).length) {
          this.userFieldErrors.set(fieldErrors)
          return
        }
      }
      if (kind === "order" && error instanceof ApiRequestError && error.fields.length) {
        const fieldErrors = Object.fromEntries(
          error.fields
            .filter((field) => field.code === "STOCK_INSUFICIENTE")
            .map((field) => [field.field, field.message]),
        )
        this.orderFieldErrors.set(fieldErrors)
        if (Object.keys(fieldErrors).length) return
      }
      if (
        (kind === "inventory-entry" || kind === "inventory-adjust") &&
        error instanceof ApiRequestError &&
        error.fields.length
      ) {
        const fieldErrors = Object.fromEntries(error.fields.map(({ field, message }) => [field, message]))
        this.inventoryFieldErrors.set(fieldErrors)
        this.focusFirstInventoryError(error.fields)
        return
      }
      this.state.showToast(error instanceof Error ? error.message : "No se pudo guardar en el backend.")
    } finally {
      this.loading.set(false)
    }
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
    this.clientErrors.set(this.clientErrors().filter((message) => !message.includes("ubicación")))
  }

  clearClientErrors(): void {
    this.clientErrors.set([])
  }
}
