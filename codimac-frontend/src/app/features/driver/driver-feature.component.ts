import { Component, effect, OnDestroy, signal } from "@angular/core"
import { FechaPipe } from "../../shared/fecha.pipe"
import { DomSanitizer, type SafeResourceUrl } from "@angular/platform-browser"
import { FormsModule } from "@angular/forms"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import type {
  RemoteRoute,
  RemoteRouteSummaryForDriver,
  RemoteStop,
} from "../../../lib/codimac-api"
import { IconComponent } from "../../shared/icon.component"
import { NumeroPipe } from "../../shared/numero.pipe"
import { StatusBadgeComponent } from "../../shared/status-badge.component"
import { RouteMapComponent } from "../../shared/route-map.component"
import type { ParadaMapa } from "../../../adaptadores/mapas/leaflet-mapa-ruta"
import {
  clientTelephoneUrl,
  driverDirectionsUrl,
  driverMapPreviewUrl,
} from "../../../dominio/driver-links"
import { iniciales, saludoPorHora } from "../../../dominio/formato"
import {
  CAUSAS_INCIDENCIA,
  validarEntrega,
  validarIncidencia,
  type ErroresCampo,
} from "../../../dominio/validaciones"

@Component({
  selector: "codimac-driver",
  standalone: true,
  imports: [FechaPipe, FormsModule, IconComponent, NumeroPipe, RouteMapComponent, StatusBadgeComponent],
  templateUrl: "./driver-feature.component.html",
})
export class DriverFeatureComponent implements OnDestroy {
  readonly causes = CAUSAS_INCIDENCIA
  readonly initials = iniciales
  readonly screen = signal(0)
  readonly remoteRoute = signal<RemoteRoute | null>(null)
  readonly closedSummary = signal<RemoteRouteSummaryForDriver | null>(null)
  readonly busy = signal(false)
  readonly errors = signal<ErroresCampo>({})
  readonly lastReceiver = signal("")
  /** P-CH02: la ruta en curso alterna entre lista y mapa. */
  readonly routeView = signal<"lista" | "mapa">("lista")
  receiver = ""
  observations = ""
  incidentCause = ""
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

  get greeting(): string {
    return `${saludoPorHora()}, ${this.state.userName().split(/\s+/)[0] ?? ""}`
  }

