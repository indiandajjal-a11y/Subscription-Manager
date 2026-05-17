ALTER TABLE product_orders
  ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'provision',
  ADD COLUMN IF NOT EXISTS failure_reason_code text,
  ADD COLUMN IF NOT EXISTS failure_message text,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE product_order_items
  ADD COLUMN IF NOT EXISTS priced_amount numeric(18, 4),
  ADD COLUMN IF NOT EXISTS priced_currency char(3);

ALTER TABLE product_order_items
  DROP CONSTRAINT IF EXISTS product_order_items_status_check;

ALTER TABLE product_order_items
  ADD CONSTRAINT product_order_items_status_check
  CHECK (status IN ('acknowledged', 'inProgress', 'completed', 'failed', 'cancelled'));

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
