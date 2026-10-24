import { app } from "./app.js"
import { codimacEnv, config } from "./config.js"
import { pool } from "./db/pool.js"
import { errorData, logger } from "./http/logger.js"

const server = app.listen(config.PORT, () => {
  logger.info("servidor.iniciado", {
    url: `http://localhost:${config.PORT}`,
    entorno: codimacEnv,
    proveedorMapas: config.GOOGLE_ROUTES_API_KEY ? "Google Routes" : "Estimador local",
    https: config.forceHttps,
  })
})

async function shutdown(signal: string) {
  logger.info("servidor.cerrando", { signal })
  server.close(async (error) => {
    if (error) {
      logger.error("servidor.cierre_fallido", errorData(error))
      process.exitCode = 1
    }
    await pool.end()
  })
}

process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))
