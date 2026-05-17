# Release Notes: Sprint 5

## Release Summary

Sprint 5 adds cancellation business rules and advanced charging resolution on top of the Sprint 4 authenticated subscription flow.

Included:

- Terminate orders created directly from `subscriptionId`
- Cancellation eligibility snapshots
- Cancellation window, ownership, and inactive-subscription checks
- Inventory termination details: `terminationReason` and `neaDeprovisioningFailed`
- `ChargingResolutionRecord` audit trail
- DA priority fallback, partial charging, default charging source resolution, and CS-attribute discount evaluation
- Catalog price extensions for `chargingPriority`, `allowPartialCharge`, `defaultChargingSource`, and `priceAlteration`

## API

Added or extended:

- `POST /api/v1/orders` with `orderType: "terminate"` and `subscriptionId`
- `GET /api/v1/subscriptions/:subscriptionId`
- `GET /api/v1/orders/:orderId/charging-resolution`
- `GET /api/v1/catalog/offerings/:id/prices/:priceId`
- `PATCH /api/v1/catalog/offerings/:id/prices/:priceId`

## Verification

Passing tests after Sprint 5 verification: 70

Added coverage:

- `testing/sprint5.test.js`
- SubscriptionId cancellation flow, ownership checks, cancellation windows, NEA failure reconciliation, and notification suppression
- DA fallback, partial charging, default source resolution, and highest-value CS-attribute discount selection

## Deferred

Still deferred:

- CS attribute updates after provisioning
- Named CustomerSegment entities
- Renewal scheduling and execution
- Notification template dispatch
