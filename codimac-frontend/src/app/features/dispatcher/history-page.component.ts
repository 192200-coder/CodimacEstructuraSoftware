import { Component, effect, signal } from "@angular/core"
import { DatePipe } from "@angular/common"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import type { RemoteClosedRoute } from "../../../lib/codimac-api"
import { IconComponent } from "../../shared/icon.component"
import { NumeroPipe } from "../../shared/numero.pipe"
import { StatusBadgeComponent } from "../../shared/status-badge.component"
import { matchesCodeSearch } from "../../../dominio/busqueda-codigo"

@Component({
  selector: "codimac-history-page",
  standalone: true,
  imports: [DatePipe, IconComponent, NumeroPipe, StatusBadgeComponent],
  templateUrl: "./history-page.component.html",
})
export class HistoryPageComponent {
  readonly routes = signal<RemoteClosedRoute[]>([])
  readonly selectedId = signal("")
  readonly loaded = signal(false)
  readonly search = signal("")

  constructor(
    readonly state: AppStateService,
    private readonly api: CodimacApiService,
  ) {
    effect(() => {
      if (this.state.isOnline()) void this.loadRoutes()
    })
  }

  get filteredRoutes(): RemoteClosedRoute[] {
    const query = this.search().trim().toLocaleLowerCase()
    return query
      ? this.routes().filter((route) =>
          matchesCodeSearch(route.code, query) ||
          `${route.driver_name ?? ""} ${route.vehicle_plate ?? ""}`
            .toLocaleLowerCase().includes(query),
        )
      : this.routes()
  }

  get selectedRoute(): RemoteClosedRoute | undefined {
    return this.filteredRoutes.find((route) => route.id === this.selectedId())
  }

  setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value)
  }

  exportCsv(): void {
    const rows = [
      ["Reparto", "Fecha", "Chofer", "Vehículo", "Resultado", "Paradas", "Distancia km", "Tiempo min", "Litros", "Costo"],
      ...this.filteredRoutes.map((route) => [
        route.code,
        new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeZone: "America/Lima" }).format(new Date(route.created_at)),
        route.driver_name ?? "",
        route.vehicle_plate ?? "",
        route.result,
        String(route.stop_count),
        String(route.distance_km ?? ""),
        String(route.estimated_minutes ?? ""),
        String(route.estimated_liters ?? ""),
        String(route.estimated_cost ?? ""),
      ]),
    ]
    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
      .join("\r\n")
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "historial-codimac.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  private async loadRoutes(): Promise<void> {
    try {
      const routes = await this.api.getClosedRouteHistory()
      this.routes.set(routes)
      this.selectedId.set(routes[0]?.id ?? "")
    } catch (error) {
      this.state.showToast(error instanceof Error ? error.message : "No se pudo cargar el historial.")
    } finally {
      this.loaded.set(true)
    }
  }
}
