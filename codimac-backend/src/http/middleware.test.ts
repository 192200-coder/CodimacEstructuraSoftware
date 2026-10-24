import express from "express"
import type { Server } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import { createLogger } from "./logger.js"
import { createRequestLog, requireHttps } from "./middleware.js"

let server: Server | undefined

async function start(app: express.Express): Promise<string> {
  server = app.listen(0)
  await new Promise<void>((resolve) => server!.once("listening", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Sin puerto de prueba")
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve())
  server = undefined
})

describe("HTTPS obligatorio (RNF-07)", () => {
  function appWith(enabled: boolean) {
    const app = express()
    app.set("trust proxy", 1)
    app.use(requireHttps(enabled))
    app.get("/health", (_req, res) => { res.json({ ok: true }) })
    app.get("/api/x", (_req, res) => { res.json({ ok: true }) })
    return app
  }

  it("rechaza HTTP cuando está activo, salvo el chequeo de salud", async () => {
    const base = await start(appWith(true))
    expect((await fetch(`${base}/api/x`)).status).toBe(403)
    expect((await fetch(`${base}/api/x`, { headers: { "X-Forwarded-Proto": "https" } })).status).toBe(200)
    expect((await fetch(`${base}/health`)).status).toBe(200)
  })

  it("no interviene en desarrollo", async () => {
    const base = await start(appWith(false))
    expect((await fetch(`${base}/api/x`)).status).toBe(200)
  })
})

describe("logs estructurados (RNF-16)", () => {
  it("escribe una línea JSON por petición con método, ruta, estado y duración", async () => {
    const lines: string[] = []
    const app = express()
    app.use(createRequestLog(createLogger({ info: (line) => lines.push(line), warn: (line) => lines.push(line) })))
    app.get("/api/pedidos", (_req, res) => { res.json([]) })
    const base = await start(app)
    await fetch(`${base}/api/pedidos?estado=Listo`)
    await fetch(`${base}/api/no-existe`)

    const [ok, notFound] = lines.map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(ok).toMatchObject({ level: "info", event: "http.request", method: "GET", path: "/api/pedidos", status: 200 })
    expect(typeof ok!.ms).toBe("number")
    expect(notFound).toMatchObject({ level: "warn", status: 404 })
  })
})
