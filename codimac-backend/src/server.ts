import { app } from "./app.js"
import { config } from "./config.js"
import { pool } from "./db/pool.js"

const server = app.listen(config.PORT, () => {
  console.log(`CODIMAC API escuchando en http://localhost:${config.PORT}`)
})

async function shutdown(signal: string) {
  console.log(`Cerrando servidor (${signal})`)
  server.close(async (error) => {
    if (error) {
      console.error("No se pudo cerrar el servidor correctamente:", error)
      process.exitCode = 1
    }
    await pool.end()
  })
}

process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))
