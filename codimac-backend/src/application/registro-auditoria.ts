export interface EventoAuditoria {
  usuarioId: string | null
  accion: string
  entidad: string
  entidadId: string | null
  valorAnterior: Record<string, unknown> | null
  valorNuevo: Record<string, unknown> | null
}

export interface RegistroAuditoria {
  registrar(evento: EventoAuditoria): Promise<void>
}

export async function registrarEventoAuditoria(
  registro: RegistroAuditoria,
  evento: EventoAuditoria,
): Promise<void> {
  await registro.registrar(evento)
}
