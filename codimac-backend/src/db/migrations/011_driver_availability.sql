-- RF-03.1: disponibilidad de choferes gestionada por el despachador y el administrador.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS available boolean NOT NULL DEFAULT true;
