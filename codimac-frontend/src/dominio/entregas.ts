import { ReglaNegocioError } from "./errores"
import type { Parada } from "./modelos"

export function registrarIncidencia(parada: Parada): Parada {
  if (!["En camino", "Incidencia"].includes(parada.estado)) {
    throw new ReglaNegocioError(
      "Solo se puede registrar una incidencia en una parada activa.",
      "PARADA_NO_ACTIVA",
    )
  }
  const intentos = parada.intentos + 1
  return {
    ...parada,
    intentos,
    estado: intentos >= 2 ? "No entregada" : "Incidencia",
  }
}

export function confirmarEntrega(parada: Parada): Parada {
  if (parada.estado === "Entregada") {
    throw new ReglaNegocioError(
      "La parada ya fue confirmada.",
      "CONFIRMACION_DUPLICADA",
    )
  }
  if (parada.estado !== "En camino") {
    throw new ReglaNegocioError(
      "La parada no está En camino.",
      "PARADA_NO_ACTIVA",
    )
  }
  return { ...parada, estado: "Entregada" }
}

export function puedeCerrarRuta(paradas: Parada[]) {
  return (
    paradas.length > 0 &&
    paradas.every((parada) =>
      ["Entregada", "No entregada"].includes(parada.estado),
    )
  )
}
