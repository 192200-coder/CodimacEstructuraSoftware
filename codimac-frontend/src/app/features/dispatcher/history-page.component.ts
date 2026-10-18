import { Component, effect, signal } from "@angular/core"
import { DatePipe } from "@angular/common"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import type { RemoteRouteSummary } from "../../../lib/codimac-api"
import { IconComponent } from "../../shared/icon.component"
import { StatusBadgeComponent } from "../../shared/status-badge.component"
import { matchesCodeSearch } from "../../../dominio/busqueda-codigo"

@Component({
  selector: "codimac-history-page",
  standalone: true,
  imports: [DatePipe, IconComponent, StatusBadgeComponent],
  templateUrl: "./history-page.component.html",
})
export class HistoryPageComponent {
  readonly routes = signal<RemoteRouteSummary[]>([])
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

  get filteredRoutes(): RemoteRouteSummary[] {
    const query = this.search().trim().toLocaleLowerCase()
    return query
      ? this.routes().filter((route) => route.status === "Cerrada").filter((route) =>
          matchesCodeSearch(route.code, query) ||
          `${route.driver_name ?? ""} ${route.vehicle_plate ?? ""}`
            .toLocaleLowerCase().includes(query),
        )
      : this.routes().filter((route) => route.status === "Cerrada")
  }

  get selectedRoute(): RemoteRouteSummary | undefined {
    return this.filteredRoutes.find((route) => route.id === this.selectedId())
  }

  setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value)
  }

  exportCsv(): void {
    const rows = [
      ["Reparto", "Fecha", "Chofer", "Vehículo", "Estado", "Paradas", "Distancia", "Tiempo", "Combustible"],
      ...this.filteredRoutes.map((route) => [
        route.code,
        new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeZone: "America/Lima" }).format(new Date(route.created_at)),
        route.driver_name ?? "",
        route.vehicle_plate ?? "",
        route.status,
        String(route.stop_count),
        String(route.distance_km ?? ""),
        String(route.estimated_minutes ?? ""),
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
      const routes = await this.api.getRoutes()
      this.routes.set(routes)
      this.selectedId.set(routes.find((route) => route.status === "Cerrada")?.id ?? "")
    } catch (error) {
      this.state.showToast(error instanceof Error ? error.message : "No se pudo cargar el historial.")
    } finally {
      this.loaded.set(true)
    }
  }
}
