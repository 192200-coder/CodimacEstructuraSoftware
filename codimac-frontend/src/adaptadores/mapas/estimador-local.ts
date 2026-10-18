import { generarAlternativas } from "../../dominio/rutas"
import type { ServicioMapas } from "../../aplicacion/puertos"
import type { Coordenadas, DestinoRuta, Vehiculo } from "../../dominio/modelos"

export class EstimadorLocal implements ServicioMapas {
  constructor(
    private readonly precioCombustible: number,
    private readonly minutosPorParada: number,
  ) {}

  async calcularAlternativas(
    origen: Coordenadas,
    destinos: DestinoRuta[],
    vehiculo: Vehiculo,
  ) {
    return generarAlternativas(
      origen,
      destinos,
      vehiculo,
      this.precioCombustible,
      this.minutosPorParada,
      "tiempo",
    )
  }
}
