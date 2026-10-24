import type { Coordenadas } from "./modelos"
import { distanciaLineaRectaKm } from "./rutas"
import { validarCliente } from "./validaciones"

export interface DatosCliente {
  contact: string
  address: string
  reference: string
  latitude: number | null
  longitude: number | null
}

export interface AdvertenciaAreaServicio {
  distanceKm: number
  radiusKm: number
  message: string
}

/** Lista de mensajes del Anexo B para teléfono, dirección, referencia y ubicación. */
export function validarDatosCliente(client: DatosCliente): string[] {
  const { name: _nombre, ...errores } = validarCliente({ name: "Cliente", ...client })
  return Object.values(errores)
}

export function advertenciaAreaServicio(
  warehouse: Coordenadas,
  client: Coordenadas,
  radiusKm: number,
): AdvertenciaAreaServicio | null {
  const distanceKm = distanciaLineaRectaKm(warehouse, client)
  if (distanceKm <= radiusKm) return null
  return {
    distanceKm,
    radiusKm,
    message: `Esta ubicación está a más de ${radiusKm} km del almacén.`,
  }
}
