CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE product_specifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  version text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_specification_characteristics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_specification_id uuid NOT NULL REFERENCES product_specifications(id) ON DELETE CASCADE,
  name text NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('number', 'string', 'boolean')),
  value text NOT NULL,
  unit text
);

CREATE TABLE product_offerings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  product_specification_id uuid NOT NULL REFERENCES product_specifications(id),
  channel_availability text[] NOT NULL DEFAULT '{}',
  sunset_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_offering_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_offering_id uuid NOT NULL REFERENCES product_offerings(id) ON DELETE CASCADE,
  price_type text NOT NULL CHECK (price_type IN ('standard', 'discount')),
  amount numeric(18, 4) NOT NULL,
  currency char(3) NOT NULL,
  charging_source text NOT NULL CHECK (charging_source IN ('MA', 'DA', 'LOYALTY', 'MOBILE_MONEY')),
  da_id text,
  priority integer,
  parent_price_id uuid REFERENCES product_offering_prices(id),
  discount_type text CHECK (discount_type IN ('fixed', 'percentage')),
  discount_value numeric(18, 4),
  eligibility_condition text,
  is_default boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX one_default_price_per_offering_currency
  ON product_offering_prices(product_offering_id, currency)
  WHERE is_default;

CREATE TABLE eligibility_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_offering_id uuid NOT NULL REFERENCES product_offerings(id) ON DELETE CASCADE,
  rule_type text NOT NULL CHECK (rule_type IN ('serviceClass', 'segment', 'multiPurchase', 'renewal', 'channel')),
  operator text NOT NULL CHECK (operator IN ('equals', 'notEquals', 'in', 'notIn')),
  value text NOT NULL,
  failure_reason_code text NOT NULL
);

CREATE TABLE shopping_carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id text NOT NULL,
  subscriber_id text NOT NULL,
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'validated', 'checkedOut', 'abandoned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES shopping_carts(id) ON DELETE CASCADE,
  product_offering_id uuid NOT NULL REFERENCES product_offerings(id),
  quantity integer NOT NULL DEFAULT 1,
  purchase_policy text NOT NULL CHECK (purchase_policy IN ('one-off', 'auto-renewal', 'gift')),
  beneficiary_id text,
  priced_amount numeric(18, 4),
  priced_currency char(3),
  validation_status text NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending', 'valid', 'invalid')),
  validation_reason_code text
);

CREATE TABLE product_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES shopping_carts(id),
  subscriber_id text NOT NULL,
  channel_id text NOT NULL,
  order_type text NOT NULL DEFAULT 'provision' CHECK (order_type IN ('provision', 'terminate')),
  status text NOT NULL DEFAULT 'acknowledged' CHECK (status IN ('acknowledged', 'inProgress', 'completed', 'failed', 'cancelled')),
  failure_reason_code text,
  failure_message text,
  validation_status text NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending', 'valid', 'invalid')),
  validation_reason_code text,
  total_amount numeric(18, 4) NOT NULL DEFAULT 0,
  currency char(3),
  state_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  fulfillment jsonb NOT NULL DEFAULT '{}'::jsonb,
  compensation jsonb,
  validated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES product_orders(id) ON DELETE CASCADE,
  cart_item_id uuid REFERENCES cart_items(id),
  product_offering_id uuid NOT NULL REFERENCES product_offerings(id),
  quantity integer NOT NULL DEFAULT 1,
  purchase_policy text NOT NULL CHECK (purchase_policy IN ('one-off', 'auto-renewal', 'gift')),
  beneficiary_id text,
  priced_amount numeric(18, 4),
  priced_currency char(3),
  amount numeric(18, 4),
  currency char(3),
  status text NOT NULL DEFAULT 'acknowledged' CHECK (status IN ('acknowledged', 'inProgress', 'completed', 'failed', 'cancelled')),
  fulfillment_status text NOT NULL DEFAULT 'pending' CHECK (fulfillment_status IN ('pending', 'completed', 'failed', 'cancelled')),
  failure_reason_code text
);

CREATE TABLE order_validation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES product_orders(id) ON DELETE CASCADE,
  channel_valid boolean NOT NULL,
  subscriber_eligible boolean NOT NULL,
  offering_available boolean NOT NULL,
  balance_sufficient boolean NOT NULL,
  overall_valid boolean NOT NULL,
  failure_reason_codes text[] NOT NULL DEFAULT '{}',
  validated_at timestamptz NOT NULL
);

CREATE TABLE fulfillment_step_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES product_orders(id) ON DELETE CASCADE,
  step_name text NOT NULL CHECK (step_name IN ('debit', 'attachOffer', 'neaActivation')),
  status text NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'skipped')),
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  executed_at timestamptz NOT NULL,
  failure_reason text
);

CREATE TABLE product_inventories (
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

CREATE TABLE channels (
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

CREATE TABLE channel_interactions (
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
