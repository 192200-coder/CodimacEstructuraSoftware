import { Router } from "express"
import rateLimit from "express-rate-limit"
import { pool } from "../db/pool.js"
import { HttpError } from "../http/errors.js"
import { z } from "zod"

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
    message: { error: "Demasiadas consultas. Intenta nuevamente en un minuto." },
  }),
  async (req, res) => {
    const parsedToken = z.uuid().safeParse(req.params.token)
    if (!parsedToken.success) {
      throw new HttpError(400, "El código privado de seguimiento tiene un formato inválido")
    }
    const reference = parsedToken.data
    const result = await pool.query(
      `SELECT o.code,
        CASE WHEN s.status='No entregada' THEN 'No entregada'
             WHEN s.status='Incidencia' THEN 'Reprogramado'
             WHEN o.status IN ('Pendiente','En preparación','Listo') THEN 'Registrado'
             WHEN o.status='En ruta' THEN 'En camino'
             WHEN o.status='Entregado' THEN 'Entregado' ELSE 'Registrado' END AS public_status,
        CASE WHEN s.status='No entregada' THEN NULL ELSE s.sequence_number END AS position,
        s.status AS stop_status,
        CASE WHEN s.status='No entregada' THEN 0
             ELSE (SELECT count(*)::int FROM route_stops rs WHERE rs.route_id=s.route_id) END AS total_stops,
        CASE WHEN s.status='No entregada' THEN NULL ELSE s.eta_at END AS eta_at
       FROM orders o LEFT JOIN route_stops s ON s.order_id=o.id
       LEFT JOIN routes r ON r.id=s.route_id
       WHERE o.tracking_token=$1
       ORDER BY r.created_at DESC NULLS LAST,s.sequence_number DESC NULLS LAST LIMIT 1`,
      [reference],
    )
    if (!result.rowCount) throw new HttpError(404, "No encontramos un pedido asociado a ese código privado")
    res.json({ tracking: result.rows[0] })
  },
)
