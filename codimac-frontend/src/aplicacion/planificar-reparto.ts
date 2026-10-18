import { ReglaNegocioError } from "../dominio/errores"
import { pesoTotalKg, validarCapacidad } from "../dominio/inventario"
import type { Coordenadas, Pedido, Vehiculo } from "../dominio/modelos"
import type { ServicioMapas } from "./puertos"

export class PlanificarReparto {
  constructor(private readonly mapas: ServicioMapas) {}

  async ejecutar(datos: {
    almacen: Coordenadas
    pedidos: Pedido[]
    vehiculo: Vehiculo
  }) {
    if (!datos.pedidos.length) {
      throw new ReglaNegocioError(
        "No se permiten repartos vacíos.",
        "REPARTO_VACIO",
      )
    }
    if (!datos.vehiculo.disponible) {
      throw new ReglaNegocioError(
        "El vehículo no está disponible.",
        "VEHICULO_OCUPADO",
      )
    }
    if (datos.pedidos.some((pedido) => pedido.estado !== "Listo")) {
      throw new ReglaNegocioError(
        "Solo los pedidos Listo pueden incluirse en un reparto.",
        "PEDIDO_NO_LISTO",
      )
    }
    const ids = new Set(datos.pedidos.map((pedido) => pedido.id))
    if (ids.size !== datos.pedidos.length) {
      throw new ReglaNegocioError(
        "Un pedido no puede repetirse en un reparto.",
        "PEDIDO_DUPLICADO",
      )
    }
    const peso = datos.pedidos.reduce(
      (total, pedido) => total + pesoTotalKg(pedido.lineas),
      0,
    )
    validarCapacidad(peso, datos.vehiculo.capacidadKg)
    const alternativas = await this.mapas.calcularAlternativas(
      datos.almacen,
      datos.pedidos.map((pedido) => ({
        id: pedido.id,
        etiqueta: pedido.codigo,
        coordenadas: pedido.coordenadas,
        fechaLimite: pedido.fechaLimite,
      })),
      datos.vehiculo,
    )
    return { pesoKg: peso, alternativas }
  }
}
