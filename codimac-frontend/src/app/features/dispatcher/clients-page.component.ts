import { Component, effect, signal } from "@angular/core"
import { FormsModule } from "@angular/forms"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import { IconComponent } from "../../shared/icon.component"
import { MapLocationPickerComponent } from "../../shared/map-location-picker.component"
import { advertenciaAreaServicio, validarDatosCliente } from "../../../dominio/clientes"

interface ClientRow {
  id: string
  name: string
  address: string
  contact: string
  reference: string
  latitude: number
  longitude: number
}

@Component({
  selector: "codimac-clients-page",
  standalone: true,
  imports: [FormsModule, IconComponent, MapLocationPickerComponent],
  templateUrl: "./clients-page.component.html",
})
export class ClientsPageComponent {
  readonly selectedIndex = signal(0)
  readonly editing = signal(false)
  readonly remoteClients = signal<ClientRow[]>([])
  readonly remoteLoaded = signal(false)
  warehouseLatitude = -13.6366
  warehouseLongitude = -72.8814
  serviceRadiusKm = 50
  draft: ClientRow | null = null

  constructor(
    readonly state: AppStateService,
    private readonly api: CodimacApiService,
  ) {
    let refresh = -1
    effect(() => {
      const currentRefresh = this.state.catalogRefresh()
      if (this.state.isOnline() && currentRefresh !== refresh) {
        refresh = currentRefresh
        void this.loadClients()
      }
    })
  }

  get clients(): ClientRow[] {
    return this.remoteClients()
  }

  get selected() {
    return this.clients[this.selectedIndex()] ?? null
  }

  beginEdit(): void {
    const client = this.selected
    if (!client) return
    this.draft = { ...client }
    this.editing.set(true)
  }

  cancelEdit(): void {
    this.editing.set(false)
    this.draft = null
  }

  async saveClient(): Promise<void> {
    const client = this.selected
    const draft = this.draft
    if (!client || !draft) return
    const validationErrors = validarDatosCliente({
      contact: draft.contact.trim(),
      address: draft.address,
      reference: draft.reference,
      latitude: draft.latitude,
      longitude: draft.longitude,
    })
    if (validationErrors.length) {
      this.state.showToast(validationErrors[0])
      return
    }
    try {
      await this.api.updateCatalogRecord("clients", client.id, {
        name: draft.name.trim(),
        contact: draft.contact.trim(),
        address: draft.address.trim(),
        reference: draft.reference.trim(),
        latitude: Number(draft.latitude),
        longitude: Number(draft.longitude),
      })
      await this.loadClients()
      this.cancelEdit()
      this.state.showToast("Cliente actualizado correctamente.")
    } catch (error) {
      this.state.showToast(error instanceof Error ? error.message : "No se pudo actualizar el cliente.")
    }
  }

  editFromMap(location: { latitude: number; longitude: number }): void {
    if (this.editing()) return
    this.beginEdit()
    this.updateLocation(location)
  }

  updateLocation(location: { latitude: number; longitude: number }): void {
    if (!this.draft) return
    this.draft.latitude = location.latitude
    this.draft.longitude = location.longitude
  }

  get serviceAreaWarning() {
    if (!this.draft) return null
    return advertenciaAreaServicio(
      { latitud: this.warehouseLatitude, longitud: this.warehouseLongitude },
      { latitud: this.draft.latitude, longitud: this.draft.longitude },
      this.serviceRadiusKm,
    )
  }

  private async loadClients(): Promise<void> {
    try {
      const clients = await this.api.getCatalog<Array<{
        id: string
        name: string
        address: string
        contact: string | null
        reference: string | null
        latitude: number
        longitude: number
      }>>("clients")
      this.remoteClients.set(clients.map((client) => ({
        ...client,
        contact: client.contact ?? "",
        reference: client.reference ?? "",
      })))
      const parameters = await this.api.getCatalog<{
        warehouse_latitude: number | string
        warehouse_longitude: number | string
        service_radius_km?: number | string
      } | null>("parameters")
      if (parameters) {
        this.warehouseLatitude = Number(parameters.warehouse_latitude)
        this.warehouseLongitude = Number(parameters.warehouse_longitude)
        this.serviceRadiusKm = Number(parameters.service_radius_km ?? 50)
      }
      if (this.selectedIndex() >= clients.length) this.selectedIndex.set(0)
    } catch (error) {
      this.state.showToast(error instanceof Error ? error.message : "No se pudieron cargar los clientes.")
    } finally {
      this.remoteLoaded.set(true)
    }
  }
}
