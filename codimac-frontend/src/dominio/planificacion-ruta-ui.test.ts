import { describe, expect, it } from "vitest"
import {
  calcularAvisosFechaLimite,
  calcularPesoPedidosKg,
  type PedidoPlanificacionUI,
} from "./planificacion-ruta-ui"

const pedido: PedidoPlanificacionUI = {
  id: "pedido-1",
  code: "PED-0001",
  deadline_at: "2026-10-20T09:00:00.000Z",
  clients: {
    name: "Cliente A",
    latitude: 0,
    longitude: 0.01,
  },
  order_items: [
    { quantity: 2, products: { weight_kg: 42.5 } },
  ],
}

describe("planificación de rutas en la interfaz", () => {
  it("calcula el peso usando las líneas de los pedidos", () => {
    expect(calcularPesoPedidosKg([pedido])).toBe(85)
  })

  it("avisa únicamente por pedidos cuya fecha límite se excede", () => {
    const warnings = calcularAvisosFechaLimite({
      orderIds: ["pedido-1"],
      orders: [pedido],
      origin: { latitud: 0, longitud: 0 },
      averageSpeedKmh: 30,
      minutesPerStop: 5,
      now: new Date("2026-10-20T08:59:00.000Z"),
    })

    expect(warnings).toEqual(["PED-0001 · Cliente A"])
  })

  it("no advierte pedidos sin fecha límite ni coordenadas", () => {
    expect(calcularAvisosFechaLimite({
      orderIds: ["pedido-2"],
      orders: [{
        id: "pedido-2",
        code: "PED-0002",
        clients: { name: "Cliente B" },
      }],
      origin: { latitud: 0, longitud: 0 },
      averageSpeedKmh: 30,
      minutesPerStop: 5,
      now: new Date("2026-10-20T08:00:00.000Z"),
    })).toEqual([])
  })

  it("incluye en la ETA las paradas intermedias aunque no tengan fecha límite", () => {
    const warnings = calcularAvisosFechaLimite({
      orderIds: ["sin-plazo", "con-plazo"],
      orders: [
        {
          id: "sin-plazo",
          code: "PED-0002",
          clients: { name: "Cliente B", latitude: 0, longitude: 0.01 },
        },
        {
          ...pedido,
          id: "con-plazo",
          code: "PED-0003",
        },
      ],
      origin: { latitud: 0, longitud: 0 },
      averageSpeedKmh: 30,
      minutesPerStop: 5,
      now: new Date("2026-10-20T08:59:00.000Z"),
    })

    expect(warnings).toEqual(["PED-0003 · Cliente A"])
  })
})
