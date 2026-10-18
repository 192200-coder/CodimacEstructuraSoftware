import { Component, HostListener, OnInit, signal } from "@angular/core"
import { FormsModule } from "@angular/forms"
import { AppStateService } from "../core/app-state.service"
import { CodimacApiService } from "../core/codimac-api.service"
import type { DialogKind } from "../core/models"
import { IconComponent } from "../shared/icon.component"
import { ApiRequestError, type InventoryAdjustmentReason } from "../../lib/codimac-api"

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
  imports: [FormsModule, IconComponent],
  templateUrl: "./form-dialog.component.html",
})
export class FormDialogComponent implements OnInit {
  readonly loading = signal(false)
  readonly clients = signal<CatalogOption[]>([])
  readonly products = signal<CatalogOption[]>([])
  readonly inventoryProducts = signal<CatalogOption[]>([])
  readonly orderFieldErrors = signal<Record<string, string>>({})
  readonly inventoryFieldErrors = signal<Record<string, string>>({})

  name = ""
  contact = ""
  address = ""
  latitude: number | null = null
  longitude: number | null = null
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
    } catch (error) {
      this.state.showToast(error instanceof Error ? error.message : "No se pudieron cargar los catálogos.")
    }
  }

  get kind(): DialogKind {
    return this.state.dialog() ?? "order"
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
          this.state.showToast(
            `Pedido ${result.order.code} creado. Código privado de seguimiento: ${result.order.tracking_token}`,
            20_000,
          )
          break
          }
        case "client":
          await this.api.createCatalogRecord("clients", {
            name: this.name,
            contact: this.contact || null,
            address: this.address,
            latitude: Number(this.latitude),
            longitude: Number(this.longitude),
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
}
