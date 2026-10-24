import { describe, expect, it } from "vitest"
import type { ZodType } from "zod"
import {
  clientSchema,
  createOrderSchema,
  createUserSchema,
  deliverStopSchema,
  incidentSchema,
  movementSchema,
  parametersSchema,
  productSchema,
  startOfLimaDay,
  vehicleSchema,
} from "./schemas.js"

/** Devuelve el mensaje del primer error del campo, o null si el valor es válido. */
function errorOf(schema: ZodType, value: unknown, field?: string): string | null {
  const result = schema.safeParse(value)
  if (result.success) return null
  const issue = field
    ? result.error.issues.find((item) => item.path.join(".") === field)
    : result.error.issues[0]
  return issue?.message ?? null
}

const uuid = "20000000-0000-4000-8000-000000000001"

describe("Anexo B · Usuario", () => {
  const user = { name: "Laura Mendoza", email: "laura@codimac.pe", password: "Clave2026", role: "Administrador" }

  it("acepta un usuario válido y normaliza el correo", () => {
    expect(createUserSchema.parse({ ...user, email: "Laura@Codimac.PE" }).email).toBe("laura@codimac.pe")
  })

  it("exige nombre de 3 a 80 caracteres", () => {
    expect(errorOf(createUserSchema, { ...user, name: "Al" }, "name")).toBe("Ingresa el nombre completo.")
    expect(errorOf(createUserSchema, { ...user, name: "x".repeat(81) }, "name")).toBe("Ingresa el nombre completo.")
  })

  it("exige correo válido", () => {
    expect(errorOf(createUserSchema, { ...user, email: "laura@" }, "email")).toBe("Ingresa un correo válido.")
  })

  it("exige contraseña de 8 caracteres con letras y números", () => {
    const message = "Mínimo 8 caracteres, con letras y números."
    expect(errorOf(createUserSchema, { ...user, password: "Clave1" }, "password")).toBe(message)
    expect(errorOf(createUserSchema, { ...user, password: "solamenteletras" }, "password")).toBe(message)
    expect(errorOf(createUserSchema, { ...user, password: "12345678" }, "password")).toBe(message)
  })

  it("exige rol", () => {
    expect(errorOf(createUserSchema, { ...user, role: "" }, "role")).toBe("Elige un rol.")
  })
})

describe("Anexo B · Producto y vehículo", () => {
  const product = { name: "Cemento tipo I", unit: "Bolsa de 42,5 kg", weight_kg: 42.5, total_stock: 200 }
  const vehicle = {
    plate: "abc-123",
    vehicle_type: "Camioneta",
    capacity_kg: 1500,
    average_speed_kmh: 30,
    fuel_efficiency_km_l: 10,
  }

  it("valida nombre, unidad, peso (> 0, 3 decimales) y stock inicial entero", () => {
    expect(productSchema.safeParse(product).success).toBe(true)
    expect(errorOf(productSchema, { ...product, name: "C" }, "name")).toBe("Ingresa el nombre del producto.")
    expect(errorOf(productSchema, { ...product, unit: "" }, "unit")).toBe("Elige la unidad.")
    expect(errorOf(productSchema, { ...product, weight_kg: 0 }, "weight_kg")).toBe("El peso debe ser mayor que 0.")
    expect(errorOf(productSchema, { ...product, weight_kg: 1.2345 }, "weight_kg")).toBe("Usa como máximo 3 decimales.")
    expect(errorOf(productSchema, { ...product, total_stock: 1.5 }, "total_stock")).toBe("Ingresa un número entero, 0 o más.")
    expect(errorOf(productSchema, { ...product, total_stock: -1 }, "total_stock")).toBe("Ingresa un número entero, 0 o más.")
  })

  it("normaliza la placa a ABC-123 y valida velocidad y rendimiento", () => {
    expect(vehicleSchema.parse(vehicle).plate).toBe("ABC-123")
    expect(errorOf(vehicleSchema, { ...vehicle, plate: "ABC123" }, "plate")).toBe("Usa el formato ABC-123.")
    expect(errorOf(vehicleSchema, { ...vehicle, capacity_kg: 0 }, "capacity_kg")).toBe("La capacidad debe ser mayor que 0.")
    expect(errorOf(vehicleSchema, { ...vehicle, average_speed_kmh: 4 }, "average_speed_kmh"))
      .toBe("Ingresa una velocidad entre 5 y 120 km/h.")
    expect(errorOf(vehicleSchema, { ...vehicle, average_speed_kmh: 121 }, "average_speed_kmh"))
      .toBe("Ingresa una velocidad entre 5 y 120 km/h.")
    expect(errorOf(vehicleSchema, { ...vehicle, fuel_efficiency_km_l: 51 }, "fuel_efficiency_km_l"))
      .toBe("Ingresa un rendimiento válido en km/L.")
  })
})

