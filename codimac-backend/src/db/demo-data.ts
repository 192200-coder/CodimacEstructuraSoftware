import type { PoolClient } from "pg"
import { formatSequentialCode } from "../application/sequential-code.js"

// Datos ficticios coherentes con la sección 10.3 del documento de pantallas y con los
// escenarios del Anexo C: 85 bolsas de cemento disponibles (E-02, E-03), pedidos en cada
// estado, un reparto cerrado para historial e indicadores y un cliente fuera del radio (E-14).

type Query = Pick<PoolClient, "query">

export const DEMO_PASSWORD = "demostracion"

export const demoUsers = [
  { email: "maria@codimac.pe", name: "María Rojas", role: "Despachador", phone: null },
  { email: "jose@codimac.pe", name: "José Ramírez", role: "Administrador", phone: null },
  { email: "laura@codimac.pe", name: "Laura Mendoza", role: "Administrador", phone: null },
  { email: "carlos@codimac.pe", name: "Carlos Quispe", role: "Chofer", phone: "987654321" },
  { email: "ana@codimac.pe", name: "Ana Torres", role: "Chofer", phone: "912345678" },
  { email: "luis@codimac.pe", name: "Luis Huamán", role: "Chofer", phone: "923456789" },
] as const

const clientIds = {
  a: "10000000-0000-4000-8000-000000000001",
  b: "10000000-0000-4000-8000-000000000002",
  c: "10000000-0000-4000-8000-000000000003",
  d: "10000000-0000-4000-8000-000000000004",
} as const

export const demoClients = [
  { id: clientIds.a, name: "Cliente A", contact: "987654321", address: "Av. Principal 120", reference: "Frente a la farmacia", latitude: -13.62, longitude: -72.865 },
  { id: clientIds.b, name: "Cliente B", contact: "976543210", address: "Jr. Los Pinos 432", reference: "Esquina, portón verde", latitude: -13.655, longitude: -72.86 },
  { id: clientIds.c, name: "Cliente C", contact: "965432109", address: "Av. Universitaria 77", reference: "Al costado del grifo", latitude: -13.65, longitude: -72.91 },
  // Andahuaylas, a unos 55 km del almacén: muestra la advertencia del área de servicio.
  { id: clientIds.d, name: "Cliente D", contact: "954321098", address: "Jr. Ramos 210, Andahuaylas", reference: "Junto a la plaza de armas", latitude: -13.6556, longitude: -73.3872 },
] as const

type ProductKey = "cemento" | "fierro" | "ladrillo"

/** Existencias finales; las reservas salen de los pedidos de ejemplo. */
export const demoProducts: Record<ProductKey, { name: string; unit: string; weightKg: number; totalStock: number }> = {
  cemento: { name: "Cemento tipo I", unit: "Bolsa de 42,5 kg", weightKg: 42.5, totalStock: 200 },
  fierro: { name: "Fierro corrugado de 1/2\"", unit: "Varilla de 9 m", weightKg: 8, totalStock: 500 },
  ladrillo: { name: "Ladrillo King Kong", unit: "Unidad", weightKg: 2.8, totalStock: 8000 },
}

export const demoVehicles = [
  { plate: "ABC-123", type: "Camioneta", capacityKg: 1500, speedKmh: 30, efficiencyKmL: 10 },
  { plate: "DEF-456", type: "Camión", capacityKg: 4000, speedKmh: 25, efficiencyKmL: 8 },
] as const

type OrderStatus = "Pendiente" | "En preparación" | "Listo" | "Entregado" | "Cancelado"

interface DemoOrder {
  id: string
  client: keyof typeof clientIds
  status: OrderStatus
  /** Horas respecto de la carga (negativo = en el pasado). */
  orderedHours: number
  deadlineHours: number | null
  items: Partial<Record<ProductKey, number>>
}

// Prefijos propios para no chocar con los pedidos de ejemplo de versiones anteriores.
const orderId = (n: number) => `41000000-0000-4000-8000-${String(n).padStart(12, "0")}`

