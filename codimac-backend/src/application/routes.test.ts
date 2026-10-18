import { describe, expect, it, vi } from "vitest"
import type { RouteRepository, RouteTransaction } from "./routes.js"
import { createRouteUseCases } from "./routes.js"

function createTransaction(): RouteTransaction {
  return {
    audit: { registrar: vi.fn(async () => undefined) },
    lockOrders: vi.fn(async () => [{
      id: "order-1",
      status: "Listo",
      activeRouteId: null,
    }]),
    nextRouteSequence: vi.fn(async () => 1),
    insertRoute: vi.fn(async ({ code }) => ({ id: "route-1", code })),
    insertRouteStops: vi.fn(async () => undefined),
    setOrdersActiveRoute: vi.fn(async () => undefined),
    clearOrdersForRoute: vi.fn(async () => undefined),
    insertStatusEvent: vi.fn(async () => undefined),
    lockRouteForRemoval: vi.fn(async () => null),
    deleteRouteStatusEvents: vi.fn(async () => undefined),
    deleteRouteStops: vi.fn(async () => undefined),
    deleteRoute: vi.fn(async () => undefined),
    lockRouteForAssignment: vi.fn(async () => null),
    lockAvailableDriver: vi.fn(async () => false),
    driverHasActiveRoute: vi.fn(async () => false),
    lockAvailableVehicle: vi.fn(async () => null),
    vehicleHasActiveRoute: vi.fn(async () => false),
    routeWeight: vi.fn(async () => 0),
    assignRoute: vi.fn(async () => undefined),
    setVehicleAvailable: vi.fn(async () => undefined),
    lockRouteForStart: vi.fn(async () => null),
    lockFirstStop: vi.fn(async () => null),
    startRoute: vi.fn(async () => undefined),
    updateStopStatus: vi.fn(async () => undefined),
    lockRouteOrders: vi.fn(async () => []),
    updateOrderStatus: vi.fn(async () => undefined),
    etaParameters: vi.fn(async () => null),
    etaStops: vi.fn(async () => []),
    stopCoordinates: vi.fn(async () => null),
    updateStopEta: vi.fn(async () => undefined),
    lockStopForDelivery: vi.fn(async () => null),
    markStopDelivered: vi.fn(async () => undefined),
    closeOpenIncidents: vi.fn(async () => undefined),
    markOrderDelivered: vi.fn(async () => undefined),
    lockDeliveryStock: vi.fn(async () => []),
    applyDeliveryStock: vi.fn(async () => ({ totalStock: 0, reservedStock: 0 })),
    releaseStockReservation: vi.fn(async () => undefined),
    insertDeliveryMovement: vi.fn(async () => undefined),
    releaseFailedDeliveryReservation: vi.fn(async () => undefined),
    lockStopForIncident: vi.fn(async () => null),
    insertIncident: vi.fn(async () => undefined),
    updateStopIncident: vi.fn(async () => undefined),
    openStopsForReordering: vi.fn(async () => []),
    reorderOpenStops: vi.fn(async () => undefined),
    lockNextOpenStop: vi.fn(async () => null),
    activateStop: vi.fn(async () => undefined),
    hasUnresolvedStops: vi.fn(async () => false),
    closeRoute: vi.fn(async () => null),
  }
}

function createRepository(tx: RouteTransaction): RouteRepository {
  return {
    transaction: vi.fn(async (operation) => operation(tx)),
    listRoutes: vi.fn(async () => []),
    listClosedHistory: vi.fn(async () => []),
    getDriverRoute: vi.fn(async () => null),
    getClosedRouteSummary: vi.fn(async () => null),
  }
}

describe("casos de uso de reparto", () => {
  it("valida pedidos, crea paradas y registra auditoría al aprobar un reparto", async () => {
    const tx = createTransaction()
    const repository = createRepository(tx)
    const useCases = createRouteUseCases(repository)

    const result = await useCases.create({
      orderIds: ["order-1"],
      distanceKm: 10,
      estimatedMinutes: 25,
      estimatedLiters: 2,
      estimatedCost: 12,
      actorId: "dispatcher-1",
    })

    expect(result).toEqual({ id: "route-1", code: "R-001", status: "Aprobada" })
    expect(tx.insertRouteStops).toHaveBeenCalledWith("route-1", ["order-1"])
    expect(tx.setOrdersActiveRoute).toHaveBeenCalledWith(["order-1"], "route-1")
    expect(tx.audit.registrar).toHaveBeenCalledWith(expect.objectContaining({
      accion: "Aprobación de reparto",
      entidadId: "route-1",
    }))
  })

  it("rechaza pedidos no Listos antes de crear el reparto", async () => {
    const tx = createTransaction()
    vi.mocked(tx.lockOrders).mockResolvedValueOnce([{
      id: "order-1",
      status: "Pendiente",
      activeRouteId: null,
    }])
    const repository = createRepository(tx)
    const useCases = createRouteUseCases(repository)

    await expect(useCases.create({
      orderIds: ["order-1"],
      distanceKm: 10,
      estimatedMinutes: 25,
      estimatedLiters: 2,
      estimatedCost: 12,
      actorId: "dispatcher-1",
    })).rejects.toThrow("Todos los pedidos deben estar Listo")

    expect(tx.insertRoute).not.toHaveBeenCalled()
  })

  it("registra la salida de inventario al confirmar una entrega", async () => {
    const tx = createTransaction()
    vi.mocked(tx.lockStopForDelivery).mockResolvedValue({
      id: "stop-1",
      routeId: "route-1",
      orderId: "order-1",
      driverId: "driver-1",
      routeStatus: "En ruta",
      status: "En camino",
      attempts: 0,
      latitude: -13.5,
      longitude: -71.9,
    })
    vi.mocked(tx.lockDeliveryStock).mockResolvedValue([{
      productId: "product-1",
      quantity: 3,
      reserved: 3,
      totalStock: 10,
      reservedStock: 3,
    }])
    const useCases = createRouteUseCases(createRepository(tx))

    await useCases.deliver("stop-1", "María", "driver-1")

    expect(tx.insertDeliveryMovement).toHaveBeenCalledWith({
      productId: "product-1",
      quantity: -3,
      orderId: "order-1",
      actorId: "driver-1",
    })
  })

  it("libera reservas y registra LIBERACION al agotar intentos de entrega", async () => {
    const tx = createTransaction()
    vi.mocked(tx.lockStopForIncident).mockResolvedValue({
      id: "stop-1",
      routeId: "route-1",
      orderId: "order-1",
      driverId: "driver-1",
      routeStatus: "En ruta",
      status: "En camino",
      attempts: 1,
      latitude: -13.5,
      longitude: -71.9,
    })
    vi.mocked(tx.lockDeliveryStock).mockResolvedValue([{
      productId: "product-1",
      quantity: 3,
      reserved: 3,
      totalStock: 10,
      reservedStock: 3,
    }])
    const useCases = createRouteUseCases(createRepository(tx))

    await expect(useCases.reportIncident("stop-1", "Cliente ausente", null, "driver-1"))
      .resolves.toBe("No entregada")

    expect(tx.releaseFailedDeliveryReservation).toHaveBeenCalledWith({
      productId: "product-1",
      quantity: 3,
      orderId: "order-1",
      actorId: "driver-1",
    })
  })
})
