# Phase 3: Real Charging and Auth

Phase 3 implements the Sprint 4 capability set after the core commerce and subscription/channel baselines are stable.

## Scope

- `charging-service`
- CS mock/real client abstraction
- Channel API-key to JWT token issuance
- Redis-backed token revocation
- Optional auth enforcement in cart/order routes
- Order validation using `SubscriberAccount` snapshots
- Real debit and attach stubs through charging gRPC

## Dependency Gate

Phase 3 implementation must wait until:

- Phase 1 catalog/cart/order services are implemented and tested.
- Phase 2 inventory/channel baseline is implemented and tested.
- `order-service`, `channel-service`, and `catalog-service` contracts are stable.

## Risk Profile

This is the highest-risk integration phase because it introduces the Charging System boundary. The default mode must remain mock CS, with real CS enabled only by configuration.

## Service Responsibilities

| Service | Responsibility |
| --- | --- |
| `charging-service` | Own CS client abstraction, subscriber snapshots, debit/attach/remove/credit-back gRPC APIs |
| `channel-service` | Issue JWTs from API keys, validate tokens, revoke tokens using Redis |
| `order-service` | Fetch subscriber snapshot during validation, call charging gRPC during fulfillment |
| `inventory-service` | Store Sprint 4 activation attachment metadata after fulfillment |

## Configuration Defaults

```yaml
charging:
  cs-endpoint-url: ${CS_ENDPOINT_URL:}
  transient-error-codes: ${CS_TRANSIENT_ERROR_CODES:TIMEOUT,SERVICE_UNAVAILABLE}
  retry-count: ${CS_CLIENT_RETRY_COUNT:2}
  retry-delay-ms: ${CS_RETRY_DELAY_MS:500}

auth:
  enforcement-enabled: ${AUTH_ENFORCEMENT_ENABLED:false}
```

## gRPC Surface

`charging-service` exposes:

- `FetchSubscriberAccount`
- `Debit`
- `AttachOffer`
- `RemoveOffer`
- `CreditBack`

`channel-service` exposes:

- `ValidateToken`

## Acceptance Tests

Phase 3 should include the Sprint 4 acceptance suite:

- Valid API key returns a bearer JWT and stores `ChannelAuthToken`.
- Protected route with missing token returns `MISSING_TOKEN` when enforcement is enabled.
- Order validation fetches and stores a `SubscriberAccount` snapshot.
- Order validation performs balance pre-checks.
- Fulfillment calls charging gRPC `Debit`.
- Fulfillment records Charging System outcomes in `FulfillmentStepRecord`.
- DA balances from the account snapshot are summed correctly.
- Validation failure is terminal.
- Fulfillment failure short-circuits subsequent steps.

## Release Rule

Do not tag a Sprint 4 implementation release until Phase 1, Phase 2, and Phase 3 Java tests pass. Planning checkpoints may be tagged separately with a `-plan` suffix.
