import { Component, effect, signal } from "@angular/core"
import { DatePipe } from "@angular/common"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import { IconComponent } from "../../shared/icon.component"
import { NumeroPipe } from "../../shared/numero.pipe"
import { StatusBadgeComponent } from "../../shared/status-badge.component"
import type { RemoteInventoryMovement } from "../../../lib/codimac-api"

interface InventoryRow {
  id: string
  name: string
  unit: string
  total: number
  reserved: number
  available: number
}

@Component({
  selector: "codimac-inventory-page",
  standalone: true,
  imports: [DatePipe, IconComponent, NumeroPipe, StatusBadgeComponent],
  templateUrl: "./inventory-page.component.html",
})
export class InventoryPageComponent {
  readonly activeTab = signal<"stock" | "movements">("stock")
  readonly remoteProducts = signal<InventoryRow[]>([])
  readonly selectedProductId = signal("")
  readonly movements = signal<RemoteInventoryMovement[]>([])
  readonly movementsLoaded = signal(false)
  readonly remoteLoaded = signal(false)
  readonly search = signal("")

  constructor(
    readonly state: AppStateService,
    private readonly api: CodimacApiService,
  ) {
    let refresh = -1
    effect(() => {
      const currentRefresh = this.state.inventoryRefresh()
      if (this.state.isOnline() && currentRefresh !== refresh) {
        refresh = currentRefresh
        void this.loadProducts()
      }
    })
  }

  get products(): InventoryRow[] {
    const rows = this.remoteProducts()
    const query = this.search().trim().toLocaleLowerCase()
    return query ? rows.filter((product) => `${product.name} ${product.unit}`.toLocaleLowerCase().includes(query)) : rows
  }

  get reservedUnits(): number {
    return this.products.reduce((total, product) => total + product.reserved, 0)
  }

  get outOfStockCount(): number {
    return this.products.filter((product) => product.available <= 0).length
  }

  setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value)
  }

  get selectedProduct(): InventoryRow | undefined {
    return this.remoteProducts().find((product) => product.id === this.selectedProductId())
  }

  showStock(): void {
    this.activeTab.set("stock")
  }

  showMovements(productId = this.selectedProductId()): void {
    this.activeTab.set("movements")
    const id = productId || this.remoteProducts()[0]?.id || ""
    if (id) {
      this.selectedProductId.set(id)
      void this.loadMovements(id)
    }
  }

  selectMovementProduct(event: Event): void {
    this.showMovements((event.target as HTMLSelectElement).value)
  }

  private async loadMovements(productId: string): Promise<void> {
    this.movementsLoaded.set(false)
    this.movements.set([])
    try {
      const movements = await this.api.getInventoryMovements(productId)
      if (this.selectedProductId() === productId) this.movements.set(movements)
    } catch (error) {
      this.state.showToast(error instanceof Error ? error.message : "No se pudieron cargar los movimientos.")
    } finally {
      if (this.selectedProductId() === productId) this.movementsLoaded.set(true)
    }
  }

  private async loadProducts(): Promise<void> {
    try {
      const products = await this.api.getCatalog<Array<{
        id: string
        name: string
        unit: string
        total_stock: string | number
        reserved_stock: string | number
      }>>("products")
      this.remoteProducts.set(products.map((product) => {
        const total = Number(product.total_stock)
        const reserved = Number(product.reserved_stock)
        return {
          id: product.id,
          name: product.name,
          unit: product.unit,
          total,
          reserved,
          available: total - reserved,
        }
      }))
    } catch (error) {
      this.state.showToast(error instanceof Error ? error.message : "No se pudo cargar el inventario.")
    } finally {
      this.remoteLoaded.set(true)
    }
  }
}
