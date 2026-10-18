import { Router } from "express"
import { inTransaction, pool } from "../db/pool.js"
import { authenticate, requireRole } from "../http/auth.js"
import { HttpError } from "../http/errors.js"
import { createOrderSchema, idParamSchema } from "../http/schemas.js"
import { validateOrderStock } from "../application/validate-order-stock.js"
import { formatSequentialCode } from "../application/sequential-code.js"
import { registrarEventoAuditoria } from "../application/registro-auditoria.js"
import { PostgresRegistroAuditoria } from "../adapters/postgres-registro-auditoria.js"

export const ordersRouter = Router()
ordersRouter.use(authenticate)

ordersRouter.get("/", requireRole("Despachador", "Administrador"), async (_req, res) => {
  const result = await pool.query(
    `SELECT o.id,o.codigo AS code,o.status,o.ordered_at,o.deadline_at,o.active_route_id,
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
    const auditoria = new PostgresRegistroAuditoria((text, values) => client.query(text, values))
    const products = await client.query(
      `SELECT id,name,total_stock,reserved_stock
       FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [body.items.map((item) => item.productId)],
    )
    const stockErrors = validateOrderStock(
      body.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      products.rows.map((product) => ({
        id: product.id as string,
        name: product.name as string,
        totalStock: Number(product.total_stock),
        reservedStock: Number(product.reserved_stock),
      })),
    )
    if (stockErrors.length) {
      throw new HttpError(422, "Revisa los campos marcados.", "VALIDATION_ERROR", stockErrors)
    }
    const sequence = await client.query("SELECT nextval('order_code_seq') AS value")
    const code = formatSequentialCode("PED", Number(sequence.rows[0].value))
    const inserted = await client.query(
      `INSERT INTO orders(codigo,client_id,deadline_at,created_by)
       VALUES($1,$2,$3,$4) RETURNING id,codigo AS code,status,deadline_at`,
      [code, body.clientId, body.deadlineAt ?? null, req.user!.id],
    )
    for (const item of body.items) {
      await client.query(
        "INSERT INTO order_items(order_id,product_id,quantity) VALUES($1,$2,$3)",
        [inserted.rows[0].id, item.productId, item.quantity],
      )
    }
    await registrarEventoAuditoria(auditoria, {
      usuarioId: req.user!.id,
      accion: "Alta de pedido",
      entidad: "Pedido",
      entidadId: inserted.rows[0].id as string,
      valorAnterior: null,
      valorNuevo: {
        codigo: inserted.rows[0].code as string,
        estado: inserted.rows[0].status as string,
        clienteId: body.clientId,
        fechaLimite: body.deadlineAt ?? null,
        lineas: body.items,
      },
    })
    return inserted.rows[0]
  })
  res.status(201).json({ order })
})

