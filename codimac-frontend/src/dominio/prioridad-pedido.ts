export type PrioridadPedido = "Alta" | "Media" | "Normal" | "Sin plazo"

export function prioridadPorFechaLimite(
  fechaLimite: string | null,
  ahoraMs = Date.now(),
): PrioridadPedido {
  if (fechaLimite === null) return "Sin plazo"
  const fechaMs = Date.parse(fechaLimite)
  if (!Number.isFinite(fechaMs)) {
    throw new Error("La fecha límite del pedido no es válida.")
  }
  const horasRestantes = (fechaMs - ahoraMs) / 3_600_000
  if (horasRestantes <= 24) return "Alta"
  if (horasRestantes <= 72) return "Media"
  return "Normal"
}

const ESTADOS_ACTIVOS = new Set(["Pendiente", "En preparación", "Listo", "En ruta"])

export interface AlertaPlazo {
  code: string
  message: string
  vencido: boolean
}

/** Alertas de plazo por vencer (RF-01.10): solo pedidos activos con fecha límite en las próximas 24 h. */
export function alertasDePlazo(
  pedidos: Array<{ code: string; status: string; deadline_at: string | null }>,
  ahoraMs = Date.now(),
): AlertaPlazo[] {
  return pedidos
    .filter((pedido) => pedido.deadline_at && ESTADOS_ACTIVOS.has(pedido.status))
    .map((pedido) => ({ pedido, limite: Date.parse(pedido.deadline_at!) }))
    .filter(({ limite }) => Number.isFinite(limite) && limite - ahoraMs <= 24 * 3_600_000)
    .sort((a, b) => a.limite - b.limite)
    .map(({ pedido, limite }) => {
      const horas = Math.round((limite - ahoraMs) / 3_600_000)
      if (limite < ahoraMs) {
        return { code: pedido.code, vencido: true, message: `El pedido ${pedido.code} venció su fecha límite.` }
      }
      return {
        code: pedido.code,
        vencido: false,
        message: horas < 1
          ? `El pedido ${pedido.code} vence en menos de 1 hora.`
          : `El pedido ${pedido.code} vence en ${horas} ${horas === 1 ? "hora" : "horas"}.`,
      }
    })
}
