import { Component, effect, HostListener, signal, untracked } from "@angular/core"
import { FechaPipe } from "../../shared/fecha.pipe"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import { IconComponent } from "../../shared/icon.component"
import { NumeroPipe } from "../../shared/numero.pipe"
import { StatusBadgeComponent } from "../../shared/status-badge.component"
import type { RemoteOrder, RemoteOrderEvent } from "../../../lib/codimac-api"
import { alertasDePlazo, prioridadPorFechaLimite } from "../../../dominio/prioridad-pedido"
import { matchesCodeSearch } from "../../../dominio/busqueda-codigo"

interface OrderRow {
  id: string
  code: string
  client: string
  status: string
  priority: string
  deadline: string | null
  deadlineAt: number | null
}

const ORDER_STATUSES = ["Pendiente", "En preparación", "Listo", "En ruta", "Entregado", "Cancelado"]
const ACTIVE_STATUSES = new Set(["Pendiente", "En preparación", "Listo", "En ruta"])
const priorityRank: Record<string, number> = { Alta: 0, Media: 1, Normal: 2, "Sin plazo": 3 }

@Component({
  selector: "codimac-orders-page",
  standalone: true,
  imports: [IconComponent, NumeroPipe, StatusBadgeComponent, FechaPipe],
  templateUrl: "./orders-page.component.html",
})
export class OrdersPageComponent {
  readonly statuses = ORDER_STATUSES
  readonly remoteOrders = signal<RemoteOrder[]>([])
  readonly remoteLoaded = signal(false)
  readonly loadError = signal("")
  readonly selectedId = signal("")
  readonly search = signal("")
  readonly pendingCancellation = signal<RemoteOrder | null>(null)
  readonly cancellationInProgress = signal(false)
  readonly transitionInProgress = signal(false)
  readonly events = signal<RemoteOrderEvent[]>([])
  readonly statusFilter = signal("Todos los estados")
  readonly priorityFilter = signal("Todas las prioridades")
  readonly dateFilter = signal("Cualquier fecha")

  constructor(
    readonly state: AppStateService,
    private readonly api: CodimacApiService,
  ) {
    effect(() => {
      this.state.ordersRefresh()
      if (this.state.isOnline()) void untracked(() => this.reloadOrders())
    })
    // La búsqueda global y las tarjetas del panel entregan un código, un cliente o un estado.
    effect(() => {
      const query = this.state.globalSearch()
      if (!query) return
      untracked(() => {
        if (ORDER_STATUSES.includes(query)) {
          this.statusFilter.set(query)
          this.search.set("")
        } else {
          this.search.set(query)
          this.statusFilter.set("Todos los estados")
        }
        this.state.globalSearch.set("")
      })
    })
  }

  get rows(): OrderRow[] {
    const now = Date.now()
    const rows = this.remoteOrders().map((order) => ({
      id: order.id,
      code: order.code,
      client: order.clients?.name ?? "Cliente",
      status: order.status,
      priority: ACTIVE_STATUSES.has(order.status) ? prioridadPorFechaLimite(order.deadline_at) : "—",
      deadline: order.deadline_at,
      deadlineAt: order.deadline_at ? new Date(order.deadline_at).getTime() : null,
    }))
    const query = this.search().trim().toLowerCase()
    return rows
      .filter((row) => {
        if (query && !matchesCodeSearch(row.code, query) && !row.client.toLowerCase().includes(query)) return false
        if (this.statusFilter() !== "Todos los estados" && row.status !== this.statusFilter()) return false
        if (this.priorityFilter() !== "Todas las prioridades" && row.priority !== this.priorityFilter()) return false
        if (this.dateFilter() !== "Cualquier fecha") {
          if (row.deadlineAt === null) return false
          const hoursAhead = this.dateFilter() === "Hoy" ? 24 : 7 * 24
          if (row.deadlineAt < now || row.deadlineAt > now + hoursAhead * 3_600_000) return false
          if (this.dateFilter() === "Hoy" && new Date(row.deadlineAt).toDateString() !== new Date(now).toDateString()) {
            return false
          }
        }
        return true
      })
      // RN-04: los activos se ordenan por prioridad; los finales (Entregado/Cancelado) al final.
      .sort((a, b) =>
        (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) ||
        (a.deadlineAt ?? Infinity) - (b.deadlineAt ?? Infinity),
      )
  }

