import { inTransaction, pool } from "../db/pool.js"
import type { Coordinates, OpenStop } from "../domain/routing.js"
import type {
  DeliveryStockLine,
  RouteOrder,
  RouteRepository,
  RouteStopForEta,
  RouteStopForOrder,
  RouteTransaction,
  StopForDelivery,
} from "../application/routes.js"
import { PostgresRegistroAuditoria } from "./postgres-registro-auditoria.js"

class PostgresRouteTransaction implements RouteTransaction {
  readonly audit: PostgresRegistroAuditoria

  constructor(private readonly client: Parameters<Parameters<typeof inTransaction>[0]>[0]) {
    this.audit = new PostgresRegistroAuditoria((text, values) =>
      this.client.query(text, values),
    )
  }

  async lockOrders(orderIds: string[]): Promise<RouteOrder[]> {
    const result = await this.client.query(
      "SELECT id,status,active_route_id FROM orders WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [orderIds],
    )
    return result.rows.map((row) => ({
      id: row.id as string,
      status: row.status as string,
      activeRouteId: row.active_route_id as string | null,
    }))
  }

  async nextRouteSequence(): Promise<number> {
    const result = await this.client.query("SELECT nextval('route_code_seq') AS value")
    return Number(result.rows[0].value)
  }

  async insertRoute(input: {
    code: string
    distanceKm: number
    estimatedMinutes: number
    estimatedLiters: number
    estimatedCost: number
    actorId: string
  }): Promise<{ id: string; code: string }> {
    const result = await this.client.query(
      `INSERT INTO routes(codigo,status,distance_km,estimated_minutes,estimated_liters,estimated_cost,created_by)
       VALUES($1,'Aprobada',$2,$3,$4,$5,$6) RETURNING id,codigo AS code`,
      [
        input.code,
        input.distanceKm,
        input.estimatedMinutes,
        input.estimatedLiters,
        input.estimatedCost,
        input.actorId,
      ],
    )
    return { id: result.rows[0].id as string, code: result.rows[0].code as string }
  }

  async insertRouteStops(routeId: string, orderIds: string[]): Promise<void> {
    for (const [index, orderId] of orderIds.entries()) {
      await this.client.query(
        "INSERT INTO route_stops(route_id,order_id,sequence_number) VALUES($1,$2,$3)",
        [routeId, orderId, index + 1],
      )
    }
  }

  async setOrdersActiveRoute(orderIds: string[], routeId: string | null): Promise<void> {
    await this.client.query(
      "UPDATE orders SET active_route_id=$2,updated_at=now() WHERE id=ANY($1::uuid[])",
      [orderIds, routeId],
    )
  }

  async clearOrdersForRoute(routeId: string): Promise<void> {
    await this.client.query(
      "UPDATE orders SET active_route_id=NULL,updated_at=now() WHERE active_route_id=$1",
      [routeId],
    )
  }

