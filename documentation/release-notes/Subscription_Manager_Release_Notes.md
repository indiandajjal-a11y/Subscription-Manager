# Subscription Manager Release Notes

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
