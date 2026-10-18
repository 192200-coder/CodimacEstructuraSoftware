import { ApplicationError } from "./errors.js"
import { formatSequentialCode } from "./sequential-code.js"
import { validateOrderStock } from "./validate-order-stock.js"
import {
  registrarEventoAuditoria,
  type RegistroAuditoria,
} from "./registro-auditoria.js"

export interface OrderLineInput {
  productId: string
  quantity: number
}

export interface CreateOrderInput {
  clientId: string
  deadlineAt?: string | null
  items: OrderLineInput[]
}

export interface OrderStockProduct {
  id: string
  name: string
  totalStock: number
  reservedStock: number
}

export interface OrderPreparationItem extends OrderStockProduct {
  quantity: number
}

export interface OrderSnapshot {
  status: string
  activeRouteId: string | null
}

export interface OrderReservation {
  productId: string
  quantity: number
}

export interface OrderRepositoryTransaction {
  readonly audit: RegistroAuditoria
  lockProducts(productIds: string[]): Promise<OrderStockProduct[]>
  nextOrderSequence(): Promise<number>
  insertOrder(input: {
    code: string
    clientId: string
    deadlineAt: string | null
    actorId: string
  }): Promise<{ id: string; code: string; status: string; deadline_at: string | null }>
  insertOrderItems(orderId: string, items: OrderLineInput[]): Promise<void>
  lockOrder(orderId: string): Promise<OrderSnapshot | null>
  lockOrderItemsForPreparation(orderId: string): Promise<OrderPreparationItem[]>
  reserveOrderItem(input: {
    orderId: string
    productId: string
    quantity: number
    actorId: string
  }): Promise<void>
  lockActiveRoute(routeId: string, orderId: string): Promise<boolean>
  removeOrderFromUnstartedRoute(routeId: string, orderId: string): Promise<boolean>
  lockActiveReservations(orderId: string): Promise<OrderReservation[]>
  releaseReservation(input: {
    orderId: string
    productId: string
    quantity: number
    actorId: string
  }): Promise<{ totalStock: number; reservedStock: number } | null>
  updateOrderStatus(orderId: string, status: string, clearRoute?: boolean): Promise<void>
  insertOrderStatusEvent(
    orderId: string,
    previousStatus: string,
    newStatus: string,
    actorId: string,
  ): Promise<void>
}

export interface OrderRepository {
  transaction<T>(operation: (tx: OrderRepositoryTransaction) => Promise<T>): Promise<T>
  listOrders(): Promise<unknown[]>
  listOrderEvents(orderId: string): Promise<unknown[]>
}

export interface OrderUseCases {
  create(input: CreateOrderInput & { actorId: string }): Promise<{
    id: string
    code: string
    status: string
    deadline_at: string | null
  }>
  prepare(orderId: string, actorId: string): Promise<void>
  cancel(orderId: string, actorId: string): Promise<void>
  markReady(orderId: string, actorId: string): Promise<void>
  list(): Promise<unknown[]>
  events(orderId: string): Promise<unknown[]>
}

