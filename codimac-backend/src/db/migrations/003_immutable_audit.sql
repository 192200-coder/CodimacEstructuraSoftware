CREATE TABLE auditoria_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha_hora timestamptz NOT NULL DEFAULT now(),
  usuario_id uuid REFERENCES profiles(id) ON DELETE RESTRICT,
  accion text NOT NULL CHECK (length(trim(accion)) > 0),
  entidad text NOT NULL CHECK (length(trim(entidad)) > 0),
  entidad_id text,
  valor_anterior jsonb,
  valor_nuevo jsonb
);

CREATE INDEX auditoria_eventos_fecha_idx ON auditoria_eventos(fecha_hora DESC, id DESC);
CREATE INDEX auditoria_eventos_usuario_idx ON auditoria_eventos(usuario_id, fecha_hora DESC);
CREATE INDEX auditoria_eventos_entidad_accion_idx ON auditoria_eventos(entidad, accion, fecha_hora DESC);

CREATE FUNCTION impedir_modificacion_auditoria()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Los eventos de auditoría son inmutables'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER auditoria_eventos_inmutable
BEFORE UPDATE OR DELETE ON auditoria_eventos
FOR EACH ROW EXECUTE FUNCTION impedir_modificacion_auditoria();
