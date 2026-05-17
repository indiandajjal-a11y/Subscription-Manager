-- Sprint 3 prompt gap closure: terminate orders, compensation config/records,
-- notification events, richer inventory fields, and channel registry fields.

ALTER TABLE product_orders
  ADD COLUMN IF NOT EXISTS original_order_id uuid REFERENCES product_orders(id),
  ADD COLUMN IF NOT EXISTS cancellation_reason_code text,
  ADD COLUMN IF NOT EXISTS compensation_policy text CHECK (compensation_policy IN ('none', 'creditBack', 'retry')),
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries integer,
  ADD COLUMN IF NOT EXISTS retry_interval_seconds integer;

CREATE TABLE IF NOT EXISTS compensation_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_offering_id uuid NOT NULL UNIQUE REFERENCES product_offerings(id),
  compensation_type text NOT NULL CHECK (compensation_type IN ('none', 'creditBack', 'retry')),
  max_retries integer,
  retry_interval_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compensation_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES product_orders(id),
  compensation_type text NOT NULL CHECK (compensation_type IN ('creditBack', 'retry')),
  attempt_number integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'success', 'failed')),
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  executed_at timestamptz NOT NULL DEFAULT now(),
  failure_reason text
);

ALTER TABLE product_inventories
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES product_orders(id),
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS renewal_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS charging_source text CHECK (charging_source IN ('MA', 'DA', 'LOYALTY', 'MOBILE_MONEY')),
  ADD COLUMN IF NOT EXISTS da_id text,
  ADD COLUMN IF NOT EXISTS amount_charged numeric(18, 4),
  ADD COLUMN IF NOT EXISTS currency char(3),
  ADD COLUMN IF NOT EXISTS beneficiary_id text,
  ADD COLUMN IF NOT EXISTS terminated_at timestamptz;

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS channel_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS channel_type text,
  ADD COLUMN IF NOT EXISTS contact_point text,
  ADD COLUMN IF NOT EXISTS auth_method text DEFAULT 'none' CHECK (auth_method IN ('none', 'apiKey', 'jwt')),
  ADD COLUMN IF NOT EXISTS api_key_hash text,
  ADD COLUMN IF NOT EXISTS allowed_offering_ids uuid[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN ('ORDER_COMPLETED', 'ORDER_FAILED', 'ORDER_CANCELLED', 'COMPENSATION_COMPLETED', 'COMPENSATION_FAILED')),
  order_id uuid NOT NULL REFERENCES product_orders(id),
  subscriber_id text NOT NULL,
  channel_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
