# Subscription Manager Release Notes

## v5.5 - Sprint 13 Stable Release

- Added event-driven 4G SIM upgrade automation with DND exclusion, rate limiting, SIM type checks, CS callback dispatch, and subscriber accept/decline handling.
- Added PIN-secured credit transfer with AES-256 encrypted PIN storage, PIN lockout, transfer limits, MA balance checks, CS debit/credit, reversal, and bilateral notifications.
- Added idempotency support, unified audit log, `/api/v1/health`, `/api/v1/ready`, and order `notificationDispatched` status.
- Added `psoFlagCharacteristicName` support on product offerings and documented remaining open gaps.
- Added Sprint 13 automated tests and Sonar quality rubric.

## V1 - Sprint 1

- Established TMF620 Product Catalog foundation.
- Added TMF663 ShoppingCart flow and ProductOrder checkout stub.

## V2 - Sprint 2

- Added ProductOrder validation, state transitions, fulfillment stubs, and cancellation handling.
- Added OrderValidationResult and fulfillment step coverage.

## V3 - Sprint 3

- Added ProductInventory, compensation/retry hooks, channel registry, terminate orders, and NotificationEvent records.

## V4 - Sprint 4

- Added JWT/API-key channel authentication, SubscriberAccount snapshots, and real CS client boundaries for GAD/GBAD and SCAPv2 operations.

## V5 - Sprint 5

- Added cancellation eligibility, CS offer removal, NEA deprovisioning, termination audit fields, and ORDER_CANCELLED notification records.
- Added advanced charging resolution with DA fallback, partial charging, default charging source resolution, and CS-attribute discounts.

## V6 - Sprint 6 Stable

- Added CustomerSegment helpers and catalog segment API routes.
- Added resolved customer segment support in SubscriberAccount validation, eligibility, and price alterations.
- Added CS attribute update configuration and `RealChargingSystemClient.updateSubscriberAttributes`.
- Added RenewalSchedule helpers and scheduler behavior using Sprint 6 lifecycle states.
- Added gift order validation, sponsor/beneficiary PartyRelationship records, and recipient-aware NotificationEvent helpers.
- Added per-offering compensation policy persistence and retry tracking.
- Verified full suite: 98 passing tests, 0 failures.

## V7 - Sprint 7 Stable

- Added CommunicationTemplate management, template selection, placeholder rendering, math expression handling, date formatting, and SMS truncation.
- Added NotificationDispatchRecord audit history and notification dispatch endpoint.
- Added CurrencyConfig management with default currency support and currency-aware price validation.
- Added combined `POST /api/v1/cart/:cartId/subscribe` channel flow.
- Added StaffNumberLink management and STAFF segment override for linked secondary numbers.
- Addressed Sonar major findings for inline route assignments, duplicate mock CS methods, non-Error throws, and nested ternaries.
- Verified full suite: 105 passing tests, 0 failures.

## V8 - Sprint 8 Stable

- Added Party lifecycle records and dormant cleanup orchestration for CRM-driven subscriber decommissioning.
- Added decommissioned-subscriber guard for new cart creation.
- Added consolidated balance check with active ProductInventory aggregation, live GBAD lookup, and BALANCE_CHECK template rendering.
- Added BonusDetectionConfig and BonusDetectionRecord with DATA_BONUS_AWARDED notification event support.
- Added tariff migration modify orders, TICKProvisioningRule CRUD, TICK add/remove fulfillment steps, and TARIFF_MIGRATION_COMPLETED events.
- Added Sprint 8 automated coverage and refreshed Sonar prevention rubric.
- Verified full suite: 110 passing tests, 0 failures.
