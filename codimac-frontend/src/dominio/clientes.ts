import type { Coordenadas } from "./modelos"
import { distanciaLineaRectaKm } from "./rutas"

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

export function validarDatosCliente(client: DatosCliente): string[] {
  const errors: string[] = []
  if (!/^9\d{8}$/.test(client.contact)) {
    errors.push("El teléfono debe tener 9 dígitos y comenzar con 9.")
  }
  if (client.address.trim().length < 5 || client.address.trim().length > 150) {
    errors.push("La dirección debe tener entre 5 y 150 caracteres.")
  }
  if (client.reference.trim().length > 150) {
    errors.push("La referencia no puede superar los 150 caracteres.")
  }
  if (
    client.latitude === null
    || client.longitude === null
    || !Number.isFinite(client.latitude)
    || !Number.isFinite(client.longitude)
    || client.latitude < -90
    || client.latitude > 90
    || client.longitude < -180
    || client.longitude > 180
  ) {
    errors.push("Selecciona la ubicación del cliente en el mapa.")
  }
  return errors
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
