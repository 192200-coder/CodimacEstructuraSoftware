import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Server } from "node:http"
import jwt from "jsonwebtoken"

const mocks = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock("./db/pool.js", () => ({
  pool: { query: mocks.query },
  inTransaction: vi.fn(async (operation: (client: { query: typeof mocks.query }) => Promise<unknown>) =>
    operation({ query: mocks.query })),
}))

process.env.DATABASE_URL = "postgres://codimac-test@localhost/codimac"
process.env.JWT_SECRET = "codimac-test-secret-with-at-least-32-characters"
process.env.CORS_ORIGIN = "http://localhost:8443"
process.env.DATABASE_SSL = "false"

const { app } = await import("./app.js")
const query = vi.mocked(mocks.query)
const dispatcherId = "90000000-0000-4000-8000-000000000004"
let server: Server
let baseUrl: string

beforeAll(async () => {
  server = app.listen(0)
  await new Promise<void>((resolve) => server.once("listening", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No se pudo abrir el servidor de prueba")
  baseUrl = `http://127.0.0.1:${address.port}`
})

beforeEach(() => query.mockReset())

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  )
})

function tokenFor(): string {
  return jwt.sign(
    { sub: dispatcherId, jti: "90000000-0000-4000-8000-000000000099" },
    process.env.JWT_SECRET!,
  )
}

function authResult(role: "Despachador" | "Chofer" | "Administrador") {
  return {
    rows: [{
      id: dispatcherId,
      email: "dispatcher@codimac.pe",
      display_name: "Despachador",
      role,
      auth_session_id: "90000000-0000-4000-8000-000000000099",
    }],
    rowCount: 1,
  }
}

describe("historial operativo y movimientos de inventario", () => {
  it("sirve el historial cerrado desde rutas operativas y no consulta auditorías", async () => {
    const closedRoute = {
      id: "route-closed",
      code: "R-001",
      status: "Cerrada",
      result: "Completado",
      stop_count: 1,
      route_stops: [],
    }
    query
      .mockResolvedValueOnce(authResult("Despachador") as never)
      .mockResolvedValueOnce(authResult("Despachador") as never)
      .mockResolvedValueOnce(authResult("Despachador") as never)
      .mockResolvedValueOnce({ rows: [closedRoute], rowCount: 1 } as never)

    const response = await fetch(`${baseUrl}/api/routes/history`, {
      headers: { Authorization: `Bearer ${tokenFor()}` },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ routes: [closedRoute] })
    const historyQuery = String(query.mock.calls[3]?.[0])
    expect(historyQuery).toContain("FROM routes r")
    expect(historyQuery).toContain("WHERE r.status='Cerrada'")
    expect(historyQuery).not.toContain("auditoria_eventos")
    expect(historyQuery).not.toContain("audit_events")
  })

  it("permite consultar historial al Administrador", async () => {
    query
      .mockResolvedValueOnce(authResult("Administrador") as never)
      .mockResolvedValueOnce(authResult("Administrador") as never)
      .mockResolvedValueOnce(authResult("Administrador") as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)

    const response = await fetch(`${baseUrl}/api/routes/history`, {
      headers: { Authorization: `Bearer ${tokenFor()}` },
    })

    expect(response.status).toBe(200)
  })

  it("rechaza la consulta de historial al Chofer", async () => {
    query
      .mockResolvedValueOnce(authResult("Chofer") as never)
      .mockResolvedValueOnce(authResult("Chofer") as never)
      .mockResolvedValueOnce(authResult("Chofer") as never)

    const response = await fetch(`${baseUrl}/api/routes/history`, {
      headers: { Authorization: `Bearer ${tokenFor()}` },
    })

    expect(response.status).toBe(403)
    expect(query).toHaveBeenCalledTimes(3)
  })

  it("consulta movimientos de producto en orden cronológico descendente", async () => {
    const movement = {
      id: "movement-1",
      tipo: "SALIDA",
      cantidad: "-3",
      pedido_codigo: "P-001",
    }
    query
      .mockResolvedValueOnce(authResult("Despachador") as never)
      .mockResolvedValueOnce(authResult("Despachador") as never)
      .mockResolvedValueOnce({ rows: [movement], rowCount: 1 } as never)

    const response = await fetch(
      `${baseUrl}/api/inventory/20000000-0000-4000-8000-000000000001/movements`,
      { headers: { Authorization: `Bearer ${tokenFor()}` } },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ movements: [movement] })
    const movementsQuery = String(query.mock.calls[2]?.[0])
    expect(movementsQuery).toContain("FROM inventory_movements m")
    expect(movementsQuery).toContain("ORDER BY m.fecha_hora DESC,m.id DESC")
  })
})
