import { Component, effect, signal } from "@angular/core"
import { DatePipe } from "@angular/common"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import { IconComponent } from "../../shared/icon.component"
import { StatusBadgeComponent } from "../../shared/status-badge.component"
import type { RemoteOrder } from "../../../lib/codimac-api"
import { prioridadPorFechaLimite } from "../../../dominio/prioridad-pedido"

interface OrderRow {
  code: string
  client: string
  status: string
  priority: string
  deadline: string
  deadlineAt: number | null
}

@Component({
  selector: "codimac-orders-page",
  standalone: true,
  imports: [IconComponent, StatusBadgeComponent, DatePipe],
  templateUrl: "./orders-page.component.html",
})
export class OrdersPageComponent {
  readonly remoteOrders = signal<RemoteOrder[]>([])
  readonly remoteLoaded = signal(false)
  readonly selectedCode = signal("")
  readonly search = signal("")

  constructor(
    readonly state: AppStateService,
    private readonly api: CodimacApiService,
  ) {
    effect(() => {
      if (this.state.isOnline()) void this.reloadOrders()
    })
  }

  readonly statusFilter = signal("Todos los estados")
  readonly priorityFilter = signal("Todas las prioridades")
  readonly dateFilter = signal("Cualquier fecha")

  get rows(): OrderRow[] {
    const now = Date.now()
    const rows = this.remoteOrders().map((order) => {
      const deadlineAt = order.deadline_at ? new Date(order.deadline_at).getTime() : null
      const priority = prioridadPorFechaLimite(order.deadline_at)
      return {
          code: order.code,
          client: order.clients?.name ?? "Cliente",
          status: order.status,
          priority,
          deadline: order.deadline_at
            ? new Intl.DateTimeFormat("es-PE", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "America/Lima",
              }).format(new Date(order.deadline_at))
            : "Sin fecha límite",
          deadlineAt,
        }
    })
    const query = this.search().trim().toLowerCase()
    return rows.filter((row) => {
      if (query && !`${row.code} ${row.client} ${row.status}`.toLowerCase().includes(query)) return false
      if (this.statusFilter() !== "Todos los estados" && row.status !== this.statusFilter()) return false
      if (this.priorityFilter() !== "Todas las prioridades" && row.priority !== this.priorityFilter()) return false
      if (this.dateFilter() !== "Cualquier fecha") {
        if (row.deadlineAt === null) return false
        const deadline = new Date(row.deadlineAt)
        const hoursAhead = this.dateFilter() === "Hoy" ? 24 : 7 * 24
        if (row.deadlineAt < now || row.deadlineAt > now + hoursAhead * 3_600_000) return false
        if (this.dateFilter() === "Hoy" && deadline.toDateString() !== new Date(now).toDateString()) return false
      }
      return true
    })
  }

  get urgentOrders(): OrderRow[] {
    return this.rows.filter((row) => row.priority === "Alta")
  }

  get selectedRemote(): RemoteOrder | undefined {
    return this.remoteOrders().find((order) => order.code === this.selectedCode()) ??
      this.remoteOrders()[0]
  }

  async updateSelected(kind: "prepare" | "cancel"): Promise<void> {
    const order = this.selectedRemote
    if (!order) {
      this.state.showToast("Selecciona un pedido cargado desde el backend.")
      return
    }
    try {
      if (kind === "cancel") {
        await this.api.cancelOrder(order.id)
      } else if (order.status === "Pendiente") {
        await this.api.prepareOrder(order.id)
      } else if (order.status === "En preparación") {
        await this.api.markOrderReady(order.id)
      } else {
        throw new Error("El pedido no admite esa transición.")
      }
      await this.reloadOrders()
      this.state.showToast(
        kind === "cancel"
          ? "Pedido cancelado y reservas liberadas."
          : order.status === "Pendiente"
            ? "Stock reservado; pedido en preparación."
            : "Pedido marcado como Listo.",
      )
    } catch (error) {
      this.state.showToast(
        error instanceof Error ? error.message : "No se pudo actualizar el pedido.",
      )
    }
  }

  private async reloadOrders(): Promise<void> {
    try {
      const orders = await this.api.getOrders()
      this.remoteOrders.set(orders)
      this.selectedCode.set(orders[0]?.code ?? "")
      this.remoteLoaded.set(true)
    } catch (error) {
      this.remoteLoaded.set(true)
      this.state.showToast(error instanceof Error ? error.message : "No se pudieron cargar los pedidos.")
    }
  }

  setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value)
  }

  setStatusFilter(event: Event): void {
    this.statusFilter.set((event.target as HTMLSelectElement).value)
  }

  setPriorityFilter(event: Event): void {
    this.priorityFilter.set((event.target as HTMLSelectElement).value)
  }

  setDateFilter(event: Event): void {
    this.dateFilter.set((event.target as HTMLSelectElement).value)
  }

  async copyTrackingToken(token: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(token)
      this.state.showToast("Código privado de seguimiento copiado.")
    } catch {
      this.state.showToast("No se pudo copiar el código de seguimiento. Selecciónalo y cópialo manualmente.")
    }
  }
}
