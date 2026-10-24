-- RF-05.9 / RN-09: recorrido de referencia (mismas paradas en orden de prioridad,
-- misma matriz de tiempos) para estimar el ahorro de la ruta elegida.
ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS reference_km numeric(10,3) CHECK (reference_km IS NULL OR reference_km >= 0),
  ADD COLUMN IF NOT EXISTS reference_minutes integer CHECK (reference_minutes IS NULL OR reference_minutes >= 0);

-- CREATE OR REPLACE solo permite añadir columnas al final de la vista.
CREATE OR REPLACE VIEW route_indicators AS
SELECT r.id, r.codigo AS code, r.started_at, r.closed_at, r.distance_km,
       r.estimated_minutes, r.estimated_cost,
       count(DISTINCT rs.id) FILTER (WHERE rs.status = 'Entregada') AS delivered,
       count(DISTINCT rs.id) FILTER (WHERE rs.status = 'No entregada') AS not_delivered,
       count(DISTINCT i.id) AS incidents,
       r.estimated_liters, r.reference_km, r.reference_minutes
FROM routes r
LEFT JOIN route_stops rs ON rs.route_id = r.id
LEFT JOIN incidents i ON i.stop_id = rs.id
WHERE r.status = 'Cerrada'
GROUP BY r.id;
