ALTER TABLE routes DROP CONSTRAINT routes_status_check;

UPDATE routes SET status='Calculada' WHERE status='Borrador';
UPDATE routes SET status='En curso' WHERE status='En ruta';

ALTER TABLE routes
  ALTER COLUMN status SET DEFAULT 'Calculada',
  ADD CONSTRAINT routes_status_check
    CHECK (status IN ('Calculada', 'Aprobada', 'Asignada', 'En curso', 'Cerrada'));

CREATE OR REPLACE FUNCTION validar_transicion_estado_ruta()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'Cerrada' THEN
    RAISE EXCEPTION 'Una ruta cerrada no puede reactivarse'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD.status = 'Calculada' AND NEW.status = 'Aprobada')
    OR (OLD.status = 'Aprobada' AND NEW.status = 'Asignada')
    OR (OLD.status = 'Asignada' AND NEW.status = 'En curso')
    OR (OLD.status = 'En curso' AND NEW.status = 'Cerrada')
  ) THEN
    RAISE EXCEPTION 'Transición de ruta inválida: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER routes_state_transition_guard
BEFORE UPDATE OF status ON routes
FOR EACH ROW EXECUTE FUNCTION validar_transicion_estado_ruta();
