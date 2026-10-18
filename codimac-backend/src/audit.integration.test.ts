import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Server } from "node:http"
import jwt from "jsonwebtoken"

const mocks = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock("./db/pool.js", () => ({
  pool: { query: mocks.query },
  inTransaction: vi.fn(),
}))

process.env.DATABASE_URL = "postgres://codimac-test@localhost/codimac"
process.env.JWT_SECRET = "codimac-test-secret-with-at-least-32-characters"
process.env.CORS_ORIGIN = "http://localhost:8443"
process.env.DATABASE_SSL = "false"

const { app } = await import("./app.js")
const query = vi.mocked(mocks.query)
const administratorId = "90000000-0000-4000-8000-000000000003"
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
    { sub: administratorId, jti: "90000000-0000-4000-8000-000000000099" },
    process.env.JWT_SECRET!,
  )
}

function authResult(role: "Administrador" | "Despachador") {
  return {
    rows: [{
      id: administratorId,
      email: "admin@codimac.pe",
      display_name: "Admin CODIMAC",
      role,
      auth_session_id: "90000000-0000-4000-8000-000000000099",
    }],
    rowCount: 1,
  }
}

describe("consulta de auditoría", () => {
  it("registra los inicios de sesión fallidos incluso si la cuenta no existe", async () => {
    query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)

    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "inexistente@codimac.pe", password: "no-registrar-esta-clave" }),
    })

    expect(response.status).toBe(401)
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[1]?.[0]).toContain("INSERT INTO auditoria_eventos")
    expect(query.mock.calls[1]?.[1]).toEqual([
      null,
      "Inicio de sesión fallido",
      "Autenticación",
      null,
      null,
      JSON.stringify({ correoIngresado: "inexistente@codimac.pe", motivo: "Cuenta no encontrada" }),
    ])
  })

  it("aplica filtros y paginación y devuelve los campos de auditoría", async () => {
    const event = {
      id: "a0000000-0000-4000-8000-000000000001",
      fecha_hora: "2026-10-18T16:00:00.000Z",
      usuario_id: administratorId,
      usuario: "Admin CODIMAC",
      email: "admin@codimac.pe",
      accion: "Cambio de estado",
      entidad: "Pedido",
      entidad_id: "40000000-0000-4000-8000-000000000001",
      valor_anterior: { estado: "Pendiente" },
      valor_nuevo: { estado: "En preparación" },
    }
    query
      .mockResolvedValueOnce(authResult("Administrador") as never)
      .mockResolvedValueOnce(authResult("Administrador") as never)
      .mockResolvedValueOnce({ rows: [{ total: 1 }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [event], rowCount: 1 } as never)

    const response = await fetch(
      `${baseUrl}/api/admin/audit?desde=2026-10-01T00%3A00%3A00.000Z&hasta=2026-10-31T23%3A59%3A59.000Z&usuario=admin&entidad=Pedido&accion=Cambio%20de%20estado&limit=25&offset=25`,
      { headers: { Authorization: `Bearer ${tokenFor()}` } },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ events: [event], total: 1, limit: 25, offset: 25 })
    expect(query.mock.calls[2]?.[1]).toEqual([
      "2026-10-01T00:00:00.000Z",
      "2026-10-31T23:59:59.000Z",
      "%admin%",
      "Pedido",
      "Cambio de estado",
    ])
    expect(query.mock.calls[3]?.[1]).toEqual([
      "2026-10-01T00:00:00.000Z",
      "2026-10-31T23:59:59.000Z",
      "%admin%",
      "Pedido",
      "Cambio de estado",
      25,
      25,
    ])
  })

  it("solo permite consultar la auditoría al Administrador", async () => {
    query
      .mockResolvedValueOnce(authResult("Despachador") as never)
      .mockResolvedValueOnce(authResult("Despachador") as never)

    const response = await fetch(`${baseUrl}/api/admin/audit`, {
      headers: { Authorization: `Bearer ${tokenFor()}` },
    })

    expect(response.status).toBe(403)
    expect(query).toHaveBeenCalledTimes(2)
  })
})
