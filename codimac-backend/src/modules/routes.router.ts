import { Router } from "express"
import { inTransaction, pool } from "../db/pool.js"
import { authenticate, requireRole } from "../http/auth.js"
import { HttpError } from "../http/errors.js"
import { createRouteSchema, idParamSchema, uuidSchema } from "../http/schemas.js"
import { z } from "zod"
import { isWithinRouteLimit, nextIncident } from "../domain/rules.js"
import {
  estimateStopArrivals,
  orderOpenStops,
  type Coordinates,
} from "../domain/routing.js"

export const routesRouter = Router()
routesRouter.use(authenticate)

routesRouter.post("/routes", requireRole("Despachador"), async (req, res) => {
  const body = createRouteSchema.parse(req.body)
  if (!isWithinRouteLimit(body.orderIds.length)) {
    throw new HttpError(400, "La ruta debe tener entre 1 y 10 paradas")
  }
  const routeId = await inTransaction(async (client) => {
    const orders = await client.query(
      "SELECT id,status,active_route_id FROM orders WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [body.orderIds],
    )
    if (orders.rowCount !== body.orderIds.length) throw new HttpError(404, "Uno o más pedidos no existen")
    if (orders.rows.some((order) => order.status !== "Listo" || order.active_route_id)) {
      throw new HttpError(409, "Todos los pedidos deben estar Listo y sin reparto activo")
    }
    const inserted = await client.query(
      `INSERT INTO routes(code,status,distance_km,estimated_minutes,estimated_liters,estimated_cost,created_by)
       VALUES($1,'Aprobada',$2,$3,$4,$5,$6) RETURNING id`,
      [body.code, body.distanceKm, body.estimatedMinutes, body.estimatedLiters, body.estimatedCost, req.user!.id],
    )
    const id = inserted.rows[0].id as string
    for (const [index, orderId] of body.orderIds.entries()) {
      await client.query(
        "INSERT INTO route_stops(route_id,order_id,sequence_number) VALUES($1,$2,$3)",
        [id, orderId, index + 1],
      )
    }
    await client.query(
      "UPDATE orders SET active_route_id=$2,updated_at=now() WHERE id=ANY($1::uuid[])",
      [body.orderIds, id],
    )
    await client.query(
      "INSERT INTO status_events(entity_type,entity_id,new_status,actor_id,route_id) VALUES('Ruta',$1,'Aprobada',$2,$1)",
      [id, req.user!.id],
    )
    if (body.driverId && body.vehicleId) {
      await assignRouteInTransaction(client, id, body.driverId, body.vehicleId, req.user!.id)
    }
    return id
  })
  res.status(201).json({ routeId, status: body.driverId ? "Asignada" : "Aprobada" })
})

routesRouter.get("/routes", requireRole("Despachador", "Administrador"), async (_req, res) => {
  const result = await pool.query(
    `SELECT r.*, p.display_name AS driver_name, v.plate AS vehicle_plate,
       count(s.id)::int AS stop_count,
       COALESCE(jsonb_agg(jsonb_build_object(
         'id',s.id,'sequence_number',s.sequence_number,'status',s.status,
         'attempts',s.attempts,'eta_at',s.eta_at,'delivered_at',s.delivered_at,
         'received_by',s.received_by,'code',o.code,'client_name',c.name,'address',c.address
       ) ORDER BY s.sequence_number) FILTER (WHERE s.id IS NOT NULL),'[]'::jsonb) AS route_stops
     FROM routes r LEFT JOIN profiles p ON p.id=r.driver_id
     LEFT JOIN vehicles v ON v.id=r.vehicle_id LEFT JOIN route_stops s ON s.route_id=r.id
     LEFT JOIN orders o ON o.id=s.order_id LEFT JOIN clients c ON c.id=o.client_id
     GROUP BY r.id,p.display_name,v.plate ORDER BY r.created_at DESC`,
  )
  res.json({ routes: result.rows })
})

