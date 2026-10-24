// Indicadores globales (RF-00.4) y comparación con el recorrido de referencia (RF-05.9).

export interface FilaIndicador {
  closed_at: string | null
  distance_km: number | string | null
  estimated_minutes: number | string | null
  estimated_cost: number | string | null
  estimated_liters?: number | string | null
  reference_km?: number | string | null
  reference_minutes?: number | string | null
  delivered: number | string
  not_delivered: number | string
  incidents: number | string
}

export interface ResumenIndicadores {
  rutas: number
  entregas: number
  noEntregadas: number
  incidencias: number
  minutos: number
  km: number
  litros: number
  costo: number
  /** Solo rutas que guardaron su recorrido de referencia. */
  comparables: number
  minutosElegidos: number
  minutosReferencia: number
  kmElegidos: number
  kmReferencia: number
  ahorroMinutos: number
  ahorroKm: number
}

const numero = (valor: number | string | null | undefined) => {
  const n = Number(valor ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** Filtra por fecha de cierre (inclusive) con fechas `AAAA-MM-DD` en hora local. */
export function filtrarPorCierre<T extends { closed_at: string | null }>(
  filas: T[],
  desde = "",
  hasta = "",
): T[] {
  const inicio = desde ? new Date(`${desde}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY
  const fin = hasta ? new Date(`${hasta}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY
  return filas.filter((fila) => {
    if (!fila.closed_at) return false
    const cierre = Date.parse(fila.closed_at)
    return cierre >= inicio && cierre <= fin
  })
}

export function resumirIndicadores(filas: FilaIndicador[]): ResumenIndicadores {
  const comparables = filas.filter((fila) =>
    fila.reference_minutes !== null && fila.reference_minutes !== undefined,
  )
  const minutosElegidos = comparables.reduce((total, fila) => total + numero(fila.estimated_minutes), 0)
  const minutosReferencia = comparables.reduce((total, fila) => total + numero(fila.reference_minutes), 0)
  const kmElegidos = comparables.reduce((total, fila) => total + numero(fila.distance_km), 0)
  const kmReferencia = comparables.reduce((total, fila) => total + numero(fila.reference_km), 0)
  return {
    rutas: filas.length,
    entregas: filas.reduce((total, fila) => total + numero(fila.delivered), 0),
    noEntregadas: filas.reduce((total, fila) => total + numero(fila.not_delivered), 0),
    incidencias: filas.reduce((total, fila) => total + numero(fila.incidents), 0),
    minutos: filas.reduce((total, fila) => total + numero(fila.estimated_minutes), 0),
    km: filas.reduce((total, fila) => total + numero(fila.distance_km), 0),
    litros: filas.reduce((total, fila) => total + numero(fila.estimated_liters), 0),
    costo: filas.reduce((total, fila) => total + numero(fila.estimated_cost), 0),
    comparables: comparables.length,
    minutosElegidos,
    minutosReferencia,
    kmElegidos,
    kmReferencia,
    ahorroMinutos: minutosReferencia - minutosElegidos,
    ahorroKm: kmReferencia - kmElegidos,
  }
}

/** "1 h 25 min" o "45 min". */
export function formatearDuracion(minutos: number): string {
  const total = Math.round(minutos)
  const horas = Math.floor(Math.abs(total) / 60)
  const resto = Math.abs(total) % 60
  const signo = total < 0 ? "−" : ""
  return horas ? `${signo}${horas} h ${resto} min` : `${signo}${resto} min`
}
