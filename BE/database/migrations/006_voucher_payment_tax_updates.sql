BEGIN;

ALTER TYPE voucher_type ADD VALUE IF NOT EXISTS 'RECEIPT';
ALTER TYPE voucher_type ADD VALUE IF NOT EXISTS 'PAYMENT';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE payment_status AS ENUM ('UNPAID', 'PARTIAL', 'PAID');
  END IF;
END $$;

ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS payment_status payment_status NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN IF NOT EXISTS total_tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(18, 4) NOT NULL DEFAULT 0;

ALTER TABLE voucher_items
  ADD COLUMN IF NOT EXISTS discount_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(9, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'voucher_items_discount_rate_check'
  ) THEN
    ALTER TABLE voucher_items
      ADD CONSTRAINT voucher_items_discount_rate_check CHECK (discount_rate >= 0 AND discount_rate <= 100);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'voucher_items_tax_rate_check'
  ) THEN
    ALTER TABLE voucher_items
      ADD CONSTRAINT voucher_items_tax_rate_check CHECK (tax_rate >= 0 AND tax_rate <= 100);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'voucher_items_tax_amount_check'
  ) THEN
    ALTER TABLE voucher_items
      ADD CONSTRAINT voucher_items_tax_amount_check CHECK (tax_amount >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vouchers_paid_amount_check'
  ) THEN
    ALTER TABLE vouchers
      ADD CONSTRAINT vouchers_paid_amount_check CHECK (paid_amount >= 0);
  END IF;
END $$;

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
    WHEN p_type = 'SALES' THEN 'XK'
    WHEN p_type = 'CONVERSION' THEN 'XL'
    WHEN p_type = 'RECEIPT' THEN 'PT'
    WHEN p_type = 'PAYMENT' THEN 'PC'
  END;

  INSERT INTO voucher_number_counters (voucher_type, fiscal_year, last_number)
  VALUES (p_type, v_year, 1)
  ON CONFLICT (voucher_type, fiscal_year)
  DO UPDATE
  SET last_number = voucher_number_counters.last_number + 1,
      updated_at = NOW()
  RETURNING last_number INTO v_serial;

  RETURN format('%s-%s-%s', v_prefix, v_year::TEXT, lpad(v_serial::TEXT, 4, '0'));
END;
$$;

COMMIT;
