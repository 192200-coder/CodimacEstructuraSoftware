import { Injectable } from "@angular/core"
import {
  assignRoute,
  adjustInventory,
  cancelOrder,
  cancelPendingRoute,
  createAdminUser,
  createCatalogRecord,
  createOrder,
  createRoute,
  deliverStop,
  getDriverRoute,
  getDriverRouteSummary,
  getRoutes,
  getCatalog,
  getAdminEvents,
  getNotifications,
  getAdminUsers,
  getIndicators,
  loadDemoData,
  getOrders,
  getResources,
  getTracking,
  markOrderReady,
  prepareOrder,
  reportStopIncident,
  startDriverRoute,
  updateParameters,
  updateAdminUser,
  updateCatalogRecord,
  type RemoteOrder,
  type RemoteRoute,
  type RemoteRouteSummary,
  type RemoteNotification,
  type PublicTracking,
} from "../../lib/codimac-api"

@Injectable({ providedIn: "root" })
export class CodimacApiService {
  getAdminUsers() {
    return getAdminUsers()
  }

  getAdminEvents() {
    return getAdminEvents()
  }

  getNotifications(): Promise<RemoteNotification[]> {
    return getNotifications()
  }

  getIndicators() {
    return getIndicators()
  }

  loadDemoData() {
    return loadDemoData()
  }

  updateParameters(value: {
    warehouseLatitude: number
    warehouseLongitude: number
    fuelPrice: number
    minutesPerStop: number
  }) {
    return updateParameters(value)
  }

  getCatalog<T>(resource: "clients" | "products" | "vehicles" | "parameters"): Promise<T> {
    return getCatalog<T>(resource)
  }

  getResources() {
    return getResources()
  }

  createCatalogRecord(resource: "clients" | "products" | "vehicles", value: Record<string, unknown>): Promise<unknown> {
    return createCatalogRecord(resource, value)
  }

  createAdminUser(value: { name: string; email: string; password: string; role: string }): Promise<unknown> {
    return createAdminUser(value)
  }

  updateAdminUser(
    id: string,
    value: { name?: string; role?: string; active?: boolean; password?: string },
  ): Promise<unknown> {
    return updateAdminUser(id, value)
  }

  updateCatalogRecord(
    resource: "clients" | "products" | "vehicles",
    id: string,
    value: Record<string, unknown>,
  ): Promise<unknown> {
    return updateCatalogRecord(resource, id, value)
  }

  adjustInventory(productId: string, value: { quantity: number; type: "Entrada" | "Ajuste"; reason: string }): Promise<unknown> {
    return adjustInventory(productId, value)
  }

  createOrder(value: {
    code: string
    clientId: string
    deadlineAt: string | null
    items: Array<{ productId: string; quantity: number }>
  }): Promise<unknown> {
    return createOrder(value)
  }

  getOrders(): Promise<RemoteOrder[]> {
    return getOrders()
  }

  prepareOrder(id: string): Promise<unknown> {
    return prepareOrder(id)
  }

  markOrderReady(id: string): Promise<unknown> {
    return markOrderReady(id)
  }

  cancelOrder(id: string): Promise<unknown> {
    return cancelOrder(id)
  }

  getDriverRoute(): Promise<RemoteRoute | null> {
    return getDriverRoute()
  }

  getDriverRouteSummary(id: string) {
    return getDriverRouteSummary(id)
  }

  getRoutes(): Promise<RemoteRouteSummary[]> {
    return getRoutes()
  }

  createRoute(input: Parameters<typeof createRoute>[0]): Promise<unknown> {
    return createRoute(input)
  }

  assignRoute(
    id: string,
    driverId: string,
    vehicleId: string,
  ): Promise<unknown> {
    return assignRoute(id, driverId, vehicleId)
  }

  cancelPendingRoute(id: string): Promise<unknown> {
    return cancelPendingRoute(id)
  }

  startDriverRoute(id: string): Promise<unknown> {
    return startDriverRoute(id)
  }

  deliverStop(id: string, receiver: string): Promise<unknown> {
    return deliverStop(id, receiver)
  }

  reportStopIncident(
    id: string,
    cause: string,
    notes: string,
  ): Promise<unknown> {
    return reportStopIncident(id, cause, notes)
  }

  getTracking(token: string): Promise<{ tracking: PublicTracking }> {
    return getTracking(token)
  }
}
