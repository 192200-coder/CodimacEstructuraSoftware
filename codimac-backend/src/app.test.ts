import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Server } from "node:http"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"

const mocks = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock("./db/pool.js", () => ({
  pool: { query: mocks.query },
  inTransaction: vi.fn(async (operation: (client: { query: typeof mocks.query }) => Promise<unknown>) =>
    operation({ query: mocks.query })),
}))

process.env.DATABASE_URL = "postgresql://codimac:test@localhost/codimac"
process.env.JWT_SECRET = "codimac-test-secret-with-at-least-32-characters"
process.env.CORS_ORIGIN = "http://localhost:8443"
process.env.DATABASE_SSL = "false"

const { app, isAllowedOrigin } = await import("./app.js")
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

  it("publica configuración de mapas con clave pública opcional", async () => {
    const response = await fetch(`${baseUrl}/api/maps-config`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      googleMapsApiKey: expect.any(String),
    })
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

  it("responde con error genérico si no encuentra el pedido con las credenciales indicadas", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
    const response = await fetch(`${baseUrl}/api/tracking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo: "PED-0001", ultimos4: "1234" }),
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: {
        code: "NOT_FOUND",
        message: "No encontramos un pedido con esos datos.",
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

  it("responde 403 al intentar crear un usuario con rol Despachador", async () => {
    query.mockClear()
    const sessionId = "90000000-0000-4000-8000-000000000099"
    const dispatcherSession = {
      rows: [{
        id: "90000000-0000-4000-8000-000000000001",
        email: "despachador@codimac.pe",
        display_name: "Despachador",
        role: "Despachador",
        auth_session_id: sessionId,
      }],
      rowCount: 1,
    }
    query.mockResolvedValueOnce(dispatcherSession as never)
      .mockResolvedValueOnce(dispatcherSession as never)
    const token = jwt.sign(
      { sub: "90000000-0000-4000-8000-000000000001", jti: sessionId },
      process.env.JWT_SECRET!,
    )

    const response = await fetch(`${baseUrl}/api/admin/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "new@codimac.pe",
        password: "ClaveSegura123",
        name: "Nuevo usuario",
        role: "Chofer",
      }),
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { code: "FORBIDDEN" },
    })
    expect(query.mock.calls.every(([statement]) =>
      String(statement).includes("FROM profiles p JOIN auth_sessions"),
    )).toBe(true)
  })

  it("rechaza el alta de usuario cuando la base reporta un correo duplicado", async () => {
    const userId = "90000000-0000-4000-8000-000000000003"
    const sessionId = "90000000-0000-4000-8000-000000000098"
    query.mockImplementation(async (statement) => {
      if (String(statement).includes("FROM profiles p JOIN auth_sessions")) {
        return {
          rows: [{
            id: userId,
            email: "admin@codimac.pe",
            display_name: "Administrador",
            role: "Administrador",
            auth_session_id: sessionId,
          }],
          rowCount: 1,
        } as never
      }
      if (String(statement).includes("INSERT INTO profiles")) {
        throw Object.assign(new Error("duplicate key"), { code: "23505", constraint: "profiles_email_key" })
      }
      return { rows: [], rowCount: 0 } as never
    })
    const token = jwt.sign(
      { sub: userId, jti: sessionId },
      process.env.JWT_SECRET!,
    )

    const response = await fetch(`${baseUrl}/api/admin/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "existing@codimac.pe",
        password: "ClaveSegura123",
        name: "Usuario duplicado",
        role: "Chofer",
      }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: {
        code: "CONFLICT",
        fields: [{ field: "email", message: "Ese correo ya está registrado." }],
      },
    })
    query.mockReset()
    query.mockResolvedValue({ rows: [], rowCount: 0 } as never)
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

  it("en desarrollo acepta localhost, 127.0.0.1 y la red local; en producción solo CORS_ORIGIN", () => {
    for (const origin of ["http://localhost:8443", "http://127.0.0.1:8443", "http://10.60.35.57:8443", "http://192.168.1.20:8443"]) {
      expect(isAllowedOrigin(origin, false), origin).toBe(true)
    }
    expect(isAllowedOrigin("https://sitio-ajeno.com", false)).toBe(false)
    expect(isAllowedOrigin("http://127.0.0.1:8443", true)).toBe(false)
    expect(isAllowedOrigin("http://localhost:8443", true)).toBe(true)
  })
})
