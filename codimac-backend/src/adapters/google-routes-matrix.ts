import type { Coordinates } from "../domain/routing.js"
import type { ServicioMapas } from "../application/route-matrix.js"

const ENDPOINT = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"

interface MatrixElement {
  originIndex?: number
  destinationIndex?: number
  distanceMeters?: number
  duration?: string
  condition?: string
}

/**
 * Adaptador de Google Routes API (computeRouteMatrix) con tráfico. Timeout corto y un
 * reintento: si aun así falla, el caso de uso vuelve al estimador local (RNF-04).
 */
export class GoogleRoutesMatrix implements ServicioMapas {
  readonly nombre = "Google Routes"

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 8_000,
  ) {}

  async calcularMatriz(puntos: Coordinates[]) {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.request(puntos)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError instanceof Error ? lastError : new Error("No se pudo consultar Google Routes")
  }

  private async request(puntos: Coordinates[]) {
    const waypoints = puntos.map((punto) => ({
      waypoint: { location: { latLng: { latitude: punto.latitude, longitude: punto.longitude } } },
    }))
    const response = await this.fetchImpl(ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": "originIndex,destinationIndex,distanceMeters,duration,condition",
      },
      body: JSON.stringify({
        origins: waypoints,
        destinations: waypoints,
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
      }),
    })
    if (!response.ok) throw new Error(`Google Routes respondió ${response.status}`)
    const elements = await response.json() as MatrixElement[]
    const size = puntos.length
    const distanciasKm = Array.from({ length: size }, () => Array<number>(size).fill(0))
    const minutos = Array.from({ length: size }, () => Array<number>(size).fill(0))
    let filled = 0
    for (const element of elements) {
      const origin = element.originIndex ?? 0
      const destination = element.destinationIndex ?? 0
      if (origin === destination) continue
      if (element.condition !== "ROUTE_EXISTS" || element.distanceMeters === undefined || !element.duration) {
        throw new Error(`Google Routes no encontró ruta entre los puntos ${origin} y ${destination}`)
      }
      distanciasKm[origin]![destination] = element.distanceMeters / 1000
      minutos[origin]![destination] = Number.parseFloat(element.duration) / 60
      filled++
    }
    if (filled < size * (size - 1)) throw new Error("Google Routes devolvió una matriz incompleta")
    return { distanciasKm, minutos }
  }
}
