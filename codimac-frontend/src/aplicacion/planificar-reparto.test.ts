import { describe, expect, it } from "vitest"
import { EstimadorLocal } from "../adaptadores/mapas/estimador-local"
import type { Pedido, Vehiculo } from "../dominio/modelos"
import { PlanificarReparto } from "./planificar-reparto"

const vehiculo: Vehiculo = {
  id: "v1",
  placa: "ABC-123",
  capacidadKg: 1500,
  velocidadPromedioKmh: 30,
  rendimientoKmLitro: 10,
  disponible: true,
}

const pedido: Pedido = {
  id: "p1",
  codigo: "COD-101",
  estado: "Listo",
  fechaPedido: "2026-10-19T08:00:00-05:00",
  direccion: "Av. Principal 120",
  coordenadas: { latitud: -13.62, longitud: -72.865 },
  lineas: [{ productoId: "cemento", cantidad: 10, pesoUnitarioKg: 42.5 }],
}

describe("PlanificarReparto", () => {
  const useCase = new PlanificarReparto(new EstimadorLocal(6.2, 8))

  it("calcula alternativas para pedidos Listo dentro de la capacidad", async () => {
    const result = await useCase.ejecutar({
      almacen: { latitud: -13.6366, longitud: -72.8814 },
      pedidos: [pedido],
      vehiculo,
    })
    expect(result.pesoKg).toBe(425)
    expect(result.alternativas).toHaveLength(1)
  })

  it("rechaza pedidos no listos, vehículos ocupados y exceso de peso", async () => {
    await expect(
      useCase.ejecutar({
        almacen: { latitud: -13.6366, longitud: -72.8814 },
        pedidos: [{ ...pedido, estado: "Pendiente" }],
        vehiculo,
      }),
    ).rejects.toThrow("Solo los pedidos Listo")
    await expect(
      useCase.ejecutar({
        almacen: { latitud: -13.6366, longitud: -72.8814 },
        pedidos: [pedido],
        vehiculo: { ...vehiculo, disponible: false },
      }),
    ).rejects.toThrow("no está disponible")
    await expect(
      useCase.ejecutar({
        almacen: { latitud: -13.6366, longitud: -72.8814 },
        pedidos: [
          { ...pedido, lineas: [{ ...pedido.lineas[0], cantidad: 100 }] },
        ],
        vehiculo,
      }),
    ).rejects.toThrow("supera la capacidad")
  })
})
