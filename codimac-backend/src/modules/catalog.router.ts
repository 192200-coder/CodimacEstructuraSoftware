import { Router } from "express"
import { z } from "zod"
import { inTransaction, pool } from "../db/pool.js"
import { authenticate, hashPassword, requireRole } from "../http/auth.js"
import { HttpError } from "../http/errors.js"
import { idParamSchema, uuidSchema } from "../http/schemas.js"
import { canAdjustStock } from "../domain/rules.js"
import { loadDemoData } from "../db/demo-data.js"

export const catalogRouter = Router()
catalogRouter.use(authenticate)

const catalogs = {
  clients: {
    table: "clients",
    fields: ["name", "contact", "address", "latitude", "longitude"],
    schema: z.object({
      name: z.string().trim().min(1).max(160),
      contact: z.string().max(80).nullable().optional(),
      address: z.string().trim().min(1).max(300),
      latitude: z.coerce.number().min(-90).max(90),
      longitude: z.coerce.number().min(-180).max(180),
    }),
  },
  products: {
    table: "products",
    fields: ["name", "unit", "weight_kg", "total_stock", "active"],
    schema: z.object({
      name: z.string().trim().min(1).max(160),
      unit: z.string().trim().min(1).max(100),
      weight_kg: z.coerce.number().nonnegative(),
      total_stock: z.coerce.number().nonnegative().optional(),
      active: z.boolean().optional(),
    }),
  },
  vehicles: {
    table: "vehicles",
    fields: ["plate", "vehicle_type", "capacity_kg", "average_speed_kmh", "fuel_efficiency_km_l", "available"],
    schema: z.object({
      plate: z.string().trim().min(1).max(30),
      vehicle_type: z.string().trim().min(1).max(100),
      capacity_kg: z.coerce.number().positive(),
      average_speed_kmh: z.coerce.number().positive(),
      fuel_efficiency_km_l: z.coerce.number().positive(),
      available: z.boolean().optional(),
    }),
  },
} as const

catalogRouter.get("/catalog/:resource", requireRole("Despachador", "Administrador"), async (req, res) => {
  const resource = req.params.resource as keyof typeof catalogs | "parameters"
  if (resource === "parameters") {
    const result = await pool.query("SELECT * FROM global_parameters WHERE singleton=true")
    res.json({ data: result.rows[0] ?? null })
    return
  }
  const catalog = catalogs[resource]
  if (!catalog) throw new HttpError(404, "Catálogo desconocido")
  const result = await pool.query(`SELECT * FROM ${catalog.table} ORDER BY 1`)
  res.json({ data: result.rows })
})

catalogRouter.post("/admin/catalog/:resource", requireRole("Administrador"), async (req, res) => {
  const catalog = catalogs[req.params.resource as keyof typeof catalogs]
  if (!catalog) throw new HttpError(404, "Catálogo desconocido")
  const body = catalog.schema.parse(req.body)
  const fields = catalog.fields.filter((field) => Object.hasOwn(body, field))
  const values = fields.map((field) => body[field as keyof typeof body])
  const placeholders = fields.map((_, index) => `$${index + 1}`)
  const result = await pool.query(
    `INSERT INTO ${catalog.table}(${fields.join(",")}) VALUES(${placeholders.join(",")}) RETURNING *`,
    values,
  )
  res.status(201).json({ data: result.rows[0] })
})

catalogRouter.put("/admin/catalog/:resource/:id", requireRole("Administrador"), async (req, res) => {
  const { id } = idParamSchema.parse(req.params)
  const catalog = catalogs[req.params.resource as keyof typeof catalogs]
  if (!catalog) throw new HttpError(404, "Catálogo desconocido")
  const body = catalog.schema.partial().parse(req.body)
  const fields = catalog.fields.filter((field) => Object.hasOwn(body, field))
  if (!fields.length) throw new HttpError(400, "No se indicaron campos para actualizar")
  if (req.params.resource === "vehicles" && "available" in body && body.available === true) {
    const activeRoute = await pool.query(
      "SELECT 1 FROM routes WHERE vehicle_id=$1 AND status IN ('Asignada','En ruta') LIMIT 1",
      [id],
    )
    if (activeRoute.rowCount) {
      throw new HttpError(409, "No se puede marcar disponible un vehículo asignado a un reparto activo")
    }
  }
  const values = fields.map((field) => body[field as keyof typeof body])
  const assignments = fields.map((field, index) => `${field}=$${index + 1}`)
  assignments.push("updated_at=now()")
  const result = await pool.query(
    `UPDATE ${catalog.table} SET ${assignments.join(",")} WHERE id=$${fields.length + 1} RETURNING *`,
    [...values, id],
  )
  if (!result.rowCount) throw new HttpError(404, "Registro no encontrado")
  res.json({ data: result.rows[0] })
})

catalogRouter.put("/admin/parameters", requireRole("Administrador"), async (req, res) => {
  const body = z.object({
    warehouseLatitude: z.number().min(-90).max(90),
    warehouseLongitude: z.number().min(-180).max(180),
    fuelPrice: z.number().positive(),
    minutesPerStop: z.number().int().nonnegative(),
  }).parse(req.body)
  const result = await pool.query(
    `INSERT INTO global_parameters(singleton,warehouse_latitude,warehouse_longitude,fuel_price,minutes_per_stop,updated_by)
     VALUES(true,$1,$2,$3,$4,$5)
     ON CONFLICT(singleton) DO UPDATE SET warehouse_latitude=EXCLUDED.warehouse_latitude,
       warehouse_longitude=EXCLUDED.warehouse_longitude,fuel_price=EXCLUDED.fuel_price,
       minutes_per_stop=EXCLUDED.minutes_per_stop,updated_by=EXCLUDED.updated_by,updated_at=now()
     RETURNING *`,
    [body.warehouseLatitude, body.warehouseLongitude, body.fuelPrice, body.minutesPerStop, req.user!.id],
  )
  res.json({ data: result.rows[0] })
})

