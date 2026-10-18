import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("../db/pool.js", () => ({ pool: {}, inTransaction: vi.fn() }))

const { buildCatalogUpdate, catalogFields } = await import("./postgres-catalog-repository.js")

const srcDir = join(import.meta.dirname, "..")
const migrationsDir = join(srcDir, "db", "migrations")

function loadSchema(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>()
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8").replace(/--.*$/gm, "")
    for (const statement of sql.split(";")) {
      const create = /CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(([\s\S]*)\)/i.exec(statement)
      if (create) {
        const columns = new Set<string>()
        for (const line of (create[2] ?? "").split("\n")) {
          const column = /^\s*(\w+)\s+\w+/.exec(line)?.[1]
          if (column && !/^(PRIMARY|UNIQUE|CHECK|CONSTRAINT|FOREIGN)$/i.test(column)) {
            columns.add(column)
          }
        }
        tables.set(create[1] ?? "", columns)
        continue
      }
      const alter = /ALTER TABLE (\w+)/i.exec(statement)
      if (!alter) continue
      const columns = tables.get(alter[1] ?? "")
      if (!columns) continue
      for (const add of statement.matchAll(/ADD COLUMN (?:IF NOT EXISTS )?(\w+)/gi)) {
        columns.add(add[1] ?? "")
      }
      for (const rename of statement.matchAll(/RENAME COLUMN (\w+) TO (\w+)/gi)) {
        columns.delete(rename[1] ?? "")
        columns.add(rename[2] ?? "")
      }
      for (const drop of statement.matchAll(/DROP COLUMN (?:IF EXISTS )?(\w+)/gi)) {
        columns.delete(drop[1] ?? "")
      }
    }
  }
  return tables
}

const sources = [
  join(srcDir, "adapters", "postgres-authentication-repository.ts"),
  join(srcDir, "adapters", "postgres-catalog-repository.ts"),
  join(srcDir, "adapters", "postgres-order-repository.ts"),
  join(srcDir, "adapters", "postgres-route-repository.ts"),
  join(srcDir, "adapters", "postgres-registro-auditoria.ts"),
  join(srcDir, "db", "demo-data.ts"),
]

describe("alineación esquema SQL vs adaptadores", () => {
  const schema = loadSchema()

  it("las tablas de catálogo tienen created_at y updated_at", () => {
    for (const table of ["clients", "products", "vehicles", "profiles"]) {
      expect(schema.has(table), table).toBe(true)
      expect(schema.get(table)?.has("created_at"), `${table}.created_at`).toBe(true)
      expect(schema.get(table)?.has("updated_at"), `${table}.updated_at`).toBe(true)
    }
  })

  it("los campos editables del catálogo existen en su tabla", () => {
    for (const [resource, fields] of Object.entries(catalogFields)) {
      for (const field of fields) {
        expect(schema.get(resource)?.has(field), `${resource}.${field}`).toBe(true)
      }
    }
  })

  it("el UPDATE dinámico de catálogo solo usa columnas existentes", () => {
    for (const resource of ["clients", "products", "vehicles"] as const) {
      const body = Object.fromEntries(catalogFields[resource].map((f) => [f, 1]))
      const update = buildCatalogUpdate(resource, { ...body, intruso: 1 })
      expect(update?.fields).toEqual([...catalogFields[resource]])
      const set = /SET (.*) WHERE/.exec(update?.text ?? "")?.[1] ?? ""
      for (const column of set.matchAll(/(\w+)=/g)) {
        const name = column[1] ?? ""
        expect(schema.get(resource)?.has(name), `${resource}.${name}`).toBe(true)
      }
    }
    expect(buildCatalogUpdate("vehicles", { intruso: 1 })).toBeNull()
  })

  it("los INSERT/UPDATE estáticos solo referencian columnas existentes", () => {
    const problems: string[] = []
    for (const file of sources) {
      const code = readFileSync(file, "utf8")
      for (const match of code.matchAll(/INSERT INTO (\w+)\s*\(([^)]*)\)/g)) {
        const table = match[1] ?? ""
        const columns = schema.get(table)
        for (const column of (match[2] ?? "").split(",").map((c) => c.trim()).filter(Boolean)) {
          if (!columns?.has(column)) problems.push(`${file}: INSERT ${table}.${column}`)
        }
      }
      for (const match of code.matchAll(/UPDATE (\w+) SET ([^`"]*?) (?:WHERE|RETURNING)/g)) {
        const table = match[1] ?? ""
        const columns = schema.get(table)
        for (const column of (match[2] ?? "").matchAll(/(?:^|,)\s*(\w+)\s*=/g)) {
          const name = column[1] ?? ""
          if (!columns?.has(name)) problems.push(`${file}: UPDATE ${table}.${name}`)
        }
      }
    }
    expect(problems).toEqual([])
  })
})
