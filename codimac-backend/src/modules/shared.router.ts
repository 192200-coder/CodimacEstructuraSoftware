import { Router } from "express"
import { z } from "zod"
import { pool } from "../db/pool.js"
import { authenticate, requireRole } from "../http/auth.js"
import { HttpError } from "../http/errors.js"

export const sharedRouter = Router()
sharedRouter.use(authenticate)

sharedRouter.get("/state", async (req, res) => {
  const result = await pool.query(
    "SELECT role, active_section AS active FROM user_preferences WHERE user_id = $1",
    [req.user!.id],
  )
  res.json({ preferences: result.rows[0] ?? null, role: req.user!.role })
})

sharedRouter.put("/preferences", async (req, res) => {
  const body = z.object({
    role: z.enum(["Despachador", "Chofer", "Administrador"]),
    active: z.string().trim().min(1).max(80),
  }).parse(req.body)
  if (body.role !== req.user!.role) throw new HttpError(403, "No puedes cambiar tu rol desde Preferencias")
  await pool.query(
    `INSERT INTO user_preferences(user_id,role,active_section) VALUES($1,$2,$3)
     ON CONFLICT(user_id) DO UPDATE SET role=EXCLUDED.role, active_section=EXCLUDED.active_section, updated_at=now()`,
    [req.user!.id, body.role, body.active],
  )
  res.json({ saved: true })
})

sharedRouter.get("/notifications", async (req, res) => {
  const result = await pool.query(
    `SELECT e.id,e.entity_type,e.new_status,e.created_at,
       r.codigo AS route_code,o.codigo AS order_code,c.name AS client_name
     FROM status_events e
     LEFT JOIN routes r ON r.id=COALESCE(e.route_id,CASE WHEN e.entity_type='Ruta' THEN e.entity_id END)
     LEFT JOIN route_stops s ON s.id=COALESCE(e.stop_id,CASE WHEN e.entity_type='Parada' THEN e.entity_id END)
     LEFT JOIN orders o ON o.id=CASE WHEN e.entity_type='Pedido' THEN e.entity_id ELSE s.order_id END
     LEFT JOIN clients c ON c.id=o.client_id
     WHERE $1::text IN ('Despachador','Administrador') OR r.driver_id=$2
     ORDER BY e.created_at DESC
     LIMIT 40`,
    [req.user!.role, req.user!.id],
  )
  res.json({ notifications: result.rows })
})

sharedRouter.get("/resources", requireRole("Despachador", "Administrador"), async (_req, res) => {
  const [drivers, vehicles] = await Promise.all([
    pool.query(
      `SELECT p.id,p.display_name,p.phone FROM profiles p
       WHERE p.role='Chofer' AND p.active=true AND p.available=true
         AND NOT EXISTS (
           SELECT 1 FROM routes r WHERE r.driver_id=p.id AND r.status IN ('Asignada','En curso')
         )
       ORDER BY p.display_name`,
    ),
    pool.query(
      `SELECT v.* FROM vehicles v
       WHERE v.available=true
         AND NOT EXISTS (
           SELECT 1 FROM routes r WHERE r.vehicle_id=v.id AND r.status IN ('Asignada','En curso')
         )
       ORDER BY v.plate`,
    ),
  ])
  res.json({ drivers: drivers.rows, vehicles: vehicles.rows })
})
