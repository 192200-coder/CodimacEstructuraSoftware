import { describe, expect, it } from "vitest"
import { advertenciaAreaServicio, validarDatosCliente } from "./clientes"
import { distanciaLineaRectaKm } from "./rutas"

const warehouse = { latitud: -13.6366, longitud: -72.8814 }

describe("validación de datos del cliente", () => {
  const validClient = {
    contact: "912345678",
    address: "Av. Principal 120",
    reference: "",
    latitude: -13.62,
    longitude: -72.86,
  }

  it("acepta teléfono, dirección y ubicación válidos con referencia opcional", () => {
    expect(validarDatosCliente(validClient)).toEqual([])
    expect(validarDatosCliente({ ...validClient, reference: "Frente al mercado" })).toEqual([])
  })

  it.each(["812345678", "91234567", "9123456780", "+51912345678", ""])(
    "rechaza teléfono inválido %s",
    (contact) => {
      expect(validarDatosCliente({ ...validClient, contact })).toContain(
        "Ingresa un celular de 9 dígitos que empiece con 9.",
      )
    },
  )

  it.each(["Casa", "a".repeat(151)])("rechaza dirección fuera de límites", (address) => {
    expect(validarDatosCliente({ ...validClient, address })).toContain(
      "Ingresa la dirección.",
    )
  })

  it("requiere coordenadas válidas seleccionadas en el mapa y limita referencia", () => {
    expect(validarDatosCliente({ ...validClient, latitude: null })).toContain(
      "Marca la ubicación en el mapa.",
    )
    expect(validarDatosCliente({ ...validClient, longitude: 181 })).toContain(
      "Marca la ubicación en el mapa.",
    )
    expect(validarDatosCliente({ ...validClient, reference: "x".repeat(151) })).toContain(
      "Máximo 150 caracteres.",
    )
  })
})

describe("advertencia de área de servicio", () => {
  it("calcula la distancia ortodrómica con Haversine", () => {
    expect(distanciaLineaRectaKm(
      { latitud: 0, longitud: 0 },
      { latitud: 0, longitud: 1 },
    )).toBeCloseTo(111.19, 1)
  })

  it("no advierte dentro del radio y advierte fuera sin bloquear el cálculo", () => {
    expect(advertenciaAreaServicio(warehouse, warehouse, 50)).toBeNull()
    expect(advertenciaAreaServicio(warehouse, { latitud: 0, longitud: 0 }, 50)).toMatchObject({
      radiusKm: 50,
      message: "Esta ubicación está a más de 50 km del almacén.",
    })
  })
})
