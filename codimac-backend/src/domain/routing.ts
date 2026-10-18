export interface Coordinates {
  latitude: number
  longitude: number
}

export interface OpenStop {
  id: string
  status: "Pendiente" | "Incidencia"
  latitude: number
  longitude: number
}

const EARTH_RADIUS_KM = 6371
const LOCAL_ROAD_FACTOR = 1.35

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function localDistanceKm(origin: Coordinates, destination: Coordinates): number {
  const latitudeDelta = radians(destination.latitude - origin.latitude)
  const longitudeDelta = radians(destination.longitude - origin.longitude)
  const originLatitude = radians(origin.latitude)
  const destinationLatitude = radians(destination.latitude)
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(longitudeDelta / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(haversine)) * LOCAL_ROAD_FACTOR
}

export function orderOpenStops(origin: Coordinates, stops: OpenStop[]): OpenStop[] {
  const ordered: OpenStop[] = []
  let current = origin

  for (const status of ["Pendiente", "Incidencia"] as const) {
    const remaining = stops
      .filter((stop) => stop.status === status)
      .map((stop) => ({ ...stop }))

    while (remaining.length) {
      remaining.sort(
        (left, right) =>
          localDistanceKm(current, left) - localDistanceKm(current, right) ||
          left.id.localeCompare(right.id),
      )
      const next = remaining.shift()
      if (!next) break
      ordered.push(next)
      current = next
    }
  }

  return ordered
}

export function estimateStopArrivals(
  origin: Coordinates,
  stops: Array<Coordinates & { id: string }>,
  averageSpeedKmh: number,
  minutesPerStop: number,
  departureTime: Date,
): Array<{ id: string; eta: Date }> {
  if (!Number.isFinite(averageSpeedKmh) || averageSpeedKmh <= 0) {
    throw new Error("La velocidad promedio del vehículo debe ser mayor que cero.")
  }

  let current = origin
  let elapsedMinutes = 0
  return stops.map((stop) => {
    elapsedMinutes += (localDistanceKm(current, stop) / averageSpeedKmh) * 60
    const eta = new Date(departureTime.getTime() + elapsedMinutes * 60_000)
    elapsedMinutes += minutesPerStop
    current = stop
    return { id: stop.id, eta }
  })
}
