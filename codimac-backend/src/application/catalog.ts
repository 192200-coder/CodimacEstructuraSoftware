import { canAdjustStock } from "../domain/rules.js"
import { ApplicationError } from "./errors.js"
import {
  registrarEventoAuditoria,
  type RegistroAuditoria,
} from "./registro-auditoria.js"

export type CatalogResource = "clients" | "products" | "vehicles"
export type CatalogRecord = Record<string, unknown>
export type CatalogRole = "Despachador" | "Chofer" | "Administrador"

export interface CatalogParametersInput {
  warehouseLatitude: number
  warehouseLongitude: number
  fuelPrice: number
  minutesPerStop: number
  serviceRadiusKm: number
}

export interface CatalogUser {
  id: string
  email: string
  display_name: string
  phone?: string | null
  role: CatalogRole
  active: boolean
  created_at: string
}

export interface CatalogUserSnapshot {
  email: string
  display_name: string
  phone?: string | null
  role: CatalogRole
  active: boolean
}

export interface CatalogTransaction {
  readonly audit: RegistroAuditoria
  lockParameters(): Promise<CatalogRecord | null>
  saveParameters(input: CatalogParametersInput, actorId: string): Promise<CatalogRecord>
  insertUser(input: {
    email: string
    passwordHash: string
    name: string
    phone: string | null
    role: CatalogRole
  }): Promise<CatalogUser>
  lockUser(userId: string): Promise<CatalogUserSnapshot | null>
  updateUser(userId: string, update: {
    name?: string
    phone?: string | null
    role?: CatalogRole
    active?: boolean
    passwordHash?: string
  }): Promise<CatalogUser>
  lockProductStock(productId: string): Promise<{ totalStock: number; reservedStock: number } | null>
  updateProductStock(productId: string, totalStock: number): Promise<void>
  insertInventoryMovement(input: {
    productId: string
    movementType: "Entrada" | "Ajuste"
    quantity: number
    reason: string | null
    observation: string | null
    detail: string | null
    actorId: string
  }): Promise<void>
  hasActiveRouteForVehicle(vehicleId: string): Promise<boolean>
  insertCatalog(resource: CatalogResource, body: CatalogRecord): Promise<CatalogRecord>
  lockCatalog(resource: CatalogResource, id: string): Promise<CatalogRecord | null>
  updateCatalog(
    resource: CatalogResource,
    id: string,
    body: CatalogRecord,
  ): Promise<CatalogRecord | null>
}

export interface AuditQuery {
  desde?: string
  hasta?: string
  usuario?: string
  entidad?: string
  accion?: string
  limit: number
  offset: number
}

export interface CatalogRepository {
  transaction<T>(operation: (tx: CatalogTransaction) => Promise<T>): Promise<T>
  listCatalog(resource: CatalogResource): Promise<unknown[]>
  getParameters(): Promise<unknown | null>
  listUsers(): Promise<CatalogUser[]>
  loadDemoData(): Promise<void>
  listIndicators(): Promise<unknown[]>
  listAudit(query: AuditQuery): Promise<{ events: unknown[]; total: number }>
  listLegacyEvents(limit: number): Promise<unknown[]>
  listInventoryMovements(productId: string): Promise<unknown[]>
}

export interface PasswordHasher {
  hash(password: string): Promise<string>
}

export interface CatalogUseCases {
  listCatalog(resource: CatalogResource): Promise<unknown[]>
  getParameters(): Promise<unknown | null>
  createCatalog(resource: CatalogResource, body: CatalogRecord, actorId: string): Promise<CatalogRecord>
  updateCatalog(
    resource: CatalogResource,
    id: string,
    body: CatalogRecord,
    actorId: string,
  ): Promise<CatalogRecord>
  updateParameters(input: CatalogParametersInput, actorId: string): Promise<CatalogRecord>
  listUsers(): Promise<CatalogUser[]>
  createUser(input: {
    email: string
    password: string
    name: string
    phone?: string | null
    role: CatalogRole
    actorId: string
  }): Promise<CatalogUser>
  updateUser(input: {
    userId: string
    actorId: string
    actorRole: CatalogRole
    name?: string
    phone?: string | null
    role?: CatalogRole
    active?: boolean
    password?: string
  }): Promise<CatalogUser>
  loadDemoData(): Promise<void>
  registerInventoryMovement(input: InventoryMovementInput): Promise<number>
  listIndicators(): Promise<unknown[]>
  listAudit(query: AuditQuery): Promise<{ events: unknown[]; total: number }>
  listLegacyEvents(limit: number): Promise<unknown[]>
  listInventoryMovements(productId: string): Promise<unknown[]>
}

