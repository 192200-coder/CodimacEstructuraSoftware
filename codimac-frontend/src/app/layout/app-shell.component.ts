import { Component, effect, HostListener, OnDestroy, signal } from "@angular/core"
import { AppStateService } from "../core/app-state.service"
import { CodimacApiService } from "../core/codimac-api.service"
import { IconComponent } from "../shared/icon.component"
import type { RemoteNotification } from "../../lib/codimac-api"

@Component({
  selector: "codimac-shell",
  standalone: true,
  imports: [IconComponent],
  templateUrl: "./app-shell.component.html",
})
export class AppShellComponent implements OnDestroy {
  readonly notifications = signal<RemoteNotification[]>([])
  readonly readNotificationIds = signal<ReadonlySet<string>>(new Set())
  readonly notificationsOpen = signal(false)
  readonly notificationError = signal("")
  private notificationTimer: ReturnType<typeof setInterval> | null = null
  private readonly notificationEffect = effect(() => {
    if (this.state.isOnline() && this.state.userId()) {
      this.loadNotifications()
      this.startNotificationPolling()
    } else {
      this.notifications.set([])
      this.readNotificationIds.set(new Set())
      this.notificationsOpen.set(false)
      this.stopNotificationPolling()
    }
  })

  constructor(
    readonly state: AppStateService,
    private readonly api: CodimacApiService,
  ) {}

  ngOnDestroy(): void {
    this.notificationEffect.destroy()
    this.stopNotificationPolling()
  }

  get unreadCount(): number {
    return this.notifications().filter(
      (notification) => !this.readNotificationIds().has(notification.id),
    ).length
  }

  get notificationStorageKey(): string {
    return `codimac-notifications-read-${this.state.userId()}`
  }

  getNotificationTitle(notification: RemoteNotification): string {
    if (notification.new_status === "Incidencia") return "Incidencia registrada"
    if (notification.entity_type === "Ruta") {
      if (notification.new_status === "Asignada") return "Reparto asignado"
      if (notification.new_status === "En curso") return "Reparto en curso"
      if (notification.new_status === "Cerrada") return "Reparto cerrado"
      if (notification.new_status === "Aprobada") return "Reparto aprobado"
      return `Reparto ${notification.new_status.toLocaleLowerCase("es-PE")}`
    }
    if (notification.entity_type === "Parada") {
      if (notification.new_status === "No entregada") return "Entrega no completada"
      if (notification.new_status === "Entregada") return "Entrega completada"
      return `Parada ${notification.new_status.toLocaleLowerCase("es-PE")}`
    }
    if (notification.new_status === "Listo") return "Pedido listo"
    if (notification.new_status === "En preparación") return "Pedido en preparación"
    if (notification.new_status === "Entregado") return "Pedido entregado"
    if (notification.new_status === "En ruta") return "Pedido en ruta"
    if (notification.new_status === "Cancelado") return "Pedido cancelado"
    return `Pedido ${notification.new_status.toLocaleLowerCase("es-PE")}`
  }

  getNotificationDetail(notification: RemoteNotification): string {
    const entity = notification.order_code
      ? `Pedido ${notification.order_code}`
      : notification.route_code
        ? `Reparto ${notification.route_code}`
        : notification.entity_type
    const client = notification.client_name ? ` · ${notification.client_name}` : ""
    return `${entity}${client} · ${notification.new_status}`
  }

