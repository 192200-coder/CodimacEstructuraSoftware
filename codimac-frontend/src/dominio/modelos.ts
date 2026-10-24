export type EstadoPedido = "Pendiente" | "En preparación" | "Listo" | "En ruta" | "Entregado" | "Cancelado"

export type EstadoParada = "Pendiente" | "En camino" | "Entregada" | "Incidencia" | "No entregada"

export type CriterioRuta = "tiempo" | "combustible" | "equilibrio"

export interface Coordenadas {
  latitud: number
  longitud: number
}

export interface LineaPedido {
  productoId: string
  cantidad: number
  pesoUnitarioKg: number
}

export interface Existencia {
  productoId: string
  total: number
  reservado: number
}

export interface Pedido {
  id: string
  codigo: string
  estado: EstadoPedido
  fechaPedido: string
  fechaLimite?: string
  direccion: string
  coordenadas: Coordenadas
  lineas: LineaPedido[]
}

export interface Vehiculo {
  id: string
  placa: string
  capacidadKg: number
  velocidadPromedioKmh: number
  rendimientoKmLitro: number
  disponible: boolean
}

export interface DestinoRuta {
  id: string
  etiqueta: string
  coordenadas: Coordenadas
  fechaLimite?: string
  fechaPedido?: string
}

/**
 * Matriz del puerto ServicioMapas (RF-02.1). El índice "almacen" es el origen. Con el
 * estimador local `minutos` es null y el tiempo sale de la velocidad del vehículo.
 */
export interface MatrizViaje {
  ids: string[]
  distanciasKm: number[][]
  minutos: number[][] | null
  usaTraficoReal: boolean
}

export interface AlternativaRuta {
  orden: DestinoRuta[]
  distanciaKm: number
  tiempoMinutos: number
  litros: number
  costoCombustible: number
  criterio: CriterioRuta
  usaTraficoReal: boolean
}

export interface Parada {
  id: string
  entregaId: string
  estado: EstadoParada
  intentos: number
}
