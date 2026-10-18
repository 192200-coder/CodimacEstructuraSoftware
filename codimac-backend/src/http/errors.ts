import type { ErrorRequestHandler } from "express"
import { ZodError } from "zod"
import { ApplicationError } from "../application/errors.js"

export interface ErrorField {
  field: string
  code: string
  message: string
}

function errorCodeForStatus(status: number): string {
  if (status === 401) return "UNAUTHENTICATED"
  if (status === 403) return "FORBIDDEN"
  if (status === 404) return "NOT_FOUND"
  if (status === 409) return "CONFLICT"
  if (status === 400 || status === 422) return "VALIDATION_ERROR"
  return "INTERNAL_ERROR"
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = errorCodeForStatus(status),
    readonly fields: ErrorField[] = [],
  ) {
    super(message)
  }
}

function fieldName(path: PropertyKey[]): string {
  if (path[0] === "items") {
    const [, ...parts] = path
    return `lineas${parts.map((part) => typeof part === "number" ? `[${part}]` : `.${String(part)}`).join("")}`
  }
  return path.reduce<string>((field, part) =>
    typeof part === "number" ? `${field}[${part}]` : field ? `${field}.${String(part)}` : String(part), "")
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ApplicationError) {
    const status = error.code === "NOT_FOUND"
      ? 404
      : error.code === "CONFLICT"
        ? 409
        : error.code === "UNAUTHENTICATED"
          ? 401
          : error.fields.some((field) => field.code === "STOCK_INSUFICIENTE")
            ? 422
            : 400
    res.status(status).json({
      error: {
        code: error.code,
        message: error.message,
        fields: error.fields,
      },
    })
    return
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        fields: error.fields,
      },
    })
    return
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Revisa los campos marcados.",
        fields: error.issues.map((issue) => ({
          field: fieldName(issue.path),
          code: issue.code.toUpperCase(),
          message: issue.message,
        })),
      },
    })
    return
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code)
    if (code === "23505") {
      res.status(409).json({
        error: {
          code: "CONFLICT",
          message: "Ya existe un registro con esos datos.",
          fields: [],
        },
      })
      return
    }
    if (code === "23503" || code === "23514" || code === "22P02") {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Los datos no cumplen las relaciones o restricciones requeridas.",
          fields: [],
        },
      })
      return
    }
  }
  console.error("Error interno de CODIMAC:", error)
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Error interno del servicio.",
      fields: [],
    },
  })
}
