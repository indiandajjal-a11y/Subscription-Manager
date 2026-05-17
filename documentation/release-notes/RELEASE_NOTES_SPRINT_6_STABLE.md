# Release Notes: Sprint 6 Stable

## Release Summary

Sprint 6 stable verification compares the combined prompt file against the implemented Subscription Manager and closes the remaining ProductOrder lifecycle gaps precisely.

Included:

- ProductOrder validation now fails terminally for any validation failure
- Validation records unique failure reason codes on `OrderValidationResult`
- DA balance pre-checks sum request-body DA balances
- Fulfillment failure stops subsequent steps and returns HTTP `422`
- Fulfillment failures use `FULFILLMENT_STEP_FAILED` at order level
- NEA activation is skipped when `neaActivationRequired = false`
- Documentation and automated tests are updated for the verified behavior

## Verification

Full test suite:

- `55` tests passing
- `0` failures

Key test coverage:

- Sprint 2 ProductOrder validation and fulfillment gaps
- Sprint 3 inventory, retry, compensation, and channel flows
- Sprint 4 channel auth token and SubscriberAccount validation flows

## Release Tag

Planned tag:

- `v1.0`

Tag message:

- `Sprint 6 - stable release`
