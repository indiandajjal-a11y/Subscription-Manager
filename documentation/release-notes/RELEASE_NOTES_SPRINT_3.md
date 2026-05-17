# Release Notes: Sprint 3

## Release Summary

Sprint 3 adds the first fulfillment-adjacent capabilities around ProductOrder compensation, product inventory, and channel integration basics.

Included:

- ProductOrder compensation for failed orders
- ProductOrder fulfillment retry
- ProductInventory creation when orders complete
- ProductInventory query APIs
- Configurable channel registry
- Unified channel subscription request capture
- USSD pull and push entry points
- SMS message entry point
- CRM subscription entry point
- Channel interaction audit records

## Functional Scope

Order:

- Failed ProductOrders can be compensated with a credit-back style action
- Failed ProductOrders can be reset to `inProgress` for retry
- Completed ProductOrders create active inventory records

Inventory:

- Active subscription inventory is created from completed order items
- Inventory can be queried by subscriber, status, and product offering

Channels:

- Add and manage channels
- Support channel types: `USSD`, `SMS`, `WEB`, `CRM`, `MOBILE_APP`, `THIRD_PARTY`, `SELF_CARE`
- Capture channel-originated subscription requests
- Convert valid channel requests into carts and ProductOrders
- Record channel interactions for audit and traceability

## New API Endpoints

Order:

- `POST /api/v1/product-order/:orderId/compensate`
- `POST /api/v1/product-order/:orderId/retry`

Inventory:

- `GET /api/v1/inventory`
- `GET /api/v1/inventory/:inventoryId`

Channels:

- `POST /api/v1/channels`
- `GET /api/v1/channels`
- `GET /api/v1/channels/:channelId`
- `PATCH /api/v1/channels/:channelId`
- `POST /api/v1/channels/:channelId/subscription-requests`
- `POST /api/v1/channels/:channelId/ussd/pull`
- `POST /api/v1/channels/:channelId/ussd/push`
- `POST /api/v1/channels/:channelId/sms/messages`
- `POST /api/v1/channels/:channelId/crm/subscription-requests`
- `GET /api/v1/channel-interactions`

## Database

New migration:

- `database/003_sprint3_inventory_channels_compensation.sql`

This migration adds ProductInventory, channels, channel interactions, and ProductOrder compensation storage.

## Verification

Passing tests at Sprint 3 completion: 46

## Deferred

Still deferred:

- Real charging system integration
- Real network provisioning / NEA integration
- Product inventory suspension and termination flows
- Channel authentication and authorization
- SMS/USSD notification delivery
