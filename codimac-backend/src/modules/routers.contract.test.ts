import express from "express"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Server } from "node:http"
import type { CatalogUseCases } from "../application/catalog.js"
import type { RouteUseCases } from "../application/routes.js"

vi.mock("../http/auth.js", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = {
      id: "90000000-0000-4000-8000-000000000001",
      email: "dispatcher@codimac.pe",
      display_name: "Despachador",
      role: "Despachador",
    }
    next()
  },
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}))

import { errorHandler } from "../http/errors.js"
import { createCatalogRouter } from "./catalog.router.js"
import { createRoutesRouter } from "./routes.router.js"

let server: Server
let baseUrl: string

function createRouteUseCasesMock(): RouteUseCases {
  return {
    create: vi.fn(async () => ({ id: "route-1", code: "R-001", status: "Aprobada" as const })),
    remove: vi.fn(async () => undefined),
    assign: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    deliver: vi.fn(async () => undefined),
    reportIncident: vi.fn(async () => "Reprogramada" as const),
    list: vi.fn(async () => []),
    closedHistory: vi.fn(async () => [{
      id: "route-closed",
      code: "R-001",
      status: "Cerrada",
      result: "Completado",
      stop_count: 1,
    }]),
    driverRoute: vi.fn(async () => null),
    routeSummary: vi.fn(async () => ({})),
  }
}

function createCatalogUseCasesMock(): CatalogUseCases {
  return {
    listCatalog: vi.fn(async () => []),
    getParameters: vi.fn(async () => null),
    createCatalog: vi.fn(async () => ({ id: "product-1" })),
    updateCatalog: vi.fn(async () => ({ id: "product-1" })),
    updateParameters: vi.fn(async () => ({})),
    listUsers: vi.fn(async () => []),
    createUser: vi.fn(async () => ({
      id: "user-1",
      email: "new@codimac.pe",
      display_name: "Nuevo",
      role: "Despachador" as const,
      active: true,
      created_at: "2026-10-18T00:00:00Z",
    })),
    updateUser: vi.fn(async () => ({
      id: "user-1",
      email: "new@codimac.pe",
      display_name: "Nuevo",
      role: "Despachador" as const,
      active: true,
      created_at: "2026-10-18T00:00:00Z",
    })),
    loadDemoData: vi.fn(async () => undefined),
    registerInventoryMovement: vi.fn(async () => 100),
    listIndicators: vi.fn(async () => []),
    listAudit: vi.fn(async () => ({ events: [], total: 0 })),
    listLegacyEvents: vi.fn(async () => []),
    listInventoryMovements: vi.fn(async () => [{
      id: "movement-1",
      tipo: "ENTRADA",
      cantidad: "5",
    }]),
  }
}

beforeEach(async () => {
  const app = express()
  app.use(express.json())
  app.use("/api", createRoutesRouter(createRouteUseCasesMock()))
  app.use("/api", createCatalogRouter(createCatalogUseCasesMock()))
  app.use(errorHandler)
  server = app.listen(0)
  await new Promise<void>((resolve) => server.once("listening", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No se pudo iniciar el servidor de prueba")
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  )
})

describe("contratos HTTP de los routers refactorizados", () => {
  it("devuelve solo el historial operativo de rutas cerradas", async () => {
    const response = await fetch(`${baseUrl}/api/routes/history`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      routes: [{
        id: "route-closed",
        code: "R-001",
        status: "Cerrada",
        result: "Completado",
        stop_count: 1,
      }],
    })
  })

  it("expone los movimientos cronológicos del producto", async () => {
    const response = await fetch(
      `${baseUrl}/api/inventory/20000000-0000-4000-8000-000000000001/movements`,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      movements: [{
        id: "movement-1",
        tipo: "ENTRADA",
        cantidad: "5",
      }],
    })
  })

  it("mantiene el contrato de creación de reparto", async () => {
    const response = await fetch(`${baseUrl}/api/routes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderIds: ["40000000-0000-4000-8000-000000000001"],
        distanceKm: 10,
        estimatedMinutes: 25,
        estimatedLiters: 2,
        estimatedCost: 12,
      }),
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      routeId: "route-1",
      code: "R-001",
      status: "Aprobada",
    })
  })

  it("acepta una entrada de inventario sin motivo y con observación opcional", async () => {
    const response = await fetch(
      `${baseUrl}/api/inventory/20000000-0000-4000-8000-000000000001/movements`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: 15,
          type: "Entrada",
          observation: "Recepción de mercadería",
        }),
      },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ totalStock: 100 })
  })

  it("rechaza una entrada con el campo reason obsoleto", async () => {
    const response = await fetch(
      `${baseUrl}/api/inventory/20000000-0000-4000-8000-000000000001/movements`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: 15,
          type: "Entrada",
          reason: "Recepción de mercadería",
        }),
      },
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    })
  })

  it("exige motivo y detalle válido únicamente para ajustes con motivo Otro", async () => {
    const url = `${baseUrl}/api/inventory/20000000-0000-4000-8000-000000000001/movements`
    const post = (body: unknown) => fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    const missingReason = await post({
      quantity: 5,
      type: "Ajuste",
      direction: "Aumentar",
    })
    expect(missingReason.status).toBe(400)

    const tooShortDetail = await post({
      quantity: 5,
      type: "Ajuste",
      direction: "Aumentar",
      reason: "Otro",
      detail: "abc",
    })
    expect(tooShortDetail.status).toBe(400)

    const validAdjustment = await post({
      quantity: 5,
      type: "Ajuste",
      direction: "Aumentar",
      reason: "Otro",
      detail: "Ajuste por conteo",
    })
    expect(validAdjustment.status).toBe(200)
  })
})
