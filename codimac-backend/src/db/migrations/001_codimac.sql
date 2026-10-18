CREATE TABLE profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('Despachador', 'Chofer', 'Administrador')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact text,
  address text NOT NULL,
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  unit text NOT NULL,
  weight_kg numeric(12,3) NOT NULL CHECK (weight_kg >= 0),
  total_stock numeric(14,3) NOT NULL DEFAULT 0 CHECK (total_stock >= 0),
  reserved_stock numeric(14,3) NOT NULL DEFAULT 0
    CHECK (reserved_stock >= 0 AND reserved_stock <= total_stock),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate text NOT NULL UNIQUE,
  vehicle_type text NOT NULL,
  capacity_kg numeric(12,3) NOT NULL CHECK (capacity_kg > 0),
  average_speed_kmh numeric(8,2) NOT NULL CHECK (average_speed_kmh > 0),
  fuel_efficiency_km_l numeric(8,2) NOT NULL CHECK (fuel_efficiency_km_l > 0),
  available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'Borrador'
    CHECK (status IN ('Borrador', 'Aprobada', 'Asignada', 'En ruta', 'Cerrada')),
  driver_id uuid REFERENCES profiles(id),
  vehicle_id uuid REFERENCES vehicles(id),
  distance_km numeric(10,2) CHECK (distance_km >= 0),
  estimated_minutes integer CHECK (estimated_minutes >= 0),
  estimated_liters numeric(10,3) CHECK (estimated_liters >= 0),
  estimated_cost numeric(10,2) CHECK (estimated_cost >= 0),
  uses_real_traffic boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  closed_at timestamptz,
  created_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (closed_at IS NULL OR started_at IS NOT NULL)
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  tracking_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  client_id uuid NOT NULL REFERENCES clients(id),
  status text NOT NULL DEFAULT 'Pendiente'
    CHECK (status IN ('Pendiente', 'En preparación', 'Listo', 'En ruta', 'Entregado', 'Cancelado')),
  ordered_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz,
  active_route_id uuid REFERENCES routes(id),
  created_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX one_active_route_per_order
  ON orders(id) WHERE active_route_id IS NOT NULL AND status = 'En ruta';

CREATE TABLE order_items (
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, product_id)
);

CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  movement_type text NOT NULL CHECK (movement_type IN ('Entrada', 'Ajuste', 'Reserva', 'Liberación')),
  quantity numeric(14,3) NOT NULL,
  reason text NOT NULL,
  actor_id uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE route_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id),
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  status text NOT NULL DEFAULT 'Pendiente'
    CHECK (status IN ('Pendiente', 'En camino', 'Entregada', 'Incidencia', 'No entregada')),
  eta_at timestamptz,
  delivered_at timestamptz,
  received_by text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 2),
  UNIQUE (route_id, order_id),
  UNIQUE (route_id, sequence_number)
);

CREATE TABLE incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stop_id uuid NOT NULL REFERENCES route_stops(id),
  cause text NOT NULL CHECK (cause IN ('Cliente ausente', 'Dirección errónea', 'Otra')),
  notes text,
  opened_by uuid NOT NULL REFERENCES profiles(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('Pedido', 'Parada', 'Ruta')),
  entity_id uuid NOT NULL,
  previous_status text,
  new_status text NOT NULL,
  actor_id uuid NOT NULL REFERENCES profiles(id),
  route_id uuid REFERENCES routes(id),
  stop_id uuid REFERENCES route_stops(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE global_parameters (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  warehouse_latitude numeric(9,6) NOT NULL CHECK (warehouse_latitude BETWEEN -90 AND 90),
  warehouse_longitude numeric(9,6) NOT NULL CHECK (warehouse_longitude BETWEEN -180 AND 180),
  fuel_price numeric(10,2) NOT NULL CHECK (fuel_price > 0),
  minutes_per_stop integer NOT NULL CHECK (minutes_per_stop >= 0),
  updated_by uuid REFERENCES profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_preferences (
  user_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('Despachador', 'Chofer', 'Administrador')),
  active_section text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text NOT NULL,
  actor_id uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orders_status_deadline_idx ON orders(status, deadline_at, ordered_at);
CREATE INDEX route_stops_route_sequence_idx ON route_stops(route_id, sequence_number);
CREATE INDEX status_events_route_created_idx ON status_events(route_id, created_at DESC);
CREATE INDEX incidents_stop_idx ON incidents(stop_id);
CREATE INDEX auth_sessions_user_expiry_idx ON auth_sessions(user_id, expires_at);

CREATE VIEW route_indicators AS
SELECT r.id, r.code, r.started_at, r.closed_at, r.distance_km,
       r.estimated_minutes, r.estimated_cost,
       count(DISTINCT rs.id) FILTER (WHERE rs.status = 'Entregada') AS delivered,
       count(DISTINCT rs.id) FILTER (WHERE rs.status = 'No entregada') AS not_delivered,
       count(DISTINCT i.id) AS incidents
FROM routes r
LEFT JOIN route_stops rs ON rs.route_id = r.id
LEFT JOIN incidents i ON i.stop_id = rs.id
WHERE r.status = 'Cerrada'
GROUP BY r.id;
