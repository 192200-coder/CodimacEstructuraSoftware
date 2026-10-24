import type { PoolClient } from "pg"
import { describe, expect, it } from "vitest"
import { demoOrders, demoProducts, loadDemoData, resetDemoData, resettableTables } from "./demo-data.js"

/**
 * Base en memoria que entiende solo las sentencias de la carga de ejemplo y verifica en cada
 * cambio las mismas restricciones de stock que PostgreSQL (CHECK de products).
 */
function fakeDatabase() {
  let nextId = 0
  const id = () => `id-${++nextId}`
  const profiles = new Map<string, string>()
  const products = new Map<string, { id: string; name: string; total: number; reserved: number }>()
  const vehicles = new Map<string, string>()
  const orders = new Map<string, { code: string; status: string }>()
  const movements: Array<{ productId: string; type: string; quantity: number }> = []
  const audit: string[] = []
  const reservations = new Set<string>()
  const statements: string[] = []
  let orderSequence = 0
  let routeSequence = 0

  const productById = (productId: unknown) => {
    const product = [...products.values()].find((item) => item.id === productId)
    if (!product) throw new Error(`Producto inexistente ${String(productId)}`)
    return product
  }
  const checkStock = (product: { name: string; total: number; reserved: number }) => {
    if (product.total < 0 || product.reserved < 0 || product.reserved > product.total) {
      throw new Error(`Stock inválido en ${product.name}: ${product.total}/${product.reserved}`)
    }
  }
  const result = (rows: Record<string, unknown>[] = []) => ({ rows, rowCount: rows.length })

  const client = {
    async query(sql: string, values: unknown[] = []) {
      statements.push(sql)
      if (sql.startsWith("TRUNCATE")) {
        products.clear()
        vehicles.clear()
        orders.clear()
        reservations.clear()
        movements.length = 0
        return result()
      }
      if (sql.includes("setval('order_code_seq'")) { orderSequence = 0; return result() }
      if (sql.includes("setval('route_code_seq'")) { routeSequence = 0; return result() }
      if (sql.includes("INSERT INTO profiles")) {
        const email = values[0] as string
        if (!profiles.has(email)) profiles.set(email, id())
        return result([{ id: profiles.get(email) }])
      }
      if (sql.includes("INSERT INTO products")) {
        const name = values[0] as string
        if (products.has(name)) return result()
        const product = { id: id(), name, total: Number(values[3]), reserved: 0 }
        products.set(name, product)
        return result([{ id: product.id }])
      }
      if (sql.startsWith("SELECT id FROM products WHERE name")) return result([{ id: products.get(values[0] as string)?.id }])
      if (sql.includes("INSERT INTO vehicles")) {
        if (!vehicles.has(values[0] as string)) vehicles.set(values[0] as string, id())
        return result()
      }
      if (sql.startsWith("SELECT id FROM vehicles")) return result([{ id: vehicles.get(values[0] as string) }])
      if (sql.startsWith("SELECT 1 FROM orders")) return orders.has(values[0] as string) ? result([{}]) : result()
      if (sql.includes("nextval('order_code_seq')")) return result([{ value: ++orderSequence }])
      if (sql.includes("nextval('route_code_seq')")) return result([{ value: ++routeSequence }])
      if (sql.includes("INSERT INTO orders")) {
        orders.set(values[0] as string, { code: values[1] as string, status: "Pendiente" })
        return result()
      }
      if (sql.startsWith("SELECT total_stock,reserved_stock FROM products")) {
        const product = productById(values[0])
        return result([{ total_stock: product.total, reserved_stock: product.reserved }])
      }
      if (sql.startsWith("UPDATE products")) {
        const product = productById(values[0])
        const quantity = Number(values[1])
        if (sql.includes("total_stock=total_stock-$2")) product.total -= quantity
        if (sql.includes("total_stock=total_stock+$2")) product.total += quantity
        if (sql.includes("reserved_stock=reserved_stock+$2")) product.reserved += quantity
        if (sql.includes("reserved_stock=reserved_stock-$2")) product.reserved -= quantity
        checkStock(product)
        return result()
      }
      if (sql.startsWith("UPDATE orders SET status=")) {
        const order = orders.get(values[0] as string)!
        order.status = /status='([^']+)'/.exec(sql)![1]!
        return result()
      }
      if (sql.includes("INSERT INTO stock_reservations")) {
        // UNIQUE (order_id, product_id), igual que en 001_codimac.sql.
        const key = `${String(values[0])}|${String(values[1])}`
        if (reservations.has(key)) throw new Error(`Reserva duplicada ${key}`)
        reservations.add(key)
        return result()
      }
      if (sql.includes("INSERT INTO inventory_movements")) {
        movements.push({ productId: values[0] as string, type: values[1] as string, quantity: Number(values[2]) })
        return result()
      }
      if (sql.includes("INSERT INTO auditoria_eventos")) {
        audit.push(values[1] as string)
        return result()
      }
      return result()
    },
  }
  return { client: client as unknown as Pick<PoolClient, "query">, products, orders, movements, audit, statements, profiles }
}

