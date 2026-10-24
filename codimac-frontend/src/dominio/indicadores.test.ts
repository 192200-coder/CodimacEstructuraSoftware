import { describe, expect, it } from "vitest"
import { filtrarPorCierre, formatearDuracion, resumirIndicadores } from "./indicadores"

const filas = [
  {
    closed_at: "2026-10-20T15:00:00Z",
    distance_km: "16.0",
    estimated_minutes: 31,
    estimated_cost: "9.92",
    estimated_liters: "1.6",
    reference_km: "18.5",
    reference_minutes: 52,
    delivered: 3,
    not_delivered: 0,
    incidents: 1,
  },
  {
    closed_at: "2026-10-22T15:00:00Z",
    distance_km: 10,
    estimated_minutes: 20,
    estimated_cost: 6.2,
    estimated_liters: 1,
    reference_km: null,
    reference_minutes: null,
    delivered: 1,
    not_delivered: 1,
    incidents: 2,
  },
]

describe("indicadores globales (RF-00.4) y referencia (RF-05.9)", () => {
  it("suma entregas, incidencias, tiempo, km y combustible", () => {
    const resumen = resumirIndicadores(filas)
    expect(resumen).toMatchObject({
      rutas: 2,
      entregas: 4,
      noEntregadas: 1,
      incidencias: 3,
      minutos: 51,
      km: 26,
    })
    expect(resumen.litros).toBeCloseTo(2.6, 6)
    expect(resumen.costo).toBeCloseTo(16.12, 6)
  })

  it("compara solo las rutas con recorrido de referencia y calcula el ahorro (P-A06)", () => {
    const resumen = resumirIndicadores(filas)
    expect(resumen).toMatchObject({
      comparables: 1,
      minutosElegidos: 31,
      minutosReferencia: 52,
      ahorroMinutos: 21,
    })
    expect(resumen.ahorroKm).toBeCloseTo(2.5, 6)
  })

  it("filtra por rango de fechas de cierre", () => {
    expect(filtrarPorCierre(filas, "2026-10-21", "")).toHaveLength(1)
    expect(filtrarPorCierre(filas, "", "2026-10-20")).toHaveLength(1)
    expect(filtrarPorCierre(filas)).toHaveLength(2)
  })

  it("formatea duraciones", () => {
    expect(formatearDuracion(45)).toBe("45 min")
    expect(formatearDuracion(85)).toBe("1 h 25 min")
  })
})
