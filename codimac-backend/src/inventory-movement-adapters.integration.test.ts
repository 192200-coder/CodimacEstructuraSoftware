import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock("./db/pool.js", () => ({
  pool: { query: mocks.query },
  inTransaction: vi.fn(async (operation: (client: { query: typeof mocks.query }) => Promise<unknown>) =>
    operation({ query: mocks.query })),
}))

import { PostgresCatalogRepository } from "./adapters/postgres-catalog-repository.js"
import { PostgresOrderRepository } from "./adapters/postgres-order-repository.js"
import { PostgresRouteRepository } from "./adapters/postgres-route-repository.js"

const query = vi.mocked(mocks.query)

beforeEach(() => {
  query.mockReset()
  query.mockResolvedValue({ rows: [], rowCount: 1 } as never)
})

describe("persistencia transaccional de movimientos de inventario", () => {
  it.each([
    ["Entrada", "ENTRADA"],
    ["Ajuste", "AJUSTE"],
  ] as const)("guarda %s con el tipo de esquema %s", async (movementType, dbType) => {
    const repository = new PostgresCatalogRepository({ hash: vi.fn(async () => "hash") })

    await repository.transaction((tx) => tx.insertInventoryMovement({
      productId: "product-1",
      movementType,
      quantity: 4,
      reason: movementType === "Ajuste" ? "Conteo físico" : null,
      observation: movementType === "Entrada" ? "Recepción" : null,
      detail: null,
      actorId: "user-1",
    }))

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO inventory_movements"),
      ["product-1", dbType, 4, movementType === "Ajuste" ? "Conteo físico" : null,
        movementType === "Entrada" ? "Recepción" : null, null, "user-1"],
    )
  })

  it("registra RESERVA dentro de la transacción de preparación", async () => {
    const repository = new PostgresOrderRepository()

    await repository.transaction((tx) => tx.reserveOrderItem({
      orderId: "order-1",
      productId: "product-1",
      quantity: 4,
      actorId: "user-1",
    }))

    expect(query.mock.calls[2]?.[0]).toContain("VALUES($1,'RESERVA',$2,$3,$4,$5)")
    expect(query.mock.calls[2]?.[1]).toEqual([
      "product-1", 4, "Reserva para pedido order-1", "user-1", "order-1",
    ])
  })

  it("registra LIBERACION al liberar la reserva por cancelación", async () => {
    const repository = new PostgresOrderRepository()
    query.mockResolvedValueOnce({ rows: [{ total_stock: 10, reserved_stock: 2 }], rowCount: 1 } as never)
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)

    await repository.transaction((tx) => tx.releaseReservation({
      orderId: "order-1",
      productId: "product-1",
      quantity: 4,
      actorId: "user-1",
    }))

    expect(query.mock.calls[2]?.[0]).toContain("VALUES($1,'LIBERACION',$2,$3,$4,$5)")
    expect(query.mock.calls[2]?.[1]).toEqual([
      "product-1", 4, "Liberación por cancelación del pedido order-1", "user-1", "order-1",
    ])
  })

  it("registra SALIDA al confirmar una entrega", async () => {
    const repository = new PostgresRouteRepository()

    await repository.transaction((tx) => tx.insertDeliveryMovement({
      orderId: "order-1",
      productId: "product-1",
      quantity: -4,
      actorId: "driver-1",
    }))

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES($1,'SALIDA',$2,$3,$4,$5)"),
      ["product-1", -4, "Entrega del pedido order-1", "driver-1", "order-1"],
    )
  })

  it("registra LIBERACION tras agotar los intentos de entrega", async () => {
    const repository = new PostgresRouteRepository()
    query.mockResolvedValueOnce({ rows: [{ id: "product-1" }], rowCount: 1 } as never)
    query.mockResolvedValueOnce({ rows: [{ id: "reservation-1" }], rowCount: 1 } as never)
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)

    await repository.transaction((tx) => tx.releaseFailedDeliveryReservation({
      orderId: "order-1",
      productId: "product-1",
      quantity: 4,
      actorId: "driver-1",
    }))

    expect(query.mock.calls[2]?.[0]).toContain("VALUES($1,'LIBERACION',$2,$3,$4,$5)")
    expect(query.mock.calls[2]?.[1]).toEqual([
      "product-1", 4, "Liberación por entrega fallida del pedido order-1", "driver-1", "order-1",
    ])
  })
})
