import { ReglaNegocioError } from "./errores"
import type {
  AlternativaRuta,
  Coordenadas,
  CriterioRuta,
  DestinoRuta,
  Vehiculo,
} from "./modelos"

const RADIO_TIERRA_KM = 6371
const FACTOR_VIAL_LOCAL = 1.35

function radianes(grados: number) {
  return (grados * Math.PI) / 180
}

export function distanciaLineaRectaKm(a: Coordenadas, b: Coordenadas) {
  const dLat = radianes(b.latitud - a.latitud)
  const dLon = radianes(b.longitud - a.longitud)
  const lat1 = radianes(a.latitud)
  const lat2 = radianes(b.latitud)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.sqrt(h))
}

export function distanciaLocalKm(a: Coordenadas, b: Coordenadas) {
  return distanciaLineaRectaKm(a, b) * FACTOR_VIAL_LOCAL
}

function permutar<T>(elementos: T[]): T[][] {
  if (elementos.length <= 1) return [elementos]
  return elementos.flatMap((elemento, indice) =>
    permutar([
      ...elementos.slice(0, indice),
      ...elementos.slice(indice + 1),
    ]).map((resto) => [elemento, ...resto]),
  )
}

function ordenVecinoMasCercano(origen: Coordenadas, destinos: DestinoRuta[]) {
  const pendientes = [...destinos]
  const orden: DestinoRuta[] = []
  let actual = origen
  while (pendientes.length) {
    pendientes.sort(
      (a, b) =>
        distanciaLocalKm(actual, a.coordenadas) -
        distanciaLocalKm(actual, b.coordenadas),
    )
    const siguiente = pendientes.shift()!
    orden.push(siguiente)
    actual = siguiente.coordenadas
  }
  return orden
}

function medir(
  origen: Coordenadas,
  orden: DestinoRuta[],
  vehiculo: Vehiculo,
  precioCombustible: number,
  minutosPorParada: number,
) {
  let distanciaKm = 0
  let actual = origen
  for (const destino of orden) {
    distanciaKm += distanciaLocalKm(actual, destino.coordenadas)
    actual = destino.coordenadas
  }
  const tiempoMinutos =
    (distanciaKm / vehiculo.velocidadPromedioKmh) * 60 +
    minutosPorParada * orden.length
  const litros = distanciaKm / vehiculo.rendimientoKmLitro
  return {
    distanciaKm,
    tiempoMinutos,
    litros,
    costoCombustible: litros * precioCombustible,
  }
}

export function generarAlternativas(
  origen: Coordenadas,
  destinos: DestinoRuta[],
  vehiculo: Vehiculo,
  precioCombustible: number,
  minutosPorParada: number,
  criterio: CriterioRuta = "tiempo",
): AlternativaRuta[] {
  if (!destinos.length) {
    throw new ReglaNegocioError(
      "Un reparto debe tener al menos una parada.",
      "REPARTO_VACIO",
    )
  }
  if (destinos.length > 10) {
    throw new ReglaNegocioError(
      "La versión actual admite hasta 10 paradas.",
      "MAXIMO_PARADAS",
    )
  }
  if (vehiculo.velocidadPromedioKmh <= 0 || vehiculo.rendimientoKmLitro <= 0) {
    throw new ReglaNegocioError(
      "Los parámetros del vehículo no son válidos.",
      "VEHICULO_INVALIDO",
    )
  }

  const ordenes =
    destinos.length <= 8
      ? permutar(destinos)
      : [ordenVecinoMasCercano(origen, destinos)]
  const medidas = ordenes.map((orden) => ({
    orden,
    ...medir(origen, orden, vehiculo, precioCombustible, minutosPorParada),
  }))
  const maxTiempo = Math.max(...medidas.map((item) => item.tiempoMinutos))
  const maxCosto = Math.max(...medidas.map((item) => item.costoCombustible))

  return medidas
    .sort((a, b) => {
      if (criterio === "combustible") return a.litros - b.litros
      if (criterio === "equilibrio") {
        return (
          a.tiempoMinutos / maxTiempo +
          a.costoCombustible / maxCosto -
          (b.tiempoMinutos / maxTiempo + b.costoCombustible / maxCosto)
        )
      }
      return a.tiempoMinutos - b.tiempoMinutos
    })
    .slice(0, 3)
    .map((item) => ({
      ...item,
      criterio,
      usaTraficoReal: false,
    }))
}
