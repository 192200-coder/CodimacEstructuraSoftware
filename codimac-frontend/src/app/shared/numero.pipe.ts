import { Pipe, PipeTransform } from "@angular/core"
import { formatearNumero } from "../../dominio/planificacion-ruta-ui"

/** `{{ valor | numero }}` quita ceros decimales; `numero:2:2` fija 2 decimales. */
@Pipe({ name: "numero", standalone: true })
export class NumeroPipe implements PipeTransform {
  transform(
    value: number | string | null | undefined,
    maxDecimals = 2,
    minDecimals = 0,
  ): string {
    return formatearNumero(value, maxDecimals, minDecimals)
  }
}
