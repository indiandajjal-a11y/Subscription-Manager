# Phase 4: Cancellation and Advanced Charging

Phase 4 implements the Sprint 5 capability set after charging/auth is stable.

## Scope

- Full terminate order lifecycle
- Cancellation eligibility snapshots
- DA priority fallback
- Partial charging across MA and DA
- Default charging source resolution
- Price alterations based on Charging System attributes
- Charging resolution audit records

## Dependency Gate

Phase 4 implementation must wait until:

- Phase 1 catalog/cart/order services are complete.
- Phase 2 inventory/channel baseline is complete.
- Phase 3 charging/auth integration is complete.
- Charging-service owns Charging System calls and order-service delegates charging resolution.

## Risk Profile

This phase combines catalog pricing, Charging System snapshots, order fulfillment, cancellation rules, inventory updates, and compensation behavior. It needs additional tests beyond the sprint prompt, especially for partial failure and idempotency.

## Service Responsibilities

| Service | Responsibility |
| --- | --- |
| `order-service` | Full terminate order lifecycle, cancellation eligibility, terminate fulfillment orchestration |
| `catalog-service` | Price extensions, price alterations, charging defaults |
| `charging-service` | DA fallback, partial charging, discount resolution, charging audit |
| `inventory-service` | Termination fields and subscription status updates |

## Charging Resolution Rules

- DA fallback tries configured DA sources in ascending priority.
- Partial charging can split amount across MA and DA when enabled.
- Missing charging source uses `defaultChargingSource` when configured.
- Price alterations are evaluated against subscriber account attributes.
- When multiple alterations match, apply the highest discount; use priority as a tie-breaker.

## Terminate Order Flow

1. Create TERMINATE order from active subscription.
2. Store `CancellationEligibilitySnapshot`.
3. Validate terminate order.
4. Fulfill `REMOVE_OFFER`.
5. Run `NEA_DEPROVISIONING` as best effort.
6. Mark inventory `TERMINATED`.
7. Publish inventory termination event.

## Extra Tests

Add tests beyond the sprint prompt for:

- Duplicate terminate request idempotency.
- Duplicate inventory termination event handling.
- Partial charging where combined MA + DA balance is insufficient.
- DA fallback ordering and failure reporting.
- Discount tie-breaking when multiple price alterations match.
- Non-blocking NEA deprovisioning failure reconciliation.
- Charging resolution lookup before any charge exists.
- Retry behavior after transient Charging System errors.

## Acceptance Tests

Phase 4 should include the Sprint 5 acceptance suite:

- Valid subscription creates a terminate order and stores eligibility snapshot.
- Non-owned subscription cancellation returns `SUBSCRIPTION_NOT_OWNED`.
- Inactive subscription cancellation returns `SUBSCRIPTION_NOT_ACTIVE`.
- Terminate fulfillment removes offer and terminates inventory.
- DA fallback records `usedFallback=true`.
- Partial charging records `isPartialCharge=true`.
- CS-attribute discount records `discountApplied=true`.
- NEA deprovisioning failure records inventory flag while order still completes.

## Release Rule

Do not tag a Sprint 5 implementation release until Phase 1 through Phase 4 Java tests pass. Planning checkpoints may be tagged separately with a `-plan` suffix.
