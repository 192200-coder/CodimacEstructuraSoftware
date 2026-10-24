import { describe, expect, it } from "vitest"
import { formatearFecha, iniciales, saludoPorHora } from "./formato"
import { nivelStock } from "./inventario"
import { alertasDePlazo } from "./prioridad-pedido"
import { ordenarPorPrioridad, recorridoReferencia } from "./rutas"

describe("formato de fechas (RNF-15)", () => {
  it("usa la zona America/Lima y el formato de 24 horas", () => {
    // 23 oct 2026 01:30 UTC = 22 oct 2026 20:30 en Lima.
    expect(formatearFecha("2026-10-23T01:30:00Z")).toBe("22/10/2026, 20:30")
    expect(formatearFecha("2026-10-23T01:30:00Z", "hora")).toBe("20:30")
    expect(formatearFecha("2026-10-23T01:30:00Z", "fecha")).toBe("22/10/2026")
  })

  it("muestra un guion si no hay fecha válida", () => {
    expect(formatearFecha(null)).toBe("—")
    expect(formatearFecha("no-es-fecha")).toBe("—")
  })

  it("saluda según la hora de Lima e indica iniciales", () => {
    expect(saludoPorHora(new Date("2026-10-23T13:00:00Z"))).toBe("Buenos días")
    expect(saludoPorHora(new Date("2026-10-23T20:00:00Z"))).toBe("Buenas tardes")
    expect(saludoPorHora(new Date("2026-10-24T02:00:00Z"))).toBe("Buenas noches")
    expect(iniciales("Laura  Mendoza Ríos")).toBe("LM")
    expect(iniciales("Cliente B")).toBe("CB")
  })
})

describe("nivel de stock (P-D05)", () => {
  it("distingue sin stock, stock bajo y disponible", () => {
    expect(nivelStock(200, 200)).toBe("Sin stock")
    expect(nivelStock(200, 170)).toBe("Stock bajo")
    expect(nivelStock(200, 115)).toBe("Disponible")
  })
})

describe("alertas de plazo por vencer (RF-01.10)", () => {
  const ahora = Date.parse("2026-10-23T12:00:00Z")

  it("alerta solo pedidos activos que vencen en 24 horas o ya vencieron", () => {
    expect(alertasDePlazo([
      { code: "PED-0001", status: "Listo", deadline_at: "2026-10-23T17:00:00Z" },
      { code: "PED-0002", status: "Entregado", deadline_at: "2026-10-23T13:00:00Z" },
      { code: "PED-0003", status: "Cancelado", deadline_at: "2026-10-23T13:00:00Z" },
      { code: "PED-0004", status: "Pendiente", deadline_at: "2026-10-26T12:00:00Z" },
      { code: "PED-0005", status: "Pendiente", deadline_at: "2026-10-23T10:00:00Z" },
      { code: "PED-0006", status: "En preparación", deadline_at: null },
    ], ahora)).toEqual([
      { code: "PED-0005", vencido: true, message: "El pedido PED-0005 venció su fecha límite." },
      { code: "PED-0001", vencido: false, message: "El pedido PED-0001 vence en 5 horas." },
    ])
  })
})

describe("recorrido de referencia (RN-09, RF-05.9)", () => {
  const almacen = { latitud: -13.6366, longitud: -72.8814 }
  const vehiculo = {
    id: "v1",
    placa: "ABC-123",
    capacidadKg: 1500,
    velocidadPromedioKmh: 30,
    rendimientoKmLitro: 10,
    disponible: true,
  }

  it("ordena por fecha límite y luego por fecha de pedido", () => {
    const orden = ordenarPorPrioridad([
      { id: "sin-plazo-reciente", fechaPedido: "2026-10-22T10:00:00Z" },
      { id: "plazo-tarde", fechaLimite: "2026-10-25T10:00:00Z" },
      { id: "sin-plazo-antiguo", fechaPedido: "2026-10-20T10:00:00Z" },
      { id: "plazo-pronto", fechaLimite: "2026-10-24T10:00:00Z" },
    ])
    expect(orden.map((destino) => destino.id))
      .toEqual(["plazo-pronto", "plazo-tarde", "sin-plazo-antiguo", "sin-plazo-reciente"])
  })

  it("mide las paradas en orden de prioridad con la misma fórmula que la ruta", () => {
    const destinos = [
      { id: "lejos", etiqueta: "Lejos", coordenadas: { latitud: -13.70, longitud: -72.95 }, fechaLimite: "2026-10-24T10:00:00Z" },
      { id: "cerca", etiqueta: "Cerca", coordenadas: { latitud: -13.64, longitud: -72.88 }, fechaLimite: "2026-10-25T10:00:00Z" },
    ]
    const referencia = recorridoReferencia(almacen, destinos, vehiculo, 6.2, 8)
    expect(referencia.orden.map((destino) => destino.id)).toEqual(["lejos", "cerca"])
    expect(referencia.distanciaKm).toBeGreaterThan(0)
    expect(referencia.tiempoMinutos).toBeCloseTo((referencia.distanciaKm / 30) * 60 + 16, 6)
  })
})