export const demoOrders: DemoOrder[] = [
  { id: orderId(1), client: "a", status: "Entregado", orderedHours: -76, deadlineHours: null, items: { cemento: 4 } },
  { id: orderId(2), client: "b", status: "Entregado", orderedHours: -75, deadlineHours: null, items: { fierro: 10 } },
  { id: orderId(3), client: "a", status: "En preparación", orderedHours: -30, deadlineHours: 48, items: { cemento: 100, fierro: 80, ladrillo: 850 } },
  { id: orderId(4), client: "a", status: "Listo", orderedHours: -26, deadlineHours: 6, items: { cemento: 10, ladrillo: 100 } },
  { id: orderId(5), client: "b", status: "Listo", orderedHours: -24, deadlineHours: 26, items: { fierro: 40 } },
  { id: orderId(6), client: "c", status: "Listo", orderedHours: -28, deadlineHours: null, items: { cemento: 5, ladrillo: 50 } },
  // 2 800 kg: no cabe en la camioneta (E-17) y obliga a usar el camión o dividir la carga.
  { id: orderId(7), client: "b", status: "Listo", orderedHours: -20, deadlineHours: 50, items: { ladrillo: 1000 } },
  // E-03: dos pedidos de 60 bolsas con 85 disponibles; el segundo no puede prepararse.
  { id: orderId(8), client: "c", status: "Pendiente", orderedHours: -3, deadlineHours: 30, items: { cemento: 60 } },
  { id: orderId(9), client: "a", status: "Pendiente", orderedHours: -2, deadlineHours: null, items: { cemento: 60 } },
  { id: orderId(10), client: "c", status: "Cancelado", orderedHours: -40, deadlineHours: null, items: { ladrillo: 200 } },
  { id: orderId(11), client: "d", status: "Pendiente", orderedHours: -1, deadlineHours: 72, items: { fierro: 10 } },
]

const closedRouteId = "51000000-0000-4000-8000-000000000001"

const hoursFrom = (now: Date, hours: number) => new Date(now.getTime() + hours * 3_600_000)

export interface DemoDataOptions {
  now?: Date
  /** Usuario que queda como autor del evento de auditoría (el administrador que la pidió). */
  actorId?: string
  /** Restablecer: vuelve a "demostracion" la contraseña de las cuentas de ejemplo. */
  resetPasswords?: boolean
}

export interface DemoDataSummary {
  operationalDataLoaded: boolean
}

async function upsertUsers(client: Query, hashPassword: (password: string) => Promise<string>, resetPasswords: boolean) {
  const ids = new Map<string, string>()
  for (const user of demoUsers) {
    const passwordHash = await hashPassword(DEMO_PASSWORD)
    const result = await client.query(
      `INSERT INTO profiles(email,password_hash,display_name,role,phone)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(email) DO UPDATE SET
         phone=COALESCE(profiles.phone,EXCLUDED.phone),
         active=CASE WHEN $6 THEN true ELSE profiles.active END,
         available=CASE WHEN $6 THEN true ELSE profiles.available END,
         password_hash=CASE WHEN $6 THEN EXCLUDED.password_hash ELSE profiles.password_hash END
       RETURNING id`,
      [user.email, passwordHash, user.name, user.role, user.phone, resetPasswords],
    )
    ids.set(user.email, result.rows[0].id as string)
  }
  return ids
}

