-- Sprint 4: Real CS Integration + Channel Authentication
-- Adds: SubscriberAccount, ChannelAuthToken, extended ProductInventory fields

-- ============================================================================
-- SubscriberAccount (TMF666) — CS attribute cache per order
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscriber_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES product_orders(id) ON DELETE CASCADE,
  subscriber_id text NOT NULL,
  service_class text NOT NULL DEFAULT 'PREPAID',
  segment text NOT NULL DEFAULT 'CONSUMER',
  main_balance numeric(18, 4) NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'NGN',
  da_balances jsonb NOT NULL DEFAULT '[]'::jsonb,
  pso_flags text NOT NULL DEFAULT '',
  offer_ids text[] NOT NULL DEFAULT '{}',
  expiry_date date,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  cs_response_code text NOT NULL DEFAULT '0',
  cs_raw_response jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_subscriber_accounts_order_id ON subscriber_accounts(order_id);
CREATE INDEX IF NOT EXISTS idx_subscriber_accounts_subscriber_id ON subscriber_accounts(subscriber_id);

-- ============================================================================
-- ChannelAuthToken — Token registry for audit and revocation
-- ============================================================================

CREATE TABLE IF NOT EXISTS channel_auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id text NOT NULL,
  token_hash text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by text,
  last_used_at timestamptz,
  UNIQUE NULLS NOT DISTINCT (token_hash, revoked_at) -- Only one active token per hash
);

CREATE INDEX IF NOT EXISTS idx_channel_auth_tokens_channel_id ON channel_auth_tokens(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_auth_tokens_token_hash ON channel_auth_tokens(token_hash) WHERE revoked_at IS NULL;

-- ============================================================================
-- Extend Channels table for Sprint 4
-- ============================================================================

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS channel_id text,
  ADD COLUMN IF NOT EXISTS api_key_hash text,
  ADD COLUMN IF NOT EXISTS allowed_offering_ids uuid[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS auth_method text CHECK (auth_method IN ('none', 'apiKey', 'jwt'));

-- Create unique constraint on channel_id if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'channels_channel_id_key' AND table_name = 'channels'
  ) THEN
    ALTER TABLE channels ADD CONSTRAINT channels_channel_id_key UNIQUE (channel_id);
  END IF;
END $$;

-- ============================================================================
-- Extend ProductInventory for Sprint 4 (US-017 closure)
-- ============================================================================

ALTER TABLE product_inventories
  ADD COLUMN IF NOT EXISTS renewal_offer_id uuid REFERENCES product_offerings(id),
  ADD COLUMN IF NOT EXISTS refill_id text,
  ADD COLUMN IF NOT EXISTS notification_flags jsonb NOT NULL DEFAULT '{"onActivation": true, "onRenewal": true, "onExpiry": true, "onFailure": true}'::jsonb,
  ADD COLUMN IF NOT EXISTS cs_attachment_id text;

-- ============================================================================
-- Extend ProductOrders for Sprint 4
-- ============================================================================

ALTER TABLE product_orders
  ADD COLUMN IF NOT EXISTS subscriber_account_id uuid REFERENCES subscriber_accounts(id),
  ADD COLUMN IF NOT EXISTS subscription_id uuid REFERENCES product_inventories(id);

-- ============================================================================
-- Add new eligibility rule types for Sprint 4
-- ============================================================================

-- Multi-purchase rule: check if offering already attached
-- PSO flag rule: check PSO flags from CS

-- Note: These are handled in application logic, not database constraints
-- The rule_type enum in the application now supports: 'multiPurchase', 'psoFlag'

-- ============================================================================
-- Audit logging for CS calls
-- ============================================================================

CREATE TABLE IF NOT EXISTS cs_call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES product_orders(id),
  subscriber_id text NOT NULL,
  call_type text NOT NULL CHECK (call_type IN ('GAD', 'GBAD', 'SCAPv2_DEBIT', 'SCAPv2_ATTACH', 'SCAPv2_REMOVE', 'CREDIT_BACK')),
  request_payload jsonb NOT NULL,
  response_payload jsonb NOT NULL,
  response_code text,
  latency_ms integer,
  success boolean NOT NULL,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cs_call_logs_order_id ON cs_call_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_cs_call_logs_subscriber_id ON cs_call_logs(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_cs_call_logs_created_at ON cs_call_logs(created_at);

-- ============================================================================
-- Update existing Channel table structure if needed
-- ============================================================================

-- Ensure channels have the proper structure for Sprint 4
-- (channel_id as short identifier, api_key_hash for API key auth)

COMMENT ON COLUMN channels.channel_id IS 'Short identifier used in JWT tokens and cart/order channelId (e.g., USSD, SMS, CRM)';
COMMENT ON COLUMN channels.api_key_hash IS 'SHA-256 hash of the API key for API key authentication';
COMMENT ON COLUMN channels.allowed_offering_ids IS 'If set, restricts this channel to only these product offerings';
COMMENT ON COLUMN channels.auth_method IS 'Authentication method: none, apiKey, or jwt';

COMMENT ON TABLE subscriber_accounts IS 'TMF666 SubscriberAccount - CS attribute cache per order (immutable snapshot)';
COMMENT ON TABLE channel_auth_tokens IS 'Registry of issued JWT tokens for audit and revocation';
COMMENT ON TABLE cs_call_logs IS 'Audit log for all Charging System API calls';