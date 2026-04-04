BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(128) NOT NULL,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(255),
  permissions JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  partner_type partner_type NOT NULL DEFAULT 'BOTH',
  phone VARCHAR(32),
  email VARCHAR(128),
  address TEXT,
  current_debt NUMERIC(18, 4) NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku_code VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  parent_id UUID,
  category_id UUID,
  unit_name VARCHAR(32) NOT NULL DEFAULT 'unit',
  conversion_ratio NUMERIC(18, 6) NOT NULL DEFAULT 1,
  cost_price NUMERIC(18, 4) NOT NULL DEFAULT 0,
  stock_quantity NUMERIC(18, 3) NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vouchers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voucher_no VARCHAR(32),
  type voucher_type NOT NULL,
  status voucher_status NOT NULL DEFAULT 'DRAFT',
  partner_id UUID,
  voucher_date DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_discount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_net_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  is_edited BOOLEAN NOT NULL DEFAULT FALSE,
  edited_from_voucher_id UUID,
  pdf_file_path TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voucher_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voucher_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity NUMERIC(18, 3) NOT NULL,
  unit_price NUMERIC(18, 4) NOT NULL,
  discount_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  net_price NUMERIC(18, 4) NOT NULL,
  cogs NUMERIC(18, 4) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voucher_id UUID NOT NULL,
  voucher_item_id UUID,
  product_id UUID NOT NULL,
  movement_type inventory_movement_type NOT NULL,
  quantity_before NUMERIC(18, 3) NOT NULL,
  quantity_change NUMERIC(18, 3) NOT NULL,
  quantity_after NUMERIC(18, 3) NOT NULL,
  unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ar_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voucher_id UUID NOT NULL,
  partner_id UUID NOT NULL,
  debit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  credit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  balance_after NUMERIC(18, 4) NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  action audit_action NOT NULL,
  entity_name VARCHAR(128) NOT NULL,
  entity_id UUID,
  old_value JSONB,
  new_value JSONB,
  ip_address INET,
  correlation_id VARCHAR(64),
  message TEXT,
  error_stack TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  setting_key VARCHAR(128) NOT NULL,
  value_text TEXT,
  value_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voucher_number_counters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voucher_type voucher_type NOT NULL,
  fiscal_year INTEGER NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
