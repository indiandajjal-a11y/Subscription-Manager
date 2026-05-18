# Sonar Issue Fix Tracker

This file tracks Sonar issues for this repository and the progress of ongoing fixes.

## Current status

- `code/app.js`
  - Fixed visible nested ternary in `handleOrderLifecycleRoutes`.
  - Simplified `is()` and `routeWithParams()` branches to remove inline ternary expressions.
  - Added explicit status handling for `result.status` paths.

- `scripts/parse_sonar.js`
  - Updated built-in imports to use `node:` protocol.
  - Replaced `charCodeAt(0)` with `codePointAt(0)` for Unicode-aware BOM detection.
  - Refactored JSON decoding to support BOM/UTF-16 and UTF-8 smoothly.

## Remaining exported Sonar issues

### Critical / Major

- `javascript:S3776` — High cognitive complexity in `code/app.js`. Needs function decomposition and simplification.
- `javascript:S3358` — Nested ternary operation(s) in `code/app.js`.
- `javascript:S1126` — Replace if-then-else flow with a single return statement.
- `javascript:S1121` — Extract assignment of `params` from expressions; requires review of route parameter handling.

## Next actions

1. Continue refactoring remaining nested ternary and inline assignment patterns.
2. Decompose overly complex router/handler functions into smaller helpers.
3. Re-run ESLint and Sonar issue extraction after each batch.
4. Periodically commit this file and the code changes to Git for tracking.

## Commit guidance

- Commit frequently with messages like:
  - `chore: track Sonar fix progress in SONAR_ISSUES_TRACKER.md`
  - `fix: simplify nested ternary in code/app.js`
  - `refactor: reduce cognitive complexity in route handler`
