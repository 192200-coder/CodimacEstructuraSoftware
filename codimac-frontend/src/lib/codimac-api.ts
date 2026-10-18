const apiUrl = "/api"
const tokenKey = "codimac-access-token"
const userKey = "codimac-auth-user"

export interface ApiErrorField {
  field: string
  code: string
  message: string
}

export type InventoryAdjustmentReason =
  | "Conteo físico"
  | "Merma o daño"
  | "Corrección de registro"
  | "Otro"

export type InventoryMovementRequest =
  | {
      type: "Entrada"
      quantity: number
      observation?: string
    }
  | {
      type: "Ajuste"
      quantity: number
      direction: "Aumentar" | "Disminuir"
      reason: InventoryAdjustmentReason
      detail?: string
    }

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly fields: ApiErrorField[],
  ) {
    super(message)
  }
}

export interface ApiUser {
  id: string
  email: string
  display_name: string
  role: "Despachador" | "Chofer" | "Administrador"
}

export interface ApiSession {
  access_token: string
  user: {
    id: string
    email: string
    user_metadata: { role: ApiUser["role"]; name: string }
  }
}

type AuthListener = (event: string, session: ApiSession | null) => void
const listeners = new Set<AuthListener>()

function storedSession(): ApiSession | null {
  const accessToken = localStorage.getItem(tokenKey)
  const rawUser = localStorage.getItem(userKey)
  if (!accessToken || !rawUser) return null
  try {
    const user = JSON.parse(rawUser) as ApiUser
    return {
      access_token: accessToken,
      user: {
        id: user.id,
        email: user.email,
        user_metadata: { role: user.role, name: user.display_name },
      },
    }
  } catch {
    localStorage.removeItem(tokenKey)
    localStorage.removeItem(userKey)
    return null
  }
}

function publishAuth(event: string, session: ApiSession | null) {
  for (const listener of listeners) listener(event, session)
}

async function request<T = Record<string, unknown>>(
  path: string,
  options: RequestInit = {},
  authenticated = true,
): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  const token = authenticated ? localStorage.getItem(tokenKey) : null
  if (token) headers.set("Authorization", `Bearer ${token}`)
  const response = await fetch(`${apiUrl}${path}`, { ...options, headers })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const apiError = body?.error
    if (apiError && typeof apiError === "object") {
      throw new ApiRequestError(
        typeof apiError.message === "string" ? apiError.message : "No se pudo completar la solicitud.",
        typeof apiError.code === "string" ? apiError.code : "UNKNOWN_ERROR",
        Array.isArray(apiError.fields) ? apiError.fields : [],
      )
    }
    throw new ApiRequestError(
      typeof apiError === "string" ? apiError : "No se pudo conectar con CODIMAC",
      "UNKNOWN_ERROR",
      [],
    )
  }
  return body as T
}

export const codimacAuth = {
  async getSession() {
    return { data: { session: storedSession() } }
  },
  onAuthStateChange(callback: AuthListener) {
    listeners.add(callback)
    return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } }
  },
  async signInWithPassword(credentials: { email: string; password: string }) {
    try {
      const result = await request<{ token: string; user: ApiUser }>(
        "/auth/login",
        { method: "POST", body: JSON.stringify(credentials) },
        false,
      )
      localStorage.setItem(tokenKey, result.token)
      localStorage.setItem(userKey, JSON.stringify(result.user))
      const session = storedSession()
      publishAuth("SIGNED_IN", session)
      return {
        data: { user: session?.user ?? null, session },
        error: null,
      }
    } catch (error) {
      return { data: { user: null, session: null }, error: error instanceof Error ? error : new Error("No se pudo iniciar sesión") }
    }
  },
  async signOut() {
    let error: Error | null = null
    if (localStorage.getItem(tokenKey)) {
      try {
        await request("/auth/logout", { method: "POST" })
      } catch (caught) {
        error = caught instanceof Error ? caught : new Error("No se pudo cerrar la sesión en el servidor")
      }
    }
    localStorage.removeItem(tokenKey)
    localStorage.removeItem(userKey)
    publishAuth("SIGNED_OUT", null)
    return { error }
  },
  async getUser() {
    const result = await request<{ user: ApiUser }>("/auth/me")
    return { data: { user: result.user }, error: null }
  },
}

export interface RemoteClient {
  name: string
  address: string
  reference?: string | null
  contact?: string | null
  latitude?: number
  longitude?: number
}

export interface RemoteOrder {
  id: string
  code: string
  status: string
  ordered_at?: string
  deadline_at: string | null
  active_route_id?: string | null
  clients?: RemoteClient | null
  order_items?: Array<{
    quantity: number
    products: { name: string; unit: string; weight_kg: number }
  }>
}

