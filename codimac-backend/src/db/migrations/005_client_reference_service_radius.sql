ALTER TABLE clients
  ADD COLUMN reference varchar(150) NOT NULL DEFAULT '';

UPDATE clients
SET contact = right(regexp_replace(contact, '[^0-9]', '', 'g'), 9)
WHERE contact IS NOT NULL
  AND length(regexp_replace(contact, '[^0-9]', '', 'g')) >= 9;

ALTER TABLE clients
  ADD CONSTRAINT clients_contact_mobile_check
    CHECK (contact IS NOT NULL AND contact ~ '^9[0-9]{8}$') NOT VALID,
  ADD CONSTRAINT clients_address_length_check
    CHECK (length(btrim(address)) BETWEEN 5 AND 150) NOT VALID;

ALTER TABLE global_parameters
  ADD COLUMN service_radius_km numeric(8,2) NOT NULL DEFAULT 50
    CHECK (service_radius_km > 0 AND service_radius_km <= 1000);
