# Sonar and Sprint 13 Quality Rubric

Use this rubric before every release candidate.

## Sonar Rules

- No open blocker, critical, major, or bug issues in `sonar-all-issues.json`.
- Replace nested ternaries with named helper functions or clear `if` statements.
- Keep function cognitive complexity below 15 by extracting validation, mapping, and persistence steps into helpers.
- Remove unused imports immediately after each sprint.
- Use concise regex classes such as `\w` and avoid unnecessary escapes.
- Treat nullability findings as bugs; normalize nullable option objects before property access.

## Sprint 13 Regression Checks

- Run `node --test testing/*.test.js` before commit.
- Verify SIM upgrade DND, rate-limit, legacy SIM prompt, callback dispatch, accept, and decline paths.
- Verify transfer PIN setup/change/reset, lockout, transfer limits, MA balance check, debit, credit, reversal, and bilateral notifications.
- Verify idempotency for cart, order, auth token, and transfer request flows.
- Verify `/api/v1/health`, `/api/v1/ready`, and `/api/v1/admin/audit-log`.

## Documentation Gate

- Update the release notes and testing README with every new endpoint or acceptance scenario.
- Keep `documentation/open-gaps.md` current for deferred integration, security, localization, and gateway-delivery work.
