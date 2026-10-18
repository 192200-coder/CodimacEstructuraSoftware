import { Router } from "express"
import { z } from "zod"
import type { RouteUseCases } from "../application/routes.js"
import { authenticate, requireRole } from "../http/auth.js"
import { idParamSchema, uuidSchema, createRouteSchema } from "../http/schemas.js"

export function createRoutesRouter(useCases: RouteUseCases) {
  const router = Router()
  router.use(authenticate)

  router.post("/routes", requireRole("Despachador"), async (req, res) => {
    const body = createRouteSchema.parse(req.body)
    const route = await useCases.create({
      ...body,
      actorId: req.user!.id,
    })
    res.status(201).json({
      routeId: route.id,
      code: route.code,
      status: route.status,
    })
  })

  router.get("/routes/history", requireRole("Despachador", "Administrador"), async (_req, res) => {
    res.json({ routes: await useCases.closedHistory() })
  })

  router.get("/routes", requireRole("Despachador", "Administrador"), async (_req, res) => {
    res.json({ routes: await useCases.list() })
  })

  router.delete("/routes/:id", requireRole("Despachador"), async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    await useCases.remove(id, req.user!.id)
    res.json({ deleted: true })
  })

  router.post("/routes/:id/assign", requireRole("Despachador"), async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = z.object({ driverId: uuidSchema, vehicleId: uuidSchema }).parse(req.body)
    await useCases.assign(id, body.driverId, body.vehicleId, req.user!.id)
    res.json({ status: "Asignada", notification: "simulated" })
  })

  router.get("/driver/route", requireRole("Chofer"), async (req, res) => {
    res.json({ route: await useCases.driverRoute(req.user!.id) })
  })

  router.get("/driver/routes/:id/summary", requireRole("Chofer"), async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    res.json({ summary: await useCases.routeSummary(id, req.user!.id) })
  })

  router.post("/routes/:id/start", requireRole("Chofer"), async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    await useCases.start(id, req.user!.id)
    res.json({ status: "En ruta" })
  })

  router.post("/stops/:id/deliver", requireRole("Chofer"), async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const { receivedBy } = z.object({ receivedBy: z.string().trim().min(1).max(160) }).parse(req.body)
    await useCases.deliver(id, receivedBy, req.user!.id)
    res.json({ status: "Entregada" })
  })

  router.post("/stops/:id/incidents", requireRole("Chofer"), async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = z.object({
      cause: z.enum(["Cliente ausente", "Dirección errónea", "Otra"]),
      notes: z.string().max(1000).nullable().optional(),
    }).parse(req.body)
    const result = await useCases.reportIncident(
      id,
      body.cause,
      body.notes ?? null,
      req.user!.id,
    )
    res.json({ result })
  })

  return router
}
