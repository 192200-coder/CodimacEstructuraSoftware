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
    lockRouteForApproval: vi.fn(async () => ({ status: "Calculada" })),
    updateRouteStatus: vi.fn(async () => true),
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
    startRoute: vi.fn(async () => true),
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
    lockStopForIncident: vi.fn(async () => null),
    insertIncident: vi.fn(async () => undefined),
    updateStopIncident: vi.fn(async () => undefined),
    openStopsForReordering: vi.fn(async () => []),
    reorderOpenStops: vi.fn(async () => undefined),
    lockNextOpenStop: vi.fn(async () => null),
    activateStop: vi.fn(async () => undefined),
    hasUnresolvedStops: vi.fn(async () => false),
    lockRouteForClosure: vi.fn(async () => ({ status: "En curso" })),
    closeRoute: vi.fn(async () => ({ vehicleId: "vehicle-1" })),
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

describe("división de carga en múltiples rutas", () => {
  function batchTransaction(weights: number[], capacities: number[]) {
    const tx = createTransaction()
    let sequence = 0
    let routeIndex = -1
    vi.mocked(tx.nextRouteSequence).mockImplementation(async () => ++sequence)
    vi.mocked(tx.insertRoute).mockImplementation(async ({ code }) => {
      routeIndex += 1
      return { id: `route-${routeIndex + 1}`, code }
    })
    vi.mocked(tx.lockOrders).mockImplementation(async (ids) =>
      ids.map((id) => ({ id, status: "Listo", activeRouteId: null })),
    )
    vi.mocked(tx.lockRouteForAssignment).mockResolvedValue({ status: "Aprobada" })
    vi.mocked(tx.lockAvailableDriver).mockResolvedValue(true)
    const vehicleCapacity = new Map<string, number>()
    capacities.forEach((capacity, index) => vehicleCapacity.set(`vehicle-${index + 1}`, capacity))
    vi.mocked(tx.lockAvailableVehicle).mockImplementation(async (id) => {
      const capacityKg = vehicleCapacity.get(id)
      return capacityKg === undefined ? null : { capacityKg }
    })
    vi.mocked(tx.routeWeight).mockImplementation(async (routeId) =>
      weights[Number(routeId.split("-")[1]) - 1] ?? 0,
    )
    return tx
  }

  const plan = (n: number) => ({
    orderIds: [`order-${n}`],
    distanceKm: 10,
    estimatedMinutes: 20,
    estimatedLiters: 2,
    estimatedCost: 12,
    driverId: `driver-${n}`,
    vehicleId: `vehicle-${n}`,
  })

  it("crea, aprueba y asigna R-001 y R-002 en una sola transacción sin tocar el stock", async () => {
    const tx = batchTransaction([2000, 1500], [2000, 1500])
    const repository = createRepository(tx)
    const useCases = createRouteUseCases(repository)

    const result = await useCases.createBatch({ routes: [plan(1), plan(2)], actorId: "dispatcher-1" })

    expect(repository.transaction).toHaveBeenCalledTimes(1)
    expect(result.map((route) => route.code)).toEqual(["R-001", "R-002"])
    expect(tx.assignRoute).toHaveBeenCalledWith("route-1", "driver-1", "vehicle-1")
    expect(tx.assignRoute).toHaveBeenCalledWith("route-2", "driver-2", "vehicle-2")
    expect(tx.lockDeliveryStock).not.toHaveBeenCalled()
    expect(tx.releaseStockReservation).not.toHaveBeenCalled()
    expect(tx.applyDeliveryStock).not.toHaveBeenCalled()
  })

  it("rechaza el lote completo si un lote supera la capacidad de su vehículo", async () => {
    const tx = batchTransaction([2000, 1800], [2000, 1500])
    const useCases = createRouteUseCases(createRepository(tx))

    await expect(
      useCases.createBatch({ routes: [plan(1), plan(2)], actorId: "dispatcher-1" }),
    ).rejects.toThrow("La carga supera la capacidad del vehículo")
    expect(tx.assignRoute).toHaveBeenCalledTimes(1)
  })

  it("rechaza pedidos, vehículos o choferes repetidos entre rutas del lote", async () => {
    const tx = batchTransaction([1, 1], [10, 10])
    const repository = createRepository(tx)
    const useCases = createRouteUseCases(repository)

    await expect(useCases.createBatch({
      routes: [plan(1), { ...plan(2), orderIds: ["order-1"] }],
      actorId: "dispatcher-1",
    })).rejects.toThrow("solo puede usarse en una ruta")
    await expect(useCases.createBatch({
      routes: [plan(1), { ...plan(2), vehicleId: "vehicle-1" }],
      actorId: "dispatcher-1",
    })).rejects.toThrow("solo puede usarse en una ruta")
    expect(repository.transaction).not.toHaveBeenCalled()
  })
})

