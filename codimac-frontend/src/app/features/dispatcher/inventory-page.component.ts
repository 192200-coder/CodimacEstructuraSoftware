import { Component, effect, signal } from "@angular/core"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import { IconComponent } from "../../shared/icon.component"
import { StatusBadgeComponent } from "../../shared/status-badge.component"

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
  imports: [IconComponent, StatusBadgeComponent],
  templateUrl: "./inventory-page.component.html",
})
export class InventoryPageComponent {
  readonly remoteProducts = signal<InventoryRow[]>([])
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
