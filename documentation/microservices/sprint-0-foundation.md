# Sprint 0 Foundation

This branch is the safe Java microservices base for the migration. It is intentionally additive: the existing Node.js implementation remains untouched while the Java platform surface is introduced beside it.

## Goals

- Establish a Java 21 multi-module Maven workspace.
- Keep shared DTOs, exceptions, and event contracts in `common-lib`.
- Create service module boundaries before Sprint 1 implementation begins.
- Provide local infrastructure for PostgreSQL, Kafka, Redis, Zipkin, and Kafka UI.
- Keep `main` isolated until the microservices milestone is verified.

## Branching

- `main`: stable source of truth.
- `microservices-base`: integration branch for Java migration foundation and shared contracts.
- `microservices/sprint-N-*`: sprint implementation branches from `microservices-base`.
- `oda-analysis`: parallel analysis branch; merge decisions into `microservices-base` before locking service contracts.

## Current Module Skeleton

| Module | Purpose |
| --- | --- |
| `common-lib` | Shared API envelope, exceptions, and event base contracts |
| `catalog-service` | TMF620 catalog |
| `cart-service` | TMF663 cart |
| `order-service` | TMF622 order lifecycle |
| `inventory-service` | TMF637 inventory/subscriptions |
| `channel-service` | Channel registry and auth |
| `customer-service` | Segments, renewals, relationships |
| `notification-service` | Templates and dispatch |
| `charging-service` | CS abstraction and charging records |

## Sprint 0 Exit Criteria

- Maven reactor compiles.
- Existing Node.js tests are not disrupted.
- Local infrastructure can be started independently with `docker compose -f docker-compose.microservices.yml up -d`.
- ODA analysis can still adjust service contracts before Sprint 1 domain implementation.
