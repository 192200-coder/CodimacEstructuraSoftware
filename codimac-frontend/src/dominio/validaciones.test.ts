import { describe, expect, it } from "vitest"
import {
  normalizarPlaca,
  validarCliente,
  validarConsultaPortal,
  validarEntrega,
  validarIncidencia,
  validarInicioSesion,
  validarMovimientoInventario,
  validarParametros,
  validarPedido,
  validarProducto,
  validarUsuario,
  validarVehiculo,
} from "./validaciones"

describe("Anexo B · usuario (M-01, E-04, E-05)", () => {
  const usuario = { name: "Laura Mendoza", email: "laura@codimac.pe", password: "Clave2026", role: "Administrador" }

  it("acepta un usuario válido", () => {
    expect(validarUsuario(usuario, { creando: true })).toEqual({})
  })

  it("muestra un mensaje por campo", () => {
    expect(validarUsuario(
      { name: "Al", email: "laura@", password: "corta", role: "" },
      { creando: true },
    )).toEqual({
      name: "Ingresa el nombre completo.",
      email: "Ingresa un correo válido.",
      password: "Mínimo 8 caracteres, con letras y números.",
      role: "Elige un rol.",
    })
  })

  it("al editar, la contraseña es opcional pero si se escribe debe ser segura", () => {
    expect(validarUsuario({ ...usuario, password: "" }, { creando: false })).toEqual({})
    expect(validarUsuario({ ...usuario, password: "sololetras" }, { creando: false }))
      .toEqual({ password: "Mínimo 8 caracteres, con letras y números." })
  })

  it("valida el celular del chofer solo si se ingresa", () => {
    expect(validarUsuario({ ...usuario, phone: "812345678" }, { creando: true }))
      .toEqual({ phone: "Ingresa un celular de 9 dígitos que empiece con 9." })
  })
})

describe("Anexo B · producto y vehículo", () => {
  it("valida nombre, unidad, peso con 3 decimales y stock entero", () => {
    expect(validarProducto({ name: "Cemento tipo I", unit: "Unidad", weightKg: 42.5, totalStock: 200 })).toEqual({})
    expect(validarProducto({ name: "C", unit: "", weightKg: 0, totalStock: 1.5 })).toEqual({
      name: "Ingresa el nombre del producto.",
      unit: "Elige la unidad.",
      weightKg: "El peso debe ser mayor que 0.",
      totalStock: "Ingresa un número entero, 0 o más.",
    })
    expect(validarProducto({ name: "Arena", unit: "Metro cúbico", weightKg: 1.2345 }).weightKg)
      .toBe("Usa como máximo 3 decimales.")
  })

  it("valida la placa ABC-123, la velocidad entre 5 y 120 y el rendimiento hasta 50", () => {
    const vehiculo = { plate: "abc-123", vehicleType: "Camioneta", capacityKg: 1500, averageSpeedKmh: 30, fuelEfficiencyKmL: 10 }
    expect(normalizarPlaca(" abc-123 ")).toBe("ABC-123")
    expect(validarVehiculo(vehiculo)).toEqual({})
    expect(validarVehiculo({ ...vehiculo, plate: "ABC123", capacityKg: 0, averageSpeedKmh: 121, fuelEfficiencyKmL: 60 }))
      .toEqual({
        plate: "Usa el formato ABC-123.",
        capacityKg: "La capacidad debe ser mayor que 0.",
        averageSpeedKmh: "Ingresa una velocidad entre 5 y 120 km/h.",
        fuelEfficiencyKmL: "Ingresa un rendimiento válido en km/L.",
      })
  })
})

describe("Anexo B · cliente (E-14)", () => {
  it("sin ubicación no se puede guardar", () => {
    expect(validarCliente({
      name: "Cliente A",
      contact: "987654321",
      address: "Av. Principal 120",
      reference: "",
      latitude: null,
      longitude: null,
    })).toEqual({ location: "Marca la ubicación en el mapa." })
  })
})