catalogRouter.get("/admin/users", requireRole("Administrador"), async (_req, res) => {
  const result = await pool.query(
    "SELECT id,email,display_name,role,active,created_at FROM profiles ORDER BY display_name",
  )
  res.json({ users: result.rows })
})

catalogRouter.post("/admin/demo-data", requireRole("Administrador"), async (req, res) => {
  await inTransaction(async (client) => {
    await loadDemoData(client)
    await client.query(
      "INSERT INTO audit_events(message,actor_id) VALUES($1,$2)",
      ["Se cargaron los registros demostrativos faltantes.", req.user!.id],
    )
  })
  res.json({ loaded: true })
})

catalogRouter.post("/admin/users", requireRole("Administrador"), async (req, res) => {
  const body = z.object({
    email: z.email().transform((email) => email.toLowerCase()),
    password: z.string().min(10).max(128),
    name: z.string().trim().min(1).max(160),
    role: z.enum(["Despachador", "Chofer", "Administrador"]),
  }).parse(req.body)
  const passwordHash = await hashPassword(body.password)
  const result = await pool.query(
    `INSERT INTO profiles(email,password_hash,display_name,role)
     VALUES($1,$2,$3,$4) RETURNING id,email,display_name,role,active,created_at`,
    [body.email, passwordHash, body.name, body.role],
  )
  res.status(201).json({ user: result.rows[0] })
})

catalogRouter.put("/admin/users/:id", requireRole("Administrador"), async (req, res) => {
  const { id } = idParamSchema.parse(req.params)
  const body = z.object({
    name: z.string().trim().min(1).max(160).optional(),
    role: z.enum(["Despachador", "Chofer", "Administrador"]).optional(),
    active: z.boolean().optional(),
    password: z.string().min(10).max(128).optional(),
  }).refine((value) => Object.keys(value).length > 0, "Indica qué datos deseas actualizar").parse(req.body)
  if (id === req.user!.id && (body.active === false || (body.role !== undefined && body.role !== req.user!.role))) {
    throw new HttpError(409, "No puedes desactivar ni cambiar el rol de tu propia cuenta")
  }
  const updates: string[] = []
  const values: unknown[] = []
  if (body.name !== undefined) {
    values.push(body.name)
    updates.push(`display_name=$${values.length}`)
  }
  if (body.role !== undefined) {
    values.push(body.role)
    updates.push(`role=$${values.length}`)
  }
  if (body.active !== undefined) {
    values.push(body.active)
    updates.push(`active=$${values.length}`)
  }
  if (body.password !== undefined) {
    values.push(await hashPassword(body.password))
    updates.push(`password_hash=$${values.length}`)
  }
  values.push(id)
  const result = await pool.query(
    `UPDATE profiles SET ${updates.join(",")} WHERE id=$${values.length}
     RETURNING id,email,display_name,role,active,created_at`,
    values,
  )
  if (!result.rowCount) throw new HttpError(404, "Usuario no encontrado")
  res.json({ user: result.rows[0] })
})

catalogRouter.post("/inventory/:productId/movements", requireRole("Despachador", "Administrador"), async (req, res) => {
  const productId = uuidSchema.parse(req.params.productId)
  const body = z.object({
    quantity: z.number().finite(),
    type: z.enum(["Entrada", "Ajuste"]),
    reason: z.string().trim().min(1).max(500),
  }).parse(req.body)
  if (body.type === "Entrada" && body.quantity <= 0) {
    throw new HttpError(400, "Una entrada debe ser positiva")
  }
  const result = await pool.connect()
  try {
    await result.query("BEGIN")
    const product = await result.query(
      "SELECT total_stock,reserved_stock FROM products WHERE id=$1 FOR UPDATE",
      [productId],
    )
    if (!product.rowCount) throw new HttpError(404, "Producto no encontrado")
    const totalStock = Number(product.rows[0].total_stock) + body.quantity
    if (!canAdjustStock(Number(product.rows[0].total_stock), Number(product.rows[0].reserved_stock), body.quantity)) {
      throw new HttpError(409, "El ajuste dejaría stock negativo o menor que las reservas")
    }
    await result.query("UPDATE products SET total_stock=$2,updated_at=now() WHERE id=$1", [productId, totalStock])
    await result.query(
      "INSERT INTO inventory_movements(product_id,movement_type,quantity,reason,actor_id) VALUES($1,$2,$3,$4,$5)",
      [productId, body.type, body.quantity, body.reason, req.user!.id],
    )
    await result.query("COMMIT")
    res.json({ totalStock })
  } catch (error) {
    await result.query("ROLLBACK")
    throw error
  } finally {
    result.release()
  }
})

catalogRouter.get("/indicators", requireRole("Administrador"), async (_req, res) => {
  const result = await pool.query("SELECT * FROM route_indicators ORDER BY closed_at DESC")
  res.json({ indicators: result.rows })
})

catalogRouter.get("/admin/events", requireRole("Administrador"), async (req, res) => {
  const { limit = 100 } = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
  }).parse(req.query)
  const result = await pool.query(
    `SELECT e.id,e.message,e.created_at,p.display_name AS user,p.role
     FROM audit_events e JOIN profiles p ON p.id=e.actor_id
     ORDER BY e.created_at DESC LIMIT $1`,
    [limit],
  )
  res.json({ events: result.rows })
})