  async insertStatusEvent(event: {
    entityType: string
    entityId: string
    previousStatus?: string
    newStatus: string
    actorId: string
    routeId: string
    stopId?: string
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO status_events(entity_type,entity_id,previous_status,new_status,actor_id,route_id,stop_id)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        event.entityType,
        event.entityId,
        event.previousStatus ?? null,
        event.newStatus,
        event.actorId,
        event.routeId,
        event.stopId ?? null,
      ],
    )
  }

  async lockRouteForRemoval(routeId: string) {
    const result = await this.client.query(
      "SELECT codigo AS code,status,distance_km,estimated_minutes,estimated_cost FROM routes WHERE id=$1 FOR UPDATE",
      [routeId],
    )
    if (!result.rowCount) return null
    return {
      code: result.rows[0].code as string,
      status: result.rows[0].status as string,
      distanceKm: Number(result.rows[0].distance_km),
      estimatedMinutes: Number(result.rows[0].estimated_minutes),
      estimatedCost: Number(result.rows[0].estimated_cost),
    }
  }

  async deleteRouteStatusEvents(routeId: string): Promise<void> {
    await this.client.query("DELETE FROM status_events WHERE route_id=$1", [routeId])
  }

  async deleteRouteStops(routeId: string): Promise<void> {
    await this.client.query("DELETE FROM route_stops WHERE route_id=$1", [routeId])
  }

  async deleteRoute(routeId: string): Promise<void> {
    await this.client.query("DELETE FROM routes WHERE id=$1", [routeId])
  }

  async lockRouteForAssignment(routeId: string): Promise<{ status: string } | null> {
    const result = await this.client.query(
      "SELECT status FROM routes WHERE id=$1 FOR UPDATE",
      [routeId],
    )
    return result.rowCount ? { status: result.rows[0].status as string } : null
  }

  async lockAvailableDriver(driverId: string): Promise<boolean> {
    const result = await this.client.query(
      "SELECT id FROM profiles WHERE id=$1 AND role='Chofer' AND active=true FOR UPDATE",
      [driverId],
    )
    return Boolean(result.rowCount)
  }

  async driverHasActiveRoute(driverId: string): Promise<boolean> {
    const result = await this.client.query(
      "SELECT 1 FROM routes WHERE driver_id=$1 AND status IN ('Asignada','En ruta')",
      [driverId],
    )
    return Boolean(result.rowCount)
  }

  async lockAvailableVehicle(vehicleId: string): Promise<{ capacityKg: number } | null> {
    const result = await this.client.query(
      "SELECT capacity_kg FROM vehicles WHERE id=$1 AND available=true FOR UPDATE",
      [vehicleId],
    )
    return result.rowCount ? { capacityKg: Number(result.rows[0].capacity_kg) } : null
  }

  async vehicleHasActiveRoute(vehicleId: string): Promise<boolean> {
    const result = await this.client.query(
      "SELECT 1 FROM routes WHERE vehicle_id=$1 AND status IN ('Asignada','En ruta')",
      [vehicleId],
    )
    return Boolean(result.rowCount)
  }

  async routeWeight(routeId: string): Promise<number> {
    const result = await this.client.query(
      `SELECT COALESCE(sum(oi.quantity*p.weight_kg),0) AS weight
       FROM route_stops s JOIN order_items oi ON oi.order_id=s.order_id
       JOIN products p ON p.id=oi.product_id WHERE s.route_id=$1`,
      [routeId],
    )
    return Number(result.rows[0].weight)
  }

  async assignRoute(routeId: string, driverId: string, vehicleId: string): Promise<void> {
    await this.client.query(
      "UPDATE routes SET driver_id=$2,vehicle_id=$3,status='Asignada',updated_at=now() WHERE id=$1",
      [routeId, driverId, vehicleId],
    )
  }

  async setVehicleAvailable(vehicleId: string, available: boolean): Promise<void> {
    await this.client.query("UPDATE vehicles SET available=$2 WHERE id=$1", [vehicleId, available])
  }

  async lockRouteForStart(routeId: string): Promise<{ status: string; driverId: string } | null> {
    const result = await this.client.query(
      "SELECT status,driver_id FROM routes WHERE id=$1 FOR UPDATE",
      [routeId],
    )
    return result.rowCount
      ? { status: result.rows[0].status as string, driverId: result.rows[0].driver_id as string }
      : null
  }

  async lockFirstStop(routeId: string): Promise<{ id: string; orderId: string } | null> {
    const result = await this.client.query(
      "SELECT id,order_id FROM route_stops WHERE route_id=$1 ORDER BY sequence_number LIMIT 1 FOR UPDATE",
      [routeId],
    )
    return result.rowCount
      ? { id: result.rows[0].id as string, orderId: result.rows[0].order_id as string }
      : null
  }

  async startRoute(routeId: string): Promise<void> {
    await this.client.query(
      "UPDATE routes SET status='En ruta',started_at=now(),updated_at=now() WHERE id=$1",
      [routeId],
    )
  }

  async updateStopStatus(stopId: string, status: string): Promise<void> {
    await this.client.query("UPDATE route_stops SET status=$2 WHERE id=$1", [stopId, status])
  }

  async lockRouteOrders(routeId: string): Promise<RouteOrder[]> {
    const result = await this.client.query(
      `SELECT o.id,o.status,o.active_route_id FROM orders o
       JOIN route_stops s ON s.order_id=o.id
       WHERE s.route_id=$1 ORDER BY s.sequence_number FOR UPDATE OF o`,
      [routeId],
    )
    return result.rows.map((row) => ({
      id: row.id as string,
      status: row.status as string,
      activeRouteId: row.active_route_id as string | null,
    }))
  }

  async updateOrderStatus(orderId: string, status: string, activeRouteId?: string | null): Promise<void> {
    if (activeRouteId === undefined) {
      await this.client.query(
        "UPDATE orders SET status=$2,updated_at=now() WHERE id=$1",
        [orderId, status],
      )
      return
    }
    await this.client.query(
      "UPDATE orders SET status=$2,active_route_id=$3,updated_at=now() WHERE id=$1",
      [orderId, status, activeRouteId],
    )
  }

  async etaParameters(routeId: string) {
    const result = await this.client.query(
      `SELECT v.average_speed_kmh,p.minutes_per_stop,p.warehouse_latitude,p.warehouse_longitude
       FROM routes r JOIN vehicles v ON v.id=r.vehicle_id
       CROSS JOIN global_parameters p WHERE r.id=$1 AND p.singleton=true`,
      [routeId],
    )
    if (!result.rowCount) return null
    return {
      averageSpeedKmh: Number(result.rows[0].average_speed_kmh),
      minutesPerStop: Number(result.rows[0].minutes_per_stop),
      warehouse: {
        latitude: Number(result.rows[0].warehouse_latitude),
        longitude: Number(result.rows[0].warehouse_longitude),
      },
    }
  }

  async etaStops(routeId: string): Promise<RouteStopForEta[]> {
    const result = await this.client.query(
      `SELECT s.id,c.latitude,c.longitude
       FROM route_stops s JOIN orders o ON o.id=s.order_id
       JOIN clients c ON c.id=o.client_id
       WHERE s.route_id=$1 AND s.status IN ('En camino','Pendiente','Incidencia')
       ORDER BY s.sequence_number`,
      [routeId],
    )
    return result.rows.map((row) => ({
      id: row.id as string,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
    }))
  }

  async stopCoordinates(stopId: string): Promise<Coordinates | null> {
    const result = await this.client.query(
      `SELECT c.latitude,c.longitude FROM route_stops s
       JOIN orders o ON o.id=s.order_id JOIN clients c ON c.id=o.client_id
       WHERE s.id=$1`,
      [stopId],
    )
    return result.rowCount
      ? { latitude: Number(result.rows[0].latitude), longitude: Number(result.rows[0].longitude) }
      : null
  }

  async updateStopEta(stopId: string, eta: Date): Promise<void> {
    await this.client.query("UPDATE route_stops SET eta_at=$2 WHERE id=$1", [stopId, eta])
  }

  async lockStopForDelivery(stopId: string): Promise<StopForDelivery | null> {
    return this.lockStop(stopId)
  }

  async markStopDelivered(stopId: string, receivedBy: string): Promise<void> {
    await this.client.query(
      "UPDATE route_stops SET status='Entregada',delivered_at=now(),received_by=$2 WHERE id=$1",
      [stopId, receivedBy],
    )
  }

  async closeOpenIncidents(stopId: string): Promise<void> {
    await this.client.query(
      "UPDATE incidents SET closed_at=now() WHERE stop_id=$1 AND closed_at IS NULL",
      [stopId],
    )
  }

  async markOrderDelivered(orderId: string): Promise<void> {
    await this.client.query(
      "UPDATE orders SET status='Entregado',updated_at=now() WHERE id=$1",
      [orderId],
    )
  }

  async lockDeliveryStock(orderId: string): Promise<DeliveryStockLine[]> {
    const result = await this.client.query(
      `SELECT oi.product_id,oi.quantity,sr.quantity AS reserved,p.total_stock,p.reserved_stock
       FROM order_items oi LEFT JOIN stock_reservations sr
         ON sr.order_id=oi.order_id AND sr.product_id=oi.product_id AND sr.released_at IS NULL
       JOIN products p ON p.id=oi.product_id
       WHERE oi.order_id=$1 ORDER BY oi.product_id FOR UPDATE OF oi,p`,
      [orderId],
    )
    return result.rows.map((row) => ({
      productId: row.product_id as string,
      quantity: Number(row.quantity),
      reserved: row.reserved === null ? null : Number(row.reserved),
      totalStock: Number(row.total_stock),
      reservedStock: Number(row.reserved_stock),
    }))
  }

  async applyDeliveryStock(productId: string, quantity: number) {
    const result = await this.client.query(
      `UPDATE products SET total_stock=total_stock-$2,reserved_stock=reserved_stock-$2,updated_at=now()
       WHERE id=$1 RETURNING total_stock,reserved_stock`,
      [productId, quantity],
    )
    return {
      totalStock: Number(result.rows[0].total_stock),
      reservedStock: Number(result.rows[0].reserved_stock),
    }
  }

  async releaseStockReservation(orderId: string, productId: string): Promise<void> {
    await this.client.query(
      "UPDATE stock_reservations SET released_at=now() WHERE order_id=$1 AND product_id=$2",
      [orderId, productId],
    )
  }

  async insertDeliveryMovement(input: {
    productId: string
    quantity: number
    orderId: string
    actorId: string
  }): Promise<void> {
    await this.client.query(
      "INSERT INTO inventory_movements(product_id,movement_type,quantity,reason,actor_id) VALUES($1,'Ajuste',$2,$3,$4)",
      [input.productId, input.quantity, `Despacho entregado del pedido ${input.orderId}`, input.actorId],
    )
  }

  async lockStopForIncident(stopId: string): Promise<StopForDelivery | null> {
    return this.lockStop(stopId)
  }

  private async lockStop(stopId: string): Promise<StopForDelivery | null> {
    const result = await this.client.query(
      `SELECT s.id,s.route_id,s.order_id,s.status,s.attempts,r.driver_id,r.status AS route_status,
              c.latitude,c.longitude
       FROM route_stops s JOIN routes r ON r.id=s.route_id
       JOIN orders o ON o.id=s.order_id JOIN clients c ON c.id=o.client_id
       WHERE s.id=$1 FOR UPDATE OF s,r`,
      [stopId],
    )
    if (!result.rowCount) return null
    return {
      id: result.rows[0].id as string,
      routeId: result.rows[0].route_id as string,
      orderId: result.rows[0].order_id as string,
      status: result.rows[0].status as string,
      attempts: Number(result.rows[0].attempts),
      driverId: result.rows[0].driver_id as string,
      routeStatus: result.rows[0].route_status as string,
      latitude: Number(result.rows[0].latitude),
      longitude: Number(result.rows[0].longitude),
    }
  }

  async insertIncident(stopId: string, cause: string, notes: string | null, actorId: string): Promise<void> {
    await this.client.query(
      "INSERT INTO incidents(stop_id,cause,notes,opened_by) VALUES($1,$2,$3,$4)",
      [stopId, cause, notes, actorId],
    )
  }

  async updateStopIncident(stopId: string, status: string, attempts: number): Promise<void> {
    await this.client.query(
      "UPDATE route_stops SET status=$2,attempts=$3 WHERE id=$1",
      [stopId, status, attempts],
    )
  }

  async openStopsForReordering(routeId: string): Promise<RouteStopForOrder[]> {
    const result = await this.client.query(
      `SELECT s.id,s.status,c.latitude,c.longitude
       FROM route_stops s JOIN orders o ON o.id=s.order_id
       JOIN clients c ON c.id=o.client_id
       WHERE s.route_id=$1 AND s.status IN ('Pendiente','Incidencia')`,
      [routeId],
    )
    return result.rows.map((row) => ({
      id: row.id as string,
      status: row.status as "Pendiente" | "Incidencia",
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
    }))
  }

  async reorderOpenStops(routeId: string, ordered: OpenStop[]): Promise<void> {
    if (!ordered.length) return
    const resolved = await this.client.query(
      `SELECT count(*)::int AS count FROM route_stops
       WHERE route_id=$1 AND status IN ('Entregada','No entregada')`,
      [routeId],
    )
    await this.client.query(
      `UPDATE route_stops SET sequence_number=sequence_number+10000
       WHERE route_id=$1 AND status IN ('Pendiente','Incidencia')`,
      [routeId],
    )
    for (const [index, stop] of ordered.entries()) {
      await this.client.query(
        "UPDATE route_stops SET sequence_number=$2 WHERE id=$1",
        [stop.id, Number(resolved.rows[0].count) + index + 1],
      )
    }
  }

  async lockNextOpenStop(routeId: string) {
    const result = await this.client.query(
      `SELECT s.id,s.order_id,s.status AS stop_status,o.status AS order_status FROM route_stops s
       JOIN orders o ON o.id=s.order_id
       WHERE s.route_id=$1 AND s.status IN ('Pendiente','Incidencia')
       ORDER BY s.sequence_number LIMIT 1 FOR UPDATE OF s,o`,
      [routeId],
    )
    return result.rowCount
      ? {
          id: result.rows[0].id as string,
          orderId: result.rows[0].order_id as string,
          stopStatus: result.rows[0].stop_status as string,
          orderStatus: result.rows[0].order_status as string,
        }
      : null
  }

  async activateStop(stopId: string, orderId: string, routeId: string): Promise<void> {
    await this.client.query("UPDATE route_stops SET status='En camino' WHERE id=$1", [stopId])
    await this.client.query(
      "UPDATE orders SET status='En ruta',active_route_id=$2,updated_at=now() WHERE id=$1",
      [orderId, routeId],
    )
  }

  async hasUnresolvedStops(routeId: string): Promise<boolean> {
    const result = await this.client.query(
      "SELECT 1 FROM route_stops WHERE route_id=$1 AND status NOT IN ('Entregada','No entregada') LIMIT 1",
      [routeId],
    )
    return Boolean(result.rowCount)
  }

  async closeRoute(routeId: string): Promise<{ vehicleId: string } | null> {
    const result = await this.client.query(
      "UPDATE routes SET status='Cerrada',closed_at=now(),updated_at=now() WHERE id=$1 AND status='En ruta' RETURNING vehicle_id",
      [routeId],
    )
    return result.rowCount ? { vehicleId: result.rows[0].vehicle_id as string } : null
  }
}

