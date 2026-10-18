ALTER TABLE profiles
  ADD COLUMN phone text,
  ADD CONSTRAINT profiles_phone_mobile_check
    CHECK (phone IS NULL OR phone ~ '^9[0-9]{8}$');