export interface RemoteStop {
  id: string
  sequence_number: number
  status: string
  attempts: number
  eta_at?: string | null
  orders?: {
    code: string
    clients?: RemoteClient | null
    order_items?: Array<{ quantity: number | string; products: { name: string; unit: string } }>
  } | null
}

export interface RemoteRoute {
  id: string
  code: string
  status: string
  vehicles?: { plate: string; vehicle_type: string } | null
  route_stops: RemoteStop[]
}

export interface RemoteRouteSummaryForDriver {
  id: string
  code: string
  started_at: string
  closed_at: string
  distance_km: number | string | null
  estimated_minutes: number | string | null
  delivered: number
  not_delivered: number
}

export interface RemoteRouteSummary {
  id: string
  code: string
  status: string
  created_at: string
  distance_km: number | string | null
  estimated_minutes: number | string | null
  estimated_liters: number | string | null
  estimated_cost: number | string | null
  driver_name: string | null
  vehicle_plate: string | null
  stop_count: number
  route_stops: Array<{
    id: string
    sequence_number: number
    status: string
    attempts: number
    eta_at: string | null
    delivered_at: string | null
    received_by: string | null
    code: string
    client_name: string
    address: string
  }>
}

export interface RemoteClosedRoute extends RemoteRouteSummary {
  started_at: string | null
  closed_at: string | null
  duration_minutes: number | string | null
  result: string
  delivered: number
  not_delivered: number
}

export interface RemoteInventoryMovement {
  id: string
  fecha_hora: string
  producto_id: string
  tipo: "ENTRADA" | "AJUSTE" | "RESERVA" | "LIBERACION" | "SALIDA"
  cantidad: number | string
  usuario_id: string
  usuario: string
  pedido_id: string | null
  pedido_codigo: string | null
  motivo: string | null
  detalle: string | null
  observation: string | null
}

export interface RemoteNotification {
  id: string
  entity_type: "Pedido" | "Parada" | "Ruta"
  new_status: string
  created_at: string
  route_code: string | null
  order_code: string | null
  client_name: string | null
}

export interface PublicTracking {
  code: string
  public_status:
    | "Registrado"
    | "En preparación"
    | "Listo para salir"
    | "En camino"
    | "Reprogramado"
    | "No entregada"
    | "Entregado"
    | "Cancelado"
  current_step: 1 | 2 | 3 | 4 | 5 | null
  position?: number | null
  total_stops?: number
  eta_at?: string | null
  stop_status: string | null
}

export async function getTracking(
  codigo: string,
  ultimos4: string,
): Promise<{ tracking: PublicTracking }> {
  return request("/tracking", {
    method: "POST",
    body: JSON.stringify({ codigo, ultimos4 }),
  }, false)
}

export async function getMapsConfig(): Promise<{ googleMapsApiKey: string }> {
  return request("/maps-config", {}, false)
}

export async function getNotifications(): Promise<RemoteNotification[]> {
  const body = await request<{ notifications: RemoteNotification[] }>("/notifications")
  return body.notifications
}

export async function checkBackendHealth() {
  const response = await fetch("/health")
  if (!response.ok) throw new Error("No se pudo conectar con el backend de CODIMAC")
  return response.json()
}

export async function getRemoteState() {
  return request("/state")
}

export async function savePreferences(preferences: { role: string; active: string }) {
  return request("/preferences", { method: "PUT", body: JSON.stringify(preferences) })
}

export async function getOrders(): Promise<RemoteOrder[]> {
  const body = await request<{ orders?: RemoteOrder[] }>("/orders")
  return body.orders ?? []
}

export async function prepareOrder(id: string) {
  return request(`/orders/${id}/prepare`, { method: "POST" })
}

export async function cancelOrder(id: string) {
  return request(`/orders/${id}/cancel`, { method: "POST" })
}

export async function markOrderReady(id: string) {
  return request(`/orders/${id}/ready`, { method: "POST" })
}

export async function getDriverRoute(): Promise<RemoteRoute | null> {
  const body = await request<{ route: RemoteRoute | null }>("/driver/route")
  return body.route
}

export async function getDriverRouteSummary(id: string): Promise<RemoteRouteSummaryForDriver> {
  const body = await request<{ summary: RemoteRouteSummaryForDriver }>(
    `/driver/routes/${encodeURIComponent(id)}/summary`,
  )
  return body.summary
}

export async function getRoutes(): Promise<RemoteRouteSummary[]> {
  const body = await request<{ routes: RemoteRouteSummary[] }>("/routes")
  return body.routes
}

export async function getClosedRouteHistory(): Promise<RemoteClosedRoute[]> {
  const body = await request<{ routes: RemoteClosedRoute[] }>("/routes/history")
  return body.routes
}

