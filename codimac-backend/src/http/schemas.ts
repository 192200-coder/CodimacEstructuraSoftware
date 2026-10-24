import { z } from "zod"

// Reglas y mensajes del Anexo B (catálogo de validaciones) de la especificación v1.1.

export const uuidSchema = z.uuid()
export const idParamSchema = z.object({ id: uuidSchema })
export const adjustmentReasons = [
  "Conteo físico",
  "Merma o daño",
  "Corrección de registro",
  "Otro",
] as const
export const incidentCauses = ["Cliente ausente", "Dirección errónea", "Otra"] as const

const LIMA_UTC_OFFSET_MS = 5 * 3_600_000

/** Inicio del día actual en America/Lima (UTC-5, sin horario de verano). */
export function startOfLimaDay(nowMs = Date.now()): number {
  const lima = new Date(nowMs - LIMA_UTC_OFFSET_MS)
  return Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate()) + LIMA_UTC_OFFSET_MS
}

function hasAtMostDecimals(value: number, decimals: number): boolean {
  const scaled = value * 10 ** decimals
  return Math.abs(scaled - Math.round(scaled)) < 1e-6
}

const requiredText = (message: string, min: number, max: number) =>
  z.string({ error: message }).trim().min(min, message).max(max, message)

const wholeNumber = (message: string) =>
  z.number({ error: message }).int(message).finite(message)

export const movementQuantitySchema = wholeNumber("Ingresa un número entero, 1 o más.")
  .min(1, "Ingresa un número entero, 1 o más.")

