# Technical Architecture

## Purpose

Sprint 1 establishes the TMF-aligned foundation for future subscription ordering, fulfillment, inventory, and channel integrations.

Sprint 2 extends the checkout stub into a ProductOrder lifecycle foundation with validation, state transitions, fulfillment stubs, and cancellation.

Sprint 3 adds ProductInventory creation, compensation/retry hooks, channel integration entry points, terminate-order cancellation, compensation configuration, and notification event placeholders.

Sprint 4 adds channel authentication endpoints, optional protected-route enforcement, SubscriberAccount snapshots for live CS validation, and CS-ready account/order validation contracts.

## Runtime Components

`code/server.js`

- Starts the HTTP server
- Selects persistence mode
- Loads PostgreSQL state when configured

`code/app.js`

- Defines the REST routing layer
- Parses JSON requests
- Applies consistent error envelopes
- Enforces Sprint 4 JWT/API-key authentication when `ENABLE_AUTH_ENFORCEMENT=true`
- Saves state after mutating operations when persistence is enabled

`code/domain.js`

- Contains Sprint 1 business rules
- Owns TMF entity lifecycle behavior
- Performs pricing, eligibility, cart expiry, checkout, and validation logic
- Owns Sprint 2 ProductOrder state transitions and fulfillment stub logic
- Owns Sprint 3 inventory creation, compensation config/records, retry, terminate orders, notification events, and channel capture logic
- Owns Sprint 4 auth token, API key, SubscriberAccount snapshot, and live-account order validation logic

`code/sprint4.js`

- Provides the Sprint 4 ChargingSystemClient abstraction
- Uses mock CS behavior when `CS_ENDPOINT_URL` is not configured
- Contains real-call hooks for GAD/GBAD account fetch and SCAPv2 debit/attach/remove/credit-back operations
- Retries configured transient CS responses before returning a failed client result

`code/postgresPersistence.js`

- Hydrates in-memory domain state from PostgreSQL
- Writes domain state back transactionally after mutations

`database/001_sprint1_tmf_foundation.sql`

- Creates Sprint 1 PostgreSQL schema

## Persistence Modes

In-memory mode:

- Default
- Useful for local development and automated tests
- Data is lost when the process exits

PostgreSQL mode:

- Enabled with `STORAGE_PROVIDER=postgres` or `DATABASE_URL`
- Loads all Sprint 1 tables on startup
- Saves state transactionally after mutating requests

## API Boundary

All APIs use the `/api/v1/` prefix. The implementation preserves TMF naming for:

- `ProductSpecification`
- `ProductOffering`
- `ProductOfferingPrice`
- `ShoppingCart`
- `CartItem`
- `ProductOrder`

Sprint 2 adds ProductOrder routes:

- `GET /api/v1/product-order`
- `POST /api/v1/product-order`
- `GET /api/v1/product-order/:orderId`
- `POST /api/v1/product-order/:orderId/state`
- `POST /api/v1/product-order/:orderId/validate`
- `POST /api/v1/product-order/:orderId/fulfill`
- `POST /api/v1/product-order/:orderId/cancel`
- `/api/v1/orders` aliases for official ProductOrder capture, validation, fulfillment, and cancellation

Sprint 3 adds:

- `POST /api/v1/product-order/:orderId/compensate`
- `POST /api/v1/product-order/:orderId/retry`
- `POST /api/v1/orders/:orderId/cancel-request`
- `POST /api/v1/catalog/offerings/:id/compensation-config`
- `GET /api/v1/catalog/offerings/:id/compensation-config`
- `GET /api/v1/inventory`
- `GET /api/v1/inventory/:inventoryId`
- `PATCH /api/v1/inventory/:inventoryId/status`
- `GET /api/v1/compensation-records`
- `GET /api/v1/notification-events`
- `POST /api/v1/channels`
- `GET /api/v1/channels`
- `PATCH /api/v1/channels/:channelId`
- `POST /api/v1/channels/:channelId/activate`
- `POST /api/v1/channels/:channelId/deactivate`
- `POST /api/v1/channels/:channelId/regenerate-key`
- channel-specific request capture routes for USSD, SMS, and CRM

Sprint 4 adds:

- `POST /api/v1/auth/token`
- `POST /api/v1/auth/revoke`
- `GET /api/v1/auth/tokens`
- `GET /api/v1/orders/:orderId/subscriber-account`
- Channel API-key creation through `createChannelWithApiKey`
- JWT issue, validation, revocation, and active-token listing helpers
- SubscriberAccount snapshots linked to ProductOrder
- ProductOrder validation using live SubscriberAccount data instead of request-body subscriber attributes
- `subscriptionId` on completed ProductOrder responses

## Testing Strategy

`testing/sprint1.test.js`

- Domain and acceptance tests for Sprint 1 stories

`testing/http-api.test.js`

- HTTP-level integration tests against the actual router
- Sprint 4 auth token endpoint and protected-route checks

`testing/sprint2.test.js`

- ProductOrder lifecycle, validation, fulfillment, and cancellation tests

`testing/sprint3.test.js`

- Inventory creation, compensation config/records, retry, terminate order, notification event, and channel request tests

`testing/sprint4.test.js`

- Channel auth token issue, validation, API key fallback, and revocation tests
- SubscriberAccount-backed ProductOrder validation tests
- Token rate limiting, Sprint 4 inventory fields, notification flags, and CS transient retry tests

Run all tests:

```powershell
npm.cmd test
```
