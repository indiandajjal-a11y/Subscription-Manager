# Release Notes: Sprint 1

## Release Summary

Sprint 1 delivers the TMF-aligned foundation for the ISP Subscription Manager.

Included:

- TMF620 Product Catalog foundation
- TMF663 Shopping Cart foundation
- TMF622 ProductOrder checkout stub
- Multi-currency pricing support
- Product offering lifecycle and sunset handling
- Cart validation, pricing, checkout, abandonment, and expiry handling
- PostgreSQL-ready persistence adapter
- Automated domain and HTTP integration tests

## Functional Scope

Product Catalog:

- Create, list, retrieve, update, activate, and retire `ProductSpecification`
- Create, list, retrieve, update, activate, and retire `ProductOffering`
- Manage `ProductOfferingPrice` records
- Manage `EligibilityRule` records

Shopping Cart:

- Create a cart by channel, subscriber, and currency
- Add and remove cart items
- Validate eligibility and price cart items
- Checkout into an acknowledged `ProductOrder`
- Abandon carts
- Enforce cart TTL and closed-cart rules

## Technical Scope

- Node.js REST API with no frontend
- In-memory storage for local development and test speed
- PostgreSQL persistence mode through `DATABASE_URL`
- PostgreSQL migration in `database/001_sprint1_tmf_foundation.sql`
- Consistent validation error envelope

## Verification

Current automated suite:

- Domain and business-rule tests
- HTTP integration tests against the real router
- Total passing tests at release preparation: 30

## Deferred

Deferred to later sprints:

- Full ProductOrder state machine
- Charging integration
- Product inventory
- Channel authentication
- Notification sending
- Renewal scheduling
- Network activation
