BEGIN;

ALTER TABLE vouchers
  ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE voucher_number_counters
  ALTER COLUMN updated_at SET DEFAULT NOW();

CREATE OR REPLACE FUNCTION generate_voucher_no(p_type voucher_type, p_date DATE DEFAULT CURRENT_DATE)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_year INTEGER := EXTRACT(YEAR FROM p_date)::INTEGER;
  v_prefix TEXT;
  v_serial INTEGER;
BEGIN
  v_prefix := CASE p_type
    WHEN 'PURCHASE' THEN 'NK'
    WHEN 'SALES' THEN 'XK'
    WHEN 'CONVERSION' THEN 'XL'
    WHEN 'RECEIPT' THEN 'PT'
    WHEN 'PAYMENT' THEN 'PC'
    WHEN 'OPENING_BALANCE' THEN 'DK'
  END;

  INSERT INTO voucher_number_counters (voucher_type, fiscal_year, last_number, updated_at)
  VALUES (p_type, v_year, 1, NOW())
  ON CONFLICT (voucher_type, fiscal_year)
  DO UPDATE
  SET last_number = voucher_number_counters.last_number + 1,
      updated_at = NOW()
  RETURNING last_number INTO v_serial;

  RETURN format('%s-%s-%s', v_prefix, v_year::TEXT, lpad(v_serial::TEXT, 4, '0'));
END;
$$;

COMMIT;
