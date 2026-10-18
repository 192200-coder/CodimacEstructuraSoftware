import { describe, expect, it } from "vitest"
import { estimateStopArrivals, orderOpenStops } from "./routing.js"

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
