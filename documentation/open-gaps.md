# Open Gaps

Sprint 13 closes the Sprint 9 prompt scope for SIM upgrade automation, credit transfer with PIN, and hardening. Remaining items are future production hardening or external dependencies.

| Story ID | Description | Future Owner | Current Workaround |
|---|---|---|---|
| FUT-LOC | Multi-language notification locale support | Future localization sprint | English templates through Sprint 7 engine |
| FUT-SIM-REAL | Real `SimCheckClient` integration | Device management integration | Mock client and injectable interface |
| FUT-OFFLINE-REAL | Real offline cleanup integration | Data platform integration | Mock `OfflineCleanupClient` from Sprint 8 |
| FUT-DA-TRANSFER | DA-sourced credit transfers | Charging product sprint | Sprint 13 supports MA-only transfer pre-checks |
| FUT-GW-RECEIPTS | Gateway delivery receipts | Gateway integration | Dispatch status records store send result only |
| FUT-GIFT-ELIG | Beneficiary eligibility on gifts | Product rules sprint | Sponsor-side validation remains active |
| FUT-OIDC | OAuth2/OIDC admin authorization | Security hardening | Channel JWT/API-key controls remain in place |
| FUT-REVOCATION | Persistent token revocation list | Security hardening | In-memory revocation cache plus token records |
| FUT-USSD-STATE | Multi-step USSD state machine | USSD gateway adapter | Single-screen push menu supported |

No open gap blocks the in-memory Sprint 13 acceptance suite.
