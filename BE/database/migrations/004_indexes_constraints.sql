BEGIN;

ALTER TABLE users
  ADD CONSTRAINT users_username_uniq UNIQUE (username);

ALTER TABLE categories
  ADD CONSTRAINT categories_code_uniq UNIQUE (code);

ALTER TABLE partners
  ADD CONSTRAINT partners_code_uniq UNIQUE (code);

ALTER TABLE products
  ADD CONSTRAINT products_sku_code_uniq UNIQUE (sku_code);

ALTER TABLE vouchers
  ADD CONSTRAINT vouchers_voucher_no_uniq UNIQUE (voucher_no);

ALTER TABLE system_settings
  ADD CONSTRAINT system_settings_key_uniq UNIQUE (setting_key);

ALTER TABLE voucher_number_counters
  ADD CONSTRAINT voucher_number_counters_type_year_uniq UNIQUE (voucher_type, fiscal_year);

ALTER TABLE products
  ADD CONSTRAINT products_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES products(id),
  ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id);

ALTER TABLE vouchers
  ADD CONSTRAINT vouchers_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES partners(id),
  ADD CONSTRAINT vouchers_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id),
  ADD CONSTRAINT vouchers_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id),
  ADD CONSTRAINT vouchers_edited_from_fkey FOREIGN KEY (edited_from_voucher_id) REFERENCES vouchers(id);

ALTER TABLE voucher_items
  ADD CONSTRAINT voucher_items_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES vouchers(id),
  ADD CONSTRAINT voucher_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id),
  ADD CONSTRAINT voucher_items_quantity_check CHECK (quantity > 0),
  ADD CONSTRAINT voucher_items_price_check CHECK (unit_price >= 0),
  ADD CONSTRAINT voucher_items_discount_check CHECK (discount_amount >= 0),
  ADD CONSTRAINT voucher_items_net_price_check CHECK (net_price >= 0);

ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES vouchers(id),
  ADD CONSTRAINT inventory_movements_item_id_fkey FOREIGN KEY (voucher_item_id) REFERENCES voucher_items(id),
  ADD CONSTRAINT inventory_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);

ALTER TABLE ar_ledger
  ADD CONSTRAINT ar_ledger_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES vouchers(id),
  ADD CONSTRAINT ar_ledger_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES partners(id);

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_parent_id ON products(parent_id);
CREATE INDEX idx_products_deleted_at ON products(deleted_at);
CREATE INDEX idx_vouchers_type_status ON vouchers(type, status);
CREATE INDEX idx_vouchers_partner_id ON vouchers(partner_id);
CREATE INDEX idx_vouchers_voucher_date ON vouchers(voucher_date);
CREATE INDEX idx_vouchers_deleted_at ON vouchers(deleted_at);
CREATE INDEX idx_voucher_items_voucher_id ON voucher_items(voucher_id);
CREATE INDEX idx_voucher_items_product_id ON voucher_items(product_id);
CREATE INDEX idx_inventory_movements_product_created_at ON inventory_movements(product_id, created_at);
CREATE INDEX idx_ar_ledger_partner_created_at ON ar_ledger(partner_id, created_at);
CREATE INDEX idx_audit_logs_entity_created_at ON audit_logs(entity_name, created_at);
CREATE INDEX idx_audit_logs_correlation_id ON audit_logs(correlation_id);

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
