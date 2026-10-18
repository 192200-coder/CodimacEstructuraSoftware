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
