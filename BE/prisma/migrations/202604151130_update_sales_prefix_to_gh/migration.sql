CREATE OR REPLACE FUNCTION generate_voucher_no(
  p_type voucher_type,
  p_date DATE DEFAULT CURRENT_DATE,
  p_payment_method payment_method DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_year INTEGER := EXTRACT(YEAR FROM p_date)::INTEGER;
  v_prefix TEXT;
  v_serial INTEGER;
BEGIN
  v_prefix := CASE
    WHEN p_type = 'RECEIPT' AND p_payment_method = 'TRANSFER' THEN 'NTTK'
    WHEN p_type = 'PURCHASE' THEN 'NK'
    WHEN p_type = 'SALES' THEN 'GH'
    WHEN p_type = 'CONVERSION' THEN 'XL'
    WHEN p_type = 'RECEIPT' THEN 'PT'
    WHEN p_type = 'PAYMENT' THEN 'PC'
    WHEN p_type = 'OPENING_BALANCE' THEN 'DK'
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
