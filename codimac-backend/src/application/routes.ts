import {
  canTransitionRouteStatus,
  nextIncident,
  isWithinRouteLimit,
  transitionRouteStatus,
  type RouteStatus,
} from "../domain/rules.js"
import {
  estimateStopArrivals,
  orderOpenStops,
  type Coordinates,
  type OpenStop,
} from "../domain/routing.js"
import { ApplicationError } from "./errors.js"
import { formatSequentialCode } from "./sequential-code.js"
import {
  registrarEventoAuditoria,
  type RegistroAuditoria,
} from "./registro-auditoria.js"

export interface CreateRouteInput {
  orderIds: string[]
  distanceKm: number
  estimatedMinutes: number
  estimatedLiters: number
  estimatedCost: number
  actorId: string
}

export interface CreateRouteBatchInput {
  routes: Array<Omit<CreateRouteInput, "actorId"> & { driverId: string; vehicleId: string }>
  actorId: string
}

export interface RouteOrder {
  id: string
  status: string
  activeRouteId: string | null
}

export interface RouteStopForEta extends Coordinates {
  id: string
}

export interface RouteStopForOrder extends RouteStopForEta {
  status: "Pendiente" | "Incidencia"
}

export interface DeliveryStockLine {
  productId: string
  quantity: number
  reserved: number | null
  totalStock: number
  reservedStock: number
}

export interface StopForDelivery {
  id: string
  routeId: string
  orderId: string
  driverId: string
  routeStatus: string
  status: string
  attempts: number
  latitude: number
  longitude: number
}

export interface RouteTransaction {
  readonly audit: RegistroAuditoria
  lockOrders(orderIds: string[]): Promise<RouteOrder[]>
  nextRouteSequence(): Promise<number>
  insertRoute(input: {
    code: string
    status: "Calculada"
    distanceKm: number
    estimatedMinutes: number
    estimatedLiters: number
    estimatedCost: number
    actorId: string
  }): Promise<{ id: string; code: string }>
  insertRouteStops(routeId: string, orderIds: string[]): Promise<void>
  setOrdersActiveRoute(orderIds: string[], routeId: string | null): Promise<void>
  clearOrdersForRoute(routeId: string): Promise<void>
  insertStatusEvent(event: {
    entityType: string
    entityId: string
    previousStatus?: string
    newStatus: string
    actorId: string
    routeId: string
    stopId?: string
  }): Promise<void>

  lockRouteForRemoval(routeId: string): Promise<{
    code: string
    status: string
    vehicleId: string | null
    distanceKm: number
    estimatedMinutes: number
    estimatedCost: number
  } | null>
  lockRouteForApproval(routeId: string): Promise<{ status: string } | null>
  updateRouteStatus(routeId: string, status: RouteStatus): Promise<boolean>
  deleteRouteStatusEvents(routeId: string): Promise<void>
  deleteRouteStops(routeId: string): Promise<void>
  deleteRoute(routeId: string): Promise<void>

  lockRouteForAssignment(routeId: string): Promise<{ status: string } | null>
  lockAvailableDriver(driverId: string): Promise<boolean>
  driverHasActiveRoute(driverId: string): Promise<boolean>
  lockAvailableVehicle(vehicleId: string): Promise<{ capacityKg: number } | null>
  vehicleHasActiveRoute(vehicleId: string): Promise<boolean>
  routeWeight(routeId: string): Promise<number>
  assignRoute(routeId: string, driverId: string, vehicleId: string): Promise<void>
  setVehicleAvailable(vehicleId: string, available: boolean): Promise<void>

  lockRouteForStart(routeId: string): Promise<{ status: string; driverId: string } | null>
  lockFirstStop(routeId: string): Promise<{ id: string; orderId: string } | null>
  startRoute(routeId: string, status: RouteStatus): Promise<boolean>
  updateStopStatus(stopId: string, status: string): Promise<void>
  lockRouteOrders(routeId: string): Promise<RouteOrder[]>
  updateOrderStatus(orderId: string, status: string, activeRouteId?: string | null): Promise<void>

