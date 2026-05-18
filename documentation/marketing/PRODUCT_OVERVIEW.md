# Product Overview

## ISP Subscription Manager

The Subscription Manager enables an ISP or mobile operator to sell data bundles consistently across digital and assisted channels.

Sprint 1 establishes the foundation for:

- A centralized sellable product catalog
- Channel-aware product availability
- Multi-currency product pricing
- Subscriber cart creation and checkout
- Future order fulfillment, inventory, charging, and network activation

## Business Value

- Faster bundle launch through structured catalog management
- Consistent product visibility across USSD, SMS, CRM, mobile app, and web channels
- Reduced integration rework through TMF-aligned entities and API vocabulary
- Clear separation between shopping intent, ordering, fulfillment, charging, and provisioning

## Sprint 1 Capabilities

- Define data bundle specifications
- Create sellable product offerings
- Configure prices and discounts by currency
- Restrict offers by channel
- Create subscriber shopping carts
- Validate eligibility and price carts
- Checkout into an acknowledged order stub

## Future Expansion

Current stable capabilities now include:

- Full ProductOrder validation and fulfillment lifecycle
- Product inventory with activation, renewal, cancellation, and termination fields
- Charging system integration boundaries for account fetch, debit, attach, remove, credit-back, and attribute updates
- Channel authentication with JWT/API-key enforcement
- Cancellation, advanced charging fallback, partial charging, default charging source, and CS-attribute discounts
- Customer segment resolution
- Renewal scheduling helpers
- Gift subscription validation and sponsor/beneficiary relationship records
- Notification event records with recipient context
- Template-driven SMS and USSD notification dispatch
- Operator-configurable currency symbols, minor units, and expiry date presentation
- Reduced-step USSD/SMS purchase flow
- Staff secondary-number linking for discounted staff plans
- Dormant subscriber cleanup for safe identifier reallocation
- Consolidated USSD-ready bundle balance check
- Bonus follow-up notification when a configured data bonus is detected
- Tariff migration with configurable TICK provisioning or deprovisioning
