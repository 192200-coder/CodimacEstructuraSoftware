import { Pipe, PipeTransform } from "@angular/core"
import { formatearFecha, type EstiloFecha } from "../../dominio/formato"

/** `{{ valor | fecha }}` en hora de Lima y formato de 24 horas; `fecha:"hora"` o `fecha:"fecha"`. */
@Pipe({ name: "fecha", standalone: true })
export class FechaPipe implements PipeTransform {
  transform(value: string | number | Date | null | undefined, estilo: EstiloFecha = "fechaHora"): string {
    return formatearFecha(value, estilo)
  }
}
