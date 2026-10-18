import { inTransaction, pool } from "../db/pool.js"
import type {
  AuditQuery,
  CatalogParametersInput,
  CatalogRecord,
  CatalogRepository,
  CatalogResource,
  CatalogRole,
  CatalogTransaction,
  CatalogUser,
  CatalogUserSnapshot,
  PasswordHasher,
} from "../application/catalog.js"
import type { RegistroAuditoria } from "../application/registro-auditoria.js"
import { loadDemoData } from "../db/demo-data.js"
import { PostgresRegistroAuditoria } from "./postgres-registro-auditoria.js"

const catalogFields: Record<CatalogResource, readonly string[]> = {
  clients: ["name", "contact", "address", "reference", "latitude", "longitude"],
  products: ["name", "unit", "weight_kg", "total_stock", "active"],
  vehicles: [
    "plate",
    "vehicle_type",
    "capacity_kg",
    "average_speed_kmh",
    "fuel_efficiency_km_l",
    "available",
  ],
}

class PostgresCatalogTransaction implements CatalogTransaction {
  readonly audit: RegistroAuditoria

  constructor(private readonly client: Parameters<Parameters<typeof inTransaction>[0]>[0]) {
    this.audit = new PostgresRegistroAuditoria((text, values) =>
      this.client.query(text, values),
    )
  }

  async lockParameters(): Promise<CatalogRecord | null> {
    const result = await this.client.query(
      "SELECT * FROM global_parameters WHERE singleton=true FOR UPDATE",
    )
    return result.rows[0] ?? null
  }

  async saveParameters(input: CatalogParametersInput, actorId: string): Promise<CatalogRecord> {
    const result = await this.client.query(
      `INSERT INTO global_parameters(singleton,warehouse_latitude,warehouse_longitude,fuel_price,minutes_per_stop,service_radius_km,updated_by)
       VALUES(true,$1,$2,$3,$4,$5,$6)
       ON CONFLICT(singleton) DO UPDATE SET warehouse_latitude=EXCLUDED.warehouse_latitude,
         warehouse_longitude=EXCLUDED.warehouse_longitude,fuel_price=EXCLUDED.fuel_price,
         minutes_per_stop=EXCLUDED.minutes_per_stop,service_radius_km=EXCLUDED.service_radius_km,
         updated_by=EXCLUDED.updated_by,updated_at=now()
       RETURNING *`,
      [
        input.warehouseLatitude,
        input.warehouseLongitude,
        input.fuelPrice,
        input.minutesPerStop,
        input.serviceRadiusKm,
        actorId,
      ],
    )
    return result.rows[0]
  }

  async insertUser(input: {
    email: string
    passwordHash: string
    name: string
    role: CatalogRole
  }): Promise<CatalogUser> {
    const result = await this.client.query(
      `INSERT INTO profiles(email,password_hash,display_name,role)
       VALUES($1,$2,$3,$4) RETURNING id,email,display_name,role,active,created_at`,
      [input.email, input.passwordHash, input.name, input.role],
    )
    return result.rows[0] as CatalogUser
  }

  async lockUser(userId: string): Promise<CatalogUserSnapshot | null> {
    const result = await this.client.query(
      "SELECT email,display_name,role,active FROM profiles WHERE id=$1 FOR UPDATE",
      [userId],
    )
    return result.rowCount ? result.rows[0] as CatalogUserSnapshot : null
  }

  async updateUser(userId: string, update: {
    name?: string
    role?: CatalogRole
    active?: boolean
    passwordHash?: string
  }): Promise<CatalogUser> {
    const values: unknown[] = []
    const assignments: string[] = []
    if (update.name !== undefined) {
      values.push(update.name)
      assignments.push(`display_name=$${values.length}`)
    }
    if (update.role !== undefined) {
      values.push(update.role)
      assignments.push(`role=$${values.length}`)
    }
    if (update.active !== undefined) {
      values.push(update.active)
      assignments.push(`active=$${values.length}`)
    }
    if (update.passwordHash !== undefined) {
      values.push(update.passwordHash)
      assignments.push(`password_hash=$${values.length}`)
    }
    values.push(userId)
    const result = await this.client.query(
      `UPDATE profiles SET ${assignments.join(",")} WHERE id=$${values.length}
       RETURNING id,email,display_name,role,active,created_at`,
      values,
    )
    return result.rows[0] as CatalogUser
  }

  async lockProductStock(
    productId: string,
  ): Promise<{ totalStock: number; reservedStock: number } | null> {
    const result = await this.client.query(
      "SELECT total_stock,reserved_stock FROM products WHERE id=$1 FOR UPDATE",
      [productId],
    )
    return result.rowCount
      ? {
          totalStock: Number(result.rows[0].total_stock),
          reservedStock: Number(result.rows[0].reserved_stock),
        }
      : null
  }

  async updateProductStock(productId: string, totalStock: number): Promise<void> {
    await this.client.query(
      "UPDATE products SET total_stock=$2,updated_at=now() WHERE id=$1",
      [productId, totalStock],
    )
  }

