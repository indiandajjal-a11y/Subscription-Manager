# Sonar Quality Rubric for Subscription Manager

This document summarizes common Sonar issues found in the codebase and recommended fixes/practices to prevent recurrence.

1) Reduce Cognitive Complexity
- Keep functions short (<= 30 lines where practical).
- Extract route handlers or business logic into small pure functions.
- Replace long if/else chains with a routing table or map of handlers.

2) Remove Dead / Unused Code
- Remove unused imports and variables. Use `const` for values that don't change.
- Avoid unused expressions; ensure function return values are used or remove the call.

3) Prefer `const` over `let` where possible
- Use `const` for values not reassigned. This reduces accidental mutation.

4) Error handling and explicit returns
- Handle promise rejections and `await` asynchronous calls where necessary.
- Avoid swallowing errors; return or rethrow after logging.

5) Limit function parameters and side-effects
- Prefer passing fewer, explicit parameters; group related config into an object.

6) Automated checks
- Add ESLint with ruleset: `eslint:recommended` + `plugin:sonarjs/recommended`.
- Add `npm run lint` and `npm test` to CI and pre-commit hooks.

7) Reviews and follow-up
- When fixing critical issues (e.g., complexity), write unit tests to cover behavior.
- Add code review checklist items for Sonar-critical rules.

Location: keep this file at repository root and reference it in PRs.