export class PostgresRouteRepository implements RouteRepository {
  async transaction<T>(operation: (tx: RouteTransaction) => Promise<T>): Promise<T> {
    return inTransaction((client) => operation(new PostgresRouteTransaction(client)))
  }

  async listRoutes(): Promise<unknown[]> {
    const result = await pool.query(
      `SELECT r.*,r.codigo AS code,p.display_name AS driver_name, v.plate AS vehicle_plate,
         count(s.id)::int AS stop_count,
         COALESCE(jsonb_agg(jsonb_build_object(
           'id',s.id,'sequence_number',s.sequence_number,'status',s.status,
           'attempts',s.attempts,'eta_at',s.eta_at,'delivered_at',s.delivered_at,
           'received_by',s.received_by,'code',o.codigo,'client_name',c.name,'address',c.address
         ) ORDER BY s.sequence_number) FILTER (WHERE s.id IS NOT NULL),'[]'::jsonb) AS route_stops
       FROM routes r LEFT JOIN profiles p ON p.id=r.driver_id
       LEFT JOIN vehicles v ON v.id=r.vehicle_id LEFT JOIN route_stops s ON s.route_id=r.id
       LEFT JOIN orders o ON o.id=s.order_id LEFT JOIN clients c ON c.id=o.client_id
       GROUP BY r.id,p.display_name,v.plate ORDER BY r.created_at DESC`,
    )
    return result.rows
  }

