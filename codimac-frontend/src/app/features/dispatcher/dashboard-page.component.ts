import { Component, effect, signal } from "@angular/core"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import { IconComponent } from "../../shared/icon.component"
import { StatusBadgeComponent } from "../../shared/status-badge.component"
import { FechaPipe } from "../../shared/fecha.pipe"
import type { RemoteOrder, RemoteRouteSummary } from "../../../lib/codimac-api"
import { alertasDePlazo, type AlertaPlazo } from "../../../dominio/prioridad-pedido"

@Component({
  selector: "codimac-dashboard-page",
  standalone: true,
  imports: [FechaPipe, IconComponent, StatusBadgeComponent],
  templateUrl: "./dashboard-page.component.html",
})
export class DashboardPageComponent {
  readonly orders = signal<RemoteOrder[]>([])
  readonly routes = signal<RemoteRouteSummary[]>([])
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
      this.state.ordersRefresh()
      if (this.state.isOnline()) void this.loadDashboard()
    })
  }

  get metrics() {
    const orders = this.orders()
    return [
      { label: "Pendientes", status: "Pendiente", detail: "Por preparar", tone: "neutral", icon: "clock" },
      { label: "En preparación", status: "En preparación", detail: "Unidades reservadas", tone: "amber", icon: "box" },
      { label: "Listos", status: "Listo", detail: "Para armar reparto", tone: "blue", icon: "checkCircle" },
      { label: "En ruta", status: "En ruta", detail: "En reparto", tone: "indigo", icon: "truck" },
      { label: "Entregados", status: "Entregado", detail: "Completados", tone: "green", icon: "checkCheck" },
      { label: "Cancelados", status: "Cancelado", detail: "Antes de salir", tone: "red", icon: "xCircle" },
    ].map((metric) => ({ ...metric, value: this.countOrders(orders, metric.status) }))
  }

  get deadlineAlerts(): AlertaPlazo[] {
    return alertasDePlazo(this.orders())
  }

  get activeRoutes(): RemoteRouteSummary[] {
    return this.routes().filter((route) => route.status === "Asignada" || route.status === "En curso")
  }

  confirmedStops(route: RemoteRouteSummary): number {
    return route.route_stops.filter((stop) => stop.status === "Entregada" || stop.status === "No entregada").length
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

  filterOrders(status: string): void {
    this.state.searchOrders(status)
  }

  private async loadDashboard(): Promise<void> {
    this.loading.set(true)
    this.loadError.set("")
    try {
      const [orders, resources, routes] = await Promise.all([
        this.api.getOrders(),
        this.api.getResources(),
        this.api.getRoutes(),
      ])
      this.orders.set(orders)
      this.resources.set(resources)
      this.routes.set(routes)
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : "No se pudo cargar el panel.")
    } finally {
      this.loading.set(false)
    }
  }
}
