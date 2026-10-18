import { z } from "zod"

export const uuidSchema = z.uuid()
export const idParamSchema = z.object({ id: uuidSchema })
export const adjustmentReasons = [
  "Conteo físico",
  "Merma o daño",
  "Corrección de registro",
  "Otro",
] as const

export const movementSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("Entrada"),
    quantity: z.number().positive().finite(),
    observation: z.string().trim().max(500).optional(),
  }).strict(),
  z.object({
    type: z.literal("Ajuste"),
    quantity: z.number().positive().finite(),
    direction: z.enum(["Aumentar", "Disminuir"]),
    reason: z.enum(adjustmentReasons),
    detail: z.string().trim().optional(),
  }).strict().superRefine((movement, context) => {
    if (movement.reason === "Otro") {
      if (!movement.detail || movement.detail.length < 5 || movement.detail.length > 120) {
        context.addIssue({
          code: "custom",
          path: ["detail"],
          message: "El detalle debe tener entre 5 y 120 caracteres cuando el motivo es Otro.",
        })
      }
    } else if (movement.detail !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["detail"],
        message: "El detalle solo se utiliza cuando el motivo es Otro.",
      })
    }
  }),
])
export const createOrderSchema = z.object({
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
