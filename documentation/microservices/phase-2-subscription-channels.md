# Phase 2: Subscription Creation and Channels

Phase 2 implements the Sprint 3 capability set after the Phase 1 core commerce backbone is stable.

## Scope

- `inventory-service`
- `channel-service`
- Order compensation/retry skeleton
- Compensation config in `catalog-service`
- Channel subscription request flow

## Dependency Gate

Phase 2 implementation must wait until Phase 1 is complete:

- `catalog-service`, `cart-service`, and `order-service` are implemented in Java.
- `cart.checked-out`, `order.state-changed`, `order.completed`, and `order.failed` are available.
- gRPC cart/order to catalog is available.
- All 48 cumulative Sprint 1 and Sprint 2 acceptance tests pass.

## Business Outcome

Phase 2 turns completed product orders into active subscription inventory and lets registered channels submit subscription requests through the cart/order path.

## Service Responsibilities

| Service | Responsibility |
| --- | --- |
| `inventory-service` | Consume `order.completed`, create/query `ProductInventory`, publish `inventory.created` |
| `channel-service` | Register channels, track interactions, capture channel subscription requests |
| `catalog-service` | Store per-offering `CompensationConfig` and expose gRPC config lookup |
| `order-service` | Add compensation/retry skeleton and terminate-order scaffold |

## Events

| Topic | Producer | Consumer |
| --- | --- | --- |
| `order.completed` | `order-service` | `inventory-service` |
| `order.compensated` | `order-service` | Future services |
| `inventory.created` | `inventory-service` | Future customer/notification services |
| `channel.subscription-request` | `channel-service` | Audit/analytics consumers |

## Acceptance Tests

Phase 2 should include the Sprint 3 acceptance suite:

- `order.completed` event creates `ProductInventory`.
- Duplicate `order.completed` event is idempotent.
- Inventory can be queried by subscriber.
- Failed order compensation creates a `CompensationRecord`.
- Retry within configured limit resets order to `IN_PROGRESS`.
- Channel registration generates an API key and starts inactive.
- Active channel subscription request creates cart/order and records interaction.
- Inactive channel subscription request returns `CHANNEL_INACTIVE`.
- Terminate scaffold creates a `TERMINATE` order for a completed provision order.

## Release Rule

Do not tag a Sprint 3 implementation release until Phase 1 and Phase 2 Java tests pass. Planning checkpoints may be tagged separately with a `-plan` suffix.
