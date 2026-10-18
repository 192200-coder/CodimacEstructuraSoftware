import L from "leaflet"
import type { CambioUbicacionMapa, CoordenadasMapa, PuertoUbicacionMapa } from "../aplicacion/ubicacion-mapa"

const DEFAULT_CENTER: L.LatLngExpression = [-13.6366, -72.8814]

export class LeafletUbicacionMapa implements PuertoUbicacionMapa {
  async initialize(
    container: HTMLElement,
    _addressInput: HTMLInputElement,
    initial: CoordenadasMapa | null,
    onChange: CambioUbicacionMapa,
  ): Promise<() => void> {
    const map = L.map(container).setView(
      initial ? [initial.latitude, initial.longitude] : DEFAULT_CENTER,
      initial ? 15 : 11,
    )
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)

    const markerIcon = L.divIcon({
      className: "codimac-map-marker",
      html: '<span aria-hidden="true">●</span>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    })
    let marker: L.Marker | null = null
    const setLocation = (latitude: number, longitude: number) => {
      marker?.remove()
      marker = L.marker([latitude, longitude], {
        draggable: true,
        icon: markerIcon,
      }).addTo(map)
      marker.on("dragend", () => {
        const location = marker?.getLatLng()
        if (location) onChange({ latitude: location.lat, longitude: location.lng })
      })
      onChange({ latitude, longitude })
    }

    map.on("click", (event: L.LeafletMouseEvent) => {
      setLocation(event.latlng.lat, event.latlng.lng)
    })
    if (initial) {
      marker = L.marker([initial.latitude, initial.longitude], {
        draggable: true,
        icon: markerIcon,
      }).addTo(map)
      marker.on("dragend", () => {
        const location = marker?.getLatLng()
        if (location) onChange({ latitude: location.lat, longitude: location.lng })
      })
    }

    return () => map.remove()
  }
}