  formatNotificationDate(value: string): string {
    return new Intl.DateTimeFormat("es-PE", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Lima",
    }).format(new Date(value))
  }

  toggleNotifications(): void {
    this.notificationsOpen.update((open) => !open)
    if (this.notificationsOpen()) {
      this.loadReadNotificationIds()
      void this.loadNotifications(true)
    }
  }

  closeNotifications(): void {
    this.notificationsOpen.set(false)
  }

  markNotificationsRead(): void {
    const readIds = new Set(this.readNotificationIds())
    for (const notification of this.notifications()) readIds.add(notification.id)
    this.readNotificationIds.set(readIds)
    this.persistReadNotificationIds()
    this.state.showToast("Notificaciones marcadas como leídas.")
  }

  markNotificationRead(notification: RemoteNotification): void {
    this.readNotificationIds.update((ids) => new Set([...ids, notification.id]))
    this.persistReadNotificationIds()
    const section = this.state.role() === "Administrador"
      ? "Historial"
      : notification.entity_type === "Ruta" || notification.entity_type === "Parada"
        ? "Repartos"
        : "Pedidos"
    this.state.selectSection(section)
    this.notificationsOpen.set(false)
  }

  @HostListener("document:keydown.escape")
  closeNotificationsOnEscape(): void {
    this.notificationsOpen.set(false)
  }

  private startNotificationPolling(): void {
    if (this.notificationTimer !== null) return
    this.notificationTimer = setInterval(() => void this.loadNotifications(), 30_000)
  }

  private stopNotificationPolling(): void {
    if (this.notificationTimer !== null) clearInterval(this.notificationTimer)
    this.notificationTimer = null
  }

  private async loadNotifications(showError = false): Promise<void> {
    try {
      const notifications = await this.api.getNotifications()
      this.loadReadNotificationIds()
      this.notifications.set(notifications)
      this.notificationError.set("")
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "No se pudieron cargar las notificaciones."
      this.notificationError.set(message)
      if (showError) this.state.showToast(message)
    }
  }

  private loadReadNotificationIds(): void {
    const saved = localStorage.getItem(this.notificationStorageKey)
    if (!saved) {
      this.readNotificationIds.set(new Set())
      return
    }
    try {
      const ids: unknown = JSON.parse(saved)
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
        throw new Error("El estado de lectura guardado no tiene un formato válido.")
      }
      this.readNotificationIds.set(new Set(ids))
    } catch (error) {
      localStorage.removeItem(this.notificationStorageKey)
      this.readNotificationIds.set(new Set())
      console.warn("Se reinició el estado local de lectura de notificaciones.", error)
    }
  }

  private persistReadNotificationIds(): void {
    try {
      localStorage.setItem(
        this.notificationStorageKey,
        JSON.stringify([...this.readNotificationIds()].slice(-200)),
      )
    } catch (error) {
      this.state.showToast(
        error instanceof Error
          ? `No se pudo guardar el estado leído en este dispositivo: ${error.message}`
          : "No se pudo guardar el estado leído en este dispositivo.",
      )
    }
  }

  get userInitials(): string {
    return this.state.userName().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()
  }

  get navItems() {
    return this.state.role() === "Administrador"
      ? [
          { label: "Indicadores", icon: "grid" },
          { label: "Usuarios", icon: "users" },
          { label: "Productos", icon: "box" },
          { label: "Vehículos", icon: "truck" },
          { label: "Parámetros", icon: "warehouse" },
          { label: "Historial", icon: "history" },
          { label: "Auditoría", icon: "history" },
          { label: "Datos de ejemplo", icon: "box" },
        ]
      : [
          { label: "Panel", icon: "grid" },
          { label: "Pedidos", icon: "box" },
          { label: "Inventario", icon: "warehouse" },
          { label: "Clientes", icon: "users" },
          { label: "Repartos", icon: "truck" },
          { label: "Historial", icon: "history" },
        ]
  }

  get pageTitle(): string {
    if (this.state.active() === "Panel") return `Buenos días, ${this.state.userName()}`
    if (this.state.active() === "Indicadores") return "Resumen de la operación"
    return this.state.active()
  }

  get pageSubtitle(): string {
    if (this.state.active() === "Panel") return "Así avanza la operación de hoy."
    if (this.state.active() === "Indicadores") {
      return "Resultados y eficiencia de los últimos 30 días."
    }
    return `Resumen y gestión de ${this.state.active().toLowerCase()}.`
  }

  async logout(): Promise<void> {
    try {
      await this.state.logout()
    } catch (error) {
      this.state.showToast(
        error instanceof Error ? error.message : "No se pudo cerrar la sesión.",
      )
    }
  }
}
