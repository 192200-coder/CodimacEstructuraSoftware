import express from "express"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Server } from "node:http"
import type { CatalogUseCases } from "../application/catalog.js"
import type { RouteUseCases } from "../application/routes.js"

const authState = vi.hoisted(() => ({
  role: "Despachador" as "Despachador" | "Administrador",
}))

vi.mock("../http/auth.js", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = {
      id: "90000000-0000-4000-8000-000000000001",
      email: "dispatcher@codimac.pe",
      display_name: "Despachador",
      role: authState.role,
    }
    next()
  },
  requireRole: (...roles: Array<"Despachador" | "Chofer" | "Administrador">) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!req.user || !roles.includes(req.user.role)) {
        res.status(403).json({ error: "No tienes permiso para realizar esta operación" })
        return
      }
      next()
    },
}))

import { errorHandler } from "../http/errors.js"
import { createCatalogRouter } from "./catalog.router.js"
import { createRoutesRouter } from "./routes.router.js"

let server: Server
let baseUrl: string
let catalogUseCases: CatalogUseCases

function createRouteUseCasesMock(): RouteUseCases {
  return {
    create: vi.fn(async () => ({ id: "route-1", code: "R-001", status: "Calculada" as const })),
    approve: vi.fn(async () => undefined),
    createBatch: vi.fn(async () => [
      { id: "route-1", code: "R-001", status: "Asignada" as const },
      { id: "route-2", code: "R-002", status: "Asignada" as const },
    ]),
    remove: vi.fn(async () => undefined),
    assign: vi.fn(async () => ({ canal: "WhatsApp" as const, estado: "Simulado" as const, detalle: "Simulado" })),
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
    loadDemoData: vi.fn(async () => ({ operationalDataLoaded: true })),
    resetDemoData: vi.fn(async () => ({ operationalDataLoaded: true })),
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
  authState.role = "Despachador"
  const app = express()
  app.use(express.json())
  app.use("/api", createRoutesRouter(createRouteUseCasesMock()))
  catalogUseCases = createCatalogUseCasesMock()
  app.use("/api", createCatalogRouter(catalogUseCases))
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
  it("permite al Despachador crear y editar clientes con el contrato del catálogo", async () => {
    const client = {
      name: "Cliente de prueba",
      contact: "912345678",
      address: "Av. Ejemplo 123",
      reference: "Portón verde",
      latitude: -13.6,
      longitude: -72.8,
    }
    const created = await fetch(`${baseUrl}/api/catalog/clients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(client),
    })

    expect(created.status).toBe(201)
    expect(catalogUseCases.createCatalog).toHaveBeenCalledWith("clients", client, "90000000-0000-4000-8000-000000000001")

    const updated = await fetch(
      `${baseUrl}/api/catalog/clients/20000000-0000-4000-8000-000000000001`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: "Junto al mercado" }),
      },
    )
    expect(updated.status).toBe(200)
    expect(catalogUseCases.updateCatalog).toHaveBeenCalledWith(
      "clients",
      "20000000-0000-4000-8000-000000000001",
      { reference: "Junto al mercado" },
      "90000000-0000-4000-8000-000000000001",
    )

    const adminOnlyCatalog = await fetch(`${baseUrl}/api/admin/catalog/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Producto", unit: "unidad", weight_kg: 1 }),
    })
    expect(adminOnlyCatalog.status).toBe(403)
  })

  it("permite al Administrador crear clientes", async () => {
    authState.role = "Administrador"
    const response = await fetch(`${baseUrl}/api/catalog/clients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Cliente administrador",
        contact: "912345678",
        address: "Av. Ejemplo 123",
        latitude: -13.6,
        longitude: -72.8,
      }),
    })

    expect(response.status).toBe(201)
  })

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

  it("permite crear y actualizar todos los catálogos (usuarios, clientes, productos, vehículos)", async () => {
    authState.role = "Administrador"
    const id = "20000000-0000-4000-8000-000000000001"
    const json = { "Content-Type": "application/json" }
    const send = (method: string, path: string, body: unknown) =>
      fetch(`${baseUrl}/api${path}`, { method, headers: json, body: JSON.stringify(body) })

    const product = { name: "Cemento", unit: "bolsa", weight_kg: 42.5, total_stock: 10, active: true }
    const vehicle = {
      plate: "ABC-123",
      vehicle_type: "Camión",
      capacity_kg: 5000,
      average_speed_kmh: 40,
      fuel_efficiency_km_l: 6,
      available: true,
    }
    const client = {
      name: "Cliente",
      contact: "912345678",
      address: "Av. Ejemplo 123",
      reference: "",
      latitude: -13.6,
      longitude: -72.8,
    }

    expect((await send("POST", "/admin/catalog/products", product)).status).toBe(201)
    expect(catalogUseCases.createCatalog).toHaveBeenCalledWith("products", product, expect.any(String))
    expect((await send("PUT", `/admin/catalog/products/${id}`, { name: "Cemento Sol", active: false })).status).toBe(200)
    expect(catalogUseCases.updateCatalog).toHaveBeenCalledWith("products", id, { name: "Cemento Sol", active: false }, expect.any(String))

    expect((await send("POST", "/admin/catalog/vehicles", vehicle)).status).toBe(201)
    expect(catalogUseCases.createCatalog).toHaveBeenCalledWith("vehicles", vehicle, expect.any(String))
    expect((await send("PUT", `/admin/catalog/vehicles/${id}`, { capacity_kg: 6000, available: false })).status).toBe(200)
    expect(catalogUseCases.updateCatalog).toHaveBeenCalledWith("vehicles", id, { capacity_kg: 6000, available: false }, expect.any(String))

    expect((await send("POST", "/catalog/clients", client)).status).toBe(201)
    expect((await send("PUT", `/catalog/clients/${id}`, { address: "Otra dirección", latitude: -13.5 })).status).toBe(200)

    const user = { email: "Chofer@Codimac.pe", password: "ClaveSegura123", name: "Chofer", phone: "987654321", role: "Chofer" }
    expect((await send("POST", "/admin/users", user)).status).toBe(201)
    expect(catalogUseCases.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "chofer@codimac.pe", phone: "987654321", role: "Chofer" }),
    )
    expect((await send("PUT", `/admin/users/${id}`, { name: "Otro", phone: null, active: false })).status).toBe(200)
    expect(catalogUseCases.updateUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: id, name: "Otro", phone: null, active: false }),
    )
  })

  it("rechaza actualizaciones vacías o con celular inválido en los catálogos", async () => {
    authState.role = "Administrador"
    const id = "20000000-0000-4000-8000-000000000001"
    const put = (path: string, body: unknown) =>
      fetch(`${baseUrl}/api${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    expect((await put(`/admin/catalog/vehicles/${id}`, {})).status).toBe(400)
    expect((await put(`/admin/users/${id}`, { phone: "812345678" })).status).toBe(400)
  })

  it("crea y asigna varias rutas de un lote dividido por flota", async () => {
    const uuid = (n: number) => `40000000-0000-4000-8000-00000000000${n}`
    const route = (n: number) => ({
      orderIds: [uuid(n)],
      distanceKm: 5,
      estimatedMinutes: 10,
      estimatedLiters: 1,
      estimatedCost: 6,
      driverId: `60000000-0000-4000-8000-00000000000${n}`,
      vehicleId: `70000000-0000-4000-8000-00000000000${n}`,
    })
    const response = await fetch(`${baseUrl}/api/routes/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routes: [route(1), route(2)] }),
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      routes: [
        { routeId: "route-1", code: "R-001", status: "Asignada" },
        { routeId: "route-2", code: "R-002", status: "Asignada" },
      ],
    })

    const empty = await fetch(`${baseUrl}/api/routes/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routes: [] }),
    })
    expect(empty.status).toBe(400)
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
      status: "Calculada",
    })
  })

  it("ofrece una transición HTTP explícita de Calculada a Aprobada", async () => {
    const response = await fetch(`${baseUrl}/api/routes/50000000-0000-4000-8000-000000000001/approve`, {
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "Aprobada" })
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

  it("informa si el restablecimiento está habilitado y lo rechaza con 403 cuando no lo está (M-05)", async () => {
    authState.role = "Administrador"
    const status = await fetch(`${baseUrl}/api/admin/demo-data`)
    expect(await status.json()).toEqual({ resetEnabled: false })

    const reset = await fetch(`${baseUrl}/api/admin/demo-data/reset`, { method: "POST" })
    expect(reset.status).toBe(403)
    expect(catalogUseCases.resetDemoData).not.toHaveBeenCalled()

    const load = await fetch(`${baseUrl}/api/admin/demo-data`, { method: "POST" })
    expect(load.status).toBe(200)
    expect(catalogUseCases.loadDemoData).toHaveBeenCalledWith("90000000-0000-4000-8000-000000000001")
  })

  it("restablece los datos de ejemplo solo si el entorno lo habilita", async () => {
    authState.role = "Administrador"
    const useCases = createCatalogUseCasesMock()
    const app = express()
    app.use(express.json())
    app.use("/api", createCatalogRouter(useCases, { demoResetEnabled: true }))
    app.use(errorHandler)
    const enabledServer = app.listen(0)
    await new Promise<void>((resolve) => enabledServer.once("listening", resolve))
    const address = enabledServer.address()
    if (!address || typeof address === "string") throw new Error("Sin puerto de prueba")
    try {
      const reset = await fetch(`http://127.0.0.1:${address.port}/api/admin/demo-data/reset`, { method: "POST" })
      expect(reset.status).toBe(200)
      expect(await reset.json()).toEqual({ reset: true, operationalDataLoaded: true })
      expect(useCases.resetDemoData).toHaveBeenCalledWith("90000000-0000-4000-8000-000000000001")
    } finally {
      await new Promise<void>((resolve) => enabledServer.close(() => resolve()))
    }
  })
})
