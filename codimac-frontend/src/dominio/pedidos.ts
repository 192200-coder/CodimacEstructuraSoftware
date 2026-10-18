import { ReglaNegocioError } from "./errores"
import type { EstadoPedido, Pedido } from "./modelos"

const transiciones: Record<EstadoPedido, EstadoPedido[]> = {
  Pendiente: ["En preparación", "Cancelado"],
  "En preparación": ["Listo", "Cancelado"],
  Listo: ["En ruta", "Cancelado"],
  "En ruta": ["Entregado"],
  Entregado: [],
  Cancelado: [],
}

export function validarTransicionPedido(
  actual: EstadoPedido,
  siguiente: EstadoPedido,
  opciones: { reintentosAgotados?: boolean } = {},
) {
  if (actual === siguiente) {
    throw new ReglaNegocioError(
      "El pedido ya se encuentra en ese estado.",
      "ESTADO_DUPLICADO",
    )
  }
  if (
    actual === "En ruta" &&
    siguiente === "Listo" &&
    opciones.reintentosAgotados
  ) {
    return siguiente
  }
  if (!transiciones[actual].includes(siguiente)) {
    throw new ReglaNegocioError(
      `No se permite cambiar un pedido de ${actual} a ${siguiente}.`,
      "TRANSICION_INVALIDA",
    )
  }
  return siguiente
}

export function ordenarPorPrioridad(pedidos: Pedido[]) {
  return [...pedidos].sort((a, b) => {
    if (a.fechaLimite && b.fechaLimite) {
      return (
        new Date(a.fechaLimite).getTime() - new Date(b.fechaLimite).getTime()
      )
    }
    if (a.fechaLimite) return -1
    if (b.fechaLimite) return 1
    return new Date(a.fechaPedido).getTime() - new Date(b.fechaPedido).getTime()
  })
}
