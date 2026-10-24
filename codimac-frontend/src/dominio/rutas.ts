import { ReglaNegocioError } from "./errores"
import type {
  AlternativaRuta,
  Coordenadas,
  CriterioRuta,
  DestinoRuta,
  MatrizViaje,
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

const ALMACEN = "almacen"

/** Distancia y, si el proveedor la da, duración de un tramo; sin matriz usa el estimador local. */
function tramo(
  matriz: MatrizViaje | undefined,
  desde: { id: string; coordenadas: Coordenadas },
  hasta: DestinoRuta,
): { km: number; minutos: number | null } {
  const i = matriz?.ids.indexOf(desde.id) ?? -1
  const j = matriz?.ids.indexOf(hasta.id) ?? -1
  if (matriz && i >= 0 && j >= 0) {
    return { km: matriz.distanciasKm[i]![j]!, minutos: matriz.minutos?.[i]?.[j] ?? null }
  }
  return { km: distanciaLocalKm(desde.coordenadas, hasta.coordenadas), minutos: null }
}

function ordenVecinoMasCercano(origen: Coordenadas, destinos: DestinoRuta[], matriz?: MatrizViaje) {
  const pendientes = [...destinos]
  const orden: DestinoRuta[] = []
  let actual: { id: string; coordenadas: Coordenadas } = { id: ALMACEN, coordenadas: origen }
  while (pendientes.length) {
    pendientes.sort((a, b) => tramo(matriz, actual, a).km - tramo(matriz, actual, b).km)
    const siguiente = pendientes.shift()!
    orden.push(siguiente)
    actual = siguiente
  }
  return orden
}

export function medirRecorrido(
  origen: Coordenadas,
  orden: DestinoRuta[],
  vehiculo: Vehiculo,
  precioCombustible: number,
  minutosPorParada: number,
  matriz?: MatrizViaje,
) {
  let distanciaKm = 0
  let minutosManejo = 0
  let actual: { id: string; coordenadas: Coordenadas } = { id: ALMACEN, coordenadas: origen }
  for (const destino of orden) {
    const { km, minutos } = tramo(matriz, actual, destino)
    distanciaKm += km
    minutosManejo += minutos ?? (km / vehiculo.velocidadPromedioKmh) * 60
    actual = destino
  }
  const tiempoMinutos = minutosManejo + minutosPorParada * orden.length
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
  matriz?: MatrizViaje,
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
      : [ordenVecinoMasCercano(origen, destinos, matriz)]
  const medidas = ordenes.map((orden) => ({
    orden,
    ...medirRecorrido(origen, orden, vehiculo, precioCombustible, minutosPorParada, matriz),
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
      usaTraficoReal: matriz?.usaTraficoReal ?? false,
    }))
}

/**
 * Recorrido de referencia (RN-09): las mismas paradas en orden de prioridad (RN-04),
 * medidas con la misma matriz que la ruta elegida. Primero la fecha límite más próxima;
 * los pedidos sin fecha límite van después, del más antiguo al más reciente.
 */
export function ordenarPorPrioridad<T extends { fechaLimite?: string; fechaPedido?: string }>(destinos: T[]): T[] {
  const tiempo = (valor?: string) => {
    const ms = valor ? Date.parse(valor) : Number.NaN
    return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY
  }
  return [...destinos].sort((a, b) => {
    const limiteA = tiempo(a.fechaLimite)
    const limiteB = tiempo(b.fechaLimite)
    if (limiteA !== limiteB) return limiteA - limiteB
    return tiempo(a.fechaPedido) - tiempo(b.fechaPedido)
  })
}

export function recorridoReferencia(
  origen: Coordenadas,
  destinos: DestinoRuta[],
  vehiculo: Vehiculo,
  precioCombustible: number,
  minutosPorParada: number,
  matriz?: MatrizViaje,
) {
  const orden = ordenarPorPrioridad(destinos)
  return { orden, ...medirRecorrido(origen, orden, vehiculo, precioCombustible, minutosPorParada, matriz) }
}
