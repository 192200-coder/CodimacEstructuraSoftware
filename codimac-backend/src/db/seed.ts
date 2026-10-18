import { pool } from "./pool.js"
import { loadDemoData } from "./demo-data.js"
import { BcryptPasswordHasher } from "../adapters/bcrypt-password-hasher.js"

const passwordHasher = new BcryptPasswordHasher()

try {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await loadDemoData(client, (password) => passwordHasher.hash(password))
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
