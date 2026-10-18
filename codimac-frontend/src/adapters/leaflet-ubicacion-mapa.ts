import L from "leaflet"
import type { CambioUbicacionMapa, CoordenadasMapa, PuertoUbicacionMapa } from "../aplicacion/ubicacion-mapa"

const DEFAULT_CENTER: L.LatLngExpression = [-13.6366, -72.8814]

export class LeafletUbicacionMapa implements PuertoUbicacionMapa {
  async initialize(
    container: HTMLElement,
    addressInput: HTMLInputElement,
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
    let lookupSequence = 0
    const addressInputListener = () => {
      lookupSequence += 1
    }
    addressInput.addEventListener("input", addressInputListener)
    const reverseGeocode = async (latitude: number, longitude: number) => {
      const coordinates = { latitude, longitude }
      const sequence = ++lookupSequence
      onChange(coordinates, "")
      try {
        const query = new URLSearchParams({
          format: "jsonv2",
          lat: String(latitude),
          lon: String(longitude),
          "accept-language": "es",
        })
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${query}`)
        if (!response.ok) throw new Error(`Geocodificación OSM respondió HTTP ${response.status}.`)
        const result = await response.json() as { display_name?: unknown }
        if (sequence !== lookupSequence) return
        if (typeof result.display_name !== "string" || !result.display_name) {
          throw new Error("OpenStreetMap no encontró una dirección para esta ubicación.")
        }
        onChange(coordinates, result.display_name)
      } catch (error) {
        if (sequence !== lookupSequence) return
        onChange(
          coordinates,
          undefined,
          error instanceof Error
            ? `${error.message} Puedes escribir la dirección manualmente.`
            : "No se pudo obtener la dirección de esta ubicación. Puedes escribirla manualmente.",
        )
      }
    }
    const setLocation = (latitude: number, longitude: number) => {
      marker?.remove()
      marker = L.marker([latitude, longitude], {
        draggable: true,
        icon: markerIcon,
      }).addTo(map)
      marker.on("dragend", () => {
        const location = marker?.getLatLng()
        if (location) void reverseGeocode(location.lat, location.lng)
      })
      void reverseGeocode(latitude, longitude)
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
        if (location) void reverseGeocode(location.lat, location.lng)
      })
    }

    return () => {
      addressInput.removeEventListener("input", addressInputListener)
      map.remove()
    }
  }
}
