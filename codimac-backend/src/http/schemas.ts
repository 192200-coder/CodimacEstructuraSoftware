import { z } from "zod"

export const uuidSchema = z.uuid()
export const idParamSchema = z.object({ id: uuidSchema })
export const movementSchema = z.object({
  quantity: z.number().finite(),
  type: z.enum(["Entrada", "Ajuste"]),
  reason: z.string().trim().min(1).max(500),
})
export const createOrderSchema = z.object({
  code: z.string().trim().min(1).max(40),
  clientId: uuidSchema,
  deadlineAt: z.iso.datetime({ offset: true }).nullable().optional(),
  items: z.array(z.object({
    productId: uuidSchema,
    quantity: z.number().positive().finite(),
  })).min(1).max(100),
}).refine((value) => new Set(value.items.map((item) => item.productId)).size === value.items.length, {
  message: "No se permiten productos duplicados en un pedido",
})
export const createRouteSchema = z.object({
  code: z.string().trim().min(1).max(40),
  orderIds: z.array(uuidSchema).min(1).max(10),
  distanceKm: z.number().nonnegative().finite(),
  estimatedMinutes: z.number().int().nonnegative(),
  estimatedLiters: z.number().nonnegative().finite(),
  estimatedCost: z.number().nonnegative().finite(),
  driverId: uuidSchema.optional(),
  vehicleId: uuidSchema.optional(),
}).refine((value) => new Set(value.orderIds).size === value.orderIds.length, {
  message: "No se permiten pedidos duplicados",
}).refine((value) => Boolean(value.driverId) === Boolean(value.vehicleId), {
  message: "Chofer y vehículo deben enviarse juntos para asignar la ruta",
})