const hash = async (password: string) => `hash:${password}`

describe("datos de ejemplo", () => {
  it("deja el inventario del documento: 85 bolsas de cemento disponibles (E-02, E-03)", async () => {
    const db = fakeDatabase()
    await loadDemoData(db.client, hash, { now: new Date("2026-10-23T15:00:00Z") })

    const stock = (key: keyof typeof demoProducts) => db.products.get(demoProducts[key].name)!
    expect(stock("cemento")).toMatchObject({ total: 200, reserved: 115 })
    expect(stock("fierro")).toMatchObject({ total: 500, reserved: 120 })
    expect(stock("ladrillo")).toMatchObject({ total: 8000, reserved: 2000 })
  })

  it("crea pedidos en cada estado con códigos PED-NNNN consecutivos", async () => {
    const db = fakeDatabase()
    await loadDemoData(db.client, hash)

    const statuses = [...db.orders.values()].map((order) => order.status)
    for (const status of ["Pendiente", "En preparación", "Listo", "Entregado", "Cancelado"]) {
      expect(statuses, status).toContain(status)
    }
    expect([...db.orders.values()].map((order) => order.code))
      .toEqual(demoOrders.map((_order, index) => `PED-${String(index + 1).padStart(4, "0")}`))
  })

  it("registra un movimiento por entrada, reserva, liberación y salida (RF-01.17)", async () => {
    const db = fakeDatabase()
    await loadDemoData(db.client, hash)

    const types = new Set(db.movements.map((movement) => movement.type))
    expect(types).toEqual(new Set(["ENTRADA", "RESERVA", "LIBERACION", "SALIDA"]))
  })

  it("es idempotente: una segunda carga no duplica pedidos ni altera el stock", async () => {
    const db = fakeDatabase()
    await loadDemoData(db.client, hash)
    const before = JSON.stringify([...db.products.values()])
    const summary = await loadDemoData(db.client, hash)

    expect(summary.operationalDataLoaded).toBe(false)
    expect(db.orders.size).toBe(demoOrders.length)
    expect(JSON.stringify([...db.products.values()])).toBe(before)
  })

  it("funciona sobre una base con productos propios: repone lo que falte antes de reservar", async () => {
    const db = fakeDatabase()
    await db.client.query("INSERT INTO products(name,unit,weight_kg,total_stock) VALUES($1,$2,$3,$4)", [
      demoProducts.cemento.name, "Bolsa", 42.5, 10,
    ])
    await loadDemoData(db.client, hash)

    const cemento = db.products.get(demoProducts.cemento.name)!
    expect(cemento.reserved).toBe(115)
    expect(cemento.total).toBeGreaterThanOrEqual(cemento.reserved)
  })

  it("restablecer vacía datos operativos, reinicia los códigos y conserva usuarios y auditoría (M-05)", async () => {
    const db = fakeDatabase()
    await loadDemoData(db.client, hash)
    await resetDemoData(db.client, hash, { actorId: "admin" })

    const truncate = db.statements.find((sql) => sql.startsWith("TRUNCATE"))!
    for (const table of resettableTables) expect(truncate).toContain(table)
    expect(truncate).not.toMatch(/profiles|auditoria_eventos/)
    expect([...db.orders.values()][0]?.code).toBe("PED-0001")
    expect(db.products.get(demoProducts.cemento.name)).toMatchObject({ total: 200, reserved: 115 })
    expect(db.audit).toEqual(["Carga de datos de ejemplo", "Restablecimiento de datos de ejemplo"])
  })
})
