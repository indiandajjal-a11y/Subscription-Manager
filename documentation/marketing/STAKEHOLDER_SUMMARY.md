# Stakeholder Summary

## What Was Delivered

Sprint 1 delivered the foundational Subscription Manager services needed before order fulfillment and network activation can be built.

The system can now:

- Register data bundle specifications
- Publish product offerings
- Manage multi-currency pricing
- Validate subscriber purchase intent
- Convert a validated cart into an acknowledged product order stub

## Why It Matters

The Sprint 1 foundation keeps product catalog, shopping cart, and future order fulfillment concerns separated. This lowers integration risk for later sprints and keeps the implementation aligned with TM Forum Open API vocabulary.

## Current Readiness

The service includes:

- Working API implementation
- PostgreSQL-ready persistence
- Automated test coverage
- API examples
- Installation and operations notes

## Sprint 6 Stable Additions

The platform now includes:

- Customer charging resolution with DA fallback, partial charging, and discounts
- Product inventory with cancellation and renewal fields
- ProductOrder workflow for provision, terminate, renew helper flows, and gift orders
- Channel authentication
- Notification event records for self, sponsor, and beneficiary recipients
- Network activation/deactivation hooks
- Customer segment resolution and configurable compensation policy support

## Sprint 7 Stable Additions

The platform now also includes:

- Notification template management for SMS and USSD
- Template rendering with placeholders, basic math expressions, date formatting, amount formatting, and live balance lookup
- Dispatch audit records for every notification attempt
- Currency configuration for subscriber-facing amount display
- Reduced-step cart subscription for channel flows
- Staff secondary-number linking and STAFF segment override support
