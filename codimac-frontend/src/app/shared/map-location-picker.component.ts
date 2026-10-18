import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, signal } from "@angular/core"
import type { CambioUbicacionMapa, CoordenadasMapa, PuertoUbicacionMapa } from "../../aplicacion/ubicacion-mapa"
import { GoogleMapsUbicacionMapa } from "../../adapters/google-maps-ubicacion-mapa"
import { LeafletUbicacionMapa } from "../../adapters/leaflet-ubicacion-mapa"
import { CodimacApiService } from "../core/codimac-api.service"

@Component({
  selector: "codimac-map-location-picker",
  standalone: true,
  template: `
    <label class="map-address-field">
      Buscar dirección en el mapa
      <input
        #addressInput
        type="search"
        autocomplete="street-address"
        [value]="address"
        (input)="onAddressInput($event)"
        placeholder="Escribe una dirección o marca el mapa"
      />
    </label>
    <div #mapContainer class="location-map" role="application" aria-label="Selector de ubicación del cliente"></div>
    <p class="map-provider-note">{{ providerMessage() }}</p>
    @if (error()) { <p class="tracking-error" role="alert">{{ error() }}</p> }
  `,
})
export class MapLocationPickerComponent implements AfterViewInit, OnDestroy {
  @Input() address = ""
  @Input() latitude: number | null = null
  @Input() longitude: number | null = null
  @Output() readonly addressChange = new EventEmitter<string>()
  @Output() readonly locationChange = new EventEmitter<CoordenadasMapa>()
  @ViewChild("mapContainer", { static: true }) private readonly mapContainer!: ElementRef<HTMLDivElement>
  @ViewChild("addressInput", { static: true }) private readonly addressInput!: ElementRef<HTMLInputElement>

  readonly error = signal("")
  readonly providerMessage = signal("Cargando selector de mapa…")
  private disposeMap: (() => void) | null = null

  constructor(private readonly api: CodimacApiService) {}

  async ngAfterViewInit(): Promise<void> {
    const initial = this.latitude !== null && this.longitude !== null
      ? { latitude: this.latitude, longitude: this.longitude }
      : null
    let apiKey = ""
    try {
      apiKey = (await this.api.getMapsConfig()).googleMapsApiKey
    } catch {
      this.providerMessage.set("No se pudo consultar la configuración de mapas; usando OpenStreetMap.")
    }

    if (apiKey) {
      try {
        this.disposeMap = await this.initializeMap(
          new GoogleMapsUbicacionMapa(apiKey),
          initial,
        )
        this.providerMessage.set("Mapa de Google Maps. Busca una dirección, haz clic o arrastra el marcador.")
        return
      } catch {
        this.providerMessage.set("Google Maps no está disponible; usando OpenStreetMap.")
      }
    } else if (!this.providerMessage().startsWith("No se pudo")) {
      this.providerMessage.set("Mapa de OpenStreetMap. Haz clic o arrastra el marcador.")
    }

    try {
      this.disposeMap = await this.initializeMap(new LeafletUbicacionMapa(), initial)
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : "No se pudo cargar el selector de mapa.")
      this.providerMessage.set("")
    }
  }

  ngOnDestroy(): void {
    this.disposeMap?.()
  }

  onAddressInput(event: Event): void {
    this.addressChange.emit((event.target as HTMLInputElement).value)
  }

  private initializeMap(
    adapter: PuertoUbicacionMapa,
    initial: CoordenadasMapa | null,
  ): Promise<() => void> {
    const onChange: CambioUbicacionMapa = (coordinates, address) => {
      this.locationChange.emit(coordinates)
      if (address) {
        this.addressInput.nativeElement.value = address
        this.addressChange.emit(address)
      }
    }
    return adapter.initialize(
      this.mapContainer.nativeElement,
      this.addressInput.nativeElement,
      initial,
      onChange,
    )
  }
}
