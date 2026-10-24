import { pool } from "./pool.js"
import { loadDemoData, resetDemoData } from "./demo-data.js"
import { BcryptPasswordHasher } from "../adapters/bcrypt-password-hasher.js"

// pnpm seed            → agrega los datos de ejemplo que falten.
// pnpm seed -- --reset → borra pedidos, repartos, inventario y catálogos y recarga el ejemplo.
const reset = process.argv.includes("--reset")
const passwordHasher = new BcryptPasswordHasher()

try {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const hash = (password: string) => passwordHasher.hash(password)
    const summary = reset ? await resetDemoData(client, hash) : await loadDemoData(client, hash)
    await client.query("COMMIT")
    console.log(reset
      ? "Datos de ejemplo restablecidos."
      : summary.operationalDataLoaded
        ? "Datos de ejemplo cargados."
        : "Catálogos de ejemplo completados; los pedidos de ejemplo ya existían.")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
} finally {
  await pool.end()
}
