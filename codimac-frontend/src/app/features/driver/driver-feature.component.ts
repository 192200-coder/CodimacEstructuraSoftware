import { Component, effect, OnDestroy, signal } from "@angular/core"
import { DomSanitizer, type SafeResourceUrl } from "@angular/platform-browser"
import { DatePipe } from "@angular/common"
import { FormsModule } from "@angular/forms"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import type {
  RemoteRoute,
  RemoteRouteSummaryForDriver,
  RemoteStop,
} from "../../../lib/codimac-api"
import { IconComponent } from "../../shared/icon.component"
import { StatusBadgeComponent } from "../../shared/status-badge.component"
import {
  clientTelephoneUrl,
  driverDirectionsUrl,
  driverMapPreviewUrl,
} from "../../../dominio/driver-links"

@Component({
  selector: "codimac-driver",
  standalone: true,
  imports: [DatePipe, FormsModule, IconComponent, StatusBadgeComponent],
  templateUrl: "./driver-feature.component.html",
})
export class DriverFeatureComponent implements OnDestroy {
  readonly screen = signal(0)
  readonly remoteRoute = signal<RemoteRoute | null>(null)
  readonly closedSummary = signal<RemoteRouteSummaryForDriver | null>(null)
  receiver = ""
  incidentCause = "Cliente ausente"
  incidentNotes = ""
  private routeMonitorTimer: ReturnType<typeof setInterval> | null = null
  private hasLoadedRemoteRoute = false
  private lastRouteLoadError = ""

  constructor(
    readonly state: AppStateService,
    private readonly api: CodimacApiService,
    private readonly sanitizer: DomSanitizer,
  ) {
    effect(() => {
      if (this.state.isOnline()) {
        void this.loadRoute()
        this.startRoutePolling()
      } else {
        this.stopRoutePolling()
        this.remoteRoute.set(null)
        this.hasLoadedRemoteRoute = false
      }
    })
  }

  ngOnDestroy(): void {
    this.stopRoutePolling()
  }

  private async loadRoute(): Promise<void> {
    try {
      const route = await this.api.getDriverRoute()
      const previousRoute = this.remoteRoute()
      this.remoteRoute.set(route)
      this.lastRouteLoadError = ""
      if (
        this.hasLoadedRemoteRoute &&
        route?.status === "Asignada" &&
        route.id !== previousRoute?.id
      ) {
        this.state.showToast(`Tienes un nuevo reparto asignado: ${route.code}.`)
      }
      this.hasLoadedRemoteRoute = true
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cargar la ruta asignada."
      if (message !== this.lastRouteLoadError) this.state.showToast(message)
      this.lastRouteLoadError = message
    }
  }

  private startRoutePolling(): void {
    if (this.routeMonitorTimer !== null) return
    this.routeMonitorTimer = setInterval(() => void this.loadRoute(), 30_000)
  }

  private stopRoutePolling(): void {
    if (this.routeMonitorTimer !== null) clearInterval(this.routeMonitorTimer)
    this.routeMonitorTimer = null
  }

  get activeRemoteStop(): RemoteStop | undefined {
    return this.remoteRoute()?.route_stops.find(
      (stop) => stop.status === "En camino",
    )
  }

  get currentRemoteStop(): RemoteStop | undefined {
    return this.activeRemoteStop ?? this.remoteRoute()?.route_stops.find(
      (stop) => stop.status === "Pendiente",
    )
  }

  get remoteItemCount(): number {
    return this.currentRemoteStop?.orders?.order_items?.length ?? 0
  }

  get remoteUnitCount(): number {
    return this.currentRemoteStop?.orders?.order_items?.reduce(
      (total, item) => total + Number(item.quantity),
      0,
    ) ?? 0
  }

  get currentClientName(): string {
    return this.currentRemoteStop?.orders?.clients?.name ?? "Cliente"
  }