ordersRouter.post("/:id/prepare", requireRole("Despachador"), async (req, res) => {
  const { id } = idParamSchema.parse(req.params)
  await inTransaction(async (client) => {
    const auditoria = new PostgresRegistroAuditoria((text, values) => client.query(text, values))
    const order = await client.query("SELECT status FROM orders WHERE id=$1 FOR UPDATE", [id])
    if (!order.rowCount) throw new HttpError(404, "Pedido no encontrado")
    if (order.rows[0].status !== "Pendiente") throw new HttpError(409, "El pedido debe estar Pendiente")
    const items = await client.query(
      `SELECT oi.product_id,oi.quantity,p.name,p.total_stock,p.reserved_stock
       FROM order_items oi JOIN products p ON p.id=oi.product_id
       WHERE oi.order_id=$1 ORDER BY oi.product_id FOR UPDATE OF p`,
      [id],
    )
    if (!items.rowCount) throw new HttpError(409, "El pedido no tiene productos")
    const stockErrors = validateOrderStock(
      items.rows.map((item) => ({
        productId: item.product_id as string,
        quantity: Number(item.quantity),
      })),
      items.rows.map((item) => ({
        id: item.product_id as string,
        name: item.name as string,
        totalStock: Number(item.total_stock),
        reservedStock: Number(item.reserved_stock),
      })),
    )
    if (stockErrors.length) {
      throw new HttpError(422, "Revisa los campos marcados.", "VALIDATION_ERROR", stockErrors)
    }
    for (const item of items.rows) {
      const reservedBefore = Number(item.reserved_stock)
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
      await registrarEventoAuditoria(auditoria, {
        usuarioId: req.user!.id,
        accion: "Reserva de inventario",
        entidad: "Inventario",
        entidadId: item.product_id as string,
        valorAnterior: { existencias: Number(item.total_stock), reservadas: reservedBefore },
        valorNuevo: {
          existencias: Number(item.total_stock),
          reservadas: reservedBefore + Number(item.quantity),
          pedidoId: id,
          cantidad: Number(item.quantity),
        },
      })
    }
    await client.query("UPDATE orders SET status='En preparación',updated_at=now() WHERE id=$1", [id])
    await client.query(
      "INSERT INTO status_events(entity_type,entity_id,previous_status,new_status,actor_id) VALUES('Pedido',$1,'Pendiente','En preparación',$2)",
      [id, req.user!.id],
    )
    await registrarEventoAuditoria(auditoria, {
      usuarioId: req.user!.id,
      accion: "Cambio de estado",
      entidad: "Pedido",
      entidadId: id,
      valorAnterior: { estado: "Pendiente" },
      valorNuevo: { estado: "En preparación" },
    })
  })
  res.json({ status: "En preparación" })
})

