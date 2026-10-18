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

const credentials = { codigo: "PED-0001", ultimos4: "1234" }

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
    app.set("trust proxy", 1)
    app.use(express.json())
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

  it("acepta el código y los últimos cuatro dígitos, exponiendo solo el pedido consultado", async () => {
    queryMock.mockResolvedValue({
      rows: [{
        code: "PED-0001",
        order_status: "En ruta",
        position: 2,
        total_stops: 3,
        eta_at: "2026-10-18T18:30:00.000Z",
        stop_status: "En camino",
        client_name: "Nombre privado",
        contact: "+51 900 111 1234",
        address: "Dirección privada",
        other_orders: [{ code: "PED-0002", client_name: "Otro cliente" }],
      }],
      rowCount: 1,
    })

    const response = await fetch(`${baseUrl}/api/tracking`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.1" },
      body: JSON.stringify(credentials),
    })
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
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("right(regexp_replace"), [
      credentials.codigo,
      credentials.ultimos4,
    ])
  })

  it("responde con el mismo error cuando el pedido no existe o los dígitos no coinciden", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 })
    const post = (body: unknown, ip: string) => fetch(`${baseUrl}/api/tracking`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify(body),
    })

    const noOrder = await post(credentials, "198.51.100.2")
    const wrongPhone = await post({ ...credentials, ultimos4: "9999" }, "198.51.100.3")
    expect(noOrder.status).toBe(404)
    expect(wrongPhone.status).toBe(404)
    const noOrderBody = await noOrder.json()
    const wrongPhoneBody = await wrongPhone.json()
    expect(noOrderBody).toEqual(wrongPhoneBody)
    expect(noOrderBody).toMatchObject({
      error: {
        code: "NOT_FOUND",
        message: "No encontramos un pedido con esos datos.",
        fields: [],
      },
    })
  })

  it("no expone posición ni ETA para estados distintos de En camino", async () => {
    const cases = [
      ["Pendiente", "Registrado", 1],
      ["En preparación", "En preparación", 2],
      ["Listo", "Listo para salir", 3],
      ["Entregado", "Entregado", 5],
      ["Cancelado", "Cancelado", null],
    ] as const

    for (const [index, [orderStatus, expectedStatus, expectedStep]] of cases.entries()) {
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

      const response = await fetch(`${baseUrl}/api/tracking`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": `198.51.100.${index + 4}`,
        },
        body: JSON.stringify(credentials),
      })
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

  it("usa el mismo mensaje genérico para datos malformados", async () => {
    const invalid = await fetch(`${baseUrl}/api/tracking`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.9" },
      body: JSON.stringify({ codigo: "PED-0001", ultimos4: "12x" }),
    })
    expect(invalid.status).toBe(404)
    expect(await invalid.json()).toMatchObject({
      error: { message: "No encontramos un pedido con esos datos." },
    })
    expect(pool.query).not.toHaveBeenCalled()
  })

  it("permite cinco fallos por IP y devuelve 429 en el sexto intento", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 })
    const post = () => fetch(`${baseUrl}/api/tracking`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.10" },
      body: JSON.stringify(credentials),
    })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await post()).status).toBe(404)
    }
    const limited = await post()
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({
      error: {
        code: "RATE_LIMITED",
        message: "Demasiados intentos. Prueba de nuevo en 10 minutos.",
      },
    })
    expect(queryMock).toHaveBeenCalledTimes(5)
  })

  it("no cuenta las consultas exitosas para el límite de fallos", async () => {
    queryMock.mockResolvedValue({
      rows: [{
        code: "PED-0001",
        order_status: "Pendiente",
        position: null,
        total_stops: null,
        eta_at: null,
        stop_status: null,
      }],
      rowCount: 1,
    })
    const post = () => fetch(`${baseUrl}/api/tracking`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.11" },
      body: JSON.stringify(credentials),
    })

    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect((await post()).status).toBe(200)
    }
  })
})
