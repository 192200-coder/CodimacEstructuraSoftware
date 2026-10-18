import { Router } from "express"
import type { OrderUseCases } from "../application/orders.js"
import { authenticate, requireRole } from "../http/auth.js"
import { createOrderSchema, idParamSchema } from "../http/schemas.js"

export function createOrdersRouter(useCases: OrderUseCases) {
  const router = Router()
  router.use(authenticate)

  router.get("/", requireRole("Despachador", "Administrador"), async (_req, res) => {
    res.json({ orders: await useCases.list() })
  })

  router.get("/:id/events", requireRole("Despachador", "Administrador"), async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    res.json({ events: await useCases.events(id) })
  })

  router.post("/", requireRole("Despachador"), async (req, res) => {
    const body = createOrderSchema.parse(req.body)
    const order = await useCases.create({
      ...body,
      actorId: req.user!.id,
    })
    res.status(201).json({ order })
  })

  router.post("/:id/prepare", requireRole("Despachador"), async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    await useCases.prepare(id, req.user!.id)
    res.json({ status: "En preparación" })
  })

  router.post("/:id/cancel", requireRole("Despachador"), async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    await useCases.cancel(id, req.user!.id)
    res.json({ status: "Cancelado" })
  })

  router.post("/:id/ready", requireRole("Despachador"), async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    await useCases.markReady(id, req.user!.id)
    res.json({ status: "Listo" })
  })

  return router
}