describe("Anexo B · pedido (E-02)", () => {
  const stock = (productId: string) =>
    productId === "cemento" ? { disponible: 85, nombre: "Cemento tipo I" } : null
  const ahora = new Date(2026, 9, 23, 10, 0)

  it("bloquea cantidades mayores al disponible con el faltante", () => {
    expect(validarPedido(
      { clientId: "c1", deadlineAt: "", items: [{ productId: "cemento", quantity: 1000 }] },
      stock,
      ahora,
    )).toEqual({
      "lineas[0].cantidad": "Solo hay 85 unidades disponibles de Cemento tipo I; faltan 915.",
    })
  })

  it("exige cliente, cantidades enteras, productos sin repetir y fecha no anterior a hoy", () => {
    expect(validarPedido(
      {
        clientId: "",
        deadlineAt: "2026-10-22T18:00",
        items: [{ productId: "cemento", quantity: 1.5 }, { productId: "cemento", quantity: 2 }],
      },
      stock,
      ahora,
    )).toEqual({
      clientId: "Elige un cliente.",
      deadlineAt: "La fecha límite no puede ser anterior a hoy.",
      "lineas[0].cantidad": "La cantidad debe ser un número entero, 1 o más.",
      "lineas[1].producto": "Este producto ya está en el pedido.",
    })
    expect(validarPedido(
      { clientId: "c1", deadlineAt: "2026-10-23T08:00", items: [{ productId: "cemento", quantity: 5 }] },
      stock,
      ahora,
    )).toEqual({})
  })
})

describe("Anexo B · inventario (E-07, E-08, E-09)", () => {
  it("la entrada no pide motivo", () => {
    expect(validarMovimientoInventario({ tipo: "Entrada", productId: "p1", quantity: 50 })).toEqual({})
  })

  it("el ajuste exige motivo y detalle si es Otro", () => {
    expect(validarMovimientoInventario({
      tipo: "Ajuste",
      productId: "p1",
      quantity: 5,
      direction: "Aumentar",
      reason: "",
    })).toEqual({ reason: "Elige el motivo del ajuste." })
    expect(validarMovimientoInventario({
      tipo: "Ajuste",
      productId: "p1",
      quantity: 5,
      direction: "Aumentar",
      reason: "Otro",
      detail: "abc",
    })).toEqual({ detail: "Describe el motivo con 5 a 120 caracteres." })
  })

  it("no permite disminuir por debajo de lo reservado", () => {
    expect(validarMovimientoInventario({
      tipo: "Ajuste",
      productId: "p1",
      quantity: 100,
      direction: "Disminuir",
      reason: "Merma o daño",
      existencias: 200,
      reservadas: 115,
    })).toEqual({ quantity: "No puedes bajar de 115 unidades: están reservadas." })
  })

  it("exige cantidades enteras de 1 o más", () => {
    expect(validarMovimientoInventario({ tipo: "Entrada", productId: "p1", quantity: 0.5 }))
      .toEqual({ quantity: "Ingresa un número entero, 1 o más." })
  })
})

describe("Anexo B · parámetros, entrega, incidencia, portal e inicio de sesión", () => {
  it("valida los parámetros globales", () => {
    expect(validarParametros({
      fuelPrice: 6.2,
      minutesPerStop: 8,
      serviceRadiusKm: 50,
      warehouseLatitude: -13.63,
      warehouseLongitude: -72.88,
    })).toEqual({})
    expect(validarParametros({
      fuelPrice: 0,
      minutesPerStop: 121,
      serviceRadiusKm: 0.5,
      warehouseLatitude: -13.63,
      warehouseLongitude: -72.88,
    })).toEqual({
      fuelPrice: "Ingresa un precio mayor que 0.",
      minutesPerStop: "Ingresa un valor entre 0 y 120.",
      serviceRadiusKm: "Ingresa un radio entre 1 y 500 km.",
    })
  })

  it("valida la confirmación de entrega y la incidencia", () => {
    expect(validarEntrega({ receivedBy: "Al" })).toEqual({ receivedBy: "Ingresa quién recibió el pedido." })
    expect(validarIncidencia({ cause: "Otra", notes: "" })).toEqual({ notes: "Describe brevemente lo ocurrido." })
    expect(validarIncidencia({ cause: "Cliente ausente", notes: "" })).toEqual({})
  })

  it("valida la consulta del portal y el inicio de sesión", () => {
    expect(validarConsultaPortal({ codigo: "", ultimos4: "12" })).toEqual({
      codigo: "Ingresa el código de tu pedido.",
      ultimos4: "Ingresa los últimos 4 dígitos de tu teléfono.",
    })
    expect(validarInicioSesion({ email: "maria@codimac.pe", password: "" }))
      .toEqual({ password: "Ingresa tu contraseña." })
  })
})