  get deadlineAlerts() {
    return alertasDePlazo(this.remoteOrders())
  }

  get hasFilters(): boolean {
    return Boolean(this.search()) ||
      this.statusFilter() !== "Todos los estados" ||
      this.priorityFilter() !== "Todas las prioridades" ||
      this.dateFilter() !== "Cualquier fecha"
  }

  clearFilters(): void {
    this.search.set("")
    this.statusFilter.set("Todos los estados")
    this.priorityFilter.set("Todas las prioridades")
    this.dateFilter.set("Cualquier fecha")
  }

  get selectedRemote(): RemoteOrder | undefined {
    return this.remoteOrders().find((order) => order.id === this.selectedId())
  }

  selectOrder(id: string): void {
    this.selectedId.set(id)
    void this.loadEvents(id)
  }

  /** RF-01.8: se cancela antes de salir; si está en un reparto aún no iniciado, el backend lo retira. */
  canCancel(order: RemoteOrder): boolean {
    return ["Pendiente", "En preparación", "Listo"].includes(order.status)
  }

  requestCancellation(): void {
    const order = this.selectedRemote
    if (!order || !this.canCancel(order)) {
      this.state.showToast("El pedido ya no puede cancelarse.", "error")
      return
    }
    this.pendingCancellation.set(order)
  }

  closeCancellation(): void {
    if (!this.cancellationInProgress()) this.pendingCancellation.set(null)
  }

  @HostListener("document:keydown.escape")
  closeCancellationOnEscape(): void {
    this.closeCancellation()
  }

  async confirmCancellation(): Promise<void> {
    const order = this.pendingCancellation()
    if (!order || this.cancellationInProgress()) return
    this.cancellationInProgress.set(true)
    try {
      await this.api.cancelOrder(order.id)
      this.pendingCancellation.set(null)
      await this.reloadOrders()
      this.state.showToast(`Pedido ${order.code} cancelado. Se liberaron sus reservas.`)
    } catch (error) {
      this.state.showError(error, "No se pudo cancelar el pedido.")
    } finally {
      this.cancellationInProgress.set(false)
    }
  }

  async advanceSelected(): Promise<void> {
    const order = this.selectedRemote
    if (!order || this.transitionInProgress()) return
    this.transitionInProgress.set(true)
    try {
      if (order.status === "Pendiente") {
        await this.api.prepareOrder(order.id)
        this.state.showToast(`Pedido ${order.code} en preparación. Se reservaron las unidades.`)
      } else if (order.status === "En preparación") {
        await this.api.markOrderReady(order.id)
        this.state.showToast(`Pedido ${order.code} marcado como Listo.`)
      } else {
        throw new Error("El pedido no admite esa transición.")
      }
      await this.reloadOrders()
    } catch (error) {
      // RN-02: si falta stock al preparar, el pedido sigue en Pendiente y se avisa el faltante.
      this.state.showError(error, "No se pudo actualizar el pedido.")
    } finally {
      this.transitionInProgress.set(false)
    }
  }

  private async reloadOrders(): Promise<void> {
    try {
      const orders = await this.api.getOrders()
      this.remoteOrders.set(orders)
      this.loadError.set("")
      const current = this.selectedId()
      const next = orders.some((order) => order.id === current) ? current : orders[0]?.id ?? ""
      this.selectedId.set(next)
      if (next) void this.loadEvents(next)
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : "No se pudieron cargar los pedidos.")
    } finally {
      this.remoteLoaded.set(true)
    }
  }

  private async loadEvents(orderId: string): Promise<void> {
    try {
      const events = await this.api.getOrderEvents(orderId)
      if (this.selectedId() === orderId) this.events.set(events)
    } catch {
      if (this.selectedId() === orderId) this.events.set([])
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
}
