import type { EventoAuditoria, RegistroAuditoria } from "../application/registro-auditoria.js"

type Query = (text: string, values: unknown[]) => Promise<unknown>

export class PostgresRegistroAuditoria implements RegistroAuditoria {
  constructor(private readonly query: Query) {}

  async registrar(evento: EventoAuditoria): Promise<void> {
    await this.query(
      `INSERT INTO auditoria_eventos
         (usuario_id,accion,entidad,entidad_id,valor_anterior,valor_nuevo)
       VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [
        evento.usuarioId,
        evento.accion,
        evento.entidad,
        evento.entidadId,
        evento.valorAnterior === null ? null : JSON.stringify(evento.valorAnterior),
        evento.valorNuevo === null ? null : JSON.stringify(evento.valorNuevo),
      ],
    )
  }
}
