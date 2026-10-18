import { describe, expect, it } from "vitest"
import { createRouteSchema } from "./schemas.js"

const validRoute = {
  code: "R-100",
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
