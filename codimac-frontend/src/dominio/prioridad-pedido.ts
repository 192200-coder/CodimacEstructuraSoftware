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
