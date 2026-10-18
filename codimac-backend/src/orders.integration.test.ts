import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Server } from "node:http"
import type { PoolClient } from "pg"
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
const { inTransaction } = await import("./db/pool.js")
const transaction = vi.mocked(inTransaction)
const query = vi.mocked(mocks.query)
const actorId = "90000000-0000-4000-8000-000000000001"
const clientId = "20000000-0000-4000-8000-000000000001"
const productId = "10000000-0000-4000-8000-000000000001"
const orderIds = [
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002",
]

let server: Server
let baseUrl: string
let physicalStock = 85
let reserved = 0
let nextOrder = 0
let orderSequence = 0
let routeSequence = 0
let orders: Map<string, { status: string; quantity: number }>
let transactionTail: Promise<void>

const product = {
  id: productId,
  name: "Cemento tipo I",
  total_stock: 85,
  reserved_stock: 0,
}

function queryResult(rows: Record<string, unknown>[] = []) {
  return { rows, rowCount: rows.length }
}

const transactionClient = {
  async query(sql: string, values: unknown[] = []) {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return queryResult()
    if (sql.includes("nextval('order_code_seq')")) {
      orderSequence += 1
      return queryResult([{ value: orderSequence }])
    }
    if (sql.includes("nextval('route_code_seq')")) {
      routeSequence += 1
      return queryResult([{ value: routeSequence }])
    }
    if (sql.includes("SELECT id,name,total_stock,reserved_stock")) {
      const ids = values[0] as string[]
      return queryResult(ids.includes(productId) ? [{ ...product, total_stock: physicalStock, reserved_stock: reserved }] : [])
    }
    if (sql.includes("INSERT INTO orders")) {
      const id = orderIds[nextOrder] ?? `30000000-0000-4000-8000-${String(nextOrder + 1).padStart(12, "0")}`
      nextOrder += 1
      return queryResult([{
        id,
        code: values[0] as string,
        status: "Pendiente",
        deadline_at: values[2] as string | null,
      }])
    }
    if (sql.includes("INSERT INTO order_items")) {
      const orderId = values[0] as string
      const quantity = Number(values[2])
      orders.set(orderId, { status: "Pendiente", quantity })
      return queryResult()
    }
    if (sql.includes("SELECT status FROM orders WHERE id=$1 FOR UPDATE")) {
      const order = orders.get(values[0] as string)
      return queryResult(order ? [{ status: order.status }] : [])
    }
    if (sql.includes("FROM order_items oi JOIN products p")) {
      const order = orders.get(values[0] as string)
      return queryResult(order ? [{
        product_id: productId,
        quantity: order.quantity,
        name: "Cemento tipo I",
        total_stock: physicalStock,
        reserved_stock: reserved,
      }] : [])
    }
    if (sql.includes("UPDATE products SET reserved_stock=reserved_stock+$2")) {
      reserved += Number(values[1])
      return queryResult()
    }
    if (sql.includes("UPDATE orders SET status='En preparación'")) {
      const order = orders.get(values[0] as string)
      if (order) order.status = "En preparación"
      return queryResult()
    }
    return queryResult()
  },
}

beforeAll(async () => {
  server = app.listen(0)
  await new Promise<void>((resolve) => server.once("listening", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No se pudo abrir el servidor de prueba")
  baseUrl = `http://127.0.0.1:${address.port}`
})

beforeEach(() => {
  physicalStock = 85
  reserved = 0
  nextOrder = 0
  orderSequence = 0
  routeSequence = 0
  orders = new Map()
  transactionTail = Promise.resolve()
  query.mockImplementation(async () => ({
    rows: [{
      id: actorId,
      email: "despachador@codimac.pe",
      display_name: "Despachador",
      role: "Despachador",
      auth_session_id: "90000000-0000-4000-8000-000000000099",
    }],
    rowCount: 1,
  } as never))
  transaction.mockImplementation(async (operation) => {
    const previous = transactionTail
    let release: () => void = () => {}
    transactionTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    const snapshot = {
      physicalStock,
      reserved,
      orders: structuredClone(orders),
    }
    try {
      return await operation(transactionClient as unknown as PoolClient)
    } catch (error) {
      physicalStock = snapshot.physicalStock
      reserved = snapshot.reserved
      orders = snapshot.orders
      throw error
    } finally {
      release()
    }
  })
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  )
})

async function post(path: string, body: unknown): Promise<Response> {
  const token = jwt.sign(
    { sub: actorId, jti: "90000000-0000-4000-8000-000000000099" },
    process.env.JWT_SECRET!,
  )
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

function newOrder(quantity: number) {
  return {
    clientId,
    deadlineAt: null,
    items: [{ productId, quantity }],
  }
}

describe("flujo HTTP de disponibilidad y reserva de pedidos", () => {
  it("rechaza el pedido si una línea excede el stock sin guardar cabecera ni detalle", async () => {
    const response = await post("/api/orders", newOrder(1000))
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Revisa los campos marcados.",
        fields: [{
          field: "lineas[0].cantidad",
          code: "STOCK_INSUFICIENTE",
          message: "Solo hay 85 unidades disponibles de Cemento tipo I; faltan 915.",
        }],
      },
    })
    expect(orders.size).toBe(0)
    expect(nextOrder).toBe(0)
    expect(orderSequence).toBe(0)
  })

  it("serializa dos preparaciones concurrentes y mantiene Pendiente la que excede el stock restante", async () => {
    const [firstCreate, secondCreate] = await Promise.all([
      post("/api/orders", newOrder(60)),
      post("/api/orders", newOrder(60)),
    ])
    expect(firstCreate.status).toBe(201)
    expect(secondCreate.status).toBe(201)
    expect(await firstCreate.json()).toMatchObject({ order: { code: "PED-0001" } })
    expect(await secondCreate.json()).toMatchObject({ order: { code: "PED-0002" } })

    const [firstPrepare, secondPrepare] = await Promise.all([
      post(`/api/orders/${orderIds[0]}/prepare`, {}),
      post(`/api/orders/${orderIds[1]}/prepare`, {}),
    ])
    const responses = [firstPrepare, secondPrepare]
    const succeeded = responses.filter((response) => response.status === 200)
    const rejected = responses.filter((response) => response.status === 422)

    expect(succeeded).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(reserved).toBe(60)
    expect(physicalStock - reserved).toBe(25)
    expect([...orders.values()].filter((order) => order.status === "En preparación")).toHaveLength(1)
    expect([...orders.values()].filter((order) => order.status === "Pendiente")).toHaveLength(1)
    const rejectedResponse = rejected[0]
    if (!rejectedResponse) throw new Error("No se recibió el rechazo esperado por stock insuficiente")
    expect(await rejectedResponse.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        fields: [{
          code: "STOCK_INSUFICIENTE",
          message: "Solo hay 25 unidades disponibles de Cemento tipo I; faltan 35.",
        }],
      },
    })
  })
})
