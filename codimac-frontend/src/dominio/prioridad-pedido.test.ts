import { describe, expect, it } from "vitest"
import { prioridadPorFechaLimite } from "./prioridad-pedido"

describe("prioridad visible de pedidos", () => {
  const now = Date.parse("2026-10-18T12:00:00.000Z")

  it("marca alta una fecha vencida o dentro de 24 horas", () => {
    expect(prioridadPorFechaLimite("2026-10-18T11:00:00.000Z", now)).toBe("Alta")
    expect(prioridadPorFechaLimite("2026-10-19T12:00:00.000Z", now)).toBe("Alta")
  })

  it("distingue plazos dentro de 72 horas y plazos posteriores", () => {
    expect(prioridadPorFechaLimite("2026-10-20T12:00:00.000Z", now)).toBe("Media")
    expect(prioridadPorFechaLimite("2026-10-22T12:00:00.000Z", now)).toBe("Normal")
  })

  it("muestra la falta de fecha límite y rechaza fechas inválidas", () => {
    expect(prioridadPorFechaLimite(null, now)).toBe("Sin plazo")
    expect(() => prioridadPorFechaLimite("no-es-fecha", now)).toThrow("fecha límite")
  })
})
