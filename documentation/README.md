# Subscription Manager Documentation

This folder keeps non-code deliverables for the Subscription Manager project.

## Structure

- `release-notes/` - sprint and version release notes
- `installation/` - setup, configuration, and deployment guides
- `technical/` - architecture, API examples, data model, and engineering handoff notes
- `operations/` - runbooks and production support notes
- `marketing/` - product positioning, capability summaries, and stakeholder material

Sprint 1 focuses on the TMF foundation: Product Catalog, Shopping Cart, and a ProductOrder checkout stub.

Sprint 2 extends ProductOrder into validation, state transitions, fulfillment stubs, and cancellation.

Sprint 3 adds ProductInventory, compensation/retry hooks, and channel integration basics.

Sprint 4 adds channel authentication endpoints, optional protected-route enforcement, SubscriberAccount snapshots, and CS integration boundaries.

Sprint 5 adds subscription cancellation business rules, termination audit fields, and advanced charging resolution for fallback, partial charging, defaults, and CS-attribute discounts.

Sprint 6 stable verification now closes the lifecycle, renewal, gifting, segment, CS attribute update, and configurable compensation gaps from the Sprint 10 prompt.

Current stable scope:

- Sprint 5 cancellation and advanced charging are verified by the full test suite.
- Sprint 6 adds CustomerSegment resolution, `resolvedSegmentId` snapshots, customer-segment eligibility/discount support, CS attribute update configuration, renewal schedule helpers, gift order validation, PartyRelationship records, recipient-aware notifications, and per-offering compensation policy defaults.
- Sprint 6 API coverage includes CustomerSegment, RenewalSchedule, and PartyRelationship routes.
- Automated verification: `npm.cmd test` passes all 98 tests.
