import L from "leaflet"

export interface PuntoMapa {
  latitude: number
  longitude: number
}

export interface ParadaMapa extends PuntoMapa {
  sequence: number
  label: string
  /** Estado de la parada (9.1); define el color del marcador. */
  status?: string
}

export interface MapaRuta {
  dibujar(almacen: PuntoMapa | null, paradas: ParadaMapa[]): void
  destruir(): void
}

const stopClass: Record<string, string> = {
  Entregada: "delivered",
  Incidencia: "incident",
  "No entregada": "failed",
  "En camino": "on-way",
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

/** RF-02.10: secuencia de paradas numeradas sobre OpenStreetMap, sin clave ni facturación. */
export function crearMapaRuta(container: HTMLElement): MapaRuta {
  const map = L.map(container, { scrollWheelZoom: false }).setView([-13.6366, -72.8814], 12)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map)
  const layer = L.layerGroup().addTo(map)

  return {
    dibujar(almacen, paradas) {
      layer.clearLayers()
      const puntos: L.LatLngExpression[] = []
      if (almacen) {
        puntos.push([almacen.latitude, almacen.longitude])
        L.marker([almacen.latitude, almacen.longitude], {
          icon: L.divIcon({
            className: "route-map-warehouse",
            html: '<span aria-hidden="true">A</span>',
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
          title: "Almacén",
          zIndexOffset: 1000,
        }).bindTooltip("Almacén").addTo(layer)
      }
      for (const parada of [...paradas].sort((a, b) => a.sequence - b.sequence)) {
        puntos.push([parada.latitude, parada.longitude])
        L.marker([parada.latitude, parada.longitude], {
          icon: L.divIcon({
            className: `route-map-stop ${stopClass[parada.status ?? ""] ?? ""}`,
            html: `<span>${parada.sequence}</span>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          }),
          title: `${parada.sequence}. ${parada.label}`,
        }).bindTooltip(`${parada.sequence}. ${escapeHtml(parada.label)}${parada.status ? ` · ${escapeHtml(parada.status)}` : ""}`).addTo(layer)
      }
      if (puntos.length > 1) {
        L.polyline(puntos, { color: "#2e5c8a", weight: 3, opacity: 0.8, dashArray: "6 6" }).addTo(layer)
        map.fitBounds(L.latLngBounds(puntos), { padding: [28, 28], maxZoom: 15 })
      } else if (puntos.length === 1) {
        map.setView(puntos[0]!, 14)
      }
      // El contenedor puede haber cambiado de tamaño (pestañas, modales).
      setTimeout(() => map.invalidateSize(), 0)
    },
    destruir() {
      map.remove()
    },
  }
}
