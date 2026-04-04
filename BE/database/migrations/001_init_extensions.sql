BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION get_request_user_id()
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_id TEXT;
BEGIN
  v_user_id = NULLIF(current_setting('app.user_id', TRUE), '');
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_user_id::UUID;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION get_request_correlation_id()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN NULLIF(current_setting('app.correlation_id', TRUE), '');
END;
$$;

CREATE OR REPLACE FUNCTION get_request_ip()
RETURNS INET
LANGUAGE plpgsql
AS $$
DECLARE
  v_ip TEXT;
BEGIN
  v_ip = NULLIF(current_setting('app.ip_address', TRUE), '');
  IF v_ip IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_ip::INET;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

COMMIT;
