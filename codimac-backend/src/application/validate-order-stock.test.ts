import { describe, expect, it } from "vitest"
import { validateOrderStock } from "./validate-order-stock.js"

describe("validación de disponibilidad al registrar pedidos", () => {
  it("devuelve el disponible y faltante por cada línea que excede el stock", () => {
    expect(validateOrderStock(
      [{ productId: "cemento", quantity: 1000 }],
      [{
        id: "cemento",
        name: "Cemento tipo I",
        totalStock: 100,
        reservedStock: 15,
      }],
    )).toEqual([{
      field: "lineas[0].cantidad",
      code: "STOCK_INSUFICIENTE",
      message: "Solo hay 85 unidades disponibles de Cemento tipo I; faltan 915.",
    }])
  })

  it("acepta una cantidad igual al disponible y rechaza cada línea insuficiente", () => {
    const products = [{
      id: "cemento",
      name: "Cemento tipo I",
      totalStock: 100,
      reservedStock: 15,
    }]
    expect(validateOrderStock([{ productId: "cemento", quantity: 85 }], products)).toEqual([])
    expect(validateOrderStock([
      { productId: "cemento", quantity: 86 },
      { productId: "cemento", quantity: 90 },
    ], products)).toHaveLength(2)
  })

  it("al preparar avisa el faltante y que el pedido sigue en Pendiente (RN-02, E-03)", () => {
    expect(validateOrderStock(
      [{ productId: "cemento", quantity: 60 }],
      [{ id: "cemento", name: "Cemento tipo I", totalStock: 85, reservedStock: 60 }],
      "preparacion",
    )).toEqual([{
      field: "lineas[0].cantidad",
      code: "STOCK_INSUFICIENTE",
      message: "Stock insuficiente: faltan 35 unidades de Cemento tipo I. El pedido sigue en Pendiente.",
    }])
  })
})