export const movementSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("Entrada"),
    quantity: movementQuantitySchema,
    observation: z.string().trim().max(500, "Máximo 500 caracteres.").optional(),
  }).strict(),
  z.object({
    type: z.literal("Ajuste"),
    quantity: movementQuantitySchema,
    direction: z.enum(["Aumentar", "Disminuir"], { error: "Elige si aumentas o disminuyes." }),
    reason: z.enum(adjustmentReasons, { error: "Elige el motivo del ajuste." }),
    detail: z.string().trim().optional(),
  }).strict().superRefine((movement, context) => {
    if (movement.reason === "Otro") {
      if (!movement.detail || movement.detail.length < 5 || movement.detail.length > 120) {
        context.addIssue({
          code: "custom",
          path: ["detail"],
          message: "Describe el motivo con 5 a 120 caracteres.",
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
], { error: "Elige el tipo de movimiento." })
export const createOrderSchema = z.object({
  clientId: z.uuid({ error: "Elige un cliente." }),
  deadlineAt: z.iso.datetime({ offset: true, error: "Ingresa una fecha límite válida." })
    .nullable()
    .optional()
    .refine(
      (value) => !value || Date.parse(value) >= startOfLimaDay(),
      "La fecha límite no puede ser anterior a hoy.",
    ),
  items: z.array(z.object({
    productId: uuidSchema,
    quantity: wholeNumber("La cantidad debe ser un número entero, 1 o más.")
      .min(1, "La cantidad debe ser un número entero, 1 o más."),
  }), { error: "Agrega al menos un producto." })
    .min(1, "Agrega al menos un producto.")
    .max(100, "Un pedido admite como máximo 100 líneas."),
}).refine((value) => new Set(value.items.map((item) => item.productId)).size === value.items.length, {
  message: "No repitas productos en el pedido.",
  path: ["items"],
})
export const clientSchema = z.object({
  name: requiredText("Ingresa el nombre del cliente.", 2, 100),
  contact: z.string({ error: "Ingresa un celular de 9 dígitos que empiece con 9." })
    .regex(/^9\d{8}$/, "Ingresa un celular de 9 dígitos que empiece con 9."),
  address: requiredText("Ingresa la dirección.", 5, 150),
  reference: z.string().trim().max(150, "Máximo 150 caracteres.").optional(),
  latitude: z.coerce.number({ error: "Marca la ubicación en el mapa." })
    .min(-90, "Marca la ubicación en el mapa.").max(90, "Marca la ubicación en el mapa."),
  longitude: z.coerce.number({ error: "Marca la ubicación en el mapa." })
    .min(-180, "Marca la ubicación en el mapa.").max(180, "Marca la ubicación en el mapa."),
}).strict()

const userNameSchema = requiredText("Ingresa el nombre completo.", 3, 80)
const userRoleSchema = z.enum(["Despachador", "Chofer", "Administrador"], { error: "Elige un rol." })
const userPhoneSchema = z.string()
  .regex(/^9\d{8}$/, "Ingresa un celular de 9 dígitos que empiece con 9.")
  .nullable()
  .optional()
export const passwordSchema = z.string({ error: "Mínimo 8 caracteres, con letras y números." })
  .min(8, "Mínimo 8 caracteres, con letras y números.")
  .max(128, "Máximo 128 caracteres.")
  .regex(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/, "Mínimo 8 caracteres, con letras y números.")
  .regex(/\d/, "Mínimo 8 caracteres, con letras y números.")

export const createUserSchema = z.object({
  email: z.email({ error: "Ingresa un correo válido." }).transform((email) => email.toLowerCase()),
  password: passwordSchema,
  name: userNameSchema,
  phone: userPhoneSchema,
  role: userRoleSchema,
})
export const updateUserSchema = z.object({
  name: userNameSchema.optional(),
  phone: userPhoneSchema,
  role: userRoleSchema.optional(),
  active: z.boolean().optional(),
  password: passwordSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, "Indica qué datos deseas actualizar")

export const productSchema = z.object({
  name: requiredText("Ingresa el nombre del producto.", 2, 80),
  unit: requiredText("Elige la unidad.", 1, 40),
  weight_kg: z.coerce.number({ error: "El peso debe ser mayor que 0." })
    .positive("El peso debe ser mayor que 0.")
    .refine((value) => hasAtMostDecimals(value, 3), "Usa como máximo 3 decimales."),
  total_stock: z.coerce.number({ error: "Ingresa un número entero, 0 o más." })
    .int("Ingresa un número entero, 0 o más.")
    .min(0, "Ingresa un número entero, 0 o más.")
    .optional(),
  active: z.boolean().optional(),
})
export const vehicleSchema = z.object({
  plate: z.string({ error: "Usa el formato ABC-123." })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3}-\d{3}$/, "Usa el formato ABC-123."),
  vehicle_type: requiredText("Elige el tipo de vehículo.", 1, 100),
  capacity_kg: z.coerce.number({ error: "La capacidad debe ser mayor que 0." })
    .positive("La capacidad debe ser mayor que 0."),
  average_speed_kmh: z.coerce.number({ error: "Ingresa una velocidad entre 5 y 120 km/h." })
    .min(5, "Ingresa una velocidad entre 5 y 120 km/h.")
    .max(120, "Ingresa una velocidad entre 5 y 120 km/h."),
  fuel_efficiency_km_l: z.coerce.number({ error: "Ingresa un rendimiento válido en km/L." })
    .positive("Ingresa un rendimiento válido en km/L.")
    .max(50, "Ingresa un rendimiento válido en km/L."),
  available: z.boolean().optional(),
})
export const parametersSchema = z.object({
  warehouseLatitude: z.number({ error: "Marca la ubicación del almacén." }).min(-90).max(90),
  warehouseLongitude: z.number({ error: "Marca la ubicación del almacén." }).min(-180).max(180),
  fuelPrice: z.number({ error: "Ingresa un precio mayor que 0." })
    .positive("Ingresa un precio mayor que 0.")
    .refine((value) => hasAtMostDecimals(value, 2), "Usa como máximo 2 decimales."),
  minutesPerStop: wholeNumber("Ingresa un valor entre 0 y 120.")
    .min(0, "Ingresa un valor entre 0 y 120.")
    .max(120, "Ingresa un valor entre 0 y 120."),
  serviceRadiusKm: wholeNumber("Ingresa un radio entre 1 y 500 km.")
    .min(1, "Ingresa un radio entre 1 y 500 km.")
    .max(500, "Ingresa un radio entre 1 y 500 km."),
})
export const deliverStopSchema = z.object({
  receivedBy: requiredText("Ingresa quién recibió el pedido.", 3, 80),
  observations: z.string().trim().max(200, "Máximo 200 caracteres.").optional(),
})
export const incidentSchema = z.object({
  cause: z.enum(incidentCauses, { error: "Elige la causa." }),
  notes: z.string().trim().max(200, "Máximo 200 caracteres.").nullable().optional(),
}).superRefine((incident, context) => {
  const notes = incident.notes?.trim() ?? ""
  if (incident.cause === "Otra" && (notes.length < 5 || notes.length > 200)) {
    context.addIssue({
      code: "custom",
      path: ["notes"],
      message: "Describe brevemente lo ocurrido.",
    })
  }
})
export const createRouteBatchSchema = z.object({
  routes: z.array(z.object({
    orderIds: z.array(uuidSchema).min(1).max(10),
    distanceKm: z.number().nonnegative().finite(),
    estimatedMinutes: z.number().int().nonnegative(),
    estimatedLiters: z.number().nonnegative().finite(),
    estimatedCost: z.number().nonnegative().finite(),
    referenceKm: z.number().nonnegative().finite().optional(),
    referenceMinutes: z.number().int().nonnegative().optional(),
    usesRealTraffic: z.boolean().optional(),
    driverId: uuidSchema,
    vehicleId: uuidSchema,
  }).strict()).min(1).max(10),
}).strict()
export const createRouteSchema = z.object({
  orderIds: z.array(uuidSchema).min(1).max(10),
  distanceKm: z.number().nonnegative().finite(),
  estimatedMinutes: z.number().int().nonnegative(),
  estimatedLiters: z.number().nonnegative().finite(),
  estimatedCost: z.number().nonnegative().finite(),
  referenceKm: z.number().nonnegative().finite().optional(),
  referenceMinutes: z.number().int().nonnegative().optional(),
  usesRealTraffic: z.boolean().optional(),
}).refine((value) => new Set(value.orderIds).size === value.orderIds.length, {
  message: "No se permiten pedidos duplicados",
}).strict()
