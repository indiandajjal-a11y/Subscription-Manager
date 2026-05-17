# Release Notes: Sprint 4

## Release Summary

Sprint 4 adds the first real Charging System integration boundary and channel authentication support while preserving mock behavior for local development.

Included:

- Channel API key and JWT token helpers
- HTTP auth token endpoints and optional route-level auth enforcement
- Token revocation and active token listing
- Token endpoint rate limiting
- SubscriberAccount snapshots for CS-derived attributes
- ProductOrder validation using live SubscriberAccount data
- Sprint 4 ProductInventory extension fields
- CS client abstraction with mock fallback, transient retries, and real remove/credit-back mappings when an endpoint is configured

## Functional Scope

Authentication:

- Channels can be created with generated API keys
- Channels can exchange API keys for Bearer tokens
- Bearer tokens are signature-checked, expiry-checked, and revocation-checked
- API key fallback is limited by channel type
- Protected HTTP subscription routes can reject missing credentials with `MISSING_TOKEN`
- Authenticated cart/order requests enforce channel ownership with `CHANNEL_MISMATCH`
- Token issuance enforces `AUTH_TOKEN_RATE_LIMIT`

Charging System:

- SubscriberAccount snapshots store CS balance, DA balances, service class, segment, PSO flags, offer IDs, and raw CS response data
- ProductOrder validation can use SubscriberAccount data for eligibility and balance checks
- `code/sprint4.js` provides a CS client interface for account fetch, debit, attach, remove, and credit-back operations
- Transient CS failures retry according to `CS_TRANSIENT_ERROR_CODES` and `CS_CLIENT_RETRY_COUNT`
- Remove-offer and credit-back now call `/scapv2/remove` and `/scapv2/credit-back` when `CS_ENDPOINT_URL` is configured

Product Inventory:

- Completed orders expose `subscriptionId` from the linked `ProductInventory`
- Inventory records now include `renewalOfferId`, `refillId`, `notificationFlags`, and `csAttachmentId`
- `notificationFlags.onActivation = false` suppresses the activation notification placeholder

## Database

New migration:

- `database/005_sprint4_cs_integration_auth.sql`

This migration adds SubscriberAccount and ChannelAuthToken storage plus Sprint 4 inventory extension fields.

## Verification

Passing tests after Sprint 4 verification: 63

Added coverage:

- `testing/sprint4.test.js`
- HTTP auth endpoint and protected-route coverage in `testing/http-api.test.js`
- Sprint 2 prompt gap regressions in `testing/sprint2.test.js`
- Updated terminal-state transition expectation in `testing/sprint3.test.js`
- DA balance summing, all-validation-failure terminal behavior, NEA skip, and fulfillment failure short-circuit coverage

## Deferred

Still deferred:

- Full production CS protocol hardening
- Persistent token revocation cache across process restarts
