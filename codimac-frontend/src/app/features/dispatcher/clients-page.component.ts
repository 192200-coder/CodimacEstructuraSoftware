import { Component, effect, signal } from "@angular/core"
import { FormsModule } from "@angular/forms"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import { IconComponent } from "../../shared/icon.component"
import { MapLocationPickerComponent } from "../../shared/map-location-picker.component"
import { ApiRequestError } from "../../../lib/codimac-api"
import { advertenciaAreaServicio } from "../../../dominio/clientes"
import { iniciales } from "../../../dominio/formato"
import { validarCliente, type ErroresCampo } from "../../../dominio/validaciones"

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
  readonly selectedId = signal("")
  readonly editing = signal(false)
  readonly saving = signal(false)
  readonly remoteClients = signal<ClientRow[]>([])
  readonly remoteLoaded = signal(false)
  readonly loadError = signal("")
  readonly search = signal("")
  readonly errors = signal<ErroresCampo>({})
  readonly formError = signal("")
  readonly initials = iniciales
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
    const query = this.search().trim().toLocaleLowerCase("es-PE")
    if (!query) return this.remoteClients()
    return this.remoteClients().filter((client) =>
      `${client.name} ${client.address} ${client.contact} ${client.reference}`
        .toLocaleLowerCase("es-PE")
        .includes(query),
    )
  }

  get selected(): ClientRow | null {
    return this.remoteClients().find((client) => client.id === this.selectedId()) ?? null
  }

  setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value)
  }

  select(id: string): void {
    if (this.editing() && id !== this.selectedId()) this.cancelEdit()
    this.selectedId.set(id)
  }

  beginEdit(): void {
    const client = this.selected
    if (!client) return
    this.draft = { ...client }
    this.errors.set({})
    this.formError.set("")
    this.editing.set(true)
  }

  cancelEdit(): void {
    this.editing.set(false)
    this.draft = null
    this.errors.set({})
    this.formError.set("")
  }

  error(field: string): string {
    return this.errors()[field] ?? ""
  }

  private validateDraft(): ErroresCampo {
    const draft = this.draft
    if (!draft) return {}
    return validarCliente({ ...draft, contact: draft.contact.trim() })
  }

  /** Al salir del campo o al corregirlo, se actualiza solo ese mensaje. */
  validateField(field: string): void {
    const message = this.validateDraft()[field]
    this.errors.update((errors) => {
      const { [field]: _previous, ...rest } = errors
      return message ? { ...rest, [field]: message } : rest
    })
  }

  async saveClient(): Promise<void> {
    const client = this.selected
    const draft = this.draft
    if (!client || !draft || this.saving()) return
    const validationErrors = this.validateDraft()
    this.errors.set(validationErrors)
    this.formError.set("")
    if (Object.keys(validationErrors).length) {
      const first = Object.keys(validationErrors)[0]
      queueMicrotask(() => document.querySelector<HTMLElement>(`.client-edit-form [data-error-key="${first}"]`)?.focus())
      return
    }
    this.saving.set(true)
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
      this.state.highlight(client.id)
      this.state.showToast("Cliente actualizado.")
    } catch (error) {
      if (error instanceof ApiRequestError && error.fields.length) {
        this.errors.set(Object.fromEntries(error.fields.map(({ field, message }) => [
          field === "latitude" || field === "longitude" ? "location" : field,
          message,
        ])))
      } else {
        this.formError.set(error instanceof Error ? error.message : "No se pudo actualizar el cliente.")
      }
    } finally {
      this.saving.set(false)
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
    this.validateField("location")
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
      const [clients, parameters] = await Promise.all([
        this.api.getCatalog<Array<{
          id: string
          name: string
          address: string
          contact: string | null
          reference: string | null
          latitude: number
          longitude: number
        }>>("clients"),
        this.api.getCatalog<{
          warehouse_latitude: number | string
          warehouse_longitude: number | string
          service_radius_km?: number | string
        } | null>("parameters"),
      ])
      this.remoteClients.set(clients.map((client) => ({
        ...client,
        latitude: Number(client.latitude),
        longitude: Number(client.longitude),
        contact: client.contact ?? "",
        reference: client.reference ?? "",
      })))
      if (parameters) {
        this.warehouseLatitude = Number(parameters.warehouse_latitude)
        this.warehouseLongitude = Number(parameters.warehouse_longitude)
        this.serviceRadiusKm = Number(parameters.service_radius_km ?? 50)
      }
      const highlighted = this.state.highlightedId()
      if (highlighted && clients.some((client) => client.id === highlighted)) {
        this.selectedId.set(highlighted)
      } else if (!clients.some((client) => client.id === this.selectedId())) {
        this.selectedId.set(clients[0]?.id ?? "")
      }
      this.loadError.set("")
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : "No se pudieron cargar los clientes.")
    } finally {
      this.remoteLoaded.set(true)
    }
  }
}
