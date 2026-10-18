import { Router } from "express"
import rateLimit from "express-rate-limit"
import { pool } from "../db/pool.js"
import { HttpError } from "../http/errors.js"
import { z } from "zod"
import { getPortalStep, mapPublicTrackingStatus } from "./public-tracking.js"

export const publicRouter = Router()

publicRouter.get("/health", async (_req, res) => {
  await pool.query("SELECT 1")
  res.json({ status: "ok", service: "codimac", timestamp: new Date().toISOString() })
})

publicRouter.get(
  "/api/tracking/:token",
  rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Demasiadas consultas. Intenta nuevamente en un minuto.",
          fields: [],
        },
      })
    },
  }),
  async (req, res) => {
    const parsedToken = z.uuid().safeParse(req.params.token)
    if (!parsedToken.success) {
      throw new HttpError(400, "El código privado de seguimiento tiene un formato inválido")
    }
    const reference = parsedToken.data
    const result = await pool.query(
      `SELECT o.codigo AS code,
        o.status AS order_status,
        s.sequence_number AS position,
        s.status AS stop_status,
        (SELECT count(*)::int FROM route_stops rs WHERE rs.route_id=s.route_id) AS total_stops,
        s.eta_at
       FROM orders o LEFT JOIN route_stops s ON s.order_id=o.id
       LEFT JOIN routes r ON r.id=s.route_id
       WHERE o.tracking_token=$1
       ORDER BY r.created_at DESC NULLS LAST,s.sequence_number DESC NULLS LAST LIMIT 1`,
      [reference],
    )
    if (!result.rowCount) throw new HttpError(404, "No encontramos un pedido asociado a ese código privado")
    const order = result.rows[0]
    const publicStatus = mapPublicTrackingStatus(order.order_status, order.stop_status)
    const tracking = {
      code: order.code,
      public_status: publicStatus,
      current_step: getPortalStep(publicStatus),
      stop_status: order.stop_status,
      ...(publicStatus === "En camino" && {
        position: order.position,
        total_stops: order.total_stops,
        eta_at: order.eta_at,
      }),
    }
    res.json({ tracking })
  },
)
