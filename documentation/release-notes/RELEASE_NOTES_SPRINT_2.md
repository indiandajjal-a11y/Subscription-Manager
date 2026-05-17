# Release Notes: Sprint 2

## Release Summary

Sprint 2 extends the Sprint 1 checkout stub into a TMF622-style ProductOrder lifecycle foundation.

Included:

- ProductOrder item snapshots from checked-out carts
- ProductOrder total amount and currency
- ProductOrder validation before fulfillment
- ProductOrder state transitions
- Fulfillment execution stub for `debit`, `attachOffer`, and `neaActivation` outcomes
- ProductOrder cancellation before terminal states
- Official `OrderValidationResult` storage
- Official `FulfillmentStepRecord` audit storage
- `/api/v1/orders` aliases for TMF622-style ProductOrder operations
- HTTP APIs for listing, retrieving, validating, fulfilling, cancelling, and transitioning orders
- PostgreSQL schema updates for ProductOrder state and order items

## Functional Scope

Cart finalize:

- Validated carts can be checked out into richer ProductOrders
- Cart items are copied into ProductOrder item snapshots
- Checked-out carts remain closed to further modification

ProductOrder lifecycle:

- `acknowledged`
- `inProgress`
- `completed`
- `failed`
- `cancelled`

Fulfillment:

- Starts from `acknowledged` or `inProgress`
- Validates the order before execution
- Marks charging and provisioning as completed on success
- Marks order as failed on charging or provisioning failure

Cancellation:

- Allowed from `acknowledged` and `inProgress`
- Blocked from `completed`, `failed`, and `cancelled`

## New API Endpoints

- `GET /api/v1/product-order`
- `POST /api/v1/product-order`
- `GET /api/v1/product-order/:orderId`
- `POST /api/v1/product-order/:orderId/state`
- `POST /api/v1/product-order/:orderId/validate`
- `POST /api/v1/product-order/:orderId/fulfill`
- `POST /api/v1/product-order/:orderId/cancel`

Aliases:

- `GET /api/v1/orders`
- `POST /api/v1/orders`
- `GET /api/v1/orders/:orderId`
- `POST /api/v1/orders/:orderId/validate`
- `POST /api/v1/orders/:orderId/fulfill`
- `POST /api/v1/orders/:orderId/cancel`

## Database

New migration:

- `database/002_sprint2_product_order_state_machine.sql`
- `database/004_sprint2_official_prompt_gap_closure.sql`

These migrations expand `product_orders`, add `product_order_items`, add official validation and fulfillment step records, and align field names with the official Sprint 2 prompt.

## Verification

Current automated suite:

- Sprint 1 acceptance tests
- Sprint 2 domain tests
- HTTP integration tests

Passing tests after official Sprint 2 gap closure: 48

## Deferred

Still deferred:

- Real charging system debit
- Real provisioning or NEA activation
- Product inventory creation
- Compensation and rollback
- Channel authentication