export async function getInventoryMovements(productId: string): Promise<RemoteInventoryMovement[]> {
  const body = await request<{ movements: RemoteInventoryMovement[] }>(
    `/inventory/${encodeURIComponent(productId)}/movements`,
  )
  return body.movements
}

export async function createRoute(input: {
  orderIds: string[]
  distanceKm: number
  estimatedMinutes: number
  estimatedLiters: number
  estimatedCost: number
  driverId?: string
  vehicleId?: string
}): Promise<{ routeId: string; code: string; status: string }> {
  return request("/routes", { method: "POST", body: JSON.stringify(input) })
}

export async function assignRoute(id: string, driverId: string, vehicleId: string) {
  return request(`/routes/${id}/assign`, {
    method: "POST",
    body: JSON.stringify({ driverId, vehicleId }),
  })
}

export async function cancelPendingRoute(id: string) {
  return request(`/routes/${id}`, { method: "DELETE" })
}

export async function startDriverRoute(id: string) {
  return request(`/routes/${id}/start`, { method: "POST" })
}

export async function deliverStop(id: string, receivedBy: string) {
  return request(`/stops/${id}/deliver`, {
    method: "POST",
    body: JSON.stringify({ receivedBy }),
  })
}

export async function reportStopIncident(id: string, cause: string, notes: string) {
  return request(`/stops/${id}/incidents`, {
    method: "POST",
    body: JSON.stringify({ cause, notes }),
  })
}

export async function getCatalog<T>(resource: "clients" | "products" | "vehicles" | "parameters"): Promise<T> {
  const body = await request<{ data: T }>(`/catalog/${resource}`)
  return body.data
}

export async function getResources() {
  return request<{
    drivers: Array<{ id: string; display_name: string }>
    vehicles: Array<{
      id: string
      plate: string
      vehicle_type: string
      capacity_kg: number
      average_speed_kmh: number
      fuel_efficiency_km_l: number
    }>
  }>("/resources")
}

export async function createCatalogRecord(resource: "clients" | "products" | "vehicles", value: Record<string, unknown>) {
  return request(`/admin/catalog/${resource}`, { method: "POST", body: JSON.stringify(value) })
}

export async function updateCatalogRecord(
  resource: "clients" | "products" | "vehicles",
  id: string,
  value: Record<string, unknown>,
) {
  return request(`/admin/catalog/${resource}/${id}`, {
    method: "PUT",
    body: JSON.stringify(value),
  })
}

export async function createAdminUser(value: { name: string; email: string; password: string; role: string }) {
  return request("/admin/users", { method: "POST", body: JSON.stringify(value) })
}

export async function updateAdminUser(
  id: string,
  value: { name?: string; role?: string; active?: boolean; password?: string },
) {
  return request(`/admin/users/${id}`, { method: "PUT", body: JSON.stringify(value) })
}

export async function adjustInventory(productId: string, value: InventoryMovementRequest) {
  return request(`/inventory/${productId}/movements`, { method: "POST", body: JSON.stringify(value) })
}

export async function createOrder(value: {
  clientId: string
  deadlineAt: string | null
  items: Array<{ productId: string; quantity: number }>
}): Promise<{ order: { id: string; code: string; status: string } }> {
  return request("/orders", { method: "POST", body: JSON.stringify(value) })
}

export async function getAdminUsers() {
  return request<{ users: Array<{ id: string; email: string; display_name: string; role: string; active: boolean }> }>("/admin/users")
}

export async function getAdminEvents() {
  return request<{ events: Array<{ id: string; message: string; created_at: string; user: string; role: string }> }>("/admin/events")
}

export interface AuditEventFilters {
  desde?: string
  hasta?: string
  usuario?: string
  entidad?: string
  accion?: string
  limit?: number
  offset?: number
}

export interface AuditEvent {
  id: string
  fecha_hora: string
  usuario_id: string | null
  usuario: string | null
  email: string | null
  accion: string
  entidad: string
  entidad_id: string | null
  valor_anterior: Record<string, unknown> | null
  valor_nuevo: Record<string, unknown> | null
}

export async function getAdminAuditEvents(filters: AuditEventFilters = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") query.set(key, String(value))
  }
  const suffix = query.size ? `?${query.toString()}` : ""
  return request<{
    events: AuditEvent[]
    total: number
    limit: number
    offset: number
  }>(`/admin/audit${suffix}`)
}

export async function loadDemoData() {
  return request<{ loaded: boolean }>("/admin/demo-data", { method: "POST" })
}

export async function getIndicators() {
  return request<{ indicators: Array<Record<string, string | number | null>> }>("/indicators")
}

export async function updateParameters(value: {
  warehouseLatitude: number
  warehouseLongitude: number
  fuelPrice: number
  minutesPerStop: number
  serviceRadiusKm: number
}) {
  return request("/admin/parameters", { method: "PUT", body: JSON.stringify(value) })
}
