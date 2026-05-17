# Technical Architecture

## Purpose

Sprint 1 establishes the TMF-aligned foundation for future subscription ordering, fulfillment, inventory, and channel integrations.

Sprint 2 extends the checkout stub into a ProductOrder lifecycle foundation with validation, state transitions, fulfillment stubs, and cancellation.

Sprint 3 adds ProductInventory creation, compensation/retry hooks, and channel integration entry points.

## Runtime Components

`code/server.js`

- Starts the HTTP server
- Selects persistence mode
- Loads PostgreSQL state when configured

`code/app.js`

- Defines the REST routing layer
- Parses JSON requests
- Applies consistent error envelopes
- Saves state after mutating operations when persistence is enabled

`code/domain.js`

- Contains Sprint 1 business rules
- Owns TMF entity lifecycle behavior
- Performs pricing, eligibility, cart expiry, checkout, and validation logic
- Owns Sprint 2 ProductOrder state transitions and fulfillment stub logic
- Owns Sprint 3 inventory creation, compensation, retry, and channel capture logic

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
- `GET /api/v1/inventory`
- `GET /api/v1/inventory/:inventoryId`
- `POST /api/v1/channels`
- `GET /api/v1/channels`
- `PATCH /api/v1/channels/:channelId`
- channel-specific request capture routes for USSD, SMS, and CRM

## Testing Strategy

`testing/sprint1.test.js`

- Domain and acceptance tests for Sprint 1 stories

`testing/http-api.test.js`

- HTTP-level integration tests against the actual router

`testing/sprint2.test.js`

- ProductOrder lifecycle, validation, fulfillment, and cancellation tests

`testing/sprint3.test.js`

- Inventory creation, compensation, retry, and channel request tests

Run all tests:

```powershell
npm.cmd test
```
