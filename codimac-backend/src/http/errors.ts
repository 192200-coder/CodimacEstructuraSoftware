import type { ErrorRequestHandler } from "express"
import { ZodError } from "zod"

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message })
    return
  }
  if (error instanceof ZodError) {
    res.status(400).json({ error: "Solicitud inválida", details: error.issues })
    return
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code)
    if (code === "23505") {
      res.status(409).json({ error: "Ya existe un registro con esos datos" })
      return
    }
    if (code === "23503" || code === "23514" || code === "22P02") {
      res.status(400).json({ error: "Los datos no cumplen las relaciones o restricciones requeridas" })
      return
    }
  }
  console.error("Error interno de CODIMAC:", error)
  res.status(500).json({ error: "Error interno del servicio" })
}
