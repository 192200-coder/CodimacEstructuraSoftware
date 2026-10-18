import { describe, expect, it } from "vitest"
import {
  confirmarEntrega,
  puedeCerrarRuta,
  registrarIncidencia,
} from "./entregas"
import { liberarStock, reservarStock, validarCapacidad } from "./inventario"
import { ordenarPorPrioridad, validarTransicionPedido } from "./pedidos"
import { distanciaLocalKm, generarAlternativas } from "./rutas"
import type { DestinoRuta, Parada, Vehiculo } from "./modelos"

describe("máquina de estados de pedidos", () => {
  it("acepta la secuencia normal", () => {
    expect(validarTransicionPedido("Pendiente", "En preparación")).toBe(
      "En preparación",
    )
    expect(validarTransicionPedido("En preparación", "Listo")).toBe("Listo")
    expect(validarTransicionPedido("Listo", "En ruta")).toBe("En ruta")
    expect(validarTransicionPedido("En ruta", "Entregado")).toBe("Entregado")
  })

  it("rechaza transiciones inválidas y duplicadas", () => {
    expect(() => validarTransicionPedido("Pendiente", "Entregado")).toThrow()
    expect(() => validarTransicionPedido("Listo", "Listo")).toThrow()
  })

  it("solo vuelve a Listo por reintentos agotados", () => {
    expect(() => validarTransicionPedido("En ruta", "Listo")).toThrow()
    expect(
      validarTransicionPedido("En ruta", "Listo", { reintentosAgotados: true }),
    ).toBe("Listo")
  })

  it("prioriza fecha límite y luego antigüedad", () => {
    const base = {
      estado: "Listo" as const,
      direccion: "Abancay",
      coordenadas: { latitud: -13.6, longitud: -72.8 },
      lineas: [],
    }
    const ordered = ordenarPorPrioridad([
      { ...base, id: "old", codigo: "OLD", fechaPedido: "2026-10-01" },
      {
        ...base,
        id: "deadline",
        codigo: "DUE",
        fechaPedido: "2026-10-10",
        fechaLimite: "2026-10-20",
      },
      { ...base, id: "new", codigo: "NEW", fechaPedido: "2026-10-15" },
    ])
    expect(ordered.map((pedido) => pedido.id)).toEqual([
      "deadline",
      "old",
      "new",
    ])
  })
})

describe("reservas y capacidad", () => {
  const existencias = [{ productoId: "cemento", total: 100, reservado: 20 }]
  const lineas = [{ productoId: "cemento", cantidad: 40, pesoUnitarioKg: 42.5 }]

  it("reserva y libera sin producir negativos", () => {
    const reservadas = reservarStock(lineas, existencias)
    expect(reservadas[0].reservado).toBe(60)
    expect(liberarStock(lineas, reservadas)[0].reservado).toBe(20)
  })

  it("rechaza stock insuficiente", () => {
    expect(() =>
      reservarStock([{ ...lineas[0], cantidad: 81 }], existencias),
    ).toThrow()
  })

  it("rechaza repartos que exceden la capacidad", () => {
    expect(() => validarCapacidad(1501, 1500)).toThrow()
    expect(() => validarCapacidad(1500, 1500)).not.toThrow()
  })
})

describe("incidencias y cierre", () => {
  const parada: Parada = {
    id: "p1",
    entregaId: "e1",
    estado: "En camino",
    intentos: 0,
  }

  it("reprograma una vez y marca No entregada en el segundo intento", () => {
    const primera = registrarIncidencia(parada)
    expect(primera.estado).toBe("Incidencia")
    const segunda = registrarIncidencia(primera)
    expect(segunda.estado).toBe("No entregada")
  })

  it("impide confirmar dos veces", () => {
    const entregada = confirmarEntrega(parada)
    expect(entregada.estado).toBe("Entregada")
    expect(() => confirmarEntrega(entregada)).toThrow()
  })

  it("cierra solo con todas las paradas resueltas", () => {
    expect(
      puedeCerrarRuta([
        { ...parada, estado: "Entregada" },
        { ...parada, id: "p2", estado: "No entregada" },
      ]),
    ).toBe(true)
    expect(puedeCerrarRuta([{ ...parada, estado: "Pendiente" }])).toBe(false)
  })
})

describe("estimador local", () => {
  const vehiculo: Vehiculo = {
    id: "v1",
    placa: "ABC-123",
    capacidadKg: 1500,
    velocidadPromedioKmh: 30,
    rendimientoKmLitro: 10,
    disponible: true,
  }
  const destinos: DestinoRuta[] = [
    {
      id: "a",
      etiqueta: "A",
      coordenadas: { latitud: -13.632, longitud: -72.881 },
    },
    {
      id: "b",
      etiqueta: "B",
      coordenadas: { latitud: -13.642, longitud: -72.875 },
    },
    {
      id: "c",
      etiqueta: "C",
      coordenadas: { latitud: -13.638, longitud: -72.891 },
    },
  ]

  it("aplica el factor vial y genera hasta tres alternativas", () => {
    const origen = { latitud: -13.6366, longitud: -72.8814 }
    expect(distanciaLocalKm(origen, destinos[0].coordenadas)).toBeGreaterThan(0)
    const alternativas = generarAlternativas(origen, destinos, vehiculo, 6.2, 8)
    expect(alternativas).toHaveLength(3)
    expect(alternativas[0].tiempoMinutos).toBeLessThanOrEqual(
      alternativas[1].tiempoMinutos,
    )
    expect(alternativas[0].usaTraficoReal).toBe(false)
  })

  it("rechaza rutas vacías y de más de diez paradas", () => {
    const origen = { latitud: -13.6366, longitud: -72.8814 }
    expect(() => generarAlternativas(origen, [], vehiculo, 6.2, 8)).toThrow()
    expect(() =>
      generarAlternativas(
        origen,
        Array.from({ length: 11 }, (_, index) => ({
          ...destinos[0],
          id: String(index),
        })),
        vehiculo,
        6.2,
        8,
      ),
    ).toThrow()
  })
})
