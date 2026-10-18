import { describe, expect, it } from "vitest"
import { clientSchema, createRouteSchema, movementSchema } from "./schemas.js"

const validRoute = {
  orderIds: ["40000000-0000-4000-8000-000000000001"],
  distanceKm: 12,
  estimatedMinutes: 30,
  estimatedLiters: 2,
  estimatedCost: 12,
}

describe("contrato de creación de repartos", () => {
  it("permite crear una ruta sin asignación para los flujos administrativos existentes", () => {
    expect(createRouteSchema.safeParse(validRoute).success).toBe(true)
  })

  describe("validación de datos de clientes", () => {
    const validClient = {
      name: "Cliente de prueba",
      contact: "912345678",
      address: "Av. Principal 120",
      latitude: -13.6366,
      longitude: -72.8814,
    }

    it("exige teléfono móvil válido y coordenadas del mapa, con referencia opcional", () => {
      expect(clientSchema.safeParse(validClient).success).toBe(true)
      expect(clientSchema.parse(validClient)).not.toHaveProperty("reference")
      expect(clientSchema.safeParse({ ...validClient, reference: "Portón verde" }).success).toBe(true)
      expect(clientSchema.safeParse({ ...validClient, contact: "812345678" }).success).toBe(false)
      expect(clientSchema.safeParse({ ...validClient, contact: "+51912345678" }).success).toBe(false)
      expect(clientSchema.safeParse({ ...validClient, latitude: undefined }).success).toBe(false)
    })

    it("limita longitud de dirección y referencia", () => {
      expect(clientSchema.safeParse({ ...validClient, address: "Calle" }).success).toBe(true)
      expect(clientSchema.safeParse({ ...validClient, address: "x".repeat(151) }).success).toBe(false)
      expect(clientSchema.safeParse({ ...validClient, reference: "x".repeat(151) }).success).toBe(false)
      expect(clientSchema.partial().parse({ contact: "912345678" })).not.toHaveProperty("reference")
    })
  })

  describe("contrato de movimientos de inventario", () => {
    it("acepta entrada sin motivo con observación opcional", () => {
      expect(movementSchema.safeParse({
        type: "Entrada",
        quantity: 15,
      }).success).toBe(true)
      expect(movementSchema.safeParse({
        type: "Entrada",
        quantity: 15,
        observation: "Recepción de proveedor",
      }).success).toBe(true)
    })

    it("rechaza reason en entradas y exige motivo válido en ajustes", () => {
      expect(movementSchema.safeParse({
        type: "Entrada",
        quantity: 15,
        reason: "obsoleto",
      }).success).toBe(false)
      expect(movementSchema.safeParse({
        type: "Ajuste",
        quantity: 5,
        direction: "Disminuir",
      }).success).toBe(false)
      expect(movementSchema.safeParse({
        type: "Ajuste",
        quantity: 5,
        direction: "Disminuir",
        reason: "Merma o daño",
      }).success).toBe(true)
    })

    it("requiere detalle de 5 a 120 caracteres cuando el motivo es Otro", () => {
      const base = {
        type: "Ajuste" as const,
        quantity: 1,
        direction: "Aumentar" as const,
        reason: "Otro" as const,
      }
      expect(movementSchema.safeParse(base).success).toBe(false)
      expect(movementSchema.safeParse({ ...base, detail: "abc" }).success).toBe(false)
      expect(movementSchema.safeParse({ ...base, detail: "Ajuste adicional" }).success).toBe(true)
    })
  })

  it("rechaza la asignación embebida para mantener la aprobación como transición explícita", () => {
    expect(createRouteSchema.safeParse({
      ...validRoute,
      driverId: "90000000-0000-4000-8000-000000000002",
      vehicleId: "30000000-0000-4000-8000-000000000001",
    }).success).toBe(false)
    expect(createRouteSchema.safeParse({
      ...validRoute,
      driverId: "90000000-0000-4000-8000-000000000002",
    }).success).toBe(false)
  })
})
