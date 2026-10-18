export function hasAvailableStock(total: number, reserved: number, requested: number): boolean {
  return requested > 0 && availableStock(total, reserved) >= requested
}

export function availableStock(total: number, reserved: number): number {
  return total - reserved
}

export function canAdjustStock(total: number, reserved: number, change: number): boolean {
  const result = total + change
  return Number.isFinite(result) && result >= 0 && result >= reserved
}

export const ROUTE_STATUSES = [
  "Calculada",
  "Aprobada",
  "Asignada",
  "En curso",
  "Cerrada",
] as const

export type RouteStatus = (typeof ROUTE_STATUSES)[number]

const routeTransitions: Record<RouteStatus, readonly RouteStatus[]> = {
  Calculada: ["Aprobada"],
  Aprobada: ["Asignada"],
  Asignada: ["En curso"],
  "En curso": ["Cerrada"],
  Cerrada: [],
}

export function canTransitionRouteStatus(current: string, next: RouteStatus): boolean {
  return ROUTE_STATUSES.includes(current as RouteStatus) &&
    routeTransitions[current as RouteStatus].includes(next)
}

export function transitionRouteStatus(current: RouteStatus, next: RouteStatus): RouteStatus {
  if (!canTransitionRouteStatus(current, next)) {
    throw new Error(`Transición de ruta inválida: ${current} → ${next}`)
  }
  return next
}

export function isWithinRouteLimit(stopCount: number): boolean {
  return Number.isInteger(stopCount) && stopCount >= 1 && stopCount <= 10
}

export function nextIncident(attempts: number): { attempts: number; status: "Incidencia" | "No entregada" } {
  if (!Number.isInteger(attempts) || attempts < 0 || attempts >= 2) {
    throw new RangeError("Una parada admite como máximo dos intentos.")
  }
  const nextAttempt = attempts + 1
  return {
    attempts: nextAttempt,
    status: nextAttempt === 2 ? "No entregada" : "Incidencia",
  }
}
