import { describe, expect, it } from "vitest"
import { createRouteSchema, movementSchema } from "./schemas.js"

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

  it("exige chofer y vehículo juntos para crear y asignar en una sola operación", () => {
    expect(createRouteSchema.safeParse({
      ...validRoute,
      driverId: "90000000-0000-4000-8000-000000000002",
      vehicleId: "30000000-0000-4000-8000-000000000001",
    }).success).toBe(true)
    expect(createRouteSchema.safeParse({
      ...validRoute,
      driverId: "90000000-0000-4000-8000-000000000002",
    }).success).toBe(false)
  })
})
