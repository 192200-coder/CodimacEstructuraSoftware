import type { Coordenadas } from "./modelos"
import { pesoTotalKg } from "./inventario"
import { distanciaLocalKm } from "./rutas"

export interface PedidoPlanificacionUI {
  id: string
  code: string
  deadline_at?: string | null
  clients?: {
    name: string
    latitude?: number | string | null
    longitude?: number | string | null
  } | null
  order_items?: Array<{
    quantity: number | string
    products: { weight_kg: number | string }
  }>
}

export function calcularPesoPedidosKg(orders: PedidoPlanificacionUI[]): number {
  const lines = orders.flatMap((order) =>
    (order.order_items ?? []).map((item) => ({
      cantidad: Number(item.quantity),
      pesoUnitarioKg: Number(item.products.weight_kg),
    })),
  )
  return pesoTotalKg(lines)
}

/** Convierte kg en número o texto ("4000.000", "4,000", "1.234,5") a Number; NaN si no es válido. */
export function parsearKg(valor: number | string | null | undefined): number {
  if (typeof valor === "number") return valor
  if (valor === null || valor === undefined) return Number.NaN
  let texto = String(valor).trim().replace(/\s|kg/gi, "")
  if (!texto) return Number.NaN
  const coma = texto.lastIndexOf(",")
  const punto = texto.lastIndexOf(".")
  if (coma >= 0 && punto >= 0) {
    texto = coma > punto ? texto.replace(/\./g, "").replace(",", ".") : texto.replace(/,/g, "")
  } else if (coma >= 0) {
    texto = /^\d{1,3}(,\d{3})+$/.test(texto) ? texto.replace(/,/g, "") : texto.replace(",", ".")
  } else if ((texto.match(/\./g) ?? []).length > 1) {
    texto = texto.replace(/\./g, "")
  }
  return Number(texto)
}

/** Formato legible de kg: entero si no hay decimales, de lo contrario hasta 2 decimales. */
export function formatearKg(valor: number | string | null | undefined): string {
  const numero = parsearKg(valor)
  if (!Number.isFinite(numero)) return "—"
  return numero.toLocaleString("es-PE", { maximumFractionDigits: 2, useGrouping: false })
}

/** Número legible sin ceros innecesarios: 42.500000 → "42.5". Con minDecimales=2 fija 2 decimales (0.496 → "0.50"). */
export function formatearNumero(
  valor: number | string | null | undefined,
  maxDecimales = 2,
  minDecimales = 0,
): string {
  const numero = parsearKg(valor)
  if (!Number.isFinite(numero)) return "—"
  return numero.toLocaleString("en-US", {
    minimumFractionDigits: minDecimales,
    maximumFractionDigits: Math.max(maxDecimales, minDecimales),
    useGrouping: false,
  })
}

export function excedeCapacidadCarga(pesoKg: number | string, capacidadKg: number | string | undefined): boolean {
  const peso = parsearKg(pesoKg)
  const capacidad = parsearKg(capacidadKg)
  return !Number.isFinite(peso) || !Number.isFinite(capacidad) || peso > capacidad
}

export interface PedidoPeso {
  id: string
  pesoKg: number
}

export interface VehiculoCarga {
  id: string
  capacidadKg: number
}

export interface GrupoCarga {
  vehiculoId: string
  pedidoIds: string[]
  pesoKg: number
}

export interface DivisionCarga {
  grupos: GrupoCarga[]
  sinAsignar: string[]
}

/** Pedidos individuales cuyo peso supera la capacidad de cualquier vehículo de la flota. */
export function pedidosQueSuperanFlota(pedidos: PedidoPeso[], vehiculos: VehiculoCarga[]): string[] {
  const maxima = Math.max(0, ...vehiculos.map((vehiculo) => vehiculo.capacidadKg))
  return pedidos.filter((pedido) => pedido.pesoKg > maxima).map((pedido) => pedido.id)
}

/** Porcentaje de llenado sin recortar: más de 100 indica sobrecarga. */
export function porcentajeLlenado(pesoKg: number, capacidad: number | string | undefined): number {
  const capacidadKg = parsearKg(capacidad)
  if (!Number.isFinite(capacidadKg) || capacidadKg <= 0) return 0
  return Math.round((pesoKg / capacidadKg) * 100)
}

/**
 * Agrupa pedidos en lotes por vehículo (primer ajuste decreciente): los pedidos más
 * pesados se colocan primero en el vehículo de mayor capacidad con espacio libre.
 * Cada lote respeta la capacidad de su vehículo y el máximo de paradas por ruta.
 */
export function sugerirDivisionCarga(
  pedidos: PedidoPeso[],
  vehiculos: VehiculoCarga[],
  maxParadas = 10,
): DivisionCarga {
  const flota = [...vehiculos]
    .filter((vehiculo) => Number.isFinite(vehiculo.capacidadKg) && vehiculo.capacidadKg > 0)
    .sort((a, b) => b.capacidadKg - a.capacidadKg)
  const grupos: GrupoCarga[] = flota.map((vehiculo) => ({
    vehiculoId: vehiculo.id,
    pedidoIds: [],
    pesoKg: 0,
  }))
  const capacidad = new Map(flota.map((vehiculo) => [vehiculo.id, vehiculo.capacidadKg]))
  const sinAsignar: string[] = []

  for (const pedido of [...pedidos].sort((a, b) => b.pesoKg - a.pesoKg)) {
    const destino = grupos.find((grupo) =>
      grupo.pedidoIds.length < maxParadas &&
      grupo.pesoKg + pedido.pesoKg <= (capacidad.get(grupo.vehiculoId) ?? 0),
    )
    if (!destino) {
      sinAsignar.push(pedido.id)
      continue
    }
    destino.pedidoIds.push(pedido.id)
    destino.pesoKg += pedido.pesoKg
  }
  return { grupos: grupos.filter((grupo) => grupo.pedidoIds.length > 0), sinAsignar }
}

export function calcularAvisosFechaLimite(input: {
  orderIds: string[]
  orders: PedidoPlanificacionUI[]
  origin: Coordenadas
  averageSpeedKmh: number
  minutesPerStop: number
  now: Date
}): string[] {
  if (input.averageSpeedKmh <= 0) return []

  const ordersById = new Map(input.orders.map((order) => [order.id, order]))
  const warnings: string[] = []
  let current = input.origin
  let elapsedMinutes = 0

  for (const orderId of input.orderIds) {
    const order = ordersById.get(orderId)
    const client = order?.clients
    if (
      !order ||
      client?.latitude === undefined ||
      client.latitude === null ||
      client.longitude === undefined ||
      client.longitude === null
    ) continue

    const destination = {
      latitud: Number(client.latitude),
      longitud: Number(client.longitude),
    }
    elapsedMinutes +=
      (distanciaLocalKm(current, destination) / input.averageSpeedKmh) * 60
    if (
      order.deadline_at &&
      input.now.getTime() + elapsedMinutes * 60_000 > new Date(order.deadline_at).getTime()
    ) {
      warnings.push(`${order.code} · ${client.name}`)
    }
    elapsedMinutes += input.minutesPerStop
    current = destination
  }
  return warnings
}
