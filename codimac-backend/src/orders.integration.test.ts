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
let orders: Map<string, { status: string; quantity: number; activeRouteId: string | null }>
let reservations: Map<string, { quantity: number; released: boolean }>
let routes: Map<string, { status: string; vehicleId: string | null }>
let routeStops: Map<string, { id: string; routeId: string; orderId: string; sequence: number }>
let inventoryMovements: Array<{ type: string; quantity: number; actorId: string }>
let auditEvents: Array<{ action: string; entity: string; actorId: string }>
let statusEvents: Array<{ previous: string; next: string; actorId: string }>
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
      orders.set(orderId, { status: "Pendiente", quantity, activeRouteId: null })
      return queryResult()
    }
    if (sql.includes("SELECT status,active_route_id FROM orders WHERE id=$1 FOR UPDATE")) {
      const order = orders.get(values[0] as string)
      return queryResult(order ? [{
        status: order.status,
        active_route_id: order.activeRouteId,
      }] : [])
    }
    if (sql.includes("SELECT status FROM routes WHERE id=$1 FOR UPDATE")) {
      const route = routes.get(values[0] as string)
      return queryResult(route ? [{ status: route.status, vehicle_id: route.vehicleId }] : [])
    }
    if (sql.includes("SELECT status,vehicle_id FROM routes WHERE id=$1 FOR UPDATE")) {
      const route = routes.get(values[0] as string)
      return queryResult(route ? [{ status: route.status, vehicle_id: route.vehicleId }] : [])
    }
    if (sql.includes("SELECT status,driver_id,vehicle_id FROM routes WHERE id=$1 FOR UPDATE")) {
      const route = routes.get(values[0] as string)
      return queryResult(route ? [{
        status: route.status,
        driver_id: actorId,
        vehicle_id: route.vehicleId,
      }] : [])
    }
    if (sql.includes("SELECT id FROM route_stops WHERE route_id=$1 AND order_id=$2 FOR UPDATE")) {
      const stop = [...routeStops.values()].find((item) =>
        item.routeId === values[0] && item.orderId === values[1],
      )
      return queryResult(stop ? [{ id: stop.id }] : [])
    }
    if (sql.includes("DELETE FROM route_stops WHERE id=$1")) {
      routeStops.delete([...routeStops.values()].find((item) => item.id === values[0])?.id ?? "")
      return queryResult()
    }
    if (sql.includes("SELECT id FROM route_stops WHERE route_id=$1 ORDER BY sequence_number")) {
      return queryResult([...routeStops.values()]
        .filter((stop) => stop.routeId === values[0])
        .sort((left, right) => left.sequence - right.sequence)
        .map((stop) => ({ id: stop.id })))
    }
    if (sql.includes("UPDATE orders SET active_route_id=NULL")) {
      const order = orders.get(values[0] as string)
      if (order) order.activeRouteId = null
      return queryResult()
    }
    if (sql.includes("UPDATE vehicles SET available=true")) return queryResult()
    if (sql.includes("UPDATE routes SET status='Aprobada'")) {
      const route = routes.get(values[0] as string)
      if (route) {
        route.status = "Aprobada"
        route.vehicleId = null
      }
      return queryResult()
    }
    if (sql.includes("DELETE FROM routes WHERE id=$1")) {
      routes.delete(values[0] as string)
      return queryResult()
    }
    if (sql.includes("UPDATE route_stops SET sequence_number=sequence_number+$2")) {
      const routeId = values[0] as string
      const offset = Number(values[1])
      for (const stop of routeStops.values()) {
        if (stop.routeId === routeId) stop.sequence += offset
      }
      return queryResult()
    }
    if (sql.includes("UPDATE route_stops SET sequence_number=$2 WHERE id=$1")) {
      const stop = [...routeStops.values()].find((item) => item.id === values[0])
      if (stop) stop.sequence = Number(values[1])
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
    if (sql.includes("INSERT INTO stock_reservations")) {
      reservations.set(values[0] as string, { quantity: Number(values[2]), released: false })
      return queryResult()
    }
    if (sql.includes("FROM stock_reservations") && sql.includes("released_at IS NULL")) {
      const orderId = values[0] as string
      const reservation = reservations.get(orderId)
      return queryResult(reservation && !reservation.released
        ? [{ product_id: productId, quantity: reservation.quantity }]
        : [])
    }
    if (sql.includes("UPDATE products SET reserved_stock=reserved_stock-$2")) {
      const quantity = Number(values[1])
      if (reserved < quantity) return queryResult()
      reserved -= quantity
      return queryResult([{ total_stock: physicalStock, reserved_stock: reserved }])
    }
    if (sql.includes("UPDATE stock_reservations SET released_at=now()")) {
      const reservation = reservations.get(values[0] as string)
      if (reservation) reservation.released = true
      return queryResult()
    }
    if (sql.includes("INSERT INTO inventory_movements")) {
      inventoryMovements.push({
        type: sql.includes("'LIBERACION'") ? "LIBERACION" : "RESERVA",
        quantity: Number(values[1]),
        actorId: values[3] as string,
      })
      return queryResult()
    }
    if (sql.includes("INSERT INTO auditoria_eventos")) {
      auditEvents.push({
        action: values[1] as string,
        entity: values[2] as string,
        actorId: values[0] as string,
      })
      return queryResult()
    }
    if (sql.includes("INSERT INTO status_events")) {
      if (values[2] === "Cancelado") {
        statusEvents.push({
          previous: values[1] as string,
          next: values[2] as string,
          actorId: values[3] as string,
        })
      } else {
        statusEvents.push({
          previous: values[1] as string,
          next: values[2] as string,
          actorId: values[3] as string,
        })
      }
      return queryResult()
    }
    if (sql.includes("UPDATE orders SET status=$2")) {
      const order = orders.get(values[0] as string)
      if (order) {
        order.status = values[1] as string
        if (sql.includes("active_route_id=NULL")) order.activeRouteId = null
      }
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
  reservations = new Map()
  routes = new Map()
  routeStops = new Map()
  inventoryMovements = []
  auditEvents = []
  statusEvents = []
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
      reservations: structuredClone(reservations),
      routes: structuredClone(routes),
      routeStops: structuredClone(routeStops),
      inventoryMovements: structuredClone(inventoryMovements),
      auditEvents: structuredClone(auditEvents),
      statusEvents: structuredClone(statusEvents),
    }
    try {
      return await operation(transactionClient as unknown as PoolClient)
    } catch (error) {
      physicalStock = snapshot.physicalStock
      reserved = snapshot.reserved
      orders = snapshot.orders
      reservations = snapshot.reservations
      routes = snapshot.routes
      routeStops = snapshot.routeStops
      inventoryMovements = snapshot.inventoryMovements
      auditEvents = snapshot.auditEvents
      statusEvents = snapshot.statusEvents
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

async function createOrderAndPrepare(quantity = 10): Promise<string> {
  const created = await post("/api/orders", newOrder(quantity))
  if (created.status !== 201) throw new Error("No se pudo crear el pedido de prueba")
  const { order } = await created.json() as { order: { id: string } }
  const prepared = await post(`/api/orders/${order.id}/prepare`, {})
  if (prepared.status !== 200) throw new Error("No se pudo preparar el pedido de prueba")
  return order.id
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

  it.each(["Pendiente", "En preparación", "Listo"] as const)(
    "cancela un pedido en estado %s y libera reservas, con movimiento y auditoría",
    async (status) => {
      let orderId: string
      if (status === "Pendiente") {
        const response = await post("/api/orders", newOrder(10))
        expect(response.status).toBe(201)
        orderId = ((await response.json()) as { order: { id: string } }).order.id
      } else {
        orderId = await createOrderAndPrepare(10)
        if (status === "Listo") {
          const ready = await post(`/api/orders/${orderId}/ready`, {})
          expect(ready.status).toBe(200)
        }
        expect(reserved).toBe(10)
      }

      const response = await post(`/api/orders/${orderId}/cancel`, {})

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: "Cancelado" })
      expect(orders.get(orderId)?.status).toBe("Cancelado")
      expect(reserved).toBe(0)
      if (status === "Pendiente") {
        expect(reservations.has(orderId)).toBe(false)
        expect(inventoryMovements).toHaveLength(0)
      } else {
        expect(reservations.get(orderId)).toEqual({ quantity: 10, released: true })
        expect(inventoryMovements).toContainEqual({
          type: "LIBERACION",
          quantity: 10,
          actorId,
        })
        expect(auditEvents).toContainEqual({
          action: "Liberación de reserva",
          entity: "Inventario",
          actorId,
        })
      }
      expect(statusEvents).toContainEqual({
        previous: status,
        next: "Cancelado",
        actorId,
      })
      expect(auditEvents).toContainEqual({
        action: "Cambio de estado",
        entity: "Pedido",
        actorId,
      })
    },
  )

  it.each(["En ruta", "Entregado"] as const)(
    "rechaza la cancelación cuando el pedido está %s",
    async (status) => {
      const orderId = await createOrderAndPrepare(10)
      const order = orders.get(orderId)
      if (!order) throw new Error("No se encontró el pedido de prueba")
      order.status = status
      const movementCount = inventoryMovements.length
      const auditCount = auditEvents.length
      const statusEventCount = statusEvents.length

      const response = await post(`/api/orders/${orderId}/cancel`, {})

      expect(response.status).toBe(409)
      expect(orders.get(orderId)?.status).toBe(status)
      expect(reserved).toBe(10)
      expect(inventoryMovements).toHaveLength(movementCount)
      expect(statusEvents).toHaveLength(statusEventCount)
      expect(auditEvents).toHaveLength(auditCount)
    },
  )

  it("cancela un pedido Listo y retira su última parada de una ruta asignada", async () => {
    const orderId = await createOrderAndPrepare(10)
    const ready = await post(`/api/orders/${orderId}/ready`, {})
    expect(ready.status).toBe(200)
    const routeId = "50000000-0000-4000-8000-000000000001"
    const stopId = "60000000-0000-4000-8000-000000000001"
    const order = orders.get(orderId)
    if (!order) throw new Error("No se encontró el pedido de prueba")
    order.activeRouteId = routeId
    routes.set(routeId, { status: "Asignada", vehicleId: "70000000-0000-4000-8000-000000000001" })
    routeStops.set(stopId, { id: stopId, routeId, orderId, sequence: 1 })

    const response = await post(`/api/orders/${orderId}/cancel`, {})

    expect(response.status).toBe(200)
    expect(orders.get(orderId)).toMatchObject({ status: "Cancelado", activeRouteId: null })
    expect(routeStops.size).toBe(0)
    expect(routes.has(routeId)).toBe(false)
    expect(reserved).toBe(0)
    expect(inventoryMovements).toContainEqual({ type: "LIBERACION", quantity: 10, actorId })
  })
})
