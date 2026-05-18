# Testing Notes

Run the full suite with:

```powershell
npm.cmd test
```

Current stable result:

- 115 tests passing
- 0 failures

Sprint 7 coverage is in `sprint7.test.js` and covers CurrencyConfig, CommunicationTemplate selection/rendering, notification dispatch records, live balance placeholders, staff secondary-number override, and the combined USSD/SMS subscribe flow.

Sprint 8 coverage is in `sprint8.test.js` and covers dormant cleanup, decommissioned-subscriber cart blocking, consolidated balance rendering, bonus detection and dispatch, TICK rule matching, tariff migration fulfillment, and negative authorization/validation cases.

Sprint 13 coverage is in `sprint9.test.js` and covers SIM upgrade automation, DND/rate limiting, CS callback menu dispatch, subscriber acceptance, encrypted PIN handling, PIN lockout, transfer limits, debit/credit/reversal, idempotency, audit log, and readiness checks.

Sonar prevention checks are documented in `documentation/technical/SONAR_QUALITY_RUBRIC.md`.
