import { describe, expect, it } from "vitest"
import {
  availableStock,
  canAdjustStock,
  hasAvailableStock,
  isWithinRouteLimit,
  nextIncident,
  transitionRouteStatus,
  type RouteStatus,
} from "./rules.js"

describe("reglas de inventario", () => {
  it("solo reserva existencias disponibles y cantidades positivas", () => {
    expect(availableStock(100, 30)).toBe(70)
    expect(hasAvailableStock(100, 30, 70)).toBe(true)
    expect(hasAvailableStock(100, 31, 70)).toBe(false)
    expect(hasAvailableStock(100, 0, 0)).toBe(false)
  })

  it("no permite ajuste por debajo de reservas ni de cero", () => {
    expect(canAdjustStock(100, 30, -70)).toBe(true)
    expect(canAdjustStock(100, 31, -70)).toBe(false)
    expect(canAdjustStock(10, 0, -11)).toBe(false)
  })
})

describe("reglas de entrega y reparto", () => {
  it("acepta entre una y diez paradas", () => {
    expect(isWithinRouteLimit(1)).toBe(true)
    expect(isWithinRouteLimit(10)).toBe(true)
    expect(isWithinRouteLimit(0)).toBe(false)
    expect(isWithinRouteLimit(11)).toBe(false)
  })

  it("reprograma una vez y marca no entregada al segundo intento", () => {
    expect(nextIncident(0)).toEqual({ attempts: 1, status: "Incidencia" })
    expect(nextIncident(1)).toEqual({ attempts: 2, status: "No entregada" })
  })

  it("no permite un tercer intento ni valores inválidos", () => {
    expect(() => nextIncident(2)).toThrow("máximo dos intentos")
    expect(() => nextIncident(-1)).toThrow("máximo dos intentos")
    expect(() => nextIncident(1.5)).toThrow("máximo dos intentos")
  })

  it.each([
    ["Calculada", "Aprobada"],
    ["Aprobada", "Asignada"],
    ["Asignada", "En curso"],
    ["En curso", "Cerrada"],
  ] as const)("permite transición de ruta %s → %s", (current, next) => {
    expect(transitionRouteStatus(current, next)).toBe(next)
  })

  it.each([
    ["Calculada", "Asignada"],
    ["Calculada", "Cerrada"],
    ["Aprobada", "En curso"],
    ["Asignada", "Aprobada"],
    ["En curso", "Asignada"],
    ["Cerrada", "En curso"],
    ["Cerrada", "Cerrada"],
  ] as const)("rechaza transición de ruta %s → %s", (current, next) => {
    expect(() => transitionRouteStatus(current as RouteStatus, next as RouteStatus)).toThrow(
      "Transición de ruta inválida",
    )
  })
})
