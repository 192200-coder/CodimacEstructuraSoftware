/// <reference types="google.maps" />
import type { CambioUbicacionMapa, CoordenadasMapa, PuertoUbicacionMapa } from "../aplicacion/ubicacion-mapa"

let googleMapsLoader: Promise<void> | null = null

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof google !== "undefined" && google.maps?.places) return Promise.resolve()
  if (googleMapsLoader) return googleMapsLoader
  googleMapsLoader = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&v=weekly`
    script.async = true
    script.onload = () => typeof google !== "undefined" && google.maps?.places
      ? resolve()
      : reject(new Error("Google Maps no cargó la biblioteca de lugares."))
    script.onerror = () => reject(new Error("No se pudo cargar Google Maps."))
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    googleMapsLoader = null
    throw error
  })
  return googleMapsLoader
}

const DEFAULT_CENTER: google.maps.LatLngLiteral = { lat: -13.6366, lng: -72.8814 }

export class GoogleMapsUbicacionMapa implements PuertoUbicacionMapa {
  constructor(private readonly apiKey: string) {}

  async initialize(
    container: HTMLElement,
    addressInput: HTMLInputElement,
    initial: CoordenadasMapa | null,
    onChange: CambioUbicacionMapa,
  ): Promise<() => void> {
    await loadGoogleMaps(this.apiKey)
    const center = initial
      ? { lat: initial.latitude, lng: initial.longitude }
      : DEFAULT_CENTER
    const map = new google.maps.Map(container, {
      center,
      zoom: initial ? 15 : 11,
      mapTypeControl: false,
      streetViewControl: false,
    })
    const marker = new google.maps.Marker({
      map,
      position: initial ? center : undefined,
      draggable: true,
    })
    const updateLocation = (location: google.maps.LatLng, address?: string) => {
      marker.setPosition(location)
      map.panTo(location)
      onChange({ latitude: location.lat(), longitude: location.lng() }, address)
    }
    const mapListener = map.addListener("click", (event: google.maps.MapMouseEvent) => {
      if (event.latLng) updateLocation(event.latLng)
    })
    const markerListener = marker.addListener("dragend", () => {
      const location = marker.getPosition()
      if (location) onChange({ latitude: location.lat(), longitude: location.lng() })
    })
    const autocomplete = new google.maps.places.Autocomplete(addressInput, {
      fields: ["formatted_address", "geometry"],
    })
    const autocompleteListener = autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace()
      if (place.geometry?.location) {
        updateLocation(place.geometry.location, place.formatted_address)
      }
    })

    return () => {
      mapListener.remove()
      markerListener.remove()
      autocompleteListener.remove()
      marker.setMap(null)
    }
  }
}
