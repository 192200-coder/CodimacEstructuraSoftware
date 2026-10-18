import { ReglaNegocioError } from "./errores"
import type { Existencia, LineaPedido } from "./modelos"

export function disponible(existencia: Existencia) {
  return existencia.total - existencia.reservado
}

export function reservarStock(
  lineas: LineaPedido[],
  existencias: Existencia[],
) {
  const porProducto = new Map(
    existencias.map((item) => [item.productoId, { ...item }]),
  )
  for (const linea of lineas) {
    if (!Number.isFinite(linea.cantidad) || linea.cantidad <= 0) {
      throw new ReglaNegocioError(
        "La cantidad debe ser mayor que cero.",
        "CANTIDAD_INVALIDA",
      )
    }
    const existencia = porProducto.get(linea.productoId)
    if (!existencia || disponible(existencia) < linea.cantidad) {
      throw new ReglaNegocioError(
        `Stock insuficiente para el producto ${linea.productoId}.`,
        "STOCK_INSUFICIENTE",
      )
    }
    existencia.reservado += linea.cantidad
  }
  return [...porProducto.values()]
}

export function liberarStock(lineas: LineaPedido[], existencias: Existencia[]) {
  const porProducto = new Map(
    existencias.map((item) => [item.productoId, { ...item }]),
  )
  for (const linea of lineas) {
    const existencia = porProducto.get(linea.productoId)
    if (existencia)
      existencia.reservado = Math.max(0, existencia.reservado - linea.cantidad)
  }
  return [...porProducto.values()]
}

export function pesoTotalKg(
  lineas: Array<Pick<LineaPedido, "cantidad" | "pesoUnitarioKg">>,
) {
  return lineas.reduce(
    (total, linea) => total + linea.cantidad * linea.pesoUnitarioKg,
    0,
  )
}

export function validarCapacidad(pesoKg: number, capacidadKg: number) {
  if (pesoKg > capacidadKg) {
    throw new ReglaNegocioError(
      `El peso del reparto (${pesoKg} kg) supera la capacidad del vehículo (${capacidadKg} kg).`,
      "CAPACIDAD_EXCEDIDA",
    )
  }
}
