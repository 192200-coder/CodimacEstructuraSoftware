import { inTransaction, pool } from "../db/pool.js"
import type {
  CreateOrderInput,
  OrderRepository,
  OrderRepositoryTransaction,
} from "../application/orders.js"
import { PostgresRegistroAuditoria } from "./postgres-registro-auditoria.js"

type PgClient = Parameters<Parameters<typeof inTransaction>[0]>[0]

class PostgresOrderTransaction implements OrderRepositoryTransaction {
  readonly audit: PostgresRegistroAuditoria

  constructor(private readonly client: PgClient) {
    this.audit = new PostgresRegistroAuditoria((text, values) =>
      this.client.query(text, values),
    )
  }

  async lockProducts(productIds: string[]) {
    const result = await this.client.query(
      `SELECT id,name,total_stock,reserved_stock FROM products
       WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [productIds],
    )
    return result.rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      totalStock: Number(row.total_stock),
      reservedStock: Number(row.reserved_stock),
    }))
  }

  async nextOrderSequence(): Promise<number> {
    const result = await this.client.query("SELECT nextval('order_code_seq') AS value")
    return Number(result.rows[0].value)
  }

  async insertOrder(input: {
    code: string
    clientId: string
    deadlineAt: string | null
    actorId: string
  }) {
    const result = await this.client.query(
      `INSERT INTO orders(codigo,client_id,deadline_at,created_by)
       VALUES($1,$2,$3,$4) RETURNING id,codigo AS code,status,deadline_at`,
      [input.code, input.clientId, input.deadlineAt, input.actorId],
    )
    return result.rows[0] as {
      id: string
      code: string
      status: string
      deadline_at: string | null
    }
  }

  async insertOrderItems(
    orderId: string,
    items: CreateOrderInput["items"],
  ): Promise<void> {
    for (const item of items) {
      await this.client.query(
        "INSERT INTO order_items(order_id,product_id,quantity) VALUES($1,$2,$3)",
        [orderId, item.productId, item.quantity],
      )
    }
  }

  async lockOrder(orderId: string) {
    const result = await this.client.query(
      "SELECT status,active_route_id FROM orders WHERE id=$1 FOR UPDATE",
      [orderId],
    )
    if (!result.rowCount) return null
    return {
      status: result.rows[0].status as string,
      activeRouteId: result.rows[0].active_route_id as string | null,
    }
  }

  async lockOrderItemsForPreparation(orderId: string) {
    const result = await this.client.query(
      `SELECT oi.product_id,oi.quantity,p.name,p.total_stock,p.reserved_stock
       FROM order_items oi JOIN products p ON p.id=oi.product_id
       WHERE oi.order_id=$1 ORDER BY oi.product_id FOR UPDATE OF p`,
      [orderId],
    )
    return result.rows.map((row) => ({
      id: row.product_id as string,
      name: row.name as string,
      quantity: Number(row.quantity),
      totalStock: Number(row.total_stock),
      reservedStock: Number(row.reserved_stock),
    }))
  }

  async reserveOrderItem(input: {
    orderId: string
    productId: string
    quantity: number
    actorId: string
  }): Promise<void> {
    await this.client.query(
      "UPDATE products SET reserved_stock=reserved_stock+$2,updated_at=now() WHERE id=$1",
      [input.productId, input.quantity],
    )
    await this.client.query(
      `INSERT INTO stock_reservations(order_id,product_id,quantity) VALUES($1,$2,$3)
       ON CONFLICT(order_id,product_id) DO UPDATE SET quantity=EXCLUDED.quantity,released_at=NULL`,
      [input.orderId, input.productId, input.quantity],
    )
    await this.client.query(
      "INSERT INTO inventory_movements(producto_id,tipo,cantidad,motivo,usuario_id,pedido_id) VALUES($1,'RESERVA',$2,$3,$4,$5)",
      [input.productId, input.quantity, `Reserva para pedido ${input.orderId}`, input.actorId, input.orderId],
    )
  }

  async lockActiveRoute(routeId: string, orderId: string): Promise<boolean> {
    const route = await this.client.query(
      "SELECT status FROM routes WHERE id=$1 FOR UPDATE",
      [routeId],
    )
    if (!route.rowCount || !["Aprobada", "Asignada"].includes(route.rows[0].status as string)) {
      return false
    }
    const stop = await this.client.query(
      "SELECT id FROM route_stops WHERE route_id=$1 AND order_id=$2 FOR UPDATE",
      [routeId, orderId],
    )
    return Boolean(stop.rowCount)
  }

  async removeOrderFromUnstartedRoute(routeId: string, orderId: string): Promise<boolean> {
    const route = await this.client.query(
      "SELECT status,vehicle_id FROM routes WHERE id=$1 FOR UPDATE",
      [routeId],
    )
    if (!route.rowCount || !["Aprobada", "Asignada"].includes(route.rows[0].status as string)) {
      return false
    }
    const stop = await this.client.query(
      "SELECT id FROM route_stops WHERE route_id=$1 AND order_id=$2 FOR UPDATE",
      [routeId, orderId],
    )
    if (!stop.rowCount) return false
    await this.client.query("DELETE FROM status_events WHERE stop_id=$1", [stop.rows[0].id])
    await this.client.query("DELETE FROM route_stops WHERE id=$1", [stop.rows[0].id])
    await this.client.query(
      "UPDATE orders SET active_route_id=NULL,updated_at=now() WHERE id=$1",
      [orderId],
    )
    const remaining = await this.client.query(
      "SELECT id FROM route_stops WHERE route_id=$1 ORDER BY sequence_number",
      [routeId],
    )
    if (!remaining.rowCount) {
      if (route.rows[0].status === "Asignada") {
        if (route.rows[0].vehicle_id) {
          await this.client.query(
            "UPDATE vehicles SET available=true,updated_at=now() WHERE id=$1",
            [route.rows[0].vehicle_id],
          )
        }
        await this.client.query(
          "UPDATE routes SET status='Aprobada',driver_id=NULL,vehicle_id=NULL,updated_at=now() WHERE id=$1",
          [routeId],
        )
      }
      await this.client.query("DELETE FROM status_events WHERE route_id=$1", [routeId])
      await this.client.query("DELETE FROM routes WHERE id=$1", [routeId])
      return true
    }
    await this.client.query(
      "UPDATE route_stops SET sequence_number=sequence_number+$2 WHERE route_id=$1",
      [routeId, remaining.rowCount + 1],
    )
    for (const [index, remainingStop] of remaining.rows.entries()) {
      await this.client.query(
        "UPDATE route_stops SET sequence_number=$2 WHERE id=$1",
        [remainingStop.id, index + 1],
      )
    }
    return true
  }

  async lockActiveReservations(orderId: string) {
    const result = await this.client.query(
      `SELECT product_id,quantity FROM stock_reservations
       WHERE order_id=$1 AND released_at IS NULL FOR UPDATE`,
      [orderId],
    )
    return result.rows.map((row) => ({
      productId: row.product_id as string,
      quantity: Number(row.quantity),
    }))
  }

  async releaseReservation(input: {
    orderId: string
    productId: string
    quantity: number
    actorId: string
  }) {
    const product = await this.client.query(
      `UPDATE products SET reserved_stock=reserved_stock-$2,updated_at=now()
       WHERE id=$1 AND reserved_stock >= $2 RETURNING total_stock,reserved_stock`,
      [input.productId, input.quantity],
    )
    if (!product.rowCount) return null
    await this.client.query(
      "UPDATE stock_reservations SET released_at=now() WHERE order_id=$1 AND product_id=$2",
      [input.orderId, input.productId],
    )
    await this.client.query(
      "INSERT INTO inventory_movements(producto_id,tipo,cantidad,motivo,usuario_id,pedido_id) VALUES($1,'LIBERACION',$2,$3,$4,$5)",
      [
        input.productId,
        input.quantity,
        `Liberación por cancelación del pedido ${input.orderId}`,
        input.actorId,
        input.orderId,
      ],
    )
    return {
      totalStock: Number(product.rows[0].total_stock),
      reservedStock: Number(product.rows[0].reserved_stock),
    }
  }

  async updateOrderStatus(orderId: string, status: string, clearRoute = false): Promise<void> {
    await this.client.query(
      clearRoute
        ? "UPDATE orders SET status=$2,active_route_id=NULL,updated_at=now() WHERE id=$1"
        : "UPDATE orders SET status=$2,updated_at=now() WHERE id=$1",
      [orderId, status],
    )
  }

  async insertOrderStatusEvent(
    orderId: string,
    previousStatus: string,
    newStatus: string,
    actorId: string,
  ): Promise<void> {
    await this.client.query(
      `INSERT INTO status_events(entity_type,entity_id,previous_status,new_status,actor_id)
       VALUES('Pedido',$1,$2,$3,$4)`,
      [orderId, previousStatus, newStatus, actorId],
    )
  }
}

export class PostgresOrderRepository implements OrderRepository {
  async transaction<T>(
    operation: (tx: OrderRepositoryTransaction) => Promise<T>,
  ): Promise<T> {
    return inTransaction((client) => operation(new PostgresOrderTransaction(client)))
  }

  async listOrders(): Promise<unknown[]> {
    const result = await pool.query(
      `SELECT o.id,o.codigo AS code,o.status,o.ordered_at,o.deadline_at,o.active_route_id,
         jsonb_build_object('name',c.name,'address',c.address,'latitude',c.latitude,'longitude',c.longitude) AS clients,
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
           'quantity',oi.quantity,'products',jsonb_build_object('name',p.name,'unit',p.unit,'weight_kg',p.weight_kg)
         )) FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=o.id),'[]'::jsonb) AS order_items
       FROM orders o JOIN clients c ON c.id=o.client_id
       ORDER BY o.deadline_at NULLS LAST,o.ordered_at`,
    )
    return result.rows
  }

  async listOrderEvents(orderId: string): Promise<unknown[]> {
    const result = await pool.query(
      `SELECT e.entity_type,e.previous_status,e.new_status,e.created_at,p.display_name AS actor
       FROM status_events e JOIN profiles p ON p.id=e.actor_id
       WHERE e.entity_type='Pedido' AND e.entity_id=$1 ORDER BY e.created_at`,
      [orderId],
    )
    return result.rows
  }
}