  etaParameters(routeId: string): Promise<{
    averageSpeedKmh: number
    minutesPerStop: number
    warehouse: Coordinates
  } | null>
  etaStops(routeId: string): Promise<RouteStopForEta[]>
  stopCoordinates(stopId: string): Promise<Coordinates | null>
  updateStopEta(stopId: string, eta: Date): Promise<void>

  lockStopForDelivery(stopId: string): Promise<StopForDelivery | null>
  markStopDelivered(stopId: string, receivedBy: string): Promise<void>
  closeOpenIncidents(stopId: string): Promise<void>
  markOrderDelivered(orderId: string): Promise<void>
  lockDeliveryStock(orderId: string): Promise<DeliveryStockLine[]>
  applyDeliveryStock(productId: string, quantity: number): Promise<{ totalStock: number; reservedStock: number }>
  releaseStockReservation(orderId: string, productId: string): Promise<void>
  insertDeliveryMovement(input: {
    productId: string
    quantity: number
    orderId: string
    actorId: string
  }): Promise<void>
  lockStopForIncident(stopId: string): Promise<StopForDelivery | null>
  insertIncident(stopId: string, cause: string, notes: string | null, actorId: string): Promise<void>
  updateStopIncident(stopId: string, status: string, attempts: number): Promise<void>
  openStopsForReordering(routeId: string): Promise<RouteStopForOrder[]>
  reorderOpenStops(routeId: string, ordered: OpenStop[]): Promise<void>
  lockNextOpenStop(routeId: string): Promise<{
    id: string
    orderId: string
    stopStatus: string
    orderStatus: string
  } | null>
  activateStop(stopId: string, orderId: string, routeId: string): Promise<void>
  hasUnresolvedStops(routeId: string): Promise<boolean>
  lockRouteForClosure(routeId: string): Promise<{ status: string } | null>
  closeRoute(routeId: string): Promise<{ vehicleId: string } | null>
}

export interface RouteReadRepository {
  listRoutes(): Promise<unknown[]>
  listClosedHistory(): Promise<unknown[]>
  getDriverRoute(driverId: string): Promise<unknown | null>
  getClosedRouteSummary(routeId: string, driverId: string): Promise<unknown | null>
}

export interface RouteRepository extends RouteReadRepository {
  transaction<T>(operation: (tx: RouteTransaction) => Promise<T>): Promise<T>
}

export interface RouteUseCases {
  create(input: CreateRouteInput): Promise<{ id: string; code: string; status: "Calculada" }>
  createBatch(input: CreateRouteBatchInput): Promise<Array<{ id: string; code: string; status: "Asignada" }>>
  approve(routeId: string, actorId: string): Promise<void>
  remove(routeId: string, actorId: string): Promise<void>
  assign(routeId: string, driverId: string, vehicleId: string, actorId: string): Promise<void>
  start(routeId: string, actorId: string): Promise<void>
  deliver(stopId: string, receivedBy: string, actorId: string): Promise<void>
  reportIncident(
    stopId: string,
    cause: string,
    notes: string | null,
    actorId: string,
  ): Promise<"No entregada" | "Reprogramada">
  list(): Promise<unknown[]>
  closedHistory(): Promise<unknown[]>
  driverRoute(driverId: string): Promise<unknown | null>
  routeSummary(routeId: string, driverId: string): Promise<unknown | null>
}

