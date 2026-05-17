ALTER TABLE product_orders
  ADD COLUMN IF NOT EXISTS compensation jsonb;

CREATE TABLE IF NOT EXISTS product_inventories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_order_id uuid NOT NULL REFERENCES product_orders(id),
  order_item_id uuid NOT NULL REFERENCES product_order_items(id),
  subscriber_id text NOT NULL,
  sponsor_id text,
  channel_id text NOT NULL,
  product_offering_id uuid NOT NULL REFERENCES product_offerings(id),
  quantity integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'terminated', 'expired')),
  activated_at timestamptz NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  type text NOT NULL CHECK (type IN ('USSD', 'SMS', 'WEB', 'CRM', 'MOBILE_APP', 'THIRD_PARTY', 'SELF_CARE')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  external_id text,
  callback_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels(id),
  channel_type text NOT NULL,
  request_type text NOT NULL,
  subscriber_id text NOT NULL,
  product_offering_id uuid NOT NULL REFERENCES product_offerings(id),
  cart_id uuid REFERENCES shopping_carts(id),
  cart_item_id uuid REFERENCES cart_items(id),
  order_id uuid REFERENCES product_orders(id),
  status text NOT NULL,
  reason_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
