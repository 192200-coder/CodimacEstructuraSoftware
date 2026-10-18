import { Router } from "express"
import { inTransaction, pool } from "../db/pool.js"
import { authenticate, requireRole } from "../http/auth.js"
import { HttpError } from "../http/errors.js"
import { createOrderSchema, idParamSchema } from "../http/schemas.js"
import { hasAvailableStock } from "../domain/rules.js"

export const ordersRouter = Router()
ordersRouter.use(authenticate)

ordersRouter.get("/", requireRole("Despachador", "Administrador"), async (_req, res) => {
  const result = await pool.query(
    `SELECT o.id,o.code,o.tracking_token,o.status,o.ordered_at,o.deadline_at,o.active_route_id,
       jsonb_build_object('name',c.name,'address',c.address,'latitude',c.latitude,'longitude',c.longitude) AS clients,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'quantity',oi.quantity,'products',jsonb_build_object('name',p.name,'unit',p.unit,'weight_kg',p.weight_kg)
       )) FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=o.id),'[]'::jsonb) AS order_items
     FROM orders o JOIN clients c ON c.id=o.client_id
     ORDER BY o.deadline_at NULLS LAST,o.ordered_at`,
  )
  res.json({ orders: result.rows })
})

ordersRouter.get("/:id/events", requireRole("Despachador", "Administrador"), async (req, res) => {
  const { id } = idParamSchema.parse(req.params)
  const result = await pool.query(
    `SELECT e.entity_type,e.previous_status,e.new_status,e.created_at,p.display_name AS actor
     FROM status_events e JOIN profiles p ON p.id=e.actor_id
     WHERE e.entity_type='Pedido' AND e.entity_id=$1 ORDER BY e.created_at`,
    [id],
  )
  res.json({ events: result.rows })
})

ordersRouter.post("/", requireRole("Despachador"), async (req, res) => {
  const body = createOrderSchema.parse(req.body)
  const order = await inTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO orders(code,client_id,deadline_at,created_by)
       VALUES($1,$2,$3,$4) RETURNING id,code,status,deadline_at,tracking_token`,
      [body.code, body.clientId, body.deadlineAt ?? null, req.user!.id],
    )
    for (const item of body.items) {
      await client.query(
        "INSERT INTO order_items(order_id,product_id,quantity) VALUES($1,$2,$3)",
        [inserted.rows[0].id, item.productId, item.quantity],
      )
    }
    return inserted.rows[0]
  })
  res.status(201).json({ order })
})

ordersRouter.post("/:id/prepare", requireRole("Despachador"), async (req, res) => {
  const { id } = idParamSchema.parse(req.params)
  await inTransaction(async (client) => {
    const order = await client.query("SELECT status FROM orders WHERE id=$1 FOR UPDATE", [id])
    if (!order.rowCount) throw new HttpError(404, "Pedido no encontrado")
    if (order.rows[0].status !== "Pendiente") throw new HttpError(409, "El pedido debe estar Pendiente")
    const items = await client.query(
      `SELECT oi.product_id,oi.quantity,p.total_stock,p.reserved_stock
       FROM order_items oi JOIN products p ON p.id=oi.product_id
       WHERE oi.order_id=$1 ORDER BY oi.product_id FOR UPDATE OF p`,
      [id],
    )
    if (!items.rowCount) throw new HttpError(409, "El pedido no tiene productos")
    for (const item of items.rows) {
      if (!hasAvailableStock(Number(item.total_stock), Number(item.reserved_stock), Number(item.quantity))) {
        throw new HttpError(409, "Stock insuficiente para preparar el pedido")
      }
      await client.query(
        `UPDATE products SET reserved_stock=reserved_stock+$2,updated_at=now() WHERE id=$1`,
        [item.product_id, item.quantity],
      )
      await client.query(
        `INSERT INTO stock_reservations(order_id,product_id,quantity) VALUES($1,$2,$3)
         ON CONFLICT(order_id,product_id) DO UPDATE SET quantity=EXCLUDED.quantity,released_at=NULL`,
        [id, item.product_id, item.quantity],
      )
      await client.query(
        "INSERT INTO inventory_movements(product_id,movement_type,quantity,reason,actor_id) VALUES($1,'Reserva',$2,$3,$4)",
        [item.product_id, item.quantity, `Reserva para pedido ${id}`, req.user!.id],
      )
    }
    await client.query("UPDATE orders SET status='En preparación',updated_at=now() WHERE id=$1", [id])
    await client.query(
      "INSERT INTO status_events(entity_type,entity_id,previous_status,new_status,actor_id) VALUES('Pedido',$1,'Pendiente','En preparación',$2)",
      [id, req.user!.id],
    )
  })
  res.json({ status: "En preparación" })
})

ordersRouter.post("/:id/cancel", requireRole("Despachador"), async (req, res) => {
  const { id } = idParamSchema.parse(req.params)
  await inTransaction(async (client) => {
    const result = await client.query("SELECT status,active_route_id FROM orders WHERE id=$1 FOR UPDATE", [id])
    if (!result.rowCount) throw new HttpError(404, "Pedido no encontrado")
    const previous = result.rows[0].status as string
    if (result.rows[0].active_route_id) {
      throw new HttpError(409, "El pedido ya pertenece a un reparto activo")
    }
    if (!["Pendiente", "En preparación", "Listo"].includes(previous)) {
      throw new HttpError(409, "El pedido ya no puede cancelarse")
    }
    const reservations = await client.query(
      "SELECT product_id,quantity FROM stock_reservations WHERE order_id=$1 AND released_at IS NULL FOR UPDATE",
      [id],
    )
    for (const row of reservations.rows) {
      await client.query(
        "UPDATE products SET reserved_stock=GREATEST(0,reserved_stock-$2),updated_at=now() WHERE id=$1",
        [row.product_id, row.quantity],
      )
      await client.query(
        "UPDATE stock_reservations SET released_at=now() WHERE order_id=$1 AND product_id=$2",
        [id, row.product_id],
      )
      await client.query(
        "INSERT INTO inventory_movements(product_id,movement_type,quantity,reason,actor_id) VALUES($1,'Liberación',$2,$3,$4)",
        [row.product_id, row.quantity, `Liberación por cancelación del pedido ${id}`, req.user!.id],
      )
    }
    await client.query("UPDATE orders SET status='Cancelado',updated_at=now() WHERE id=$1", [id])
    await client.query(
      "INSERT INTO status_events(entity_type,entity_id,previous_status,new_status,actor_id) VALUES('Pedido',$1,$2,'Cancelado',$3)",
      [id, previous, req.user!.id],
    )
  })
  res.json({ status: "Cancelado" })
})

ordersRouter.post("/:id/ready", requireRole("Despachador"), async (req, res) => {
  const { id } = idParamSchema.parse(req.params)
  await inTransaction(async (client) => {
    const result = await client.query("SELECT status FROM orders WHERE id=$1 FOR UPDATE", [id])
    if (!result.rowCount) throw new HttpError(404, "Pedido no encontrado")
    if (result.rows[0].status !== "En preparación") throw new HttpError(409, "El pedido debe estar En preparación")
    await client.query("UPDATE orders SET status='Listo',updated_at=now() WHERE id=$1", [id])
    await client.query(
      "INSERT INTO status_events(entity_type,entity_id,previous_status,new_status,actor_id) VALUES('Pedido',$1,'En preparación','Listo',$2)",
      [id, req.user!.id],
    )
  })
  res.json({ status: "Listo" })
})