routesRouter.delete("/routes/:id", requireRole("Despachador"), async (req, res) => {
  const { id } = idParamSchema.parse(req.params)
  await inTransaction(async (client) => {
    const route = await client.query(
      "SELECT code,status FROM routes WHERE id=$1 FOR UPDATE",
      [id],
    )
    if (!route.rowCount) throw new HttpError(404, "Reparto no encontrado")
    if (route.rows[0].status !== "Aprobada") {
      throw new HttpError(409, "Solo se puede retirar un reparto todavía no asignado")
    }
    await client.query(
      "UPDATE orders SET active_route_id=NULL,updated_at=now() WHERE active_route_id=$1",
      [id],
    )
    await client.query("DELETE FROM status_events WHERE route_id=$1", [id])
    await client.query("DELETE FROM route_stops WHERE route_id=$1", [id])
    await client.query("DELETE FROM routes WHERE id=$1", [id])
    await client.query(
      "INSERT INTO audit_events(message,actor_id) VALUES($1,$2)",
      [`Se retiró el reparto no asignado ${route.rows[0].code} y se liberaron sus pedidos.`, req.user!.id],
    )
  })
  res.json({ deleted: true })
})

routesRouter.post("/routes/:id/assign", requireRole("Despachador"), async (req, res) => {
  const { id } = idParamSchema.parse(req.params)
  const body = z.object({ driverId: uuidSchema, vehicleId: uuidSchema }).parse(req.body)
  await inTransaction(async (client) => {
    await assignRouteInTransaction(client, id, body.driverId, body.vehicleId, req.user!.id)
  })
  res.json({ status: "Asignada", notification: "simulated" })
})

async function assignRouteInTransaction(
  client: import("pg").PoolClient,
  routeId: string,
  driverId: string,
  vehicleId: string,
  actorId: string,
): Promise<void> {
  const route = await client.query("SELECT status FROM routes WHERE id=$1 FOR UPDATE", [routeId])
  if (!route.rowCount) throw new HttpError(404, "Reparto no encontrado")
  if (route.rows[0].status !== "Aprobada") throw new HttpError(409, "La ruta debe estar Aprobada")
  const driver = await client.query(
    "SELECT id FROM profiles WHERE id=$1 AND role='Chofer' AND active=true FOR UPDATE",
    [driverId],
  )
  if (!driver.rowCount) throw new HttpError(409, "El chofer no está disponible")
  const activeDriver = await client.query(
    "SELECT 1 FROM routes WHERE driver_id=$1 AND status IN ('Asignada','En ruta')",
    [driverId],
  )
  if (activeDriver.rowCount) throw new HttpError(409, "El chofer ya tiene una ruta activa")
  const vehicle = await client.query(
    "SELECT capacity_kg FROM vehicles WHERE id=$1 AND available=true FOR UPDATE",
    [vehicleId],
  )
  if (!vehicle.rowCount) throw new HttpError(409, "El vehículo no está disponible")
  const activeVehicle = await client.query(
    "SELECT 1 FROM routes WHERE vehicle_id=$1 AND status IN ('Asignada','En ruta')",
    [vehicleId],
  )
  if (activeVehicle.rowCount) throw new HttpError(409, "El vehículo ya está asignado")
  const weight = await client.query(
    `SELECT COALESCE(sum(oi.quantity*p.weight_kg),0) AS weight
     FROM route_stops s JOIN order_items oi ON oi.order_id=s.order_id
     JOIN products p ON p.id=oi.product_id WHERE s.route_id=$1`,
    [routeId],
  )
  if (Number(weight.rows[0].weight) > Number(vehicle.rows[0].capacity_kg)) {
    throw new HttpError(409, "La carga supera la capacidad del vehículo")
  }
  await client.query(
    "UPDATE routes SET driver_id=$2,vehicle_id=$3,status='Asignada',updated_at=now() WHERE id=$1",
    [routeId, driverId, vehicleId],
  )
  await client.query("UPDATE vehicles SET available=false WHERE id=$1", [vehicleId])
  await client.query(
    "INSERT INTO status_events(entity_type,entity_id,previous_status,new_status,actor_id,route_id) VALUES('Ruta',$1,'Aprobada','Asignada',$2,$1)",
    [routeId, actorId],
  )
  await client.query(
    "INSERT INTO audit_events(message,actor_id) VALUES($1,$2)",
    [`Aviso interno registrado para el chofer de la ruta ${routeId}; WhatsApp no está configurado y no se envió.`, actorId],
  )
}

