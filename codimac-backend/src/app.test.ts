import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Server } from "node:http"
import bcrypt from "bcryptjs"

const mocks = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock("./db/pool.js", () => ({
  pool: { query: mocks.query },
  inTransaction: vi.fn(),
}))

process.env.DATABASE_URL = "postgresql://codimac:test@localhost/codimac"
process.env.JWT_SECRET = "codimac-test-secret-with-at-least-32-characters"
process.env.CORS_ORIGIN = "http://localhost:8443"
process.env.DATABASE_SSL = "false"

const { app } = await import("./app.js")
const query = vi.mocked(mocks.query)
let server: Server
let baseUrl: string

beforeAll(async () => {
  query.mockResolvedValue({ rows: [], rowCount: 0 } as never)
  server = app.listen(0)
  await new Promise<void>((resolve) => server.once("listening", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No se pudo abrir el servidor de prueba")
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

describe("API CODIMAC", () => {
  it("comprueba la conexión de salud y confirma la base de datos", async () => {
    const response = await fetch(`${baseUrl}/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: "ok", service: "codimac" })
  })

  it("permite el preflight CORS del cliente Angular configurado", async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:8443",
        "Access-Control-Request-Method": "POST",
      },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:8443")
  })

  it("explica cuando el código de trazabilidad no tiene formato UUID", async () => {
    const response = await fetch(`${baseUrl}/api/tracking/COD-101`)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "El código privado de seguimiento tiene un formato inválido",
        fields: [],
      },
    })
  })

  it("devuelve un mensaje específico si el código privado no pertenece a un pedido", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
    const response = await fetch(
      `${baseUrl}/api/tracking/50000000-0000-4000-8000-000000000001`,
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: {
        code: "NOT_FOUND",
        message: "No encontramos un pedido asociado a ese código privado",
        fields: [],
      },
    })
  })

  it("requiere sesión para las operaciones privadas", async () => {
    const response = await fetch(`${baseUrl}/api/orders`)
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      error: {
        code: "UNAUTHENTICATED",
        message: "Autenticación requerida",
        fields: [],
      },
    })
  })

  it("rechaza credenciales incorrectas sin filtrar datos de usuario", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "no-existe@codimac.pe", password: "incorrecta" }),
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      error: {
        code: "UNAUTHENTICATED",
        message: "Correo o contraseña incorrectos",
        fields: [],
      },
    })
  })

  it("inicia sesión, valida el perfil en cada solicitud y revoca el token al cerrar", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 4)
    query
      .mockResolvedValueOnce({
        rows: [{
          id: "90000000-0000-4000-8000-000000000001",
          email: "maria@codimac.pe",
          display_name: "María Quispe",
          role: "Despachador",
          password_hash: passwordHash,
          active: true,
        }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "MARIA@CODIMAC.PE", password: "correct-password" }),
    })
    const session = await loginResponse.json()
    expect(loginResponse.status).toBe(200)
    expect(session.user.role).toBe("Despachador")
    expect(session.token).toBeTypeOf("string")

    query.mockResolvedValueOnce({
      rows: [{
        id: "90000000-0000-4000-8000-000000000001",
        email: "maria@codimac.pe",
        display_name: "María Quispe",
        role: "Despachador",
        auth_session_id: "90000000-0000-4000-8000-000000000099",
      }],
      rowCount: 1,
    } as never)
    const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })
    expect(meResponse.status).toBe(200)

    query
      .mockResolvedValueOnce({
        rows: [{
          id: "90000000-0000-4000-8000-000000000001",
          email: "maria@codimac.pe",
          display_name: "María Quispe",
          role: "Despachador",
          auth_session_id: "90000000-0000-4000-8000-000000000099",
        }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` },
    })
    expect(logoutResponse.status).toBe(200)
    expect(await logoutResponse.json()).toEqual({ loggedOut: true })

    query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
    const revokedResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })
    expect(revokedResponse.status).toBe(401)
  })
})
