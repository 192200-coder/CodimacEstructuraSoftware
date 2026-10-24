import { localDistanceKm, type Coordinates } from "../domain/routing.js"

/** Puerto ServicioMapas (RF-02.1): tiempos y distancias entre el almacén y los destinos. */
export interface ServicioMapas {
  readonly nombre: string
  calcularMatriz(puntos: Coordinates[]): Promise<{ distanciasKm: number[][]; minutos: number[][] }>
}

export interface MatrizRutas {
  /** Índice 0 = almacén; luego los pedidos en el orden pedido. */
  ids: string[]
  distanciasKm: number[][]
  /** Minutos con tráfico del proveedor; null con el estimador local (se calcula con la velocidad del vehículo). */
  minutos: number[][] | null
  proveedor: string
  usaTraficoReal: boolean
  aviso: string | null
}

export interface RouteMatrixLogger {
  warn(event: string, data: Record<string, unknown>): void
}

const LOCAL_PROVIDER = "Estimador local"
const CACHE_TTL_MS = 10 * 60_000

/** Estimador local (RN-06): línea recta × 1,35; el tiempo depende de la velocidad del vehículo. */
export function matrizLocal(puntos: Coordinates[]): number[][] {
  return puntos.map((origen) => puntos.map((destino) => localDistanceKm(origen, destino)))
}

export function createRouteMatrixUseCase(options: {
  proveedor?: ServicioMapas | null
  logger?: RouteMatrixLogger
  now?: () => number
} = {}) {
  const cache = new Map<string, { at: number; value: MatrizRutas }>()
  const now = options.now ?? Date.now

  return {
    /**
     * Una sola consulta al proveedor por reparto, con caché (RNF-10). Si falla o no está
     * configurado, el despacho sigue con el estimador local (RF-02.7, RNF-04).
     */
    async obtenerMatriz(ids: string[], puntos: Coordinates[]): Promise<MatrizRutas> {
      const local: MatrizRutas = {
        ids,
        distanciasKm: matrizLocal(puntos),
        minutos: null,
        proveedor: LOCAL_PROVIDER,
        usaTraficoReal: false,
        aviso: "Ruta calculada con estimación local, sin tráfico real.",
      }
      const proveedor = options.proveedor
      if (!proveedor) return local
      const key = puntos.map((punto) => `${punto.latitude.toFixed(5)},${punto.longitude.toFixed(5)}`).join("|")
      const cached = cache.get(key)
      if (cached && now() - cached.at < CACHE_TTL_MS) return { ...cached.value, ids }
      try {
        const { distanciasKm, minutos } = await proveedor.calcularMatriz(puntos)
        const value: MatrizRutas = {
          ids,
          distanciasKm,
          minutos,
          proveedor: proveedor.nombre,
          usaTraficoReal: true,
          aviso: null,
        }
        cache.set(key, { at: now(), value })
        return value
      } catch (error) {
        options.logger?.warn("mapas.proveedor_fallido", {
          proveedor: proveedor.nombre,
          error: error instanceof Error ? error.message : String(error),
        })
        return {
          ...local,
          aviso: `El proveedor de mapas no respondió. ${local.aviso}`,
        }
      }
    },
  }
}

export type RouteMatrixUseCase = ReturnType<typeof createRouteMatrixUseCase>