routesRouter.get("/driver/route", requireRole("Chofer"), async (req, res) => {
  const result = await pool.query(
    `SELECT r.*, to_jsonb(v) AS vehicles,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'id',s.id,'sequence_number',s.sequence_number,'status',s.status,'attempts',s.attempts,
         'eta_at',s.eta_at,'orders',jsonb_build_object(
           'code',o.code,'clients',jsonb_build_object(
             'name',c.name,'address',c.address,'contact',c.contact,
             'latitude',c.latitude,'longitude',c.longitude
           ),
           'order_items',COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'quantity',oi.quantity,
               'products',jsonb_build_object('name',p.name,'unit',p.unit)
             ))
             FROM order_items oi JOIN products p ON p.id=oi.product_id
             WHERE oi.order_id=o.id
           ),'[]'::jsonb)
         )
       ) ORDER BY s.sequence_number) FROM route_stops s
       JOIN orders o ON o.id=s.order_id JOIN clients c ON c.id=o.client_id
       WHERE s.route_id=r.id),'[]'::jsonb) AS route_stops
     FROM routes r LEFT JOIN vehicles v ON v.id=r.vehicle_id
     WHERE r.driver_id=$1 AND r.status IN ('Asignada','En ruta')
     ORDER BY r.created_at DESC LIMIT 1`,
    [req.user!.id],
  )
  res.json({ route: result.rows[0] ?? null })
})

routesRouter.get("/driver/routes/:id/summary", requireRole("Chofer"), async (req, res) => {
  const { id } = idParamSchema.parse(req.params)
  const result = await pool.query(
    `SELECT r.id,r.code,r.started_at,r.closed_at,r.distance_km,r.estimated_minutes,
       count(s.id) FILTER (WHERE s.status='Entregada')::int AS delivered,
       count(s.id) FILTER (WHERE s.status='No entregada')::int AS not_delivered
     FROM routes r LEFT JOIN route_stops s ON s.route_id=r.id
     WHERE r.id=$1 AND r.driver_id=$2 AND r.status='Cerrada'
     GROUP BY r.id`,
    [id, req.user!.id],
  )
  if (!result.rowCount) throw new HttpError(404, "No se encontró el resumen de esta ruta")
  res.json({ summary: result.rows[0] })
})

routesRouter.post("/routes/:id/start", requireRole("Chofer"), async (req, res) => {
  const { id } = idParamSchema.parse(req.params)
  await inTransaction(async (client) => {
    const route = await client.query(
      "SELECT status,driver_id FROM routes WHERE id=$1 FOR UPDATE",
      [id],
    )
    if (!route.rowCount) throw new HttpError(404, "Reparto no encontrado")
    if (route.rows[0].driver_id !== req.user!.id || route.rows[0].status !== "Asignada") {
      throw new HttpError(409, "La ruta no está asignada a este chofer")
    }
    const firstStop = await client.query(
      "SELECT id,order_id FROM route_stops WHERE route_id=$1 ORDER BY sequence_number LIMIT 1 FOR UPDATE",
      [id],
    )
    if (!firstStop.rowCount) throw new HttpError(409, "El reparto no tiene paradas")
    await client.query(
      "UPDATE routes SET status='En ruta',started_at=now(),updated_at=now() WHERE id=$1",
      [id],
    )
    await client.query("UPDATE route_stops SET status='En camino' WHERE id=$1", [firstStop.rows[0].id])
    const routeOrders = await client.query(
      `SELECT o.id,o.status,o.active_route_id FROM orders o
       JOIN route_stops s ON s.order_id=o.id
       WHERE s.route_id=$1 ORDER BY s.sequence_number FOR UPDATE OF o`,
      [id],
    )
    for (const order of routeOrders.rows) {
      if (order.status !== "Listo" || order.active_route_id !== id) {
        throw new HttpError(409, "El reparto contiene un pedido que ya no está disponible")
      }
      await client.query(
        "UPDATE orders SET status='En ruta',updated_at=now() WHERE id=$1",
        [order.id],
      )
      await client.query(
        `INSERT INTO status_events(entity_type,entity_id,previous_status,new_status,actor_id,route_id)
         VALUES('Pedido',$1,'Listo','En ruta',$2,$3)`,
        [order.id, req.user!.id, id],
      )
    }
    await client.query(
      "INSERT INTO status_events(entity_type,entity_id,previous_status,new_status,actor_id,route_id) VALUES('Ruta',$1,'Asignada','En ruta',$2,$1)",
      [id, req.user!.id],
    )
    await recalculateRouteEtas(client, id, null)
  })
  res.json({ status: "En ruta" })
})

