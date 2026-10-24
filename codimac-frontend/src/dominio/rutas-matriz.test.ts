import { describe, expect, it } from "vitest"
import type { DestinoRuta, MatrizViaje } from "./modelos"
import { distanciaLocalKm, generarAlternativas, medirRecorrido } from "./rutas"

const almacen = { latitud: -13.6366, longitud: -72.8814 }
const vehiculo = {
  id: "v1",
  placa: "ABC-123",
  capacidadKg: 1500,
  velocidadPromedioKmh: 30,
  rendimientoKmLitro: 10,
  disponible: true,
}

function destinos(cantidad: number): DestinoRuta[] {
  return Array.from({ length: cantidad }, (_valor, indice) => ({
    id: `p${indice + 1}`,
    etiqueta: `Cliente ${indice + 1}`,
    coordenadas: {
      latitud: -13.6366 + Math.sin(indice * 1.7) * 0.05,
      longitud: -72.8814 + Math.cos(indice * 1.3) * 0.05,
    },
  }))
}

describe("alternativas con la matriz de ServicioMapas (RF-02.1)", () => {
  const paradas = destinos(2)
  const matriz: MatrizViaje = {
    ids: ["almacen", "p1", "p2"],
    distanciasKm: [[0, 5, 9], [5, 0, 3], [9, 3, 0]],
    minutos: [[0, 20, 25], [18, 0, 6], [24, 7, 0]],
    usaTraficoReal: true,
  }

  it("usa las distancias y los minutos con tráfico del proveedor", () => {
    const medida = medirRecorrido(almacen, paradas, vehiculo, 6.2, 8, matriz)
    expect(medida.distanciaKm).toBe(8)
    expect(medida.tiempoMinutos).toBe(20 + 6 + 16)
    expect(medida.litros).toBeCloseTo(0.8, 6)
  })

  it("marca las alternativas con tráfico real solo si la matriz lo trae", () => {
    expect(generarAlternativas(almacen, paradas, vehiculo, 6.2, 8, "tiempo", matriz)[0]?.usaTraficoReal).toBe(true)
    expect(generarAlternativas(almacen, paradas, vehiculo, 6.2, 8, "tiempo")[0]?.usaTraficoReal).toBe(false)
  })

  it("con la matriz local (sin minutos) calcula el tiempo con la velocidad del vehículo", () => {
    const local: MatrizViaje = { ...matriz, minutos: null, usaTraficoReal: false }
    expect(medirRecorrido(almacen, paradas, vehiculo, 6.2, 8, local).tiempoMinutos).toBeCloseTo((8 / 30) * 60 + 16, 6)
  })

  it("sin matriz conserva el estimador local de siempre", () => {
    const [p1] = paradas
    expect(medirRecorrido(almacen, [p1!], vehiculo, 6.2, 0).distanciaKm).toBeCloseTo(distanciaLocalKm(almacen, p1!.coordenadas), 9)
  })
})

describe("rendimiento del optimizador local (RNF-01)", () => {
  it("compara las alternativas de 5 paradas en menos de 2 s", () => {
    const inicio = performance.now()
    generarAlternativas(almacen, destinos(5), vehiculo, 6.2, 8)
    expect(performance.now() - inicio).toBeLessThan(2000)
  })

  it("resuelve el máximo de 10 paradas en menos de 2 s", () => {
    const inicio = performance.now()
    const alternativas = generarAlternativas(almacen, destinos(10), vehiculo, 6.2, 8)
    expect(performance.now() - inicio).toBeLessThan(2000)
    expect(alternativas[0]?.orden).toHaveLength(10)
  })
})
