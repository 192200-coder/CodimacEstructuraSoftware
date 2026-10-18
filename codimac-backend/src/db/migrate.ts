import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { pool } from "./pool.js"

const here = dirname(fileURLToPath(import.meta.url))
const directory = join(here, "migrations")
const client = await pool.connect()
try {
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    const applied = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file])
    if (applied.rowCount) continue
    await client.query("BEGIN")
    try {
      await client.query(await readFile(join(directory, file), "utf8"))
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file])
      await client.query("COMMIT")
      console.log(`Migración aplicada: ${file}`)
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    }
  }
} finally {
  client.release()
  await pool.end()
}