describe("casos de uso de reparto", () => {
  it("valida pedidos, crea paradas y registra el cálculo del reparto", async () => {
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

    expect(result).toEqual({ id: "route-1", code: "R-001", status: "Calculada" })
    expect(tx.insertRouteStops).toHaveBeenCalledWith("route-1", ["order-1"])
    expect(tx.setOrdersActiveRoute).toHaveBeenCalledWith(["order-1"], "route-1")
    expect(tx.audit.registrar).toHaveBeenCalledWith(expect.objectContaining({
      accion: "Cálculo de reparto",
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

  it("aprueba explícitamente solo rutas Calculada", async () => {
    const tx = createTransaction()
    const useCases = createRouteUseCases(createRepository(tx))

    await useCases.approve("route-1", "dispatcher-1")

    expect(tx.updateRouteStatus).toHaveBeenCalledWith("route-1", "Aprobada")
    expect(tx.audit.registrar).toHaveBeenCalledWith(expect.objectContaining({
      accion: "Aprobación de reparto",
      valorAnterior: { estado: "Calculada" },
      valorNuevo: { estado: "Aprobada" },
    }))
  })

  it("crea nuevos repartos en estado Calculada antes de aprobar", async () => {
    const tx = createTransaction()
    const repository = createRepository(tx)
    const useCases = createRouteUseCases(repository)

    const route = await useCases.create({
      orderIds: ["order-1"],
      distanceKm: 10,
      estimatedMinutes: 25,
      estimatedLiters: 2,
      estimatedCost: 12,
      actorId: "dispatcher-1",
    })

    expect(route.status).toBe("Calculada")
    expect(tx.insertRoute).toHaveBeenCalledWith(expect.objectContaining({ status: "Calculada" }))
    expect(tx.insertStatusEvent).toHaveBeenCalledWith(expect.objectContaining({
      newStatus: "Calculada",
    }))
    expect(tx.audit.registrar).not.toHaveBeenCalledWith(expect.objectContaining({
      accion: "Aprobación de reparto",
    }))
  })

  it("rechaza aprobar una ruta que ya no está Calculada", async () => {
    const tx = createTransaction()
    vi.mocked(tx.lockRouteForApproval).mockResolvedValue({ status: "Cerrada" })
    const useCases = createRouteUseCases(createRepository(tx))

    await expect(useCases.approve("route-1", "dispatcher-1")).rejects.toMatchObject({
      code: "CONFLICT",
    })
    expect(tx.updateRouteStatus).not.toHaveBeenCalled()
  })

  it("asigna únicamente una ruta Aprobada", async () => {
    const tx = createTransaction()
    vi.mocked(tx.lockRouteForAssignment).mockResolvedValue({ status: "Aprobada" })
    vi.mocked(tx.lockAvailableDriver).mockResolvedValue(true)
    vi.mocked(tx.lockAvailableVehicle).mockResolvedValue({ capacityKg: 500 })
    const useCases = createRouteUseCases(createRepository(tx))

    await useCases.assign("route-1", "driver-1", "vehicle-1", "dispatcher-1")

    expect(tx.assignRoute).toHaveBeenCalledWith("route-1", "driver-1", "vehicle-1")
    expect(tx.insertStatusEvent).toHaveBeenCalledWith(expect.objectContaining({
      previousStatus: "Aprobada",
      newStatus: "Asignada",
    }))
  })

  it("bloquea la asignación cuando la carga supera la capacidad del vehículo", async () => {
    const tx = createTransaction()
    vi.mocked(tx.lockRouteForAssignment).mockResolvedValue({ status: "Aprobada" })
    vi.mocked(tx.lockAvailableDriver).mockResolvedValue(true)
    vi.mocked(tx.lockAvailableVehicle).mockResolvedValue({ capacityKg: 500 })
    vi.mocked(tx.routeWeight).mockResolvedValue(500.1)
    const useCases = createRouteUseCases(createRepository(tx))

    await expect(useCases.assign("route-1", "driver-1", "vehicle-1", "dispatcher-1"))
      .rejects.toMatchObject({ code: "CONFLICT" })

    expect(tx.assignRoute).not.toHaveBeenCalled()
    expect(tx.setVehicleAvailable).not.toHaveBeenCalled()
  })

  it("cancelar una ruta Asignada la elimina y libera el vehículo y el chofer", async () => {
    const tx = createTransaction()
    vi.mocked(tx.lockRouteForRemoval).mockResolvedValue({
      code: "R-001", status: "Asignada", vehicleId: "vehicle-1",
      distanceKm: 1, estimatedMinutes: 1, estimatedCost: 1,
    })
    const useCases = createRouteUseCases(createRepository(tx))

    await useCases.remove("route-1", "dispatcher-1")

    expect(tx.clearOrdersForRoute).toHaveBeenCalledWith("route-1")
    expect(tx.deleteRoute).toHaveBeenCalledWith("route-1")
    expect(tx.setVehicleAvailable).toHaveBeenCalledWith("vehicle-1", true)
  })

  it("no permite cancelar una ruta En curso", async () => {
    const tx = createTransaction()
    vi.mocked(tx.lockRouteForRemoval).mockResolvedValue({
      code: "R-001", status: "En curso", vehicleId: "vehicle-1",
      distanceKm: 1, estimatedMinutes: 1, estimatedCost: 1,
    })
    const useCases = createRouteUseCases(createRepository(tx))

    await expect(useCases.remove("route-1", "dispatcher-1")).rejects.toMatchObject({ code: "CONFLICT" })
    expect(tx.deleteRoute).not.toHaveBeenCalled()
    expect(tx.setVehicleAvailable).not.toHaveBeenCalled()
  })

  it("inicia la ruta en En curso y conserva En ruta para el estado del pedido", async () => {
    const tx = createTransaction()
    vi.mocked(tx.lockRouteForStart).mockResolvedValue({
      status: "Asignada",
      driverId: "driver-1",
    })
    vi.mocked(tx.lockFirstStop).mockResolvedValue({ id: "stop-1", orderId: "order-1" })
    vi.mocked(tx.lockRouteOrders).mockResolvedValue([{
      id: "order-1",
      status: "Listo",
      activeRouteId: "route-1",
    }])
    const useCases = createRouteUseCases(createRepository(tx))

    await useCases.start("route-1", "driver-1")

    expect(tx.startRoute).toHaveBeenCalledWith("route-1", "En curso")
    expect(tx.insertStatusEvent).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "Pedido",
      newStatus: "En ruta",
    }))
    expect(tx.insertStatusEvent).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "Ruta",
      newStatus: "En curso",
    }))
  })

  it("registra la salida de inventario al confirmar una entrega", async () => {
    const tx = createTransaction()
    vi.mocked(tx.lockStopForDelivery).mockResolvedValue({
      id: "stop-1",
      routeId: "route-1",
      orderId: "order-1",
      driverId: "driver-1",
      routeStatus: "En curso",
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

  it("marca No entregada y devuelve el pedido a Listo conservando sus reservas", async () => {
    const tx = createTransaction()
    vi.mocked(tx.lockStopForIncident).mockResolvedValue({
      id: "stop-1",
      routeId: "route-1",
      orderId: "order-1",
      driverId: "driver-1",
      routeStatus: "En curso",
      status: "En camino",
      attempts: 1,
      latitude: -13.5,
      longitude: -71.9,
    })
    const useCases = createRouteUseCases(createRepository(tx))

    await expect(useCases.reportIncident("stop-1", "Cliente ausente", null, "driver-1"))
      .resolves.toBe("No entregada")

    expect(tx.updateOrderStatus).toHaveBeenCalledWith("order-1", "Listo", null)
    expect(tx.lockDeliveryStock).not.toHaveBeenCalled()
    expect(tx.releaseStockReservation).not.toHaveBeenCalled()
    expect(tx.closeRoute).toHaveBeenCalledTimes(1)
  })

  it("rechaza un tercer intento antes de registrar otra incidencia", async () => {
    const tx = createTransaction()
    vi.mocked(tx.lockStopForIncident).mockResolvedValue({
      id: "stop-1",
      routeId: "route-1",
      orderId: "order-1",
      driverId: "driver-1",
      routeStatus: "En curso",
      status: "En camino",
      attempts: 2,
      latitude: -13.5,
      longitude: -71.9,
    })
    const useCases = createRouteUseCases(createRepository(tx))

    await expect(useCases.reportIncident("stop-1", "Cliente ausente", null, "driver-1"))
      .rejects.toThrow("máximo dos intentos")
    expect(tx.insertIncident).not.toHaveBeenCalled()
  })

  it("cierra la ruta una sola vez y no repite cierre si ya está Cerrada", async () => {
    const tx = createTransaction()
    vi.mocked(tx.lockStopForDelivery).mockResolvedValueOnce({
      id: "stop-1",
      routeId: "route-1",
      orderId: "order-1",
      driverId: "driver-1",
      routeStatus: "En curso",
      status: "En camino",
      attempts: 0,
      latitude: -13.5,
      longitude: -71.9,
    }).mockResolvedValueOnce({
      id: "stop-2",
      routeId: "route-1",
      orderId: "order-2",
      driverId: "driver-1",
      routeStatus: "En curso",
      status: "En camino",
      attempts: 0,
      latitude: -13.5,
      longitude: -71.9,
    })
    const useCases = createRouteUseCases(createRepository(tx))

    await useCases.deliver("stop-1", "María", "driver-1")
    expect(tx.closeRoute).toHaveBeenCalledTimes(1)

    vi.mocked(tx.lockRouteForClosure).mockResolvedValue({ status: "Cerrada" })
    await useCases.deliver("stop-2", "María", "driver-1")
    expect(tx.closeRoute).toHaveBeenCalledTimes(1)
  })
})