export function createOrderUseCases(repository: OrderRepository): OrderUseCases {
  return {
    async create(input) {
      return repository.transaction(async (tx) => {
        const products = await tx.lockProducts(input.items.map((item) => item.productId))
        const stockErrors = validateOrderStock(input.items, products)
        if (stockErrors.length) {
          throw new ApplicationError("VALIDATION_ERROR", "Revisa los campos marcados.", stockErrors)
        }
        const code = formatSequentialCode("PED", await tx.nextOrderSequence())
        const order = await tx.insertOrder({
          code,
          clientId: input.clientId,
          deadlineAt: input.deadlineAt ?? null,
          actorId: input.actorId,
        })
        await tx.insertOrderItems(order.id, input.items)
        await registrarEventoAuditoria(tx.audit, {
          usuarioId: input.actorId,
          accion: "Alta de pedido",
          entidad: "Pedido",
          entidadId: order.id,
          valorAnterior: null,
          valorNuevo: {
            codigo: order.code,
            estado: order.status,
            clienteId: input.clientId,
            fechaLimite: input.deadlineAt ?? null,
            lineas: input.items,
          },
        })
        return order
      })
    },
    async prepare(orderId, actorId) {
      await repository.transaction(async (tx) => {
        const order = await tx.lockOrder(orderId)
        if (!order) throw new ApplicationError("NOT_FOUND", "Pedido no encontrado")
        if (order.status !== "Pendiente") {
          throw new ApplicationError("CONFLICT", "El pedido debe estar Pendiente")
        }
        const items = await tx.lockOrderItemsForPreparation(orderId)
        if (!items.length) throw new ApplicationError("CONFLICT", "El pedido no tiene productos")
        const stockErrors = validateOrderStock(
          items.map(({ id: productId, quantity }) => ({ productId, quantity })),
          items,
        )
        if (stockErrors.length) {
          throw new ApplicationError("VALIDATION_ERROR", "Revisa los campos marcados.", stockErrors)
        }
        for (const item of items) {
          await tx.reserveOrderItem({
            orderId,
            productId: item.id,
            quantity: item.quantity,
            actorId,
          })
          await registrarEventoAuditoria(tx.audit, {
            usuarioId: actorId,
            accion: "Reserva de inventario",
            entidad: "Inventario",
            entidadId: item.id,
            valorAnterior: {
              existencias: item.totalStock,
              reservadas: item.reservedStock,
            },
            valorNuevo: {
              existencias: item.totalStock,
              reservadas: item.reservedStock + item.quantity,
              pedidoId: orderId,
              cantidad: item.quantity,
            },
          })
        }
        await tx.updateOrderStatus(orderId, "En preparación")
        await tx.insertOrderStatusEvent(orderId, "Pendiente", "En preparación", actorId)
        await registrarEventoAuditoria(tx.audit, {
          usuarioId: actorId,
          accion: "Cambio de estado",
          entidad: "Pedido",
          entidadId: orderId,
          valorAnterior: { estado: "Pendiente" },
          valorNuevo: { estado: "En preparación" },
        })
      })
    },
    async cancel(orderId, actorId) {
      await repository.transaction(async (tx) => {
        const order = await tx.lockOrder(orderId)
        if (!order) throw new ApplicationError("NOT_FOUND", "Pedido no encontrado")
        if (!["Pendiente", "En preparación", "Listo"].includes(order.status)) {
          throw new ApplicationError("CONFLICT", "El pedido ya no puede cancelarse")
        }
        if (order.activeRouteId) {
          const cancellableRoute = await tx.lockActiveRoute(order.activeRouteId, orderId)
          if (!cancellableRoute) {
            throw new ApplicationError(
              "CONFLICT",
              "El pedido pertenece a un reparto que ya no puede modificarse",
            )
          }
          const removed = await tx.removeOrderFromUnstartedRoute(order.activeRouteId, orderId)
          if (!removed) {
            throw new ApplicationError(
              "CONFLICT",
              "El pedido pertenece a un reparto que ya no puede modificarse",
            )
          }
        }
        const reservations = await tx.lockActiveReservations(orderId)
        for (const reservation of reservations) {
          const stock = await tx.releaseReservation({
            orderId,
            productId: reservation.productId,
            quantity: reservation.quantity,
            actorId,
          })
          if (!stock) {
            throw new ApplicationError("CONFLICT", "La reserva de inventario ya no está disponible")
          }
          await registrarEventoAuditoria(tx.audit, {
            usuarioId: actorId,
            accion: "Liberación de reserva",
            entidad: "Inventario",
            entidadId: reservation.productId,
            valorAnterior: {
              existencias: stock.totalStock,
              reservadas: stock.reservedStock + reservation.quantity,
              pedidoId: orderId,
              cantidad: reservation.quantity,
            },
            valorNuevo: {
              existencias: stock.totalStock,
              reservadas: stock.reservedStock,
            },
          })
        }
        await tx.updateOrderStatus(orderId, "Cancelado", true)
        await tx.insertOrderStatusEvent(orderId, order.status, "Cancelado", actorId)
        await registrarEventoAuditoria(tx.audit, {
          usuarioId: actorId,
          accion: "Cambio de estado",
          entidad: "Pedido",
          entidadId: orderId,
          valorAnterior: { estado: order.status },
          valorNuevo: { estado: "Cancelado" },
        })
      })
    },
    async markReady(orderId, actorId) {
      await repository.transaction(async (tx) => {
        const order = await tx.lockOrder(orderId)
        if (!order) throw new ApplicationError("NOT_FOUND", "Pedido no encontrado")
        if (order.status !== "En preparación") {
          throw new ApplicationError("CONFLICT", "El pedido debe estar En preparación")
        }
        await tx.updateOrderStatus(orderId, "Listo")
        await tx.insertOrderStatusEvent(orderId, "En preparación", "Listo", actorId)
        await registrarEventoAuditoria(tx.audit, {
          usuarioId: actorId,
          accion: "Cambio de estado",
          entidad: "Pedido",
          entidadId: orderId,
          valorAnterior: { estado: "En preparación" },
          valorNuevo: { estado: "Listo" },
        })
      })
    },
    list: () => repository.listOrders(),
    events: (orderId) => repository.listOrderEvents(orderId),
  }
}
