import { describe, expect, it } from "vitest"
import { estimateStopArrivals, localDistanceKm, orderOpenStops, reestimateRoute } from "./routing.js"

describe("planificación local de paradas", () => {
  it("ordena las pendientes por proximidad antes de programar los reintentos", () => {
    const result = orderOpenStops(
      { latitude: 0, longitude: 0 },
      [
        { id: "retry-near", status: "Incidencia", latitude: 0, longitude: 0.01 },
        { id: "pending-far", status: "Pendiente", latitude: 0, longitude: 0.08 },
        { id: "pending-near", status: "Pendiente", latitude: 0, longitude: 0.02 },
      ],
    )

    expect(result.map((stop) => stop.id)).toEqual([
      "pending-near",
      "pending-far",
      "retry-near",
    ])
  })

  it("calcula ETA acumulada con distancia local, velocidad y minutos por parada", () => {
    const departure = new Date("2026-10-18T12:00:00.000Z")
    const result = estimateStopArrivals(
      { latitude: 0, longitude: 0 },
      [
        { id: "first", latitude: 0, longitude: 0.01 },
        { id: "second", latitude: 0, longitude: 0.02 },
      ],
      30,
      5,
      departure,
    )

    expect(result[0]?.eta.getTime()).toBeGreaterThan(departure.getTime())
    expect(result[1]?.eta.getTime()).toBeGreaterThan(
      (result[0]?.eta.getTime() ?? departure.getTime()) + 5 * 60_000,
    )
  })
})

describe("reestimación al quitar una parada (RF-01.13)", () => {
  const warehouse = { latitude: -13.6366, longitude: -72.8814 }
  const a = { latitude: -13.62, longitude: -72.865 }
  const b = { latitude: -13.655, longitude: -72.86 }

  it("conserva la velocidad, los litros por km y el precio implícitos de la ruta original", () => {
    const original = { distanceKm: 20, estimatedMinutes: 56, estimatedLiters: 2, estimatedCost: 12.4, stopCount: 2 }
    const result = reestimateRoute(original, warehouse, [a], 8)
    const expectedKm = localDistanceKm(warehouse, a)
    expect(result.distanceKm).toBeCloseTo(expectedKm, 2)
    // 20 km en 40 min de manejo = 30 km/h; más 8 min de la parada restante.
    expect(result.estimatedMinutes).toBe(Math.round((expectedKm / 30) * 60 + 8))
    expect(result.estimatedLiters).toBeCloseTo(expectedKm * 0.1, 3)
    expect(result.estimatedCost).toBeCloseTo(expectedKm * 0.1 * 6.2, 2)
  })

  it("recorre las paradas restantes en su orden", () => {
    const original = { distanceKm: 10, estimatedMinutes: 40, estimatedLiters: 1, estimatedCost: 6.2, stopCount: 3 }
    const result = reestimateRoute(original, warehouse, [a, b], 8)
    expect(result.distanceKm).toBeCloseTo(localDistanceKm(warehouse, a) + localDistanceKm(a, b), 2)
  })
})
