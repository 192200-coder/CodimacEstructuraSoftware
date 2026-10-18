import { Router } from "express"
import rateLimit from "express-rate-limit"
import { pool } from "../db/pool.js"
import { HttpError } from "../http/errors.js"
import {
  getPortalStep,
  mapPublicTrackingStatus,
  publicTrackingCredentialsSchema,
} from "./public-tracking.js"

export const publicRouter = Router()
const trackingRateLimit = rateLimit({
  windowMs: 10 * 60_000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Demasiados intentos. Prueba de nuevo en 10 minutos.",
        fields: [],
      },
    })
  },
})

const trackingNotFound = () =>
  new HttpError(404, "No encontramos un pedido con esos datos.")

publicRouter.get("/health", async (_req, res) => {
  await pool.query("SELECT 1")
  res.json({ status: "ok", service: "codimac", timestamp: new Date().toISOString() })
})

publicRouter.post(
  "/api/tracking",
  trackingRateLimit,
  async (req, res) => {
    const parsedCredentials = publicTrackingCredentialsSchema.safeParse(req.body)
    if (!parsedCredentials.success) throw trackingNotFound()
    const { codigo, ultimos4 } = parsedCredentials.data
    const result = await pool.query(
      `SELECT o.codigo AS code,
        o.status AS order_status,
        s.sequence_number AS position,
        s.status AS stop_status,
        (SELECT count(*)::int FROM route_stops rs WHERE rs.route_id=s.route_id) AS total_stops,
        s.eta_at
       FROM orders o
       JOIN clients c ON c.id=o.client_id
       LEFT JOIN route_stops s ON s.order_id=o.id
       LEFT JOIN routes r ON r.id=s.route_id
       WHERE o.codigo=$1
         AND right(regexp_replace(COALESCE(c.contact,''), '[^0-9]', '', 'g'),4)=$2
       ORDER BY r.created_at DESC NULLS LAST,s.sequence_number DESC NULLS LAST LIMIT 1`,
      [codigo, ultimos4],
    )
    if (!result.rowCount) throw trackingNotFound()
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
