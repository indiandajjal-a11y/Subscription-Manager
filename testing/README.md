# Testing Notes

Run the full suite with:

```powershell
npm.cmd test
```

Current stable result:

- 105 tests passing
- 0 failures

Sprint 7 coverage is in `sprint7.test.js` and covers CurrencyConfig, CommunicationTemplate selection/rendering, notification dispatch records, live balance placeholders, staff secondary-number override, and the combined USSD/SMS subscribe flow.

Sonar prevention checks are documented in `documentation/technical/SONAR_QUALITY_RUBRIC.md`.
