ALTER TABLE product_orders
  DROP CONSTRAINT IF EXISTS product_orders_status_check;

ALTER TABLE product_orders
  ADD CONSTRAINT product_orders_status_check
  CHECK (status IN ('acknowledged', 'inProgress', 'completed', 'failed', 'cancelled'));

ALTER TABLE product_orders
  ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS validation_reason_code text,
  ADD COLUMN IF NOT EXISTS total_amount numeric(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency char(3),
  ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'provision',
  ADD COLUMN IF NOT EXISTS failure_reason_code text,
  ADD COLUMN IF NOT EXISTS failure_message text,
  ADD COLUMN IF NOT EXISTS state_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS fulfillment jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS compensation jsonb,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE product_orders
  DROP CONSTRAINT IF EXISTS product_orders_validation_status_check;

ALTER TABLE product_orders
  ADD CONSTRAINT product_orders_validation_status_check
  CHECK (validation_status IN ('pending', 'valid', 'invalid'));

CREATE TABLE IF NOT EXISTS product_order_items (
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

CREATE TABLE IF NOT EXISTS order_validation_results (
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

CREATE TABLE IF NOT EXISTS fulfillment_step_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES product_orders(id) ON DELETE CASCADE,
  step_name text NOT NULL CHECK (step_name IN ('debit', 'attachOffer', 'neaActivation')),
  status text NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'skipped')),
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  executed_at timestamptz NOT NULL,
  failure_reason text
);