  async insertInventoryMovement(input: {
    productId: string
    movementType: "Entrada" | "Ajuste"
    quantity: number
    reason: string | null
    observation: string | null
    detail: string | null
    actorId: string
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO inventory_movements
         (product_id,movement_type,quantity,reason,observation,detail,actor_id)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.productId,
        input.movementType,
        input.quantity,
        input.reason,
        input.observation,
        input.detail,
        input.actorId,
      ],
    )
  }

  async hasActiveRouteForVehicle(vehicleId: string): Promise<boolean> {
    const result = await this.client.query(
      "SELECT 1 FROM routes WHERE vehicle_id=$1 AND status IN ('Asignada','En ruta') LIMIT 1",
      [vehicleId],
    )
    return Boolean(result.rowCount)
  }

  async updateCatalog(
    resource: CatalogResource,
    id: string,
    body: CatalogRecord,
  ): Promise<CatalogRecord | null> {
    const selectedFields = Object.keys(body).filter((field) =>
      catalogFields[resource].includes(field),
    )
    if (!selectedFields.length) return null
    const values = selectedFields.map((field) => body[field])
    const assignments = selectedFields.map((field, index) => `${field}=$${index + 1}`)
    assignments.push("updated_at=now()")
    const result = await this.client.query(
      `UPDATE ${resource} SET ${assignments.join(",")} WHERE id=$${selectedFields.length + 1} RETURNING *`,
      [...values, id],
    )
    return result.rowCount ? result.rows[0] : null
  }
}

export class PostgresCatalogRepository implements CatalogRepository {
  constructor(private readonly passwordHasher: PasswordHasher) {}

  async transaction<T>(operation: (tx: CatalogTransaction) => Promise<T>): Promise<T> {
    return inTransaction((client) => operation(new PostgresCatalogTransaction(client)))
  }

  async listCatalog(resource: CatalogResource): Promise<unknown[]> {
    const result = await pool.query(`SELECT * FROM ${resource} ORDER BY 1`)
    return result.rows
  }

  async getParameters(): Promise<unknown | null> {
    const result = await pool.query(
      "SELECT * FROM global_parameters WHERE singleton=true",
    )
    return result.rows[0] ?? null
  }

  async createCatalog(
    resource: CatalogResource,
    body: CatalogRecord,
  ): Promise<CatalogRecord> {
    const selectedFields = Object.keys(body).filter((field) =>
      catalogFields[resource].includes(field),
    )
    const values = selectedFields.map((field) => body[field])
    const placeholders = selectedFields.map((_, index) => `$${index + 1}`)
    const result = await pool.query(
      `INSERT INTO ${resource}(${selectedFields.join(",")}) VALUES(${placeholders.join(",")}) RETURNING *`,
      values,
    )
    return result.rows[0]
  }

  async listUsers(): Promise<CatalogUser[]> {
    const result = await pool.query(
      "SELECT id,email,display_name,role,active,created_at FROM profiles ORDER BY display_name",
    )
    return result.rows as CatalogUser[]
  }

  async loadDemoData(): Promise<void> {
    await inTransaction((client) =>
      loadDemoData(client, (password) => this.passwordHasher.hash(password)),
    )
  }

  async listIndicators(): Promise<unknown[]> {
    const result = await pool.query("SELECT * FROM route_indicators ORDER BY closed_at DESC")
    return result.rows
  }

  async listAudit(query: AuditQuery): Promise<{ events: unknown[]; total: number }> {
    const values: unknown[] = []
    const conditions: string[] = []
    const addFilter = (condition: (index: number) => string, value: unknown) => {
      values.push(value)
      conditions.push(condition(values.length))
    }
    if (query.desde) addFilter((index) => `e.fecha_hora >= $${index}::timestamptz`, query.desde)
    if (query.hasta) addFilter((index) => `e.fecha_hora <= $${index}::timestamptz`, query.hasta)
    if (query.usuario) {
      addFilter(
        (index) => `(p.display_name ILIKE $${index} OR p.email ILIKE $${index})`,
        `%${query.usuario}%`,
      )
    }
    if (query.entidad) addFilter((index) => `e.entidad = $${index}`, query.entidad)
    if (query.accion) addFilter((index) => `e.accion = $${index}`, query.accion)
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
    const count = await pool.query(
      `SELECT count(*)::int AS total FROM auditoria_eventos e
       LEFT JOIN profiles p ON p.id=e.usuario_id ${where}`,
      values,
    )
    const result = await pool.query(
      `SELECT e.id,e.fecha_hora,e.usuario_id,p.display_name AS usuario,p.email,
         e.accion,e.entidad,e.entidad_id,e.valor_anterior,e.valor_nuevo
       FROM auditoria_eventos e LEFT JOIN profiles p ON p.id=e.usuario_id
       ${where}
       ORDER BY e.fecha_hora DESC,e.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, query.limit, query.offset],
    )
    return { events: result.rows, total: Number(count.rows[0].total) }
  }

  async listLegacyEvents(limit: number): Promise<unknown[]> {
    const result = await pool.query(
      `SELECT e.id,e.message,e.created_at,p.display_name AS user,p.role
       FROM audit_events e JOIN profiles p ON p.id=e.actor_id
       ORDER BY e.created_at DESC LIMIT $1`,
      [limit],
    )
    return result.rows
  }
}