  private async loadRoute(): Promise<void> {
    try {
      const route = await this.api.getDriverRoute()
      const previousRoute = this.remoteRoute()
      this.remoteRoute.set(route)
      this.lastRouteLoadError = ""
      if (!route && previousRoute?.status === "En curso" && this.screen() > 0) {
        this.closedSummary.set(await this.api.getDriverRouteSummary(previousRoute.id))
        this.screen.set(6)
        return
      }
      if (
        this.hasLoadedRemoteRoute &&
        route?.status === "Asignada" &&
        route.id !== previousRoute?.id
      ) {
        this.state.showToast(`Tienes un nuevo reparto asignado: ${route.code}.`, "info")
      }
      this.hasLoadedRemoteRoute = true
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cargar la ruta asignada."
      if (message !== this.lastRouteLoadError) this.state.showToast(message, "error")
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

  get resolvedStops(): number {
    return this.remoteRoute()?.route_stops.filter(
      (stop) => stop.status === "Entregada" || stop.status === "No entregada",
    ).length ?? 0
  }

  get totalStops(): number {
    return this.remoteRoute()?.route_stops.length ?? 0
  }

  get progressPercent(): number {
    return this.totalStops ? Math.round((this.resolvedStops / this.totalStops) * 100) : 0
  }

  get mapStops(): ParadaMapa[] {
    return this.remoteRoute()?.route_stops.flatMap((stop) => {
      const client = stop.orders?.clients
      if (client?.latitude === undefined || client.longitude === undefined) return []
      return [{
        sequence: stop.sequence_number,
        label: client.name ?? stop.orders?.code ?? "Parada",
        status: stop.status,
        latitude: Number(client.latitude),
        longitude: Number(client.longitude),
      }]
    }) ?? []
  }

  get activeRemoteStop(): RemoteStop | undefined {
    return this.remoteRoute()?.route_stops.find(
      (stop) => stop.status === "En camino",
    )
  }

  get currentRemoteStop(): RemoteStop | undefined {
    return this.activeRemoteStop ?? this.remoteRoute()?.route_stops.find(
      (stop) => stop.status === "Pendiente" || stop.status === "Incidencia",
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
      ? new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Lima" }).format(new Date(eta))
      : "Por confirmar"
  }

  error(field: string): string {
    return this.errors()[field] ?? ""
  }

  goTo(screen: number): void {
    this.errors.set({})
    this.screen.set(screen)
  }

  openConfirmation(): void {
    this.receiver = ""
    this.observations = ""
    this.goTo(3)
  }

  openIncident(): void {
    this.incidentCause = ""
    this.incidentNotes = ""
    this.goTo(5)
  }

  validateDeliveryField(field: string): void {
    const message = validarEntrega({ receivedBy: this.receiver, observations: this.observations })[field]
    this.updateError(field, message)
  }

  validateIncidentField(field: string): void {
    const message = validarIncidencia({ cause: this.incidentCause, notes: this.incidentNotes })[field]
    this.updateError(field, message)
  }

  private updateError(field: string, message: string | undefined): void {
    this.errors.update((errors) => {
      const { [field]: _previous, ...rest } = errors
      return message ? { ...rest, [field]: message } : rest
    })
  }

  async startRoute(): Promise<void> {
    const route = this.remoteRoute()
    if (!route) {
      this.state.showToast("No tienes una ruta asignada.", "error")
      return
    }
    if (route.status === "En curso") {
      this.screen.set(1)
      return
    }
    if (route.status !== "Asignada" || this.busy()) return
    this.busy.set(true)
    try {
      await this.api.startDriverRoute(route.id)
      this.remoteRoute.set(await this.api.getDriverRoute())
      this.state.showToast("Reparto iniciado. Los pedidos pasaron a En ruta.")
      this.screen.set(1)
    } catch (error) {
      this.state.showError(error, "No se pudo iniciar la ruta.")
    } finally {
      this.busy.set(false)
    }
  }

  async confirmDelivery(): Promise<void> {
    const errors = validarEntrega({ receivedBy: this.receiver, observations: this.observations })
    this.errors.set(errors)
    if (Object.keys(errors).length || this.busy()) return
    const stop = this.activeRemoteStop
    const route = this.remoteRoute()
    if (!stop || !route) {
      this.state.showToast("No hay una parada activa que se pueda confirmar.", "error")
      return
    }
    this.busy.set(true)
    try {
      await this.api.deliverStop(stop.id, this.receiver.trim(), this.observations.trim() || undefined)
      this.lastReceiver.set(this.receiver.trim())
      const activeRoute = await this.api.getDriverRoute()
      this.remoteRoute.set(activeRoute)
      if (!activeRoute) {
        this.closedSummary.set(await this.api.getDriverRouteSummary(route.id))
        this.screen.set(6)
        return
      }
      this.screen.set(4)
    } catch (error) {
      this.state.showError(error, "No se pudo confirmar la entrega.")
    } finally {
      this.busy.set(false)
    }
  }

  async saveIncident(): Promise<void> {
    const errors = validarIncidencia({ cause: this.incidentCause, notes: this.incidentNotes })
    this.errors.set(errors)
    if (Object.keys(errors).length || this.busy()) return
    const stop = this.activeRemoteStop
    const route = this.remoteRoute()
    if (!stop || !route) {
      this.state.showToast("No hay una parada activa para registrar una incidencia.", "error")
      return
    }
    this.busy.set(true)
    try {
      const response = await this.api.reportStopIncident(
        stop.id,
        this.incidentCause,
        this.incidentNotes.trim(),
      ) as { result: "Reprogramada" | "No entregada" }
      const activeRoute = await this.api.getDriverRoute()
      this.remoteRoute.set(activeRoute)
      this.incidentNotes = ""
      if (!activeRoute) {
        this.closedSummary.set(await this.api.getDriverRouteSummary(route.id))
        this.screen.set(6)
        this.state.showToast("Incidencia registrada. La ruta se cerró al resolverse la última parada.", "info")
        return
      }
      this.screen.set(1)
      this.state.showToast(
        response.result === "Reprogramada"
          ? `Entrega reprogramada: intento ${stop.attempts + 1} de 2.`
          : "Se agotaron los intentos. El pedido vuelve a Listo.",
        "info",
        5000,
      )
    } catch (error) {
      this.state.showError(error, "No se pudo guardar la incidencia.")
    } finally {
      this.busy.set(false)
    }
  }

  openMap(): void {
    const url = this.googleMapsDirectionsUrl
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer")
      return
    }
    this.state.showToast("Este destino no tiene coordenadas registradas.", "error")
  }

  backToRoute(): void {
    this.closedSummary.set(null)
    this.goTo(0)
    void this.loadRoute()
  }

  async logout(): Promise<void> {
    try {
      await this.state.logout()
    } catch (error) {
      this.state.showError(error, "No se pudo cerrar la sesión.")
    }
  }
}
