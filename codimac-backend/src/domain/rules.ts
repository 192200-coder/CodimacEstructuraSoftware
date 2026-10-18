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

export function isWithinRouteLimit(stopCount: number): boolean {
  return Number.isInteger(stopCount) && stopCount >= 1 && stopCount <= 10
}

export function nextIncident(attempts: number): { attempts: number; status: "Incidencia" | "No entregada" } {
  const nextAttempt = attempts + 1
  return {
    attempts: Math.min(nextAttempt, 2),
    status: nextAttempt >= 2 ? "No entregada" : "Incidencia",
  }
}