routesRouter.post("/stops/:id/deliver", requireRole("Chofer"), async (req, res) => {
  const { id } = idParamSchema.parse(req.params)
  const { receivedBy } = z.object({ receivedBy: z.string().trim().min(1).max(160) }).parse(req.body)
  await inTransaction(async (client) => {
    const found = await client.query(
      `SELECT s.*,r.driver_id,r.status AS route_status,c.latitude,c.longitude FROM route_stops s
       JOIN routes r ON r.id=s.route_id
       JOIN orders o ON o.id=s.order_id JOIN clients c ON c.id=o.client_id
       WHERE s.id=$1 FOR UPDATE OF s,r`,
      [id],
    )
    if (!found.rowCount) throw new HttpError(404, "Parada no encontrada")
    const stop = found.rows[0]
    if (stop.driver_id !== req.user!.id || stop.route_status !== "En ruta" || stop.status !== "En camino") {
      throw new HttpError(409, "La parada no pertenece a una ruta activa del chofer")
    }
    await client.query(
      "UPDATE route_stops SET status='Entregada',delivered_at=now(),received_by=$2 WHERE id=$1",
      [id, receivedBy],
    )
    await client.query(
      "UPDATE orders SET status='Entregado',updated_at=now() WHERE id=$1",
      [stop.order_id],
    )
    await client.query(
      "UPDATE incidents SET closed_at=now() WHERE stop_id=$1 AND closed_at IS NULL",
      [id],
    )
    await client.query(
      "INSERT INTO status_events(entity_type,entity_id,previous_status,new_status,actor_id,route_id,stop_id) VALUES('Pedido',$1,'En ruta','Entregado',$2,$3,$4)",
      [stop.order_id, req.user!.id, stop.route_id, id],
    )
    const items = await client.query(
      `SELECT oi.product_id,oi.quantity,sr.quantity AS reserved
       FROM order_items oi LEFT JOIN stock_reservations sr
         ON sr.order_id=oi.order_id AND sr.product_id=oi.product_id AND sr.released_at IS NULL
       WHERE oi.order_id=$1 ORDER BY oi.product_id FOR UPDATE OF oi`,
      [stop.order_id],
    )
    for (const item of items.rows) {
      if (item.reserved === null || Number(item.reserved) < Number(item.quantity)) {
        throw new HttpError(409, "No hay reserva de stock activa para completar la entrega")
      }
      await client.query(
        "UPDATE products SET total_stock=total_stock-$2,reserved_stock=reserved_stock-$2,updated_at=now() WHERE id=$1",
        [item.product_id, item.quantity],
      )
      await client.query(
        "UPDATE stock_reservations SET released_at=now() WHERE order_id=$1 AND product_id=$2",
        [stop.order_id, item.product_id],
      )
      await client.query(
        "INSERT INTO inventory_movements(product_id,movement_type,quantity,reason,actor_id) VALUES($1,'Ajuste',$2,$3,$4)",
        [item.product_id, -Number(item.quantity), `Despacho entregado del pedido ${stop.order_id}`, req.user!.id],
      )
    }
    await client.query(
      "INSERT INTO status_events(entity_type,entity_id,previous_status,new_status,actor_id,route_id,stop_id) VALUES('Parada',$1,'En camino','Entregada',$2,$3,$1)",
      [id, req.user!.id, stop.route_id],
    )
    await activateNextStop(client, stop.route_id, id, req.user!.id)
  })
  res.json({ status: "Entregada" })
})