ordersRouter.post("/:id/cancel", requireRole("Despachador"), async (req, res) => {
  const { id } = idParamSchema.parse(req.params)
  await inTransaction(async (client) => {
    const auditoria = new PostgresRegistroAuditoria((text, values) => client.query(text, values))
    const result = await client.query("SELECT status,active_route_id FROM orders WHERE id=$1 FOR UPDATE", [id])
    if (!result.rowCount) throw new HttpError(404, "Pedido no encontrado")
    const previous = result.rows[0].status as string
    if (!["Pendiente", "En preparación", "Listo"].includes(previous)) {
      throw new HttpError(409, "El pedido ya no puede cancelarse")
    }
    const activeRouteId = result.rows[0].active_route_id as string | null
    if (activeRouteId) {
      const routeResult = await client.query(
        "SELECT status,driver_id,vehicle_id FROM routes WHERE id=$1 FOR UPDATE",
        [activeRouteId],
      )
      const route = routeResult.rows[0]
      if (!route || !["Aprobada", "Asignada"].includes(route.status as string)) {
        throw new HttpError(409, "El pedido pertenece a un reparto que ya no puede modificarse")
      }
      const stop = await client.query(
        "SELECT id FROM route_stops WHERE route_id=$1 AND order_id=$2 FOR UPDATE",
        [activeRouteId, id],
      )
      if (stop.rowCount) {
        await client.query("DELETE FROM status_events WHERE stop_id=$1", [stop.rows[0].id])
        await client.query("DELETE FROM route_stops WHERE id=$1", [stop.rows[0].id])
      }
      await client.query("UPDATE orders SET active_route_id=NULL,updated_at=now() WHERE id=$1", [id])
      const remainingStops = await client.query(
        "SELECT id FROM route_stops WHERE route_id=$1 ORDER BY sequence_number",
        [activeRouteId],
      )
      if (!remainingStops.rowCount) {
        if (route.status === "Asignada") {
          if (route.vehicle_id) {
            await client.query("UPDATE vehicles SET available=true,updated_at=now() WHERE id=$1", [
              route.vehicle_id,
            ])
          }
          await client.query(
            "UPDATE routes SET status='Aprobada',driver_id=NULL,vehicle_id=NULL,updated_at=now() WHERE id=$1",
            [activeRouteId],
          )
        }
        await client.query("DELETE FROM status_events WHERE route_id=$1", [activeRouteId])
        await client.query("DELETE FROM routes WHERE id=$1", [activeRouteId])
      } else if (stop.rowCount) {
        await client.query(
          "UPDATE route_stops SET sequence_number=sequence_number+$2 WHERE route_id=$1",
          [activeRouteId, remainingStops.rowCount + 1],
        )
        for (const [index, remainingStop] of remainingStops.rows.entries()) {
          await client.query(
            "UPDATE route_stops SET sequence_number=$2 WHERE id=$1",
            [remainingStop.id, index + 1],
          )
        }
      }
    }
    const reservations = await client.query(
      "SELECT product_id,quantity FROM stock_reservations WHERE order_id=$1 AND released_at IS NULL FOR UPDATE",
      [id],
    )
    for (const row of reservations.rows) {
      const product = await client.query(
        `UPDATE products SET reserved_stock=reserved_stock-$2,updated_at=now()
         WHERE id=$1 AND reserved_stock >= $2 RETURNING total_stock,reserved_stock`,
        [row.product_id, row.quantity],
      )
      if (!product.rowCount) {
        throw new HttpError(409, "La reserva de inventario ya no está disponible")
      }
      await client.query(
        "UPDATE stock_reservations SET released_at=now() WHERE order_id=$1 AND product_id=$2",
        [id, row.product_id],
      )
      await client.query(
        "INSERT INTO inventory_movements(product_id,movement_type,quantity,reason,actor_id) VALUES($1,'Liberación',$2,$3,$4)",
        [row.product_id, row.quantity, `Liberación por cancelación del pedido ${id}`, req.user!.id],
      )
      const after = product.rows[0]
      const beforeReserved = Number(after.reserved_stock) + Number(row.quantity)
      await registrarEventoAuditoria(auditoria, {
        usuarioId: req.user!.id,
        accion: "Liberación de reserva",
        entidad: "Inventario",
        entidadId: row.product_id as string,
        valorAnterior: {
          existencias: Number(after.total_stock),
          reservadas: beforeReserved,
          pedidoId: id,
          cantidad: Number(row.quantity),
        },
        valorNuevo: { existencias: Number(after.total_stock), reservadas: Number(after.reserved_stock) },
      })
    }
    await client.query(
      "UPDATE orders SET status='Cancelado',active_route_id=NULL,updated_at=now() WHERE id=$1",
      [id],
    )
    await client.query(
      "INSERT INTO status_events(entity_type,entity_id,previous_status,new_status,actor_id) VALUES('Pedido',$1,$2,'Cancelado',$3)",
      [id, previous, req.user!.id],
    )
    await registrarEventoAuditoria(auditoria, {
      usuarioId: req.user!.id,
      accion: "Cambio de estado",
      entidad: "Pedido",
      entidadId: id,
      valorAnterior: { estado: previous },
      valorNuevo: { estado: "Cancelado" },
    })
  })
  res.json({ status: "Cancelado" })
})

ordersRouter.post("/:id/ready", requireRole("Despachador"), async (req, res) => {
  const { id } = idParamSchema.parse(req.params)
  await inTransaction(async (client) => {
    const auditoria = new PostgresRegistroAuditoria((text, values) => client.query(text, values))
    const result = await client.query("SELECT status FROM orders WHERE id=$1 FOR UPDATE", [id])
    if (!result.rowCount) throw new HttpError(404, "Pedido no encontrado")
    if (result.rows[0].status !== "En preparación") throw new HttpError(409, "El pedido debe estar En preparación")
    await client.query("UPDATE orders SET status='Listo',updated_at=now() WHERE id=$1", [id])
    await client.query(
      "INSERT INTO status_events(entity_type,entity_id,previous_status,new_status,actor_id) VALUES('Pedido',$1,'En preparación','Listo',$2)",
      [id, req.user!.id],
    )
    await registrarEventoAuditoria(auditoria, {
      usuarioId: req.user!.id,
      accion: "Cambio de estado",
      entidad: "Pedido",
      entidadId: id,
      valorAnterior: { estado: "En preparación" },
      valorNuevo: { estado: "Listo" },
    })
  })
  res.json({ status: "Listo" })
})