describe("Anexo B · Cliente", () => {
  const client = {
    name: "Cliente A",
    contact: "987654321",
    address: "Av. Principal 120",
    latitude: -13.62,
    longitude: -72.86,
  }

  it("valida nombre, teléfono, dirección y ubicación con los mensajes del catálogo", () => {
    expect(errorOf(clientSchema, { ...client, name: "A" }, "name")).toBe("Ingresa el nombre del cliente.")
    expect(errorOf(clientSchema, { ...client, contact: "812345678" }, "contact"))
      .toBe("Ingresa un celular de 9 dígitos que empiece con 9.")
    expect(errorOf(clientSchema, { ...client, address: "Av." }, "address")).toBe("Ingresa la dirección.")
    expect(errorOf(clientSchema, { ...client, latitude: undefined }, "latitude")).toBe("Marca la ubicación en el mapa.")
  })
})

describe("Anexo B · Pedido", () => {
  const order = { clientId: uuid, deadlineAt: null, items: [{ productId: uuid, quantity: 10 }] }

  it("exige cliente y al menos una línea", () => {
    expect(errorOf(createOrderSchema, { ...order, clientId: "" }, "clientId")).toBe("Elige un cliente.")
    expect(errorOf(createOrderSchema, { ...order, items: [] }, "items")).toBe("Agrega al menos un producto.")
  })

  it("exige cantidades enteras de 1 o más", () => {
    const message = "La cantidad debe ser un número entero, 1 o más."
    expect(errorOf(createOrderSchema, { ...order, items: [{ productId: uuid, quantity: 0 }] })).toBe(message)
    expect(errorOf(createOrderSchema, { ...order, items: [{ productId: uuid, quantity: 2.5 }] })).toBe(message)
  })

  it("rechaza productos repetidos", () => {
    expect(errorOf(createOrderSchema, {
      ...order,
      items: [{ productId: uuid, quantity: 1 }, { productId: uuid, quantity: 2 }],
    }, "items")).toBe("No repitas productos en el pedido.")
  })

  it("acepta una fecha límite de hoy y rechaza una anterior a hoy (hora de Lima)", () => {
    const today = new Date(startOfLimaDay() + 60_000).toISOString()
    const yesterday = new Date(startOfLimaDay() - 60_000).toISOString()
    expect(createOrderSchema.safeParse({ ...order, deadlineAt: today }).success).toBe(true)
    expect(errorOf(createOrderSchema, { ...order, deadlineAt: yesterday }, "deadlineAt"))
      .toBe("La fecha límite no puede ser anterior a hoy.")
  })

  it("calcula el inicio del día en America/Lima (UTC-5)", () => {
    // 23 oct 2026, 02:00 UTC = 22 oct 2026, 21:00 en Lima.
    expect(new Date(startOfLimaDay(Date.UTC(2026, 9, 23, 2))).toISOString()).toBe("2026-10-22T05:00:00.000Z")
  })
})

describe("Anexo B · Inventario y parámetros", () => {
  it("exige cantidades enteras de 1 o más en entradas y ajustes", () => {
    expect(errorOf(movementSchema, { type: "Entrada", quantity: 0.5 }, "quantity"))
      .toBe("Ingresa un número entero, 1 o más.")
    expect(errorOf(movementSchema, { type: "Ajuste", quantity: 5, direction: "Disminuir" }, "reason"))
      .toBe("Elige el motivo del ajuste.")
  })

  it("valida precio, minutos por parada y radio del área de servicio", () => {
    const parameters = {
      warehouseLatitude: -13.6366,
      warehouseLongitude: -72.8814,
      fuelPrice: 6.2,
      minutesPerStop: 8,
      serviceRadiusKm: 50,
    }
    expect(parametersSchema.safeParse(parameters).success).toBe(true)
    expect(errorOf(parametersSchema, { ...parameters, fuelPrice: 0 }, "fuelPrice")).toBe("Ingresa un precio mayor que 0.")
    expect(errorOf(parametersSchema, { ...parameters, fuelPrice: 6.205 }, "fuelPrice")).toBe("Usa como máximo 2 decimales.")
    expect(errorOf(parametersSchema, { ...parameters, minutesPerStop: 121 }, "minutesPerStop"))
      .toBe("Ingresa un valor entre 0 y 120.")
    expect(errorOf(parametersSchema, { ...parameters, serviceRadiusKm: 0 }, "serviceRadiusKm"))
      .toBe("Ingresa un radio entre 1 y 500 km.")
    expect(errorOf(parametersSchema, { ...parameters, serviceRadiusKm: 501 }, "serviceRadiusKm"))
      .toBe("Ingresa un radio entre 1 y 500 km.")
  })
})

describe("Anexo B · Entrega e incidencia", () => {
  it("exige el nombre de quien recibió (3 a 80 caracteres)", () => {
    expect(errorOf(deliverStopSchema, { receivedBy: "Al" }, "receivedBy")).toBe("Ingresa quién recibió el pedido.")
    expect(deliverStopSchema.safeParse({ receivedBy: "Ana Torres", observations: "Dejó en portería" }).success)
      .toBe(true)
  })

  it("exige causa y observaciones cuando la causa es Otra", () => {
    expect(errorOf(incidentSchema, { cause: "Lluvia" }, "cause")).toBe("Elige la causa.")
    expect(errorOf(incidentSchema, { cause: "Otra", notes: "" }, "notes")).toBe("Describe brevemente lo ocurrido.")
    expect(incidentSchema.safeParse({ cause: "Otra", notes: "Portón cerrado con candado" }).success).toBe(true)
    expect(incidentSchema.safeParse({ cause: "Cliente ausente" }).success).toBe(true)
  })
})