async function insertMovement(client: Query, input: {
  productId: string
  type: "ENTRADA" | "RESERVA" | "LIBERACION" | "SALIDA"
  quantity: number
  actorId: string
  at: Date
  orderId?: string
  observation?: string
}) {
  await client.query(
    `INSERT INTO inventory_movements(producto_id,tipo,cantidad,usuario_id,fecha_hora,pedido_id,observation)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [input.productId, input.type, input.quantity, input.actorId, input.at, input.orderId ?? null, input.observation ?? null],
  )
}

async function upsertProducts(client: Query, actorId: string, now: Date) {
  const ids = {} as Record<ProductKey, string>
  // Lo entregado en el reparto cerrado salió del stock: la entrada inicial lo incluye.
  const delivered: Record<ProductKey, number> = { cemento: 0, fierro: 0, ladrillo: 0 }
  for (const order of demoOrders.filter((item) => item.status === "Entregado")) {
    for (const [key, quantity] of Object.entries(order.items) as Array<[ProductKey, number]>) delivered[key] += quantity
  }
  for (const [key, product] of Object.entries(demoProducts) as Array<[ProductKey, typeof demoProducts[ProductKey]]>) {
    const inserted = await client.query(
      `INSERT INTO products(name,unit,weight_kg,total_stock) VALUES($1,$2,$3,$4)
       ON CONFLICT(name) DO NOTHING RETURNING id`,
      [product.name, product.unit, product.weightKg, product.totalStock + delivered[key]],
    )
    if (inserted.rowCount) {
      ids[key] = inserted.rows[0].id as string
      await insertMovement(client, {
        productId: ids[key],
        type: "ENTRADA",
        quantity: product.totalStock + delivered[key],
        actorId,
        at: hoursFrom(now, -96),
        observation: "Stock inicial de datos de ejemplo",
      })
    } else {
      const existing = await client.query("SELECT id FROM products WHERE name=$1", [product.name])
      ids[key] = existing.rows[0].id as string
    }
  }
  return ids
}

async function upsertVehicles(client: Query) {
  const ids = new Map<string, string>()
  for (const vehicle of demoVehicles) {
    await client.query(
      `INSERT INTO vehicles(plate,vehicle_type,capacity_kg,average_speed_kmh,fuel_efficiency_km_l)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(plate) DO NOTHING`,
      [vehicle.plate, vehicle.type, vehicle.capacityKg, vehicle.speedKmh, vehicle.efficiencyKmL],
    )
    const result = await client.query("SELECT id FROM vehicles WHERE plate=$1", [vehicle.plate])
    ids.set(vehicle.plate, result.rows[0].id as string)
  }
  return ids
}

async function insertStatusEvent(client: Query, input: {
  entityType: "Pedido" | "Parada" | "Ruta"
  entityId: string
  previous: string | null
  next: string
  actorId: string
  at: Date
  routeId?: string
  stopId?: string
}) {
  await client.query(
    `INSERT INTO status_events(entity_type,entity_id,previous_status,new_status,actor_id,route_id,stop_id,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [input.entityType, input.entityId, input.previous, input.next, input.actorId, input.routeId ?? null, input.stopId ?? null, input.at],
  )
}

/**
 * Reserva unidades para un pedido. Si el producto ya existía con menos existencias de las
 * necesarias (carga sobre una base usada), registra antes una entrada por la diferencia
 * para que el stock disponible nunca quede negativo (RN-02).
 */
async function reserve(client: Query, productId: string, orderId: string, quantity: number, actorId: string, at: Date) {
  const stock = await client.query(
    "SELECT total_stock,reserved_stock FROM products WHERE id=$1 FOR UPDATE",
    [productId],
  )
  const shortfall = Number(stock.rows[0].reserved_stock) + quantity - Number(stock.rows[0].total_stock)
  if (shortfall > 0) {
    await client.query("UPDATE products SET total_stock=total_stock+$2,updated_at=now() WHERE id=$1", [productId, shortfall])
    await insertMovement(client, { productId, type: "ENTRADA", quantity: shortfall, actorId, at, observation: "Reposición para datos de ejemplo" })
  }
  await client.query("UPDATE products SET reserved_stock=reserved_stock+$2,updated_at=now() WHERE id=$1", [productId, quantity])
  await client.query(
    "INSERT INTO stock_reservations(order_id,product_id,quantity,created_at) VALUES($1,$2,$3,$4)",
    [orderId, productId, quantity, at],
  )
  await insertMovement(client, { productId, type: "RESERVA", quantity, actorId, at, orderId })
}

async function loadOperationalData(
  client: Query,
  now: Date,
  actorId: string,
  products: Record<ProductKey, string>,
  vehicles: Map<string, string>,
  driverId: string,
) {
  const orderIds = new Map<string, { code: string }>()
  for (const order of demoOrders) {
    const sequence = await client.query("SELECT nextval('order_code_seq') AS value")
    const code = formatSequentialCode("PED", Number(sequence.rows[0].value))
    const orderedAt = hoursFrom(now, order.orderedHours)
    await client.query(
      `INSERT INTO orders(id,codigo,client_id,status,ordered_at,deadline_at,created_by,created_at)
       VALUES($1,$2,$3,'Pendiente',$4,$5,$6,$4)`,
      [order.id, code, clientIds[order.client], orderedAt, order.deadlineHours === null ? null : hoursFrom(now, order.deadlineHours), actorId],
    )
    for (const [key, quantity] of Object.entries(order.items) as Array<[ProductKey, number]>) {
      await client.query(
        "INSERT INTO order_items(order_id,product_id,quantity) VALUES($1,$2,$3)",
        [order.id, products[key], quantity],
      )
    }
    orderIds.set(order.id, { code })

    // Cada estado recorre las transiciones reales: reserva al preparar, liberación al cancelar.
    // Los entregados se completan con su reparto, más abajo.
    if (order.status === "Pendiente" || order.status === "Entregado") continue
    const preparedAt = hoursFrom(orderedAt, 1)
    for (const [key, quantity] of Object.entries(order.items) as Array<[ProductKey, number]>) {
      await reserve(client, products[key], order.id, quantity, actorId, preparedAt)
    }
    await insertStatusEvent(client, { entityType: "Pedido", entityId: order.id, previous: "Pendiente", next: "En preparación", actorId, at: preparedAt })
    if (order.status === "Cancelado") {
      const cancelledAt = hoursFrom(preparedAt, 2)
      for (const [key, quantity] of Object.entries(order.items) as Array<[ProductKey, number]>) {
        await client.query("UPDATE products SET reserved_stock=reserved_stock-$2,updated_at=now() WHERE id=$1", [products[key], quantity])
        await client.query("UPDATE stock_reservations SET released_at=$3 WHERE order_id=$1 AND product_id=$2", [order.id, products[key], cancelledAt])
        await insertMovement(client, { productId: products[key], type: "LIBERACION", quantity, actorId, at: cancelledAt, orderId: order.id })
      }
      await insertStatusEvent(client, { entityType: "Pedido", entityId: order.id, previous: "En preparación", next: "Cancelado", actorId, at: cancelledAt })
      await client.query("UPDATE orders SET status='Cancelado',updated_at=$2 WHERE id=$1", [order.id, cancelledAt])
      continue
    }
    if (order.status === "En preparación") {
      await client.query("UPDATE orders SET status='En preparación' WHERE id=$1", [order.id])
      continue
    }
    const readyAt = hoursFrom(preparedAt, 2)
    await insertStatusEvent(client, { entityType: "Pedido", entityId: order.id, previous: "En preparación", next: "Listo", actorId, at: readyAt })
    await client.query("UPDATE orders SET status='Listo' WHERE id=$1", [order.id])
  }

  // Reparto cerrado (historial, indicadores y comparación con la referencia).
  const delivered = demoOrders.filter((order) => order.status === "Entregado")
  const routeSequence = await client.query("SELECT nextval('route_code_seq') AS value")
  const startedAt = hoursFrom(now, -70)
  const closedAt = hoursFrom(startedAt, 1.5)
  await client.query(
    `INSERT INTO routes(id,codigo,status,driver_id,vehicle_id,distance_km,estimated_minutes,estimated_liters,estimated_cost,
       started_at,closed_at,created_by,created_at,reference_km,reference_minutes)
     VALUES($1,$2,'Cerrada',$3,$4,12.4,38,1.55,9.61,$5,$6,$7,$8,15.1,49)`,
    [closedRouteId, formatSequentialCode("R", Number(routeSequence.rows[0].value)), driverId,
      vehicles.get("DEF-456"), startedAt, closedAt, actorId, hoursFrom(startedAt, -2)],
  )
  for (const [index, order] of delivered.entries()) {
    const deliveredAt = hoursFrom(startedAt, 0.5 + index * 0.6)
    const stopId = `61000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    await client.query(
      `INSERT INTO route_stops(id,route_id,order_id,sequence_number,status,eta_at,delivered_at,received_by,attempts)
       VALUES($1,$2,$3,$4,'Entregada',$5,$5,$6,$7)`,
      [stopId, closedRouteId, order.id, index + 1, deliveredAt, index === 0 ? "Rosa Quispe" : "Jorge Salas", index === 1 ? 1 : 0],
    )
    if (index === 1) {
      // Segunda parada: un intento fallido antes de entregar (incidencia cerrada).
      await client.query(
        "INSERT INTO incidents(stop_id,cause,notes,opened_by,opened_at,closed_at) VALUES($1,'Cliente ausente',$2,$3,$4,$5)",
        [stopId, "No había nadie en el local; se reprogramó en la misma ruta.", driverId, hoursFrom(deliveredAt, -0.4), deliveredAt],
      )
    }
    const preparedAt = hoursFrom(now, order.orderedHours + 1)
    for (const [key, quantity] of Object.entries(order.items) as Array<[ProductKey, number]>) {
      await reserve(client, products[key], order.id, quantity, actorId, preparedAt)
      // RN-12: al entregar se descuentan existencias y reservas.
      await client.query(
        "UPDATE products SET total_stock=total_stock-$2,reserved_stock=reserved_stock-$2,updated_at=now() WHERE id=$1",
        [products[key], quantity],
      )
      await client.query("UPDATE stock_reservations SET released_at=$3 WHERE order_id=$1 AND product_id=$2", [order.id, products[key], deliveredAt])
      await insertMovement(client, { productId: products[key], type: "SALIDA", quantity, actorId: driverId, at: deliveredAt, orderId: order.id })
    }
    for (const [previous, next, at] of [
      ["Pendiente", "En preparación", preparedAt],
      ["En preparación", "Listo", hoursFrom(preparedAt, 1)],
      ["Listo", "En ruta", startedAt],
    ] as const) {
      await insertStatusEvent(client, { entityType: "Pedido", entityId: order.id, previous, next, actorId, at, routeId: closedRouteId })
    }
    await insertStatusEvent(client, { entityType: "Pedido", entityId: order.id, previous: "En ruta", next: "Entregado", actorId: driverId, at: deliveredAt, routeId: closedRouteId, stopId })
    await client.query("UPDATE orders SET status='Entregado',updated_at=$2 WHERE id=$1", [order.id, deliveredAt])
  }
  await insertStatusEvent(client, { entityType: "Ruta", entityId: closedRouteId, previous: "En curso", next: "Cerrada", actorId: driverId, at: closedAt, routeId: closedRouteId })
}

/**
 * Agrega los datos de ejemplo que falten. Los catálogos se reconocen por su clave natural
 * (correo, nombre de producto, placa), así que funciona sobre una base con datos propios.
 * Los pedidos y el reparto de ejemplo solo se crean si aún no existen.
 */
export async function loadDemoData(
  client: Query,
  hashPassword: (password: string) => Promise<string>,
  options: DemoDataOptions = {},
): Promise<DemoDataSummary> {
  const now = options.now ?? new Date()
  const users = await upsertUsers(client, hashPassword, options.resetPasswords ?? false)
  const dispatcherId = users.get("maria@codimac.pe")!
  const actorId = options.actorId ?? dispatcherId

  for (const demoClient of demoClients) {
    await client.query(
      `INSERT INTO clients(id,name,contact,address,reference,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(id) DO NOTHING`,
      [demoClient.id, demoClient.name, demoClient.contact, demoClient.address, demoClient.reference, demoClient.latitude, demoClient.longitude],
    )
  }
  const products = await upsertProducts(client, dispatcherId, now)
  const vehicles = await upsertVehicles(client)
  await client.query(
    `INSERT INTO global_parameters(singleton,warehouse_latitude,warehouse_longitude,fuel_price,minutes_per_stop,service_radius_km)
     VALUES(true,-13.6366,-72.8814,6.2,8,50) ON CONFLICT(singleton) DO NOTHING`,
  )

  const existing = await client.query("SELECT 1 FROM orders WHERE id=$1", [demoOrders[0]!.id])
  const operationalDataLoaded = !existing.rowCount
  if (operationalDataLoaded) {
    await loadOperationalData(client, now, dispatcherId, products, vehicles, users.get("ana@codimac.pe")!)
  }
  await client.query(
    `INSERT INTO auditoria_eventos(usuario_id,accion,entidad,entidad_id,valor_nuevo)
     VALUES($1,$2,'Datos de ejemplo','demo',$3)`,
    [actorId, options.resetPasswords ? "Restablecimiento de datos de ejemplo" : "Carga de datos de ejemplo",
      JSON.stringify({ pedidosDeEjemplo: operationalDataLoaded ? demoOrders.length : 0 })],
  )
  return { operationalDataLoaded }
}

/** Tablas operativas y de catálogo que el restablecimiento vacía. Usuarios y auditoría se conservan. */
export const resettableTables = [
  "incidents",
  "route_stops",
  "status_events",
  "stock_reservations",
  "inventory_movements",
  "order_items",
  "orders",
  "routes",
  "clients",
  "products",
  "vehicles",
  "global_parameters",
] as const

/**
 * M-05 · Restablecer: borra pedidos, repartos, inventario y catálogos y vuelve a cargar los
 * datos de ejemplo. La auditoría es inmutable y los usuarios se conservan (se reactivan y
 * vuelven a la contraseña de ejemplo las cuentas de demostración).
 */
export async function resetDemoData(
  client: Query,
  hashPassword: (password: string) => Promise<string>,
  options: Omit<DemoDataOptions, "resetPasswords"> = {},
): Promise<DemoDataSummary> {
  await client.query(`TRUNCATE ${resettableTables.join(",")} RESTART IDENTITY CASCADE`)
  await client.query("SELECT setval('order_code_seq',1,false)")
  await client.query("SELECT setval('route_code_seq',1,false)")
  return loadDemoData(client, hashPassword, { ...options, resetPasswords: true })
}