export function createRouteUseCases(repository: RouteRepository): RouteUseCases {
  function requireRouteTransition(current: string, next: RouteStatus): RouteStatus {
    if (!canTransitionRouteStatus(current, next)) {
      throw new ApplicationError(
        "CONFLICT",
        `No se permite cambiar el estado de la ruta de ${current} a ${next}`,
      )
    }
    return transitionRouteStatus(current as RouteStatus, next)
  }

  async function assignInTransaction(
    tx: RouteTransaction,
    routeId: string,
    driverId: string,
    vehicleId: string,
    actorId: string,
  ): Promise<void> {
    const route = await tx.lockRouteForAssignment(routeId)
    if (!route) throw new ApplicationError("NOT_FOUND", "Reparto no encontrado")
    requireRouteTransition(route.status, "Asignada")
    if (!(await tx.lockAvailableDriver(driverId))) {
      throw new ApplicationError("CONFLICT", "El chofer no está disponible")
    }
    if (await tx.driverHasActiveRoute(driverId)) {
      throw new ApplicationError("CONFLICT", "El chofer ya tiene una ruta activa")
    }
    const vehicle = await tx.lockAvailableVehicle(vehicleId)
    if (!vehicle) throw new ApplicationError("CONFLICT", "El vehículo no está disponible")
    if (await tx.vehicleHasActiveRoute(vehicleId)) {
      throw new ApplicationError("CONFLICT", "El vehículo ya está asignado")
    }
    if (await tx.routeWeight(routeId) > vehicle.capacityKg) {
      throw new ApplicationError("CONFLICT", "La carga supera la capacidad del vehículo")
    }

    await tx.assignRoute(routeId, driverId, vehicleId)
    await tx.setVehicleAvailable(vehicleId, false)
    await tx.insertStatusEvent({
      entityType: "Ruta",
      entityId: routeId,
      previousStatus: "Aprobada",
      newStatus: "Asignada",
      actorId,
      routeId,
    })
    await registrarEventoAuditoria(tx.audit, {
      usuarioId: actorId,
      accion: "Asignación de reparto",
      entidad: "Ruta",
      entidadId: routeId,
      valorAnterior: { estado: "Aprobada" },
      valorNuevo: { estado: "Asignada", choferId: driverId, vehiculoId: vehicleId },
    })
  }

  async function recalculateEtas(
    tx: RouteTransaction,
    routeId: string,
    originStopId: string | null,
  ): Promise<void> {
    const parameters = await tx.etaParameters(routeId)
    if (!parameters) return
    const stops = await tx.etaStops(routeId)
    if (!stops.length) return
    let origin = parameters.warehouse
    if (originStopId) {
      const stopOrigin = await tx.stopCoordinates(originStopId)
      if (!stopOrigin) return
      origin = stopOrigin
    }
    const arrivals = estimateStopArrivals(
      origin,
      stops,
      parameters.averageSpeedKmh,
      parameters.minutesPerStop,
      new Date(),
    )
    for (const arrival of arrivals) await tx.updateStopEta(arrival.id, arrival.eta)
  }

  async function activateNextStop(
    tx: RouteTransaction,
    routeId: string,
    previousStopId: string,
    actorId: string,
  ): Promise<void> {
    const next = await tx.lockNextOpenStop(routeId)
    if (next) {
      await tx.activateStop(next.id, next.orderId, routeId)
      await registrarEventoAuditoria(tx.audit, {
        usuarioId: actorId,
        accion: "Cambio de estado",
        entidad: "Parada",
        entidadId: next.id,
        valorAnterior: { estado: next.stopStatus },
        valorNuevo: { estado: "En camino" },
      })
      await registrarEventoAuditoria(tx.audit, {
        usuarioId: actorId,
        accion: "Cambio de estado",
        entidad: "Pedido",
        entidadId: next.orderId,
        valorAnterior: { estado: next.orderStatus },
        valorNuevo: { estado: "En ruta" },
      })
      await recalculateEtas(tx, routeId, previousStopId)
      return
    }
    if (await tx.hasUnresolvedStops(routeId)) return
    const route = await tx.lockRouteForClosure(routeId)
    if (!route) throw new ApplicationError("NOT_FOUND", "Reparto no encontrado")
    if (route.status === "Cerrada") return
    requireRouteTransition(route.status, "Cerrada")
    const closed = await tx.closeRoute(routeId)
    if (!closed) throw new ApplicationError("CONFLICT", "No se pudo cerrar el reparto")
    await tx.clearOrdersForRoute(routeId)
    await tx.setVehicleAvailable(closed.vehicleId, true)
    await tx.insertStatusEvent({
      entityType: "Ruta",
      entityId: routeId,
      previousStatus: "En curso",
      newStatus: "Cerrada",
      actorId,
      routeId,
      stopId: previousStopId,
    })
    await registrarEventoAuditoria(tx.audit, {
      usuarioId: actorId,
      accion: "Cambio de estado",
      entidad: "Ruta",
      entidadId: routeId,
      valorAnterior: { estado: "En curso" },
      valorNuevo: { estado: "Cerrada" },
    })
  }

  async function createInTransaction(tx: RouteTransaction, input: CreateRouteInput) {
    if (!isWithinRouteLimit(input.orderIds.length)) {
      throw new ApplicationError("VALIDATION_ERROR", "La ruta debe tener entre 1 y 10 paradas")
    }
    const orders = await tx.lockOrders(input.orderIds)
    if (orders.length !== input.orderIds.length) {
      throw new ApplicationError("NOT_FOUND", "Uno o más pedidos no existen")
    }
    if (orders.some((order) => order.status !== "Listo" || order.activeRouteId)) {
      throw new ApplicationError("CONFLICT", "Todos los pedidos deben estar Listo y sin reparto activo")
    }
    const code = formatSequentialCode("R", await tx.nextRouteSequence())
    const route = await tx.insertRoute({
      code,
      status: "Calculada",
      distanceKm: input.distanceKm,
      estimatedMinutes: input.estimatedMinutes,
      estimatedLiters: input.estimatedLiters,
      estimatedCost: input.estimatedCost,
      actorId: input.actorId,
    })
    await tx.insertRouteStops(route.id, input.orderIds)
    await tx.setOrdersActiveRoute(input.orderIds, route.id)
    await tx.insertStatusEvent({
      entityType: "Ruta",
      entityId: route.id,
      newStatus: "Calculada",
      actorId: input.actorId,
      routeId: route.id,
    })
    await registrarEventoAuditoria(tx.audit, {
      usuarioId: input.actorId,
      accion: "Cálculo de reparto",
      entidad: "Ruta",
      entidadId: route.id,
      valorAnterior: null,
      valorNuevo: { codigo: code, estado: "Calculada", pedidos: input.orderIds },
    })
    return {
      id: route.id,
      code: route.code,
      status: "Calculada" as const,
    }
  }

  async function approveInTransaction(tx: RouteTransaction, routeId: string, actorId: string) {
    const route = await tx.lockRouteForApproval(routeId)
    if (!route) throw new ApplicationError("NOT_FOUND", "Reparto no encontrado")
    const nextStatus = requireRouteTransition(route.status, "Aprobada")
    if (!(await tx.updateRouteStatus(routeId, nextStatus))) {
      throw new ApplicationError("CONFLICT", "No se pudo aprobar el reparto")
    }
    await tx.insertStatusEvent({
      entityType: "Ruta",
      entityId: routeId,
      previousStatus: route.status,
      newStatus: nextStatus,
      actorId,
      routeId,
    })
    await registrarEventoAuditoria(tx.audit, {
      usuarioId: actorId,
      accion: "Aprobación de reparto",
      entidad: "Ruta",
      entidadId: routeId,
      valorAnterior: { estado: route.status },
      valorNuevo: { estado: nextStatus },
    })
  }

  return {
    create(input) {
      return repository.transaction((tx) => createInTransaction(tx, input))
    },
    async createBatch(input) {
      if (!input.routes.length) {
        throw new ApplicationError("VALIDATION_ERROR", "Indica al menos una ruta")
      }
      const orderIds = input.routes.flatMap((route) => route.orderIds)
      const vehicleIds = input.routes.map((route) => route.vehicleId)
      const driverIds = input.routes.map((route) => route.driverId)
      if (
        new Set(orderIds).size !== orderIds.length ||
        new Set(vehicleIds).size !== vehicleIds.length ||
        new Set(driverIds).size !== driverIds.length
      ) {
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "Cada pedido, vehículo y chofer solo puede usarse en una ruta del lote",
        )
      }
      // Una sola transacción: si una ruta falla (p. ej. capacidad), no se crea ninguna.
      return repository.transaction(async (tx) => {
        const created: Array<{ id: string; code: string; status: "Asignada" }> = []
        for (const plan of input.routes) {
          const route = await createInTransaction(tx, { ...plan, actorId: input.actorId })
          await approveInTransaction(tx, route.id, input.actorId)
          await assignInTransaction(tx, route.id, plan.driverId, plan.vehicleId, input.actorId)
          created.push({ id: route.id, code: route.code, status: "Asignada" })
        }
        return created
      })
    },
    async approve(routeId, actorId) {
      await repository.transaction((tx) => approveInTransaction(tx, routeId, actorId))
    },
    async remove(routeId, actorId) {
      await repository.transaction(async (tx) => {
        const route = await tx.lockRouteForRemoval(routeId)
        if (!route) throw new ApplicationError("NOT_FOUND", "Reparto no encontrado")
        if (!["Calculada", "Aprobada", "Asignada"].includes(route.status)) {
          throw new ApplicationError("CONFLICT", "Solo se puede cancelar un reparto que aún no inició")
        }
        await registrarEventoAuditoria(tx.audit, {
          usuarioId: actorId,
          accion: "Retiro de reparto",
          entidad: "Ruta",
          entidadId: routeId,
          valorAnterior: {
            codigo: route.code,
            estado: route.status,
            distanciaKm: route.distanceKm,
            minutosEstimados: route.estimatedMinutes,
            costoEstimado: route.estimatedCost,
          },
          valorNuevo: null,
        })
        await tx.clearOrdersForRoute(routeId)
        await tx.deleteRouteStatusEvents(routeId)
        await tx.deleteRouteStops(routeId)
        await tx.deleteRoute(routeId)
        // El chofer queda libre al desaparecer la ruta; el vehículo se libera explícitamente.
        if (route.status === "Asignada" && route.vehicleId) {
          await tx.setVehicleAvailable(route.vehicleId, true)
        }
      })
    },
    async assign(routeId, driverId, vehicleId, actorId) {
      await repository.transaction((tx) =>
        assignInTransaction(tx, routeId, driverId, vehicleId, actorId),
      )
    },
    async start(routeId, actorId) {
      await repository.transaction(async (tx) => {
        const route = await tx.lockRouteForStart(routeId)
        if (!route) throw new ApplicationError("NOT_FOUND", "Reparto no encontrado")
        if (route.driverId !== actorId || route.status !== "Asignada") {
          throw new ApplicationError("CONFLICT", "La ruta no está asignada a este chofer")
        }
        const routeStatus = requireRouteTransition(route.status, "En curso")
        const firstStop = await tx.lockFirstStop(routeId)
        if (!firstStop) throw new ApplicationError("CONFLICT", "El reparto no tiene paradas")
        if (!(await tx.startRoute(routeId, routeStatus))) {
          throw new ApplicationError("CONFLICT", "No se pudo iniciar el reparto")
        }
        await tx.updateStopStatus(firstStop.id, "En camino")
        const orders = await tx.lockRouteOrders(routeId)
        for (const order of orders) {
          if (order.status !== "Listo" || order.activeRouteId !== routeId) {
            throw new ApplicationError("CONFLICT", "El reparto contiene un pedido que ya no está disponible")
          }
          await tx.updateOrderStatus(order.id, "En ruta")
          await tx.insertStatusEvent({
            entityType: "Pedido",
            entityId: order.id,
            previousStatus: "Listo",
            newStatus: "En ruta",
            actorId,
            routeId,
          })
        }
        await tx.insertStatusEvent({
          entityType: "Ruta",
          entityId: routeId,
          previousStatus: "Asignada",
          newStatus: "En curso",
          actorId,
          routeId,
        })
        await registrarEventoAuditoria(tx.audit, {
          usuarioId: actorId,
          accion: "Cambio de estado",
          entidad: "Ruta",
          entidadId: routeId,
          valorAnterior: { estado: "Asignada" },
          valorNuevo: { estado: "En curso" },
        })
        await registrarEventoAuditoria(tx.audit, {
          usuarioId: actorId,
          accion: "Cambio de estado",
          entidad: "Parada",
          entidadId: firstStop.id,
          valorAnterior: { estado: "Pendiente" },
          valorNuevo: { estado: "En camino" },
        })
        for (const order of orders) {
          await registrarEventoAuditoria(tx.audit, {
            usuarioId: actorId,
            accion: "Cambio de estado",
            entidad: "Pedido",
            entidadId: order.id,
            valorAnterior: { estado: "Listo" },
            valorNuevo: { estado: "En ruta" },
          })
        }
        await recalculateEtas(tx, routeId, null)
      })
    },
    async deliver(stopId, receivedBy, actorId) {
      await repository.transaction(async (tx) => {
        const stop = await tx.lockStopForDelivery(stopId)
        if (!stop) throw new ApplicationError("NOT_FOUND", "Parada no encontrada")
        if (stop.driverId !== actorId || stop.routeStatus !== "En curso" || stop.status !== "En camino") {
          throw new ApplicationError("CONFLICT", "La parada no pertenece a una ruta activa del chofer")
        }
        await tx.markStopDelivered(stopId, receivedBy)
        await tx.markOrderDelivered(stop.orderId)
        await tx.closeOpenIncidents(stopId)
        await tx.insertStatusEvent({
          entityType: "Pedido",
          entityId: stop.orderId,
          previousStatus: "En ruta",
          newStatus: "Entregado",
          actorId,
          routeId: stop.routeId,
          stopId,
        })
        await registrarEventoAuditoria(tx.audit, {
          usuarioId: actorId,
          accion: "Cambio de estado",
          entidad: "Parada",
          entidadId: stopId,
          valorAnterior: { estado: "En camino" },
          valorNuevo: { estado: "Entregada", recibidoPor: receivedBy },
        })
        await registrarEventoAuditoria(tx.audit, {
          usuarioId: actorId,
          accion: "Cambio de estado",
          entidad: "Pedido",
          entidadId: stop.orderId,
          valorAnterior: { estado: "En ruta" },
          valorNuevo: { estado: "Entregado" },
        })
        const items = await tx.lockDeliveryStock(stop.orderId)
        for (const item of items) {
          if (item.reserved === null || item.reserved < item.quantity) {
            throw new ApplicationError("CONFLICT", "No hay reserva de stock activa para completar la entrega")
          }
          const updated = await tx.applyDeliveryStock(item.productId, item.quantity)
          await tx.releaseStockReservation(stop.orderId, item.productId)
          await tx.insertDeliveryMovement({
            productId: item.productId,
            quantity: -item.quantity,
            orderId: stop.orderId,
            actorId,
          })
          await registrarEventoAuditoria(tx.audit, {
            usuarioId: actorId,
            accion: "Salida de inventario por entrega",
            entidad: "Inventario",
            entidadId: item.productId,
            valorAnterior: {
              existencias: item.totalStock,
              reservadas: item.reservedStock,
              pedidoId: stop.orderId,
              cantidad: item.quantity,
            },
            valorNuevo: {
              existencias: updated.totalStock,
              reservadas: updated.reservedStock,
            },
          })
        }
        await tx.insertStatusEvent({
          entityType: "Parada",
          entityId: stopId,
          previousStatus: "En camino",
          newStatus: "Entregada",
          actorId,
          routeId: stop.routeId,
          stopId,
        })
        await activateNextStop(tx, stop.routeId, stopId, actorId)
      })
    },
    async reportIncident(stopId, cause, notes, actorId) {
      return repository.transaction(async (tx) => {
        const stop = await tx.lockStopForIncident(stopId)
        if (!stop) throw new ApplicationError("NOT_FOUND", "Parada no encontrada")
        if (stop.driverId !== actorId || stop.routeStatus !== "En curso" || stop.status !== "En camino") {
          throw new ApplicationError("CONFLICT", "La parada no pertenece a una ruta activa del chofer")
        }
        const incident = nextIncident(stop.attempts)
        await tx.insertIncident(stopId, cause, notes, actorId)
        await tx.updateStopIncident(stopId, incident.status, incident.attempts)
        if (incident.status === "No entregada") {
          await tx.closeOpenIncidents(stopId)
          await tx.updateOrderStatus(stop.orderId, "Listo", null)
          await tx.insertStatusEvent({
            entityType: "Pedido",
            entityId: stop.orderId,
            routeId: stop.routeId,
            stopId,
            actorId,
            previousStatus: "En ruta",
            newStatus: "Listo",
          })
          await registrarEventoAuditoria(tx.audit, {
            usuarioId: actorId,
            accion: "Cambio de estado",
            entidad: "Pedido",
            entidadId: stop.orderId,
            valorAnterior: { estado: "En ruta" },
            valorNuevo: { estado: "Listo" },
          })
          await tx.insertStatusEvent({
            entityType: "Parada",
            entityId: stopId,
            routeId: stop.routeId,
            stopId,
            actorId,
            previousStatus: "En camino",
            newStatus: "No entregada",
          })
          await registrarEventoAuditoria(tx.audit, {
            usuarioId: actorId,
            accion: "Incidencia y cambio de estado",
            entidad: "Parada",
            entidadId: stopId,
            valorAnterior: { estado: "En camino", intentos: stop.attempts },
            valorNuevo: {
              estado: "No entregada",
              intentos: incident.attempts,
              causa: cause,
              detalle: notes,
            },
          })
        } else {
          await tx.insertStatusEvent({
            entityType: "Parada",
            entityId: stopId,
            routeId: stop.routeId,
            stopId,
            actorId,
            previousStatus: "En camino",
            newStatus: "Incidencia",
          })
          await registrarEventoAuditoria(tx.audit, {
            usuarioId: actorId,
            accion: "Incidencia y cambio de estado",
            entidad: "Parada",
            entidadId: stopId,
            valorAnterior: { estado: "En camino", intentos: stop.attempts },
            valorNuevo: {
              estado: "Incidencia",
              intentos: incident.attempts,
              causa: cause,
              detalle: notes,
            },
          })
          const ordered = orderOpenStops(
            { latitude: stop.latitude, longitude: stop.longitude },
            await tx.openStopsForReordering(stop.routeId),
          )
          await tx.reorderOpenStops(stop.routeId, ordered)
        }
        await activateNextStop(tx, stop.routeId, stopId, actorId)
        return incident.status === "No entregada" ? "No entregada" : "Reprogramada"
      })
    },
    list: () => repository.listRoutes(),
    closedHistory: () => repository.listClosedHistory(),
    driverRoute: (driverId) => repository.getDriverRoute(driverId),
    async routeSummary(routeId, driverId) {
      const summary = await repository.getClosedRouteSummary(routeId, driverId)
      if (!summary) throw new ApplicationError("NOT_FOUND", "No se encontró el resumen de esta ruta")
      return summary
    },
  }
}
