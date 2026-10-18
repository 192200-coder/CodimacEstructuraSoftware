import type {
  AlternativaRuta,
  Coordenadas,
  DestinoRuta,
  EstadoPedido,
  Pedido,
  Vehiculo,
} from "../dominio/modelos"

export interface RepositorioPedidos {
  buscarPorId(id: string): Promise<Pedido | null>
  guardar(pedido: Pedido): Promise<void>
  cambiarEstado(
    id: string,
    estado: EstadoPedido,
    usuarioId: string,
  ): Promise<void>
}

export interface ServicioMapas {
  calcularAlternativas(
    origen: Coordenadas,
    destinos: DestinoRuta[],
    vehiculo: Vehiculo,
  ): Promise<AlternativaRuta[]>
}

export interface Reloj {
  ahora(): Date
}
