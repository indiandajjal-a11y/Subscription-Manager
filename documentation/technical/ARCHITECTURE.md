# Technical Architecture

## Purpose

Sprint 1 establishes the TMF-aligned foundation for future subscription ordering, fulfillment, inventory, and channel integrations.

Sprint 2 extends the checkout stub into a ProductOrder lifecycle foundation with validation, state transitions, fulfillment stubs, and cancellation.

Sprint 3 adds ProductInventory creation, compensation/retry hooks, channel integration entry points, terminate-order cancellation, compensation configuration, and notification event placeholders.

Sprint 4 adds channel authentication endpoints, optional protected-route enforcement, SubscriberAccount snapshots for live CS validation, and CS-ready account/order validation contracts.

Sprint 5 adds subscription cancellation eligibility/fulfillment rules and an advanced charging resolution layer for source fallback, partial charging, default source resolution, and CS-attribute discounts.

Sprint 6 adds subscriber lifecycle automation: CS attribute update configuration, named CustomerSegment resolution, renewal scheduling helpers, gift order support, PartyRelationship records, recipient-aware notifications, and per-offering compensation policies.

Sprint 7 adds the notification presentation layer: TMF681-style templates, placeholder/math rendering, live GBAD balance lookup at dispatch time, USSD/SMS dispatch records, currency configuration, combined channel subscribe flow, and staff secondary-number links.

Sprint 8 adds operational orchestration for dormant subscriber cleanup, consolidated balance checks, bonus follow-up notifications, and tariff migration-driven TICK provisioning.

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
- Owns Sprint 5 cancellation eligibility, termination audit fields, charging resolution records, fallback/partial allocation, and price alteration evaluation
- Owns Sprint 6 persisted catalog fields for CS attribute updates, bundle categories, gifting, compensation policies, gift order typing, and customer-segment-aware eligibility/discount validation

`code/sprint6.js`

- Provides Sprint 6 helper modules for CustomerSegment, RenewalSchedule, RenewalScheduler, PartyRelationship, gift validation, CS attribute update computation, compensation policy access, renewal order creation, retry tracking, and recipient-aware notifications

`code/sprint7.js`

- Provides Sprint 7 helper modules for CommunicationTemplate, NotificationDispatchRecord, CurrencyConfig, template rendering, notification dispatch, StaffNumberLink, staff segment override helpers, and the combined `subscribeCart` flow

`code/sprint8.js`

- Provides Sprint 8 helper modules for Party lifecycle, DormantCleanupRequest orchestration, consolidated balance checks, BonusDetectionConfig/Record, TICKProvisioningRule, TariffMigrationRequest, mock offline cleanup, and mock TICK provisioning

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

Sprint 5 adds:

- `POST /api/v1/orders` with `orderType: "terminate"` and `subscriptionId`
- `GET /api/v1/subscriptions/:subscriptionId`
- `GET /api/v1/orders/:orderId/charging-resolution`
- `GET /api/v1/catalog/offerings/:id/prices/:priceId`
- `PATCH /api/v1/catalog/offerings/:id/prices/:priceId`
- `CancellationEligibilityResult` for terminate-order validation
- `ChargingResolutionRecord` for debit allocation audit

Sprint 6 adds:

- `POST /api/v1/catalog/segments`
- `GET /api/v1/catalog/segments`
- `GET /api/v1/catalog/segments/:segmentId`
- `PATCH /api/v1/catalog/segments/:segmentId`
- `DELETE /api/v1/catalog/segments/:segmentId`
- `GET /api/v1/renewal-schedules`
- `POST /api/v1/renewal-schedules`
- `GET /api/v1/renewal-schedules/:scheduleId`
- `DELETE /api/v1/renewal-schedules/:scheduleId`
- `GET /api/v1/party-relationships`
- `POST /api/v1/party-relationships`
- `GET /api/v1/party-relationships/:relationshipId`
- Gift checkout uses `orderType: "gift"` when a cart item has `purchasePolicy: "gift"` or `beneficiaryId`
- ProductOrder validation resolves `SubscriberAccount.resolvedSegmentId` before eligibility and discount checks

