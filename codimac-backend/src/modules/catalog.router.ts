import { Router } from "express"
import { z } from "zod"
import type {
  AuditQuery,
  CatalogRecord,
  CatalogResource,
  CatalogUseCases,
} from "../application/catalog.js"
import { authenticate, requireRole } from "../http/auth.js"
import { HttpError } from "../http/errors.js"
import {
  clientSchema,
  createUserSchema,
  idParamSchema,
  movementSchema,
  parametersSchema,
  productSchema,
  updateUserSchema,
  uuidSchema,
  vehicleSchema,
} from "../http/schemas.js"

const catalogs = {
  clients: { schema: clientSchema },
  products: { schema: productSchema },
  vehicles: { schema: vehicleSchema },
} as const

function isCatalogResource(resource: unknown): resource is CatalogResource {
  return resource === "clients" || resource === "products" || resource === "vehicles"
}

export function createCatalogRouter(
  useCases: CatalogUseCases,
  options: { demoResetEnabled: boolean } = { demoResetEnabled: false },
) {
  const router = Router()
  router.use(authenticate)

  router.get("/catalog/:resource", requireRole("Despachador", "Administrador"), async (req, res) => {
    if (req.params.resource === "parameters") {
      res.json({ data: await useCases.getParameters() })
      return
    }
    if (!isCatalogResource(req.params.resource)) throw new HttpError(404, "Catálogo desconocido")
    res.json({ data: await useCases.listCatalog(req.params.resource) })
  })

  router.post("/catalog/clients", requireRole("Despachador", "Administrador"), async (req, res) => {
    const body = clientSchema.parse(req.body)
    const data = await useCases.createCatalog("clients", body as CatalogRecord, req.user!.id)
    res.status(201).json({ data })
  })

  router.put("/catalog/clients/:id", requireRole("Despachador", "Administrador"), async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = clientSchema.partial().parse(req.body)
    if (!Object.keys(body).length) throw new HttpError(400, "No se indicaron campos para actualizar")
    const data = await useCases.updateCatalog("clients", id, body as CatalogRecord, req.user!.id)
    res.json({ data })
  })

  router.post("/admin/catalog/:resource", requireRole("Administrador"), async (req, res) => {
    if (!isCatalogResource(req.params.resource)) throw new HttpError(404, "Catálogo desconocido")
    const catalog = catalogs[req.params.resource]
    const body = catalog.schema.parse(req.body)
    const data = await useCases.createCatalog(
      req.params.resource,
      body as CatalogRecord,
      req.user!.id,
    )
    res.status(201).json({ data })
  })

  router.put("/admin/catalog/:resource/:id", requireRole("Administrador"), async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    if (!isCatalogResource(req.params.resource)) throw new HttpError(404, "Catálogo desconocido")
    const catalog = catalogs[req.params.resource]
    const body = catalog.schema.partial().parse(req.body)
    if (!Object.keys(body).length) throw new HttpError(400, "No se indicaron campos para actualizar")
    const data = await useCases.updateCatalog(
      req.params.resource,
      id,
      body as CatalogRecord,
      req.user!.id,
    )
    res.json({ data })
  })

  router.put("/admin/parameters", requireRole("Administrador"), async (req, res) => {
    const body = parametersSchema.parse(req.body)
    res.json({ data: await useCases.updateParameters(body, req.user!.id) })
  })

  router.get("/admin/users", requireRole("Administrador"), async (_req, res) => {
    res.json({ users: await useCases.listUsers() })
  })

  router.get("/admin/demo-data", requireRole("Administrador"), (_req, res) => {
    res.json({ resetEnabled: options.demoResetEnabled })
  })

  router.post("/admin/demo-data", requireRole("Administrador"), async (req, res) => {
    const summary = await useCases.loadDemoData(req.user!.id)
    res.json({ loaded: true, ...summary })
  })

  router.post("/admin/demo-data/reset", requireRole("Administrador"), async (req, res) => {
    if (!options.demoResetEnabled) {
      throw new HttpError(403, "El restablecimiento está deshabilitado. Actívalo con DEMO_RESET_ENABLED=true solo en una base de demostración.")
    }
    const summary = await useCases.resetDemoData(req.user!.id)
    res.json({ reset: true, ...summary })
  })

  router.post("/admin/users", requireRole("Administrador"), async (req, res) => {
    const body = createUserSchema.parse(req.body)
    const user = await useCases.createUser({ ...body, actorId: req.user!.id })
    res.status(201).json({ user })
  })

  router.put("/admin/users/:id", requireRole("Administrador"), async (req, res) => {
    const { id } = idParamSchema.parse(req.params)
    const body = updateUserSchema.parse(req.body)
    const user = await useCases.updateUser({
      userId: id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      ...body,
    })
    res.json({ user })
  })

  router.post("/inventory/:productId/movements", requireRole("Despachador", "Administrador"), async (req, res) => {
    const productId = uuidSchema.parse(req.params.productId)
    const body = movementSchema.parse(req.body)
    const totalStock = await useCases.registerInventoryMovement({ productId, ...body, actorId: req.user!.id })
    res.json({ totalStock })
  })

  router.get("/inventory/:productId/movements", requireRole("Despachador", "Administrador"), async (req, res) => {
    const productId = uuidSchema.parse(req.params.productId)
    res.json({ movements: await useCases.listInventoryMovements(productId) })
  })

  router.get("/indicators", requireRole("Administrador"), async (_req, res) => {
    res.json({ indicators: await useCases.listIndicators() })
  })

  router.get("/admin/audit", requireRole("Administrador"), async (req, res) => {
    const query = z.object({
      desde: z.iso.datetime({ offset: true }).optional(),
      hasta: z.iso.datetime({ offset: true }).optional(),
      usuario: z.string().trim().min(1).max(160).optional(),
      entidad: z.string().trim().min(1).max(80).optional(),
      accion: z.string().trim().min(1).max(120).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      offset: z.coerce.number().int().min(0).default(0),
    }).refine(
      (value) =>
        !value.desde ||
        !value.hasta ||
        new Date(value.desde).getTime() <= new Date(value.hasta).getTime(),
      {
        message: "La fecha inicial no puede ser posterior a la fecha final",
        path: ["desde"],
      },
    ).parse(req.query) satisfies AuditQuery
    const result = await useCases.listAudit(query)
    res.json({ ...result, limit: query.limit, offset: query.offset })
  })

  router.get("/admin/events", requireRole("Administrador"), async (req, res) => {
    const { limit = 100 } = z.object({
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }).parse(req.query)
    res.json({ events: await useCases.listLegacyEvents(limit) })
  })

  return router
}
