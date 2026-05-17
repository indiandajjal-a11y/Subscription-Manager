# Release Notes: Sprint 3

## Release Summary

Sprint 3 adds the first fulfillment-adjacent capabilities around ProductOrder compensation, product inventory, and channel integration basics.

Included:

- ProductOrder compensation for failed orders
- ProductOrder terminate-order cancellation flow
- CompensationConfig and CompensationRecord support
- NotificationEvent placeholders for Sprint 7 dispatch
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
- Completed provision orders can spawn terminate orders through `POST /api/v1/orders/:orderId/cancel-request`
- Terminate orders complete by updating ProductInventory to `terminated`
- Compensation config is copied from ProductOffering to provision orders at checkout
- Completed ProductOrders create active inventory records

Inventory:

- Active subscription inventory is created from completed order items
- Inventory stores start/end dates, renewal flag, charge source, amount, currency, and termination timestamp
- Inventory can be queried by subscriber, status, product offering, and date range

Channels:

- Add and manage channels
- Support channel types: `USSD`, `SMS`, `WEB`, `CRM`, `MOBILE_APP`, `THIRD_PARTY`, `SELF_CARE`, `WEB_PORTAL`, `IVR`, `VOUCHER`, `API_PARTNER`
- Register channels with unique `channelId` and generated API key
- Validate cart `channelId` against the channel registry when channels are configured
- Capture channel-originated subscription requests
- Convert valid channel requests into carts and ProductOrders
- Record channel interactions for audit and traceability

## New API Endpoints

Order:

- `POST /api/v1/product-order/:orderId/compensate`
- `POST /api/v1/product-order/:orderId/retry`
- `POST /api/v1/orders/:orderId/cancel-request`
- `GET /api/v1/compensation-records`
- `GET /api/v1/notification-events`

Catalog:

- `POST /api/v1/catalog/offerings/:id/compensation-config`
- `GET /api/v1/catalog/offerings/:id/compensation-config`

Inventory:

- `GET /api/v1/inventory`
- `GET /api/v1/inventory/:inventoryId`
- `PATCH /api/v1/inventory/:inventoryId/status`

Channels:

- `POST /api/v1/channels`
- `GET /api/v1/channels`
- `GET /api/v1/channels/:channelId`
- `PATCH /api/v1/channels/:channelId`
- `POST /api/v1/channels/:channelId/activate`
- `POST /api/v1/channels/:channelId/deactivate`
- `POST /api/v1/channels/:channelId/regenerate-key`
- `POST /api/v1/channels/:channelId/subscription-requests`
- `POST /api/v1/channels/:channelId/ussd/pull`
- `POST /api/v1/channels/:channelId/ussd/push`
- `POST /api/v1/channels/:channelId/sms/messages`
- `POST /api/v1/channels/:channelId/crm/subscription-requests`
- `GET /api/v1/channel-interactions`

## Database

New migration:

- `database/003_sprint3_inventory_channels_compensation.sql`
- `database/006_sprint3_prompt_gap_closure.sql`

These migrations add ProductInventory, channels, channel interactions, ProductOrder compensation storage, terminate fields, compensation configuration/records, richer inventory fields, channel registry fields, and notification events.

## Verification

Passing tests after Sprint 3 prompt verification: 59

## Deferred

Still deferred:

- Real charging system integration
- Production NEA hardware integration
- Channel authentication and authorization
- SMS/USSD notification delivery
