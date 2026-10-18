import { Component, effect, signal } from "@angular/core"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import { IconComponent } from "../../shared/icon.component"
import { StatusBadgeComponent } from "../../shared/status-badge.component"
import type { RemoteOrder } from "../../../lib/codimac-api"

@Component({
  selector: "codimac-dashboard-page",
  standalone: true,
  imports: [IconComponent, StatusBadgeComponent],
  templateUrl: "./dashboard-page.component.html",
})
export class DashboardPageComponent {
  readonly orders = signal<RemoteOrder[]>([])
  readonly resources = signal<{ drivers: Array<{ id: string; display_name: string }>; vehicles: Array<{ id: string }> }>({
    drivers: [],
    vehicles: [],
  })
  readonly loading = signal(true)
  readonly loadError = signal("")

  constructor(
    readonly state: AppStateService,
    private readonly api: CodimacApiService,
  ) {
    effect(() => {
      if (this.state.isOnline()) void this.loadDashboard()
    })
  }

  get metrics() {
    const orders = this.orders()
    return [
      { label: "Pendientes", value: this.countOrders(orders, "Pendiente"), detail: "Pedidos registrados", tone: "neutral", icon: "clock" },
      { label: "En preparación", value: this.countOrders(orders, "En preparación"), detail: "En almacén", tone: "amber", icon: "warehouse" },
      { label: "Listos", value: this.countOrders(orders, "Listo"), detail: "Para asignar", tone: "blue", icon: "box" },
      { label: "En ruta", value: this.countOrders(orders, "En ruta"), detail: "En reparto", tone: "indigo", icon: "truck" },
      { label: "Entregados", value: this.countOrders(orders, "Entregado"), detail: "Pedidos completados", tone: "green", icon: "check" },
    ]
  }

  private countOrders(orders: RemoteOrder[], status: string): number {
    return orders.filter((order) => order.status === status).length
  }

  get recentOrders(): RemoteOrder[] {
    return [...this.orders()]
      .sort((left, right) =>
        new Date(right.ordered_at ?? 0).getTime() - new Date(left.ordered_at ?? 0).getTime(),
      )
      .slice(0, 5)
  }

  formatDate(value: string | undefined): string {
    if (!value) return "—"
    return new Intl.DateTimeFormat("es-PE", {
      dateStyle: "short",
      timeZone: "America/Lima",
    }).format(new Date(value))
  }

  private async loadDashboard(): Promise<void> {
    this.loading.set(true)
    this.loadError.set("")
    try {
      const [orders, resources] = await Promise.all([
        this.api.getOrders(),
        this.api.getResources(),
      ])
      this.orders.set(orders)
      this.resources.set(resources)
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cargar el panel."
      this.loadError.set(message)
      this.state.showToast(message)
    } finally {
      this.loading.set(false)
    }
  }
}
