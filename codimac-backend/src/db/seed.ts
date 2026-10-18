import { pool } from "./pool.js"
import { loadDemoData } from "./demo-data.js"

try {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await loadDemoData(client)
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
  console.log("Datos demostrativos cargados.")
} finally {
  await pool.end()
}
