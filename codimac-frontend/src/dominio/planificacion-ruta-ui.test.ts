import { describe, expect, it } from "vitest"
import {
  calcularAvisosFechaLimite,
  calcularPesoPedidosKg,
  excedeCapacidadCarga,
  formatearKg,
  formatearNumero,
  parsearKg,
  porcentajeLlenado,
  pedidosQueSuperanFlota,
  sugerirDivisionCarga,
  type PedidoPlanificacionUI,
} from "./planificacion-ruta-ui"

describe("parseo numérico de capacidad y peso", () => {
  it("interpreta '4000.000' como 4000 y formatos con miles", () => {
    expect(parsearKg("4000.000")).toBe(4000)
    expect(parsearKg("4,000")).toBe(4000)
    expect(parsearKg("1.234,5")).toBe(1234.5)
    expect(parsearKg("42.5")).toBe(42.5)
    expect(parsearKg("abc")).toBeNaN()
    expect(formatearKg("4000.000")).toBe("4000")
  })

  it("42,5 kg contra 4000.000 kg es carga válida; solo peso > capacidad excede", () => {
    expect(excedeCapacidadCarga(42.5, "4000.000")).toBe(false)
    expect(excedeCapacidadCarga("42.5", "4000.000")).toBe(false)
    expect(excedeCapacidadCarga(4000, "4000.000")).toBe(false)
    expect(excedeCapacidadCarga(4000.5, "4000.000")).toBe(true)
    expect(porcentajeLlenado(2000, "4000.000")).toBe(50)
  })
})

describe("formato numérico global", () => {
  it("elimina ceros innecesarios y fija 2 decimales cuando se pide", () => {
    expect(formatearNumero("42.500000")).toBe("42.5")
    expect(formatearNumero("1500.000")).toBe("1500")
    expect(formatearNumero("0.496", 2, 2)).toBe("0.50")
    expect(formatearNumero(null)).toBe("—")
  })
})

describe("división de carga por flota", () => {
  const flota = [
    { id: "camioneta", capacidadKg: 1500 },
    { id: "camion", capacidadKg: 2000 },
  ]

  it("divide 3.500 kg en Camión (2.000 kg) y Camioneta (1.500 kg) respetando capacidades", () => {
    const pedidos = [1200, 800, 900, 600].map((pesoKg, i) => ({ id: `p${i}`, pesoKg }))
    const { grupos, sinAsignar } = sugerirDivisionCarga(pedidos, flota)

    expect(sinAsignar).toEqual([])
    expect(grupos.map((g) => [g.vehiculoId, g.pesoKg])).toEqual([["camion", 2000], ["camioneta", 1500]])
    expect(grupos.flatMap((g) => g.pedidoIds).sort()).toEqual(["p0", "p1", "p2", "p3"])
  })

  it("deja sin asignar lo que no cabe en la flota y limita las paradas por ruta", () => {
    const resultado = sugerirDivisionCarga(
      [{ id: "enorme", pesoKg: 5000 }, { id: "a", pesoKg: 10 }, { id: "b", pesoKg: 10 }],
      flota,
      1,
    )
    expect(resultado.sinAsignar).toEqual(["enorme"])
    expect(resultado.grupos.every((g) => g.pedidoIds.length <= 1)).toBe(true)
  })

  it("escenario B: un pedido de 5.000 kg que ningún vehículo soporta queda sin asignar y se detecta", () => {
    const pedidos = [{ id: "PED-0099", pesoKg: 5000 }, { id: "ok", pesoKg: 500 }]
    expect(pedidosQueSuperanFlota(pedidos, flota)).toEqual(["PED-0099"])
    const resultado = sugerirDivisionCarga(pedidos, flota)
    expect(resultado.sinAsignar).toEqual(["PED-0099"])
    expect(resultado.grupos.flatMap((g) => g.pedidoIds)).toEqual(["ok"])
  })

  it("escenario C: flota insuficiente llena al máximo y deja el resto sin asignar", () => {
    const pedidos = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, pesoKg: 800 }))
    const { grupos, sinAsignar } = sugerirDivisionCarga(pedidos, [
      { id: "a", capacidadKg: 3000 },
      { id: "b", capacidadKg: 2000 },
    ])
    const asignado = grupos.reduce((total, g) => total + g.pesoKg, 0)
    expect(grupos.length).toBe(2)
    expect(grupos.every((g) => g.pesoKg <= (g.vehiculoId === "a" ? 3000 : 2000))).toBe(true)
    expect(asignado).toBe(4000)
    expect(sinAsignar.length).toBe(5)
    expect(asignado + sinAsignar.length * 800).toBe(8000)
  })

  it("escenario D: más de 10 paradas con peso suficiente generan otra ruta", () => {
    const pedidos = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, pesoKg: 10 }))
    const { grupos, sinAsignar } = sugerirDivisionCarga(pedidos, flota)
    expect(sinAsignar).toEqual([])
    expect(grupos.length).toBe(2)
    expect(grupos.every((g) => g.pedidoIds.length <= 10)).toBe(true)

    const unVehiculo = sugerirDivisionCarga(pedidos, [flota[1]])
    expect(unVehiculo.grupos[0].pedidoIds.length).toBe(10)
    expect(unVehiculo.sinAsignar.length).toBe(2)
  })

  it("calcula el porcentaje de llenado sin recortar la sobrecarga", () => {
    expect(porcentajeLlenado(0, 1000)).toBe(0)
    expect(porcentajeLlenado(500, 1000)).toBe(50)
    expect(porcentajeLlenado(1200, 1000)).toBe(120)
    expect(porcentajeLlenado(10, undefined)).toBe(0)
  })
})

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
  it("bloquea la asignación solo cuando la carga supera la capacidad disponible", () => {
    expect(excedeCapacidadCarga(1500, 1500)).toBe(false)
    expect(excedeCapacidadCarga(1500.001, 1500)).toBe(true)
    expect(excedeCapacidadCarga(1, undefined)).toBe(true)
  })

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