Sprint 7 adds:

- `POST /api/v1/admin/templates`
- `GET /api/v1/admin/templates`
- `GET /api/v1/admin/templates/:templateId`
- `PATCH /api/v1/admin/templates/:templateId`
- `DELETE /api/v1/admin/templates/:templateId`
- `POST /api/v1/notification-events/:eventId/dispatch`
- `GET /api/v1/admin/dispatch-records`
- `GET /api/v1/admin/dispatch-records/:dispatchId`
- `GET /api/v1/orders/:orderId/notification-events`
- `POST /api/v1/admin/currencies`
- `GET /api/v1/admin/currencies`
- `GET /api/v1/admin/currencies/:code`
- `PATCH /api/v1/admin/currencies/:code`
- `DELETE /api/v1/admin/currencies/:code`
- `POST /api/v1/staff/link`
- `GET /api/v1/staff/links`
- `DELETE /api/v1/staff/links/:linkId`
- `POST /api/v1/cart/:cartId/subscribe`

Sprint 8 adds:

- `POST /api/v1/admin/parties`
- `GET /api/v1/admin/parties`
- `POST /api/v1/admin/dormant-cleanup`
- `GET /api/v1/admin/dormant-cleanup`
- `GET /api/v1/admin/dormant-cleanup/:requestId`
- `GET /api/v1/subscribers/:subscriberId/balance-check`
- `POST /api/v1/catalog/offerings/:id/bonus-detection`
- `GET /api/v1/catalog/offerings/:id/bonus-detection`
- `PATCH /api/v1/catalog/offerings/:id/bonus-detection`
- `GET /api/v1/admin/bonus-detection`
- `GET /api/v1/admin/bonus-detection-records`
- `POST /api/v1/admin/tick-rules`
- `GET /api/v1/admin/tick-rules`
- `GET /api/v1/admin/tick-rules/:ruleId`
- `PATCH /api/v1/admin/tick-rules/:ruleId`
- `DELETE /api/v1/admin/tick-rules/:ruleId`
- `POST /api/v1/orders` with `orderType: "modify"` and `modifyType: "TARIFF_MIGRATION"`
- `GET /api/v1/orders/:orderId/tariff-migration`

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

`testing/sprint5.test.js`

- SubscriptionId-driven cancellation, cancellation windows, ownership checks, termination fields, and notification suppression
- DA priority fallback, partial charging, default charging source, and CS-attribute discount tests

`testing/sprint6.test.js`

- CustomerSegment resolution tests
- CS attribute update computation tests
- RenewalSchedule and RenewalScheduler tests
- Gift validation and PartyRelationship tests
- Compensation policy, retry tracking, and recipient notification tests

`testing/sprint7.test.js`

- CurrencyConfig defaults and retirement guard
- CommunicationTemplate selection, rendering, and dispatch records
- Live balance placeholder behavior
- Staff secondary-number segment override
- Combined USSD/SMS subscribe flow

`testing/sprint8.test.js`

- Dormant cleanup and decommissioned-subscriber guard
- Consolidated balance check rendering and live GBAD call behavior
- Bonus detection records and dispatchable notification events
- TICK rule matching and tariff migration fulfillment

Current full-suite result:

- `110` tests passing
- `0` failures

Run all tests:

```powershell
npm.cmd test
```
# Sprint 13 Architecture Addendum

Sprint 13 adds `code/sprint9.js` as a standalone module for event-driven SIM upgrade and custom credit transfer. SIM upgrade reuses Product Catalog, cart subscription, TMF681 dispatch, and CS attribute update boundaries. Credit transfer remains outside TMF ProductOrder/ProductInventory and uses its own lifecycle with CS debit/credit integration.
