BEGIN;

CREATE OR REPLACE FUNCTION assign_voucher_no()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.voucher_no IS NULL OR NEW.voucher_no = '' THEN
    NEW.voucher_no = generate_voucher_no(NEW.type, NEW.voucher_date);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION audit_vouchers_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_id UUID := get_request_user_id();
  v_correlation_id TEXT := get_request_correlation_id();
  v_ip INET := get_request_ip();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (
      user_id,
      action,
      entity_name,
      entity_id,
      old_value,
      new_value,
      ip_address,
      correlation_id,
      message
    ) VALUES (
      v_user_id,
      'INSERT',
      'vouchers',
      NEW.id,
      NULL,
      to_jsonb(NEW),
      v_ip,
      v_correlation_id,
      'Voucher inserted'
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (
      user_id,
      action,
      entity_name,
      entity_id,
      old_value,
      new_value,
      ip_address,
      correlation_id,
      message
    ) VALUES (
      v_user_id,
      'UPDATE',
      'vouchers',
      NEW.id,
      to_jsonb(OLD),
      to_jsonb(NEW),
      v_ip,
      v_correlation_id,
      'Voucher updated'
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (
      user_id,
      action,
      entity_name,
      entity_id,
      old_value,
      new_value,
      ip_address,
      correlation_id,
      message
    ) VALUES (
      v_user_id,
      'DELETE',
      'vouchers',
      OLD.id,
      to_jsonb(OLD),
      NULL,
      v_ip,
      v_correlation_id,
      'Voucher deleted'
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER categories_set_updated_at
BEFORE UPDATE ON categories
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER partners_set_updated_at
BEFORE UPDATE ON partners
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER products_set_updated_at
BEFORE UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER vouchers_set_updated_at
BEFORE UPDATE ON vouchers
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER voucher_items_set_updated_at
BEFORE UPDATE ON voucher_items
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER system_settings_set_updated_at
BEFORE UPDATE ON system_settings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER voucher_number_counters_set_updated_at
BEFORE UPDATE ON voucher_number_counters
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER vouchers_assign_no
BEFORE INSERT ON vouchers
FOR EACH ROW
EXECUTE FUNCTION assign_voucher_no();

CREATE TRIGGER vouchers_audit_log
AFTER INSERT OR UPDATE OR DELETE ON vouchers
FOR EACH ROW
EXECUTE FUNCTION audit_vouchers_changes();

COMMIT;
