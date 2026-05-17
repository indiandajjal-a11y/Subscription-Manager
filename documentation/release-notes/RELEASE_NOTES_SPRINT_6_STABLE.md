# Release Notes: Sprint 6 Stable

## Release Summary

Sprint 6 stable release compares the Sprint 10 prompt against the implemented Subscription Manager and closes the lifecycle, renewal, gifting, segmentation, CS attribute update, and compensation-policy gaps that were still open.

Included:

- Sprint 5 cancellation and advanced charging were re-verified.
- `CustomerSegment` model helpers and REST routes were added.
- Subscriber account validation now resolves `resolvedSegmentId` and supports `customerSegment` eligibility and discount rules.
- `ProductSpecification` and `ProductOffering` persist Sprint 6 fields: `csAttributeUpdates`, `bundleCategory`, `giftingEnabled`, `maxGiftBeneficiaries`, and `compensationPolicy`.
- Renewal schedule helpers use Sprint 6 lifecycle states: `pending`, `inProgress`, `completed`, `failed`, `cancelled`.
- Gift orders use Sprint 6 reason codes: `GIFTING_NOT_ALLOWED_FOR_OFFERING`, `SELF_GIFT_NOT_ALLOWED`, `MAX_GIFT_BENEFICIARIES_EXCEEDED`, and `GIFT_ALREADY_ACTIVE`.
- `RealChargingSystemClient.updateSubscriberAttributes` is available for mock and real CS adapters.
- PartyRelationship and recipient-aware notification helpers support sponsor/beneficiary flows.
- Documentation and automated tests were updated for the stable contract.

## Verification

Full test suite:

- `98` tests passing
- `0` failures

Key test coverage:

- Sprint 5 cancellation and charging resolution
- Sprint 6 segment resolution and customer-segment pricing
- Sprint 6 CS attribute update computation
- Sprint 6 renewal scheduling
- Sprint 6 gifting, PartyRelationship, and recipient-aware notifications
- Sprint 6 compensation policy and retry tracking

## Release Tag

Planned tag:

- `v4.0`

Tag message:

- `Sprint 10 - stable release`
