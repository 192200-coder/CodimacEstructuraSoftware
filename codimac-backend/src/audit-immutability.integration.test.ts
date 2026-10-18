import { readFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import pg from "pg"

const databaseUrl = process.env.AUDIT_TEST_DATABASE_URL

describe.skipIf(!databaseUrl)("inmutabilidad PostgreSQL de auditoria_eventos", () => {
  it("rechaza UPDATE y DELETE mediante el trigger de la migración 003", async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl })
    const client = await pool.connect()
    const schema = `audit_test_${randomUUID().replaceAll("-", "")}`
    try {
      await client.query("BEGIN")
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query(`SET LOCAL search_path TO "${schema}"`)
      await client.query("CREATE TABLE profiles (id uuid PRIMARY KEY)")
      const migration = await readFile(
        new URL("./db/migrations/003_immutable_audit.sql", import.meta.url),
        "utf8",
      )
      await client.query(migration)
      const actorId = "90000000-0000-4000-8000-000000000001"
      const eventId = "a0000000-0000-4000-8000-000000000001"
      await client.query("INSERT INTO profiles(id) VALUES($1)", [actorId])
      await client.query(
        `INSERT INTO auditoria_eventos(id,usuario_id,accion,entidad)
         VALUES($1,$2,'Alta de prueba','Prueba')`,
        [eventId, actorId],
      )

      for (const statement of [
        "UPDATE auditoria_eventos SET accion='Alterado' WHERE id=$1",
        "DELETE FROM auditoria_eventos WHERE id=$1",
      ]) {
        await client.query("SAVEPOINT immutable_attempt")
        let failure: unknown
        try {
          await client.query(statement, [eventId])
        } catch (error) {
          failure = error
        }
        expect(failure).toMatchObject({ code: "55000" })
        await client.query("ROLLBACK TO SAVEPOINT immutable_attempt")
      }

      const remaining = await client.query(
        "SELECT accion FROM auditoria_eventos WHERE id=$1",
        [eventId],
      )
      expect(remaining.rows).toEqual([{ accion: "Alta de prueba" }])
      await client.query("ROLLBACK")
    } finally {
      client.release()
      await pool.end()
    }
  })
})