export type InventoryMovementInput =
  | {
      productId: string
      type: "Entrada"
      quantity: number
      observation?: string
      actorId: string
    }
  | {
      productId: string
      type: "Ajuste"
      quantity: number
      direction: "Aumentar" | "Disminuir"
      reason: "Conteo físico" | "Merma o daño" | "Corrección de registro" | "Otro"
      detail?: string
      actorId: string
    }

const catalogEntities: Record<CatalogResource, { entity: string; label: string }> = {
  clients: { entity: "Cliente", label: "cliente" },
  products: { entity: "Producto", label: "producto" },
  vehicles: { entity: "Vehículo", label: "vehículo" },
}

/** Solo los campos enviados: la auditoría guarda el antes y el después de lo que cambió. */
function pickFields(record: CatalogRecord, fields: string[]): CatalogRecord {
  return Object.fromEntries(fields.filter((field) => field in record).map((field) => [field, record[field]]))
}

export function createCatalogUseCases(
  repository: CatalogRepository,
  passwordHasher: PasswordHasher,
): CatalogUseCases {
  return {
    listCatalog: (resource) => repository.listCatalog(resource),
    getParameters: () => repository.getParameters(),
    async createCatalog(resource, body, actorId) {
      return repository.transaction(async (tx) => {
        const created = await tx.insertCatalog(resource, body)
        await registrarEventoAuditoria(tx.audit, {
          usuarioId: actorId,
          accion: `Alta de ${catalogEntities[resource].label}`,
          entidad: catalogEntities[resource].entity,
          entidadId: String(created.id ?? ""),
          valorAnterior: null,
          valorNuevo: pickFields(created, Object.keys(body)),
        })
        return created
      })
    },
    async updateCatalog(resource, id, body, actorId) {
      return repository.transaction(async (tx) => {
        const before = await tx.lockCatalog(resource, id)
        if (!before) throw new ApplicationError("NOT_FOUND", "Registro no encontrado")
        if (
          resource === "vehicles" &&
          body.available === true &&
          await tx.hasActiveRouteForVehicle(id)
        ) {
          throw new ApplicationError(
            "CONFLICT",
            "No se puede marcar disponible un vehículo asignado a un reparto activo",
          )
        }
        const updated = await tx.updateCatalog(resource, id, body)
        if (!updated) throw new ApplicationError("NOT_FOUND", "Registro no encontrado")
        const fields = Object.keys(body)
        await registrarEventoAuditoria(tx.audit, {
          usuarioId: actorId,
          accion: `Edición de ${catalogEntities[resource].label}`,
          entidad: catalogEntities[resource].entity,
          entidadId: id,
          valorAnterior: pickFields(before, fields),
          valorNuevo: pickFields(updated, fields),
        })
        return updated
      })
    },
    async updateParameters(input, actorId) {
      return repository.transaction(async (tx) => {
        const before = await tx.lockParameters()
        const result = await tx.saveParameters(input, actorId)
        await registrarEventoAuditoria(tx.audit, {
          usuarioId: actorId,
          accion: before ? "Actualización de parámetros" : "Creación de parámetros",
          entidad: "Parámetros",
          entidadId: "principal",
          valorAnterior: before
            ? {
                warehouseLatitude: Number(before.warehouse_latitude),
                warehouseLongitude: Number(before.warehouse_longitude),
                fuelPrice: Number(before.fuel_price),
                minutesPerStop: Number(before.minutes_per_stop),
                serviceRadiusKm: Number(before.service_radius_km ?? 50),
              }
            : null,
          valorNuevo: {
            warehouseLatitude: Number(result.warehouse_latitude),
            warehouseLongitude: Number(result.warehouse_longitude),
            fuelPrice: Number(result.fuel_price),
            minutesPerStop: Number(result.minutes_per_stop),
            serviceRadiusKm: Number(result.service_radius_km),
          },
        })
        return result
      })
    },
    listUsers: () => repository.listUsers(),
    async createUser(input) {
      const passwordHash = await passwordHasher.hash(input.password)
      return repository.transaction(async (tx) => {
        const user = await tx.insertUser({
          email: input.email,
          passwordHash,
          name: input.name,
          phone: input.phone ?? null,
          role: input.role,
        })
        await registrarEventoAuditoria(tx.audit, {
          usuarioId: input.actorId,
          accion: "Alta de usuario",
          entidad: "Usuario",
          entidadId: user.id,
          valorAnterior: null,
          valorNuevo: {
            correo: user.email,
            nombre: user.display_name,
            celular: user.phone,
            rol: user.role,
            activo: user.active,
          },
        })
        return user
      })
    },
    async updateUser(input) {
      if (
        input.userId === input.actorId &&
        (input.active === false || (input.role !== undefined && input.role !== input.actorRole))
      ) {
        throw new ApplicationError(
          "CONFLICT",
          "No puedes desactivar ni cambiar el rol de tu propia cuenta",
        )
      }
      const passwordHash = input.password === undefined
        ? undefined
        : await passwordHasher.hash(input.password)
      return repository.transaction(async (tx) => {
        const before = await tx.lockUser(input.userId)
        if (!before) throw new ApplicationError("NOT_FOUND", "Usuario no encontrado")
        const user = await tx.updateUser(input.userId, {
          name: input.name,
          phone: input.phone,
          role: input.role,
          active: input.active,
          passwordHash,
        })
        const snapshot = (row: CatalogUserSnapshot) => ({
          correo: row.email,
          nombre: row.display_name,
          celular: row.phone,
          rol: row.role,
          activo: row.active,
        })
        await registrarEventoAuditoria(tx.audit, {
          usuarioId: input.actorId,
          accion: input.active === false ? "Desactivación de usuario" : "Edición de usuario",
          entidad: "Usuario",
          entidadId: input.userId,
          valorAnterior: snapshot(before),
          valorNuevo: {
            ...snapshot(user),
            contrasenaActualizada: input.password !== undefined,
          },
        })
        return user
      })
    },
    loadDemoData: () => repository.loadDemoData(),
    async registerInventoryMovement(input) {
      if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "La cantidad debe ser mayor que cero.",
          [{
            field: "quantity",
            code: "CANTIDAD_INVALIDA",
            message: "Ingresa una cantidad mayor que cero.",
          }],
        )
      }
      if (input.type === "Ajuste") {
        const reasons = ["Conteo físico", "Merma o daño", "Corrección de registro", "Otro"]
        if (!reasons.includes(input.reason)) {
          throw new ApplicationError("VALIDATION_ERROR", "Revisa los campos marcados.", [{
            field: "reason",
            code: "MOTIVO_INVALIDO",
            message: "Selecciona un motivo válido para el ajuste.",
          }])
        }
        const detail = input.detail?.trim()
        if (
          (input.reason === "Otro" && (!detail || detail.length < 5 || detail.length > 120)) ||
          (input.reason !== "Otro" && input.detail !== undefined)
        ) {
          throw new ApplicationError("VALIDATION_ERROR", "Revisa los campos marcados.", [{
            field: "detail",
            code: "DETALLE_INVALIDO",
            message: input.reason === "Otro"
              ? "El detalle debe tener entre 5 y 120 caracteres."
              : "El detalle solo se utiliza cuando el motivo es Otro.",
          }])
        }
      }
      return repository.transaction(async (tx) => {
        const product = await tx.lockProductStock(input.productId)
        if (!product) throw new ApplicationError("NOT_FOUND", "Producto no encontrado")
        const movementType = input.type
        const change = input.type === "Entrada"
          ? input.quantity
          : input.direction === "Aumentar"
            ? input.quantity
            : -input.quantity
        if (!canAdjustStock(product.totalStock, product.reservedStock, change)) {
          throw new ApplicationError(
            "CONFLICT",
            "La disminución no puede dejar las existencias por debajo de las unidades reservadas.",
            [{
              field: "quantity",
              code: "STOCK_MENOR_A_RESERVADO",
              message: `No puedes bajar de ${product.reservedStock} unidades: están reservadas.`,
            }],
          )
        }
        const totalStock = product.totalStock + change
        await tx.updateProductStock(input.productId, totalStock)
        await tx.insertInventoryMovement({
          productId: input.productId,
          movementType,
          quantity: change,
          reason: input.type === "Ajuste" ? input.reason : null,
          observation: input.type === "Entrada" ? input.observation ?? null : null,
          detail: input.type === "Ajuste" && input.reason === "Otro" ? input.detail?.trim() ?? null : null,
          actorId: input.actorId,
        })
        await registrarEventoAuditoria(tx.audit, {
          usuarioId: input.actorId,
          accion: movementType === "Entrada" ? "Entrada de inventario" : "Ajuste de inventario",
          entidad: "Inventario",
          entidadId: input.productId,
          valorAnterior: {
            existencias: product.totalStock,
            reservadas: product.reservedStock,
          },
          valorNuevo: {
            existencias: totalStock,
            reservadas: product.reservedStock,
            cantidad: change,
            ...(input.type === "Entrada"
              ? { observacion: input.observation ?? null }
              : { motivo: input.reason, detalle: input.detail?.trim() ?? null }),
          },
        })
        return totalStock
      })
    },
    listIndicators: () => repository.listIndicators(),
    listAudit: (query) => repository.listAudit(query),
    listLegacyEvents: (limit) => repository.listLegacyEvents(limit),
    listInventoryMovements: (productId) => repository.listInventoryMovements(productId),
  }
}
