import type { NextFunction, Request, Response } from "express"
import { logger, type Logger } from "./logger.js"

/** RNF-07: con FORCE_HTTPS, rechaza las peticiones que llegan por HTTP (salvo /health). */
export function requireHttps(enabled: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!enabled || req.secure || req.path === "/health") {
      next()
      return
    }
    res.status(403).json({
      error: { code: "HTTPS_REQUIRED", message: "Usa una conexión segura (HTTPS).", fields: [] },
    })
  }
}

/** RNF-16: una línea JSON por petición con método, ruta, estado, duración y usuario. */
export function createRequestLog(log: Logger = logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint()
    res.on("finish", () => {
      if (req.path === "/health") return
      const data = {
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
        userId: req.user?.id ?? null,
      }
      if (res.statusCode >= 500) log.error("http.request", data)
      else if (res.statusCode >= 400) log.warn("http.request", data)
      else log.info("http.request", data)
    })
    next()
  }
}

export const requestLog = createRequestLog()
