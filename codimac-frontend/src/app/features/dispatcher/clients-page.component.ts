import { Component, effect, signal } from "@angular/core"
import { FormsModule } from "@angular/forms"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import { IconComponent } from "../../shared/icon.component"

interface ClientRow {
  id: string
  name: string
  address: string
  contact: string
  latitude: number
  longitude: number
}

@Component({
  selector: "codimac-clients-page",
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: "./clients-page.component.html",
})
export class ClientsPageComponent {
  readonly selectedIndex = signal(0)
  readonly editing = signal(false)
  readonly remoteClients = signal<ClientRow[]>([])
  readonly remoteLoaded = signal(false)
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
    try {
      await this.api.updateCatalogRecord("clients", client.id, {
        name: draft.name.trim(),
        contact: draft.contact || null,
        address: draft.address.trim(),
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

  private async loadClients(): Promise<void> {
    try {
      const clients = await this.api.getCatalog<Array<{
        id: string
        name: string
        address: string
        contact: string | null
        latitude: number
        longitude: number
      }>>("clients")
      this.remoteClients.set(clients.map((client) => ({
        ...client,
        contact: client.contact ?? "",
      })))
      if (this.selectedIndex() >= clients.length) this.selectedIndex.set(0)
    } catch (error) {
      this.state.showToast(error instanceof Error ? error.message : "No se pudieron cargar los clientes.")
    } finally {
      this.remoteLoaded.set(true)
    }
  }
}
