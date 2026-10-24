import { describe, expect, it, vi } from "vitest"
import type { CatalogRepository, CatalogTransaction } from "./catalog.js"
import { createCatalogUseCases } from "./catalog.js"

function createTransaction(): CatalogTransaction {
  return {
    audit: { registrar: vi.fn(async () => undefined) },
    lockParameters: vi.fn(async () => null),
    saveParameters: vi.fn(async () => ({})),
    insertUser: vi.fn(async () => ({
      id: "user-1",
      email: "admin@codimac.pe",
      display_name: "Admin",
      role: "Administrador" as const,
      active: true,
      created_at: "2026-10-18T00:00:00Z",
    })),
    lockUser: vi.fn(async () => null),
    updateUser: vi.fn(async () => ({
      id: "user-1",
      email: "admin@codimac.pe",
      display_name: "Admin",
      role: "Administrador" as const,
      active: true,
      created_at: "2026-10-18T00:00:00Z",
    })),
    lockProductStock: vi.fn(async () => ({ totalStock: 85, reservedStock: 0 })),
    updateProductStock: vi.fn(async () => undefined),
    insertInventoryMovement: vi.fn(async () => undefined),
    hasActiveRouteForVehicle: vi.fn(async () => false),
    insertCatalog: vi.fn(async (_resource, body) => ({ id: "record-1", ...body })),
    lockCatalog: vi.fn(async () => ({ id: "record-1", name: "Antes" })),
    updateCatalog: vi.fn(async (_resource, _id, body) => ({ id: "record-1", ...body })),
  }
}

function createRepository(tx: CatalogTransaction): CatalogRepository {
  return {
    transaction: vi.fn(async (operation) => operation(tx)),
    listCatalog: vi.fn(async () => []),
    getParameters: vi.fn(async () => null),
    listUsers: vi.fn(async () => []),
    loadDemoData: vi.fn(async () => undefined),
    listIndicators: vi.fn(async () => []),
    listAudit: vi.fn(async () => ({ events: [], total: 0 })),
    listLegacyEvents: vi.fn(async () => []),
    listInventoryMovements: vi.fn(async () => []),
  }
}