routesRouter.post("/stops/:id/incidents", requireRole("Chofer"), async (req, res) => {
  const { id } = idParamSchema.parse(req.params)
  const body = z.object({
    cause: z.enum(["Cliente ausente", "Dirección errónea", "Otra"]),
    notes: z.string().max(1000).nullable().optional(),
  }).parse(req.body)
  const result = await inTransaction(async (client) => {
    const found = await client.query(
      `SELECT s.*,r.driver_id,r.status AS route_status,c.latitude,c.longitude FROM route_stops s
       JOIN routes r ON r.id=s.route_id
       JOIN orders o ON o.id=s.order_id JOIN clients c ON c.id=o.client_id
       WHERE s.id=$1 FOR UPDATE OF s,r`,
      [id],
    )
    if (!found.rowCount) throw new HttpError(404, "Parada no encontrada")
    const stop = found.rows[0]
    if (stop.driver_id !== req.user!.id || stop.route_status !== "En ruta" || stop.status !== "En camino") {
      throw new HttpError(409, "La parada no pertenece a una ruta activa del chofer")
    }
    await client.query(
      "INSERT INTO incidents(stop_id,cause,notes,opened_by) VALUES($1,$2,$3,$4)",
      [id, body.cause, body.notes ?? null, req.user!.id],
    )
    const incident = nextIncident(Number(stop.attempts))
    if (incident.status === "No entregada") {
      await client.query("UPDATE route_stops SET status='No entregada',attempts=$2 WHERE id=$1", [id, incident.attempts])
      await client.query(
        "UPDATE incidents SET closed_at=now() WHERE stop_id=$1 AND closed_at IS NULL",
        [id],
      )
      await client.query(
        "UPDATE orders SET status='Listo',active_route_id=NULL,updated_at=now() WHERE id=$1",
        [stop.order_id],
      )
      await client.query(
        "INSERT INTO status_events(entity_type,entity_id,previous_status,new_status,actor_id,route_id,stop_id) VALUES('Pedido',$1,'En ruta','Listo',$2,$3,$4)",
        [stop.order_id, req.user!.id, stop.route_id, id],
      )
      await client.query(
        "INSERT INTO status_events(entity_type,entity_id,previous_status,new_status,actor_id,route_id,stop_id) VALUES('Parada',$1,'En camino','No entregada',$2,$3,$1)",
        [id, req.user!.id, stop.route_id],
      )
    } else {
      await client.query(
        "UPDATE route_stops SET status='Incidencia',attempts=$2 WHERE id=$1",
        [id, incident.attempts],
      )
      await client.query(
        "INSERT INTO status_events(entity_type,entity_id,previous_status,new_status,actor_id,route_id,stop_id) VALUES('Parada',$1,'En camino','Incidencia',$2,$3,$1)",
        [id, req.user!.id, stop.route_id],
      )
      await reorderOpenStops(client, stop.route_id, {
        latitude: Number(stop.latitude),
        longitude: Number(stop.longitude),
      })
    }
    await activateNextStop(client, stop.route_id, id, req.user!.id)
    return incident.status === "No entregada" ? "No entregada" : "Reprogramada"
  })
  res.json({ result })
})

async function activateNextStop(client: import("pg").PoolClient, routeId: string, previousStopId: string, actorId: string) {
  const next = await client.query(
    `SELECT id,order_id FROM route_stops
     WHERE route_id=$1 AND status IN ('Pendiente','Incidencia')
     ORDER BY sequence_number LIMIT 1 FOR UPDATE`,
    [routeId],
  )
  if (next.rowCount) {
    await client.query("UPDATE route_stops SET status='En camino' WHERE id=$1", [next.rows[0].id])
    await client.query(
      "UPDATE orders SET status='En ruta',active_route_id=$2,updated_at=now() WHERE id=$1",
      [next.rows[0].order_id, routeId],
    )
    await recalculateRouteEtas(client, routeId, previousStopId)
    return
  }
  const remaining = await client.query(
    "SELECT 1 FROM route_stops WHERE route_id=$1 AND status NOT IN ('Entregada','No entregada') LIMIT 1",
    [routeId],
  )
  if (remaining.rowCount) return
  const closed = await client.query(
    "UPDATE routes SET status='Cerrada',closed_at=now(),updated_at=now() WHERE id=$1 AND status='En ruta' RETURNING vehicle_id",
    [routeId],
  )
  if (closed.rowCount) {
    await client.query(
      "UPDATE orders SET active_route_id=NULL,updated_at=now() WHERE active_route_id=$1",
      [routeId],
    )
    await client.query("UPDATE vehicles SET available=true WHERE id=$1", [closed.rows[0].vehicle_id])
    await client.query(
      "INSERT INTO status_events(entity_type,entity_id,previous_status,new_status,actor_id,route_id,stop_id) VALUES('Ruta',$1,'En ruta','Cerrada',$2,$1,$3)",
      [routeId, actorId, previousStopId],
    )
  }
}

