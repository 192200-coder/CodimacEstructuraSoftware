import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Server } from "node:http"

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}))
vi.mock("../db/pool.js", () => ({
  pool: { query: queryMock },
}))

import { pool } from "../db/pool.js"
import { errorHandler } from "../http/errors.js"
import { publicRouter } from "./public.router.js"
import { getPortalStep, mapPublicTrackingStatus } from "./public-tracking.js"
import express from "express"

const token = "40000000-0000-4000-8000-000000000001"

describe("mapeo de estados del seguimiento público", () => {
  it.each([
    ["Pendiente", null, "Registrado", 1],
    ["En preparación", null, "En preparación", 2],
    ["Listo", null, "Listo para salir", 3],
    ["En ruta", "En camino", "En camino", 4],
    ["Entregado", "Entregada", "Entregado", 5],
    ["Cancelado", null, "Cancelado", null],
    ["Listo", "Incidencia", "Reprogramado", null],
    ["En ruta", "No entregada", "No entregada", null],
  ] as const)("mapea %s / %s a %s, paso %s", (orderStatus, stopStatus, expectedStatus, expectedStep) => {
    const status = mapPublicTrackingStatus(orderStatus, stopStatus)
    expect(status).toBe(expectedStatus)
    expect(getPortalStep(status)).toBe(expectedStep)
  })
})

describe("contrato HTTP del seguimiento público", () => {
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    const app = express()
    app.use(publicRouter)
    app.use(errorHandler)
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("No se pudo iniciar el servidor de prueba")
    baseUrl = `http://127.0.0.1:${address.port}`
    queryMock.mockReset()
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    )
  })

  it("incluye posición y ETA solo cuando el pedido está En camino", async () => {
    queryMock.mockResolvedValue({
      rows: [{
        code: "PED-0001",
        order_status: "En ruta",
        position: 2,
        total_stops: 3,
        eta_at: "2026-10-18T18:30:00.000Z",
        stop_status: "En camino",
      }],
      rowCount: 1,
    })

    const response = await fetch(`${baseUrl}/api/tracking/${token}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      tracking: {
        code: "PED-0001",
        public_status: "En camino",
        current_step: 4,
        position: 2,
        total_stops: 3,
        eta_at: "2026-10-18T18:30:00.000Z",
        stop_status: "En camino",
      },
    })
  })

  it("entrega los cinco estados y la variante cancelada sin posición ni ETA", async () => {
    const cases = [
      ["Pendiente", "Registrado", 1],
      ["En preparación", "En preparación", 2],
      ["Listo", "Listo para salir", 3],
      ["Entregado", "Entregado", 5],
      ["Cancelado", "Cancelado", null],
    ] as const

    for (const [orderStatus, expectedStatus, expectedStep] of cases) {
      queryMock.mockResolvedValue({
        rows: [{
          code: "PED-0001",
          order_status: orderStatus,
          position: 2,
          total_stops: 3,
          eta_at: "2026-10-18T18:30:00.000Z",
          stop_status: null,
        }],
        rowCount: 1,
      })

      const response = await fetch(`${baseUrl}/api/tracking/${token}`)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.tracking).toMatchObject({
        public_status: expectedStatus,
        current_step: expectedStep,
      })
      expect(body.tracking).not.toHaveProperty("position")
      expect(body.tracking).not.toHaveProperty("total_stops")
      expect(body.tracking).not.toHaveProperty("eta_at")
    }
  })

  it("rechaza un token inválido y reporta el pedido inexistente", async () => {
    const invalid = await fetch(`${baseUrl}/api/tracking/no-es-uuid`)
    expect(invalid.status).toBe(400)
    expect(pool.query).not.toHaveBeenCalled()

    queryMock.mockResolvedValue({ rows: [], rowCount: 0 })
    const missing = await fetch(`${baseUrl}/api/tracking/${token}`)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    })
  })
})