describe("casos de uso de catálogos", () => {
  it("audita el alta de un cliente en la misma transacción (flujo, paso 1)", async () => {
    const tx = createTransaction()
    const repository = createRepository(tx)
    const useCases = createCatalogUseCases(repository, { hash: vi.fn(async () => "hashed") })

    const created = await useCases.createCatalog("clients", { name: "Cliente A", contact: "987654321" }, "dispatcher-1")

    expect(created).toMatchObject({ id: "record-1", name: "Cliente A" })
    expect(repository.transaction).toHaveBeenCalledTimes(1)
    expect(tx.audit.registrar).toHaveBeenCalledWith({
      usuarioId: "dispatcher-1",
      accion: "Alta de cliente",
      entidad: "Cliente",
      entidadId: "record-1",
      valorAnterior: null,
      valorNuevo: { name: "Cliente A", contact: "987654321" },
    })
  })

  it("audita la edición de un producto con el valor anterior y el nuevo de los campos cambiados", async () => {
    const tx = createTransaction()
    const useCases = createCatalogUseCases(createRepository(tx), { hash: vi.fn(async () => "hashed") })

    await useCases.updateCatalog("products", "record-1", { name: "Cemento Sol" }, "admin-1")

    expect(tx.audit.registrar).toHaveBeenCalledWith(expect.objectContaining({
      accion: "Edición de producto",
      entidad: "Producto",
      valorAnterior: { name: "Antes" },
      valorNuevo: { name: "Cemento Sol" },
    }))
  })

  it("no edita ni audita un registro inexistente", async () => {
    const tx = createTransaction()
    vi.mocked(tx.lockCatalog).mockResolvedValue(null)
    const useCases = createCatalogUseCases(createRepository(tx), { hash: vi.fn(async () => "hashed") })

    await expect(useCases.updateCatalog("vehicles", "missing", { capacity_kg: 10 }, "admin-1"))
      .rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(tx.updateCatalog).not.toHaveBeenCalled()
    expect(tx.audit.registrar).not.toHaveBeenCalled()
  })

  it("bloquea disminuir existencias por debajo de lo reservado con el mensaje del Anexo B (E-09)", async () => {
    const tx = createTransaction()
    vi.mocked(tx.lockProductStock).mockResolvedValue({ totalStock: 200, reservedStock: 115 })
    const useCases = createCatalogUseCases(createRepository(tx), { hash: vi.fn(async () => "hashed") })

    await expect(useCases.registerInventoryMovement({
      productId: "product-1",
      type: "Ajuste",
      quantity: 100,
      direction: "Disminuir",
      reason: "Merma o daño",
      actorId: "dispatcher-1",
    })).rejects.toMatchObject({
      code: "CONFLICT",
      fields: [{ field: "quantity", message: "No puedes bajar de 115 unidades: están reservadas." }],
    })
    expect(tx.updateProductStock).not.toHaveBeenCalled()
  })

  it("actualiza inventario y audita en la misma transacción", async () => {
    const tx = createTransaction()
    const useCases = createCatalogUseCases(
      createRepository(tx),
      { hash: vi.fn(async () => "hashed") },
    )

    const totalStock = await useCases.registerInventoryMovement({
      productId: "product-1",
      type: "Ajuste",
      quantity: 10,
      direction: "Disminuir",
      reason: "Corrección de registro",
      actorId: "admin-1",
    })

    expect(totalStock).toBe(75)
    expect(tx.updateProductStock).toHaveBeenCalledWith("product-1", 75)
    expect(tx.insertInventoryMovement).toHaveBeenCalledWith(expect.objectContaining({
      quantity: -10,
    }))
    expect(tx.audit.registrar).toHaveBeenCalledWith(expect.objectContaining({
      accion: "Ajuste de inventario",
    }))
  })

  it("registra una entrada sin motivo y con observación opcional", async () => {
    const tx = createTransaction()
    const useCases = createCatalogUseCases(
      createRepository(tx),
      { hash: vi.fn(async () => "hashed") },
    )

    await expect(useCases.registerInventoryMovement({
      productId: "product-1",
      type: "Entrada",
      quantity: 15,
      actorId: "admin-1",
    })).resolves.toBe(100)

    expect(tx.insertInventoryMovement).toHaveBeenCalledWith(expect.objectContaining({
      movementType: "Entrada",
      quantity: 15,
      reason: null,
      observation: null,
      detail: null,
    }))
    expect(tx.audit.registrar).toHaveBeenCalledWith(expect.objectContaining({
      accion: "Entrada de inventario",
      entidad: "Inventario",
    }))
    expect(tx.insertInventoryMovement).toHaveBeenCalledWith(expect.objectContaining({
      movementType: "Entrada",
      quantity: 15,
      actorId: "admin-1",
    }))
  })

  it("audita altas, ediciones y desactivaciones de usuario desde la aplicación", async () => {
    const tx = createTransaction()
    const repository = createRepository(tx)
    const useCases = createCatalogUseCases(
      repository,
      { hash: vi.fn(async () => "hashed") },
    )
    vi.mocked(tx.lockUser).mockResolvedValue({
      email: "admin@codimac.pe",
      display_name: "Admin",
      role: "Administrador",
      active: true,
    })

    await useCases.createUser({
      email: "new@codimac.pe",
      password: "long-password",
      name: "Nuevo",
      role: "Despachador",
      actorId: "admin-1",
    })
    expect(tx.audit.registrar).toHaveBeenCalledWith(expect.objectContaining({
      accion: "Alta de usuario",
      entidad: "Usuario",
    }))

    await useCases.updateUser({
      userId: "user-1",
      actorId: "admin-1",
      actorRole: "Administrador",
      active: false,
    })
    expect(tx.audit.registrar).toHaveBeenCalledWith(expect.objectContaining({
      accion: "Desactivación de usuario",
      entidad: "Usuario",
    }))
  })

  it("audita los cambios de parámetros globales en la transacción", async () => {
    const tx = createTransaction()
    vi.mocked(tx.saveParameters).mockResolvedValue({
      warehouse_latitude: -13.6,
      warehouse_longitude: -72.8,
      fuel_price: 6.2,
      minutes_per_stop: 8,
      service_radius_km: 50,
    })
    const useCases = createCatalogUseCases(
      createRepository(tx),
      { hash: vi.fn(async () => "hashed") },
    )

    await useCases.updateParameters({
      warehouseLatitude: -13.6,
      warehouseLongitude: -72.8,
      fuelPrice: 6.2,
      minutesPerStop: 8,
      serviceRadiusKm: 50,
    }, "admin-1")

    expect(tx.audit.registrar).toHaveBeenCalledWith(expect.objectContaining({
      accion: "Creación de parámetros",
      entidad: "Parámetros",
    }))
  })

  it("no persiste el ajuste si la disminución deja stock bajo las reservas", async () => {
    const tx = createTransaction()
    vi.mocked(tx.lockProductStock).mockResolvedValueOnce({
      totalStock: 85,
      reservedStock: 30,
    })
    const useCases = createCatalogUseCases(
      createRepository(tx),
      { hash: vi.fn(async () => "hashed") },
    )

    await expect(useCases.registerInventoryMovement({
      productId: "product-1",
      type: "Ajuste",
      quantity: 56,
      direction: "Disminuir",
      reason: "Merma o daño",
      actorId: "admin-1",
    })).rejects.toMatchObject({
      code: "CONFLICT",
      fields: [expect.objectContaining({ field: "quantity" })],
    })

    expect(tx.updateProductStock).not.toHaveBeenCalled()
    expect(tx.insertInventoryMovement).not.toHaveBeenCalled()
    expect(tx.audit.registrar).not.toHaveBeenCalled()
  })

  it("guarda el detalle para el motivo Otro en el mismo movimiento", async () => {
    const tx = createTransaction()
    const useCases = createCatalogUseCases(
      createRepository(tx),
      { hash: vi.fn(async () => "hashed") },
    )

    await useCases.registerInventoryMovement({
      productId: "product-1",
      type: "Ajuste",
      quantity: 5,
      direction: "Aumentar",
      reason: "Otro",
      detail: "Corrección por verificación",
      actorId: "admin-1",
    })

    expect(tx.insertInventoryMovement).toHaveBeenCalledWith(expect.objectContaining({
      movementType: "Ajuste",
      quantity: 5,
      reason: "Otro",
      detail: "Corrección por verificación",
    }))
  })

  it("rechaza desde la aplicación un detalle inválido para Otro", async () => {
    const tx = createTransaction()
    const repository = createRepository(tx)
    const useCases = createCatalogUseCases(
      repository,
      { hash: vi.fn(async () => "hashed") },
    )

    await expect(useCases.registerInventoryMovement({
      productId: "product-1",
      type: "Ajuste",
      quantity: 5,
      direction: "Aumentar",
      reason: "Otro",
      detail: "abc",
      actorId: "admin-1",
    })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: [expect.objectContaining({ field: "detail" })],
    })

    expect(repository.transaction).not.toHaveBeenCalled()
  })

  it("rechaza desactivar o cambiar el rol del propio administrador", async () => {
    const tx = createTransaction()
    const repository = createRepository(tx)
    const useCases = createCatalogUseCases(
      repository,
      { hash: vi.fn(async () => "hashed") },
    )

    await expect(useCases.updateUser({
      userId: "user-1",
      actorId: "user-1",
      actorRole: "Administrador",
      active: false,
    })).rejects.toThrow("No puedes desactivar ni cambiar el rol")

    expect(repository.transaction).not.toHaveBeenCalled()
  })
})