async function reorderOpenStops(
  client: import("pg").PoolClient,
  routeId: string,
  origin: Coordinates,
): Promise<void> {
  const stops = await client.query(
    `SELECT s.id,s.status,c.latitude,c.longitude
     FROM route_stops s
     JOIN orders o ON o.id=s.order_id
     JOIN clients c ON c.id=o.client_id
     WHERE s.route_id=$1 AND s.status IN ('Pendiente','Incidencia')`,
    [routeId],
  )
  const ordered = orderOpenStops(origin, stops.rows.map((stop) => ({
    id: stop.id as string,
    status: stop.status as "Pendiente" | "Incidencia",
    latitude: Number(stop.latitude),
    longitude: Number(stop.longitude),
  })))
  if (!ordered.length) return

  const resolved = await client.query(
    `SELECT count(*)::int AS count FROM route_stops
     WHERE route_id=$1 AND status IN ('Entregada','No entregada')`,
    [routeId],
  )
  await client.query(
    `UPDATE route_stops SET sequence_number=sequence_number+10000
     WHERE route_id=$1 AND status IN ('Pendiente','Incidencia')`,
    [routeId],
  )
  for (const [index, stop] of ordered.entries()) {
    await client.query(
      "UPDATE route_stops SET sequence_number=$2 WHERE id=$1",
      [stop.id, Number(resolved.rows[0].count) + index + 1],
    )
  }
}

async function recalculateRouteEtas(
  client: import("pg").PoolClient,
  routeId: string,
  originStopId: string | null,
): Promise<void> {
  const route = await client.query(
    `SELECT v.average_speed_kmh,p.minutes_per_stop,p.warehouse_latitude,p.warehouse_longitude
     FROM routes r JOIN vehicles v ON v.id=r.vehicle_id
     CROSS JOIN global_parameters p WHERE r.id=$1 AND p.singleton=true`,
    [routeId],
  )
  if (!route.rowCount) return
  const stops = await client.query(
    `SELECT s.id,c.latitude,c.longitude
     FROM route_stops s JOIN orders o ON o.id=s.order_id
     JOIN clients c ON c.id=o.client_id
     WHERE s.route_id=$1 AND s.status IN ('En camino','Pendiente','Incidencia')
     ORDER BY s.sequence_number`,
    [routeId],
  )
  if (!stops.rowCount) return

  let origin: Coordinates
  if (originStopId) {
    const previous = await client.query(
      `SELECT c.latitude,c.longitude FROM route_stops s
       JOIN orders o ON o.id=s.order_id JOIN clients c ON c.id=o.client_id
       WHERE s.id=$1`,
      [originStopId],
    )
    if (!previous.rowCount) return
    origin = {
      latitude: Number(previous.rows[0].latitude),
      longitude: Number(previous.rows[0].longitude),
    }
  } else {
    origin = {
      latitude: Number(route.rows[0].warehouse_latitude),
      longitude: Number(route.rows[0].warehouse_longitude),
    }
  }

  const arrivals = estimateStopArrivals(
    origin,
    stops.rows.map((stop) => ({
      id: stop.id as string,
      latitude: Number(stop.latitude),
      longitude: Number(stop.longitude),
    })),
    Number(route.rows[0].average_speed_kmh),
    Number(route.rows[0].minutes_per_stop),
    new Date(),
  )
  for (const arrival of arrivals) {
    await client.query("UPDATE route_stops SET eta_at=$2 WHERE id=$1", [
      arrival.id,
      arrival.eta,
    ])
  }
}
