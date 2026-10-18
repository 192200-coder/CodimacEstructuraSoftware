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
const driverId = "90000000-0000-4000-8000-000000000002"
const clientId = "20000000-0000-4000-8000-000000000001"
const productId = "10000000-0000-4000-8000-000000000001"
const vehicleId = "70000000-0000-4000-8000-000000000001"
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
let orders: Map<string, { status: string; quantity: number; activeRouteId: string | null; code: string }>
let reservations: Map<string, { quantity: number; released: boolean }>
let routes: Map<string, { status: string; vehicleId: string | null; driverId: string | null; code: string }>
let routeStops: Map<string, {
  id: string
  routeId: string
  orderId: string
  sequence: number
  status: string
  attempts: number
}>
let inventoryMovements: Array<{ type: string; quantity: number; actorId: string }>
let auditEvents: Array<{ action: string; entity: string; actorId: string }>
let statusEvents: Array<{ previous: string; next: string; actorId: string }>
let transactionTail: Promise<void>
let stopSequence: number
let profileRoles: Map<string, "Despachador" | "Chofer" | "Administrador">

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
    if (sql.includes("INSERT INTO routes(")) {
      const id = `50000000-0000-4000-8000-${String(routeSequence).padStart(12, "0")}`
      routes.set(id, {
        status: values[1] as string,
        vehicleId: null,
        driverId: null,
        code: values[0] as string,
      })
      return queryResult([{ id, code: values[0] as string }])
    }
    if (sql.includes("INSERT INTO route_stops(")) {
      stopSequence += 1
      const id = `60000000-0000-4000-8000-${String(stopSequence).padStart(12, "0")}`
      routeStops.set(id, {
        id,
        routeId: values[0] as string,
        orderId: values[1] as string,
        sequence: Number(values[2]),
        status: "Pendiente",
        attempts: 0,
      })
      return queryResult()
    }
    if (sql.includes("SELECT id,status,active_route_id FROM orders WHERE id=ANY")) {
      const ids = values[0] as string[]
      return queryResult(ids.flatMap((id) => {
        const order = orders.get(id)
        return order ? [{ id, status: order.status, active_route_id: order.activeRouteId }] : []
      }))
    }
    if (sql.includes("UPDATE orders SET active_route_id=$2")) {
      for (const id of values[0] as string[]) {
        const order = orders.get(id)
        if (order) order.activeRouteId = values[1] as string
      }
      return queryResult()
    }
    if (sql.includes("SELECT id FROM profiles WHERE id=$1 AND role='Chofer'")) {
      return queryResult(values[0] === driverId ? [{ id: driverId }] : [])
    }
    if (sql.includes("SELECT capacity_kg FROM vehicles WHERE id=$1 AND available=true")) {
      return queryResult(values[0] === vehicleId ? [{ capacity_kg: 1500 }] : [])
    }
    if (sql.includes("SELECT 1 FROM routes WHERE driver_id=$1 AND status IN")) {
      return queryResult([...routes.values()].some((route) =>
        route.driverId === values[0] && ["Asignada", "En curso"].includes(route.status),
      ) ? [{ present: 1 }] : [])
    }
    if (sql.includes("SELECT 1 FROM routes WHERE vehicle_id=$1 AND status IN")) {
      return queryResult([...routes.values()].some((route) =>
        route.vehicleId === values[0] && ["Asignada", "En curso"].includes(route.status),
      ) ? [{ present: 1 }] : [])
    }
    if (sql.includes("SELECT COALESCE(sum(oi.quantity*p.weight_kg),0) AS weight")) {
      const routeId = values[0] as string
      const weight = [...routeStops.values()]
        .filter((stop) => stop.routeId === routeId)
        .reduce((sum, stop) => sum + (orders.get(stop.orderId)?.quantity ?? 0) * 42.5, 0)
      return queryResult([{ weight }])
    }
    if (sql.includes("UPDATE routes SET status=$2,updated_at=now() WHERE id=$1 AND status='Calculada'")) {
      const route = routes.get(values[0] as string)
      if (!route || route.status !== "Calculada") return queryResult()
      route.status = values[1] as string
      return queryResult([{ id: values[0] }])
    }
    if (sql.includes("UPDATE routes SET driver_id=$2,vehicle_id=$3,status='Asignada'")) {
      const route = routes.get(values[0] as string)
      if (route) {
        route.driverId = values[1] as string
        route.vehicleId = values[2] as string
        route.status = "Asignada"
      }
      return queryResult([{ id: values[0] }])
    }
    if (sql.includes("UPDATE vehicles SET available=$2")) return queryResult()
    if (sql.includes("UPDATE routes SET status=$2,started_at=now()")) {
      const route = routes.get(values[0] as string)
      if (!route || route.status !== "Asignada") return queryResult()
      route.status = values[1] as string
      return queryResult([{ id: values[0] }])
    }
    if (sql.includes("SELECT id,order_id FROM route_stops WHERE route_id=$1 ORDER BY sequence_number LIMIT 1")) {
      const stop = [...routeStops.values()]
        .filter((candidate) => candidate.routeId === values[0])
        .sort((left, right) => left.sequence - right.sequence)[0]
      return queryResult(stop ? [{ id: stop.id, order_id: stop.orderId }] : [])
    }
    if (sql.includes("SELECT o.id,o.status,o.active_route_id FROM orders o")) {
      return queryResult([...routeStops.values()]
        .filter((stop) => stop.routeId === values[0])
        .sort((left, right) => left.sequence - right.sequence)
        .flatMap((stop) => {
          const order = orders.get(stop.orderId)
          return order ? [{ id: stop.orderId, status: order.status, active_route_id: order.activeRouteId }] : []
        }))
    }
    if (sql.includes("UPDATE route_stops SET status=$2 WHERE id=$1")) {
      const stop = routeStops.get(values[0] as string)
      if (stop) stop.status = values[1] as string
      return queryResult()
    }
    if (sql.includes("UPDATE routes SET status='Cerrada'")) {
      const route = routes.get(values[0] as string)
      if (!route || route.status !== "En curso") return queryResult()
      route.status = "Cerrada"
      return queryResult([{ vehicle_id: route.vehicleId }])
    }
    if (sql.includes("UPDATE orders SET active_route_id=NULL")) {
      const routeId = values[0] as string
      for (const order of orders.values()) {
        if (order.activeRouteId === routeId) order.activeRouteId = null
      }
      return queryResult()
    }
    if (sql.includes("SELECT 1 FROM route_stops WHERE route_id=$1 AND status NOT IN")) {
      return queryResult([...routeStops.values()].some((stop) =>
        stop.routeId === values[0] && !["Entregada", "No entregada"].includes(stop.status),
      ) ? [{ present: 1 }] : [])
    }
    if (sql.includes("SELECT s.id,s.order_id,s.status AS stop_status,o.status AS order_status FROM route_stops s")) {
      const stop = [...routeStops.values()]
        .filter((candidate) => candidate.routeId === values[0] && ["Pendiente", "Incidencia"].includes(candidate.status))
        .sort((left, right) => left.sequence - right.sequence)[0]
      const order = stop ? orders.get(stop.orderId) : undefined
      return queryResult(stop && order ? [{
        id: stop.id,
        order_id: stop.orderId,
        stop_status: stop.status,
        order_status: order.status,
      }] : [])
    }
    if (sql.includes("UPDATE route_stops SET status='En camino' WHERE id=$1")) {
      const stop = routeStops.get(values[0] as string)
      if (stop) stop.status = "En camino"
      return queryResult()
    }
    if (sql.includes("UPDATE orders SET status='En ruta',active_route_id=$2")) {
      const order = orders.get(values[0] as string)
      if (order) {
        order.status = "En ruta"
        order.activeRouteId = values[1] as string
      }
      return queryResult()
    }
    if (sql.includes("SELECT s.id,s.route_id,s.order_id,s.status,s.attempts,r.driver_id,r.status AS route_status")) {
      const stop = routeStops.get(values[0] as string)
      const route = stop ? routes.get(stop.routeId) : undefined
      return queryResult(stop && route ? [{
        id: stop.id,
        route_id: stop.routeId,
        order_id: stop.orderId,
        status: stop.status,
        attempts: stop.attempts,
        driver_id: route.driverId,
        route_status: route.status,
        latitude: -13.63,
        longitude: -72.88,
      }] : [])
    }
    if (sql.includes("UPDATE route_stops SET status='Entregada'")) {
      const stop = routeStops.get(values[0] as string)
      if (stop) stop.status = "Entregada"
      return queryResult()
    }
    if (sql.includes("SELECT 1 FROM route_stops WHERE route_id=$1 AND status NOT IN")) {
      return queryResult([...routeStops.values()].some((stop) =>
        stop.routeId === values[0] && !["Entregada", "No entregada"].includes(stop.status),
      ) ? [{ present: 1 }] : [])
    }
    if (sql.includes("UPDATE orders SET status='Entregado'")) {
      const order = orders.get(values[0] as string)
      if (order) order.status = "Entregado"
      return queryResult()
    }
    if (sql.includes("SELECT oi.product_id,oi.quantity,sr.quantity AS reserved")) {
      const order = orders.get(values[0] as string)
      const reservation = reservations.get(values[0] as string)
      return queryResult(order && reservation && !reservation.released ? [{
        product_id: productId,
        quantity: order.quantity,
        reserved: reservation.quantity,
        total_stock: physicalStock,
        reserved_stock: reserved,
      }] : [])
    }
    if (sql.includes("UPDATE products SET total_stock=total_stock-$2")) {
      const quantity = Number(values[1])
      physicalStock -= quantity
      reserved -= quantity
      return queryResult([{ total_stock: physicalStock, reserved_stock: reserved }])
    }
    if (sql.includes("UPDATE stock_reservations SET released_at=now()")) {
      const reservation = reservations.get(values[0] as string)
      if (reservation) reservation.released = true
      return queryResult()
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
      const code = `PED-${String(orderSequence).padStart(4, "0")}`
      orders.set(orderId, { status: "Pendiente", quantity, activeRouteId: null, code })
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
    if (sql.includes("SELECT status,driver_id FROM routes WHERE id=$1 FOR UPDATE")) {
      const route = routes.get(values[0] as string)
      return queryResult(route ? [{
        status: route.status,
        driver_id: route.driverId,
      }] : [])
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
        type: sql.includes("'LIBERACION'")
          ? "LIBERACION"
          : sql.includes("'SALIDA'") ? "SALIDA" : "RESERVA",
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
      const orderEvent = sql.includes("VALUES('Pedido'")
      statusEvents.push({
        previous: values[orderEvent ? 1 : 2] as string,
        next: values[orderEvent ? 2 : 3] as string,
        actorId: values[orderEvent ? 3 : 4] as string,
      })
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
  profileRoles = new Map([
    [actorId, "Despachador"],
    [driverId, "Chofer"],
  ])
  query.mockImplementation(async (sql, values) => {
    if (String(sql).includes("FROM profiles p JOIN auth_sessions")) {
      const id = values?.[0] as string
      const role = profileRoles.get(id) ?? "Despachador"
      return {
        rows: [{
          id,
          email: `${role.toLowerCase()}@codimac.pe`,
          display_name: role,
          role,
          auth_session_id: values?.[1] as string,
        }],
        rowCount: 1,
      } as never
    }
    if (String(sql).includes("INSERT INTO clients(")) {
      return {
        rows: [{
          id: clientId,
          name: values?.[0],
          contact: values?.[1],
          address: values?.[2],
          reference: values?.[3],
          latitude: values?.[4],
          longitude: values?.[5],
        }],
        rowCount: 1,
      } as never
    }
    if (String(sql).includes("WHERE r.status='Cerrada'")) {
      return {
        rows: [...routes].filter(([, route]) => route.status === "Cerrada").map(([id, route]) => ({
          id,
          code: route.code,
          status: route.status,
          result: "Completado",
          stop_count: [...routeStops.values()].filter((stop) => stop.routeId === id).length,
        })),
        rowCount: 1,
      } as never
    }
    if (String(sql).includes("SELECT count(*)::int AS total FROM auditoria_eventos")) {
      return { rows: [{ total: auditEvents.length }], rowCount: 1 } as never
    }
    if (String(sql).includes("FROM auditoria_eventos e LEFT JOIN profiles p")) {
      return {
        rows: auditEvents.map((event, index) => ({
          id: `audit-${index}`,
          accion: event.action,
          entidad: event.entity,
          usuario_id: event.actorId,
          valor_anterior: null,
          valor_nuevo: null,
        })),
        rowCount: auditEvents.length,
      } as never
    }
    return { rows: [], rowCount: 0 } as never
  })
  stopSequence = 0
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

async function postAs(path: string, body: unknown, userId: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      ...authHeadersAs(userId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

function authHeadersAs(userId: string): { Authorization: string } {
  const token = jwt.sign(
    { sub: userId, jti: "90000000-0000-4000-8000-000000000099" },
    process.env.JWT_SECRET!,
  )
  return { Authorization: `Bearer ${token}` }
}

async function post(path: string, body: unknown): Promise<Response> {
  return postAs(path, body, actorId)
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
  it("completa E-01 por HTTP: clientes, tres entregas, cierre, historial y auditoría", async () => {
    profileRoles.set(actorId, "Administrador")
    const client = await post("/api/admin/catalog/clients", {
      name: "Cliente de prueba",
      contact: "912345678",
      address: "Av. Principal 120",
      reference: "Portón verde",
      latitude: -13.63,
      longitude: -72.88,
    })
    expect(client.status).toBe(201)
    expect(await client.json()).toMatchObject({ data: { id: clientId, latitude: -13.63 } })
    profileRoles.set(actorId, "Despachador")

    const orderIdsForRoute: string[] = []
    for (let index = 0; index < 3; index += 1) {
      const created = await post("/api/orders", newOrder(10))
      expect(created.status).toBe(201)
      const { order } = await created.json() as { order: { id: string; code: string } }
      expect(order.code).toBe(`PED-000${index + 1}`)
      orderIdsForRoute.push(order.id)

      expect((await post(`/api/orders/${order.id}/prepare`, {})).status).toBe(200)
      expect((await post(`/api/orders/${order.id}/ready`, {})).status).toBe(200)
    }

    const createdRoute = await post("/api/routes", {
      orderIds: orderIdsForRoute,
      distanceKm: 12,
      estimatedMinutes: 45,
      estimatedLiters: 2,
      estimatedCost: 12,
    })
    expect(createdRoute.status).toBe(201)
    const { routeId } = await createdRoute.json() as { routeId: string }
    expect((await post(`/api/routes/${routeId}/approve`, {})).status).toBe(200)
    expect((await post(`/api/routes/${routeId}/assign`, { driverId, vehicleId })).status).toBe(200)

    expect((await postAs(`/api/routes/${routeId}/start`, {}, driverId)).status).toBe(200)
    const orderedStops = [...routeStops.values()]
      .filter((stop) => stop.routeId === routeId)
      .sort((left, right) => left.sequence - right.sequence)
    expect(orderedStops).toHaveLength(3)
    for (const stop of orderedStops) {
      const delivered = await postAs(`/api/stops/${stop.id}/deliver`, { receivedBy: "Cliente de prueba" }, driverId)
      expect(delivered.status).toBe(200)
    }

    expect([...orders.values()].filter((order) => order.status === "Entregado")).toHaveLength(3)
    expect(physicalStock).toBe(55)
    expect(reserved).toBe(0)
    expect(routes.get(routeId)?.status).toBe("Cerrada")
    expect(inventoryMovements.filter((movement) => movement.type === "SALIDA")).toHaveLength(3)
    expect(auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "Aprobación de reparto", entity: "Ruta" }),
      expect.objectContaining({ action: "Asignación de reparto", entity: "Ruta" }),
      expect.objectContaining({ action: "Cambio de estado", entity: "Ruta" }),
    ]))

    const history = await fetch(`${baseUrl}/api/routes/history`, {
      headers: authHeadersAs(actorId),
    })
    expect(history.status).toBe(200)
    expect(await history.json()).toMatchObject({
      routes: [{ id: routeId, code: "R-001", status: "Cerrada", stop_count: 3 }],
    })

    profileRoles.set(actorId, "Administrador")
    const audit = await fetch(`${baseUrl}/api/admin/audit`, {
      headers: authHeadersAs(actorId),
    })
    expect(audit.status).toBe(200)
    expect(await audit.json()).toMatchObject({
      total: auditEvents.length,
      events: expect.arrayContaining([
        expect.objectContaining({ accion: "Aprobación de reparto", entidad: "Ruta" }),
      ]),
    })
  })

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
          message: "Solo hay 85 unidades disponibles; faltan 915.",
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
          message: "Solo hay 25 unidades disponibles; faltan 35.",
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
    routes.set(routeId, {
      status: "Asignada",
      vehicleId,
      driverId,
      code: "R-001",
    })
    routeStops.set(stopId, {
      id: stopId,
      routeId,
      orderId,
      sequence: 1,
      status: "Pendiente",
      attempts: 0,
    })

    const response = await post(`/api/orders/${orderId}/cancel`, {})

    expect(response.status).toBe(200)
    expect(orders.get(orderId)).toMatchObject({ status: "Cancelado", activeRouteId: null })
    expect(routeStops.size).toBe(0)
    expect(routes.has(routeId)).toBe(false)
    expect(reserved).toBe(0)
    expect(inventoryMovements).toContainEqual({ type: "LIBERACION", quantity: 10, actorId })
  })
})
