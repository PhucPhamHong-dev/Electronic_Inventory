BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'voucher_type') THEN
    CREATE TYPE voucher_type AS ENUM ('PURCHASE', 'SALES', 'CONVERSION');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'voucher_status') THEN
    CREATE TYPE voucher_status AS ENUM ('DRAFT', 'BOOKED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'partner_type') THEN
    CREATE TYPE partner_type AS ENUM ('SUPPLIER', 'CUSTOMER', 'BOTH');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_movement_type') THEN
    CREATE TYPE inventory_movement_type AS ENUM (
      'PURCHASE_IN',
      'SALES_OUT',
      'CONVERSION_OUT',
      'CONVERSION_IN',
      'REVERSAL_IN',
      'REVERSAL_OUT'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_action') THEN
    CREATE TYPE audit_action AS ENUM (
      'INSERT',
      'UPDATE',
      'DELETE',
      'BOOK',
      'EDIT',
      'LOGIN',
      'AUTH',
      'FAILED'
    );
  END IF;
END $$;

COMMIT;