  async getDriverRoute(driverId: string): Promise<unknown | null> {
    const result = await pool.query(
      `SELECT r.*,r.codigo AS code,to_jsonb(v) AS vehicles,
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
           'id',s.id,'sequence_number',s.sequence_number,'status',s.status,'attempts',s.attempts,
           'eta_at',s.eta_at,'orders',jsonb_build_object(
             'code',o.codigo,'clients',jsonb_build_object(
               'name',c.name,'address',c.address,'reference',c.reference,'contact',c.contact,
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
      [driverId],
    )
    return result.rows[0] ?? null
  }

  async getClosedRouteSummary(routeId: string, driverId: string): Promise<unknown | null> {
    const result = await pool.query(
      `SELECT r.id,r.codigo AS code,r.started_at,r.closed_at,r.distance_km,r.estimated_minutes,
         count(s.id) FILTER (WHERE s.status='Entregada')::int AS delivered,
         count(s.id) FILTER (WHERE s.status='No entregada')::int AS not_delivered
       FROM routes r LEFT JOIN route_stops s ON s.route_id=r.id
       WHERE r.id=$1 AND r.driver_id=$2 AND r.status='Cerrada'
       GROUP BY r.id`,
      [routeId, driverId],
    )
    return result.rows[0] ?? null
  }
}