  get currentClientAddress(): string {
    return this.currentRemoteStop?.orders?.clients?.address ?? "Dirección no disponible"
  }

  get currentClientReference(): string {
    return this.currentRemoteStop?.orders?.clients?.reference?.trim() || "Sin referencia registrada"
  }

  get currentClientContact(): string {
    return this.currentRemoteStop?.orders?.clients?.contact ?? ""
  }

  get clientPhoneHref(): string | null {
    return clientTelephoneUrl(this.currentRemoteStop?.orders?.clients?.contact)
  }

  get googleMapsDirectionsUrl(): string | null {
    const client = this.currentRemoteStop?.orders?.clients
    if (client?.latitude === undefined || client.longitude === undefined) return null
    return driverDirectionsUrl(Number(client.latitude), Number(client.longitude))
  }

  get mapPreviewUrl(): SafeResourceUrl | null {
    const client = this.currentRemoteStop?.orders?.clients
    if (client?.latitude === undefined || client.longitude === undefined) return null
    const url = driverMapPreviewUrl(Number(client.latitude), Number(client.longitude))
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null
  }

  get currentEta(): string {
    const eta = this.currentRemoteStop?.eta_at
    return eta
      ? new Intl.DateTimeFormat("es-PE", { timeStyle: "short", timeZone: "America/Lima" }).format(new Date(eta))
      : "Por confirmar"
  }

  async startRoute(): Promise<void> {
    const route = this.remoteRoute()
    if (!route) {
      this.state.showToast("No tienes una ruta asignada por el backend.")
      return
    }
    try {
      await this.api.startDriverRoute(route.id)
      this.remoteRoute.set(await this.api.getDriverRoute())
      this.state.showToast("Reparto iniciado; pedidos actualizados a En ruta.")
    } catch (error) {
      this.state.showToast(
        error instanceof Error ? error.message : "No se pudo iniciar la ruta.",
      )
      return
    }
    this.screen.set(1)
  }

  async confirmDelivery(): Promise<void> {
    if (!this.receiver.trim()) {
      this.state.showToast("Ingresa el nombre de quien recibió.")
      return
    }
    const stop = this.activeRemoteStop
    const route = this.remoteRoute()
    if (!stop || !route) {
      this.state.showToast("No hay una parada activa que se pueda confirmar.")
      return
    }
    try {
      await this.api.deliverStop(stop.id, this.receiver.trim())
      const activeRoute = await this.api.getDriverRoute()
      this.remoteRoute.set(activeRoute)
      if (!activeRoute) {
        this.closedSummary.set(await this.api.getDriverRouteSummary(route.id))
        this.screen.set(6)
        return
      }
    } catch (error) {
      this.state.showToast(
        error instanceof Error
          ? error.message
          : "No se pudo confirmar la entrega.",
      )
      return
    }
    this.screen.set(4)
  }

  async saveIncident(): Promise<void> {
    const stop = this.activeRemoteStop
    if (!stop) {
      this.state.showToast("No hay una parada activa para registrar una incidencia.")
      return
    }
    try {
      const result = await this.api.reportStopIncident(
        stop.id,
        this.incidentCause,
        this.incidentNotes,
      ) as { result: "Reprogramada" | "No entregada" }
      this.remoteRoute.set(await this.api.getDriverRoute())
      this.incidentNotes = ""
      this.screen.set(1)
      this.state.showToast(
        result.result === "Reprogramada"
          ? `Entrega reprogramada: intento ${stop.attempts + 1} de 2.`
          : "Se agotaron los intentos. El pedido vuelve a Listo.",
      )
    } catch (error) {
      this.state.showToast(
        error instanceof Error ? error.message : "No se pudo guardar la incidencia.",
      )
      return
    }
  }

  openMap(): void {
    const url = this.googleMapsDirectionsUrl
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer")
      return
    }
    this.state.showToast("Este destino no tiene coordenadas registradas.")
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
