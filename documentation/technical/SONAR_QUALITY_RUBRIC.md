# Sonar Quality Rubric

Use this rubric before merging sprint work.

## Routing And Conditionals

- Do not assign inside `if`, `while`, or ternary expressions.
- Split route matching into two statements: assign `params`, then branch on `if (params)`.
- Keep route handlers short; move repeated behavior into helper functions when a handler grows beyond one screen.

## Complexity

- Target cognitive complexity under 15 for every function.
- Extract value selection, validation, and record-shaping logic into named helpers.
- Prefer early returns for guard clauses.
- Do not nest loops and conditionals when a filtered collection or helper can express the same rule clearly.

## Expressions

- Avoid nested ternaries.
- Use small named helpers for attribute selection, nullable conversion, and fallback calculation.
- Throw `ApiError` through `fail(...)` or throw an `Error` instance; never throw plain objects.

## Test Gate

- Run `npm.cmd test` before commit.
- Add or update a sprint test whenever a Sonar fix changes behavior-adjacent code.
- Keep backward-compatible reason codes unless a sprint explicitly introduces a new code path.

## Current Snapshot Handling

- `all-issues.json` from 18 May 2026 reported 91 issues: 1 blocker, 12 critical, 66 major, and 12 minor.
- Most remaining findings are structural complexity in large legacy router/domain functions. Do not expand those functions when adding new sprint work; put new behavior in focused modules such as `sprint8.js`.
- Fix local, low-risk findings immediately when touching nearby code, especially regex simplifications, unused imports, nested ternaries, duplicate mock methods, and plain-object throws.
- Defer broad router decomposition to a dedicated refactor branch with HTTP regression coverage because `app.js` has high behavioral density.

## Review Checklist

- No `if ((x = ...))` patterns.
- No nested ternary chains.
- No duplicate mock method bodies without an intentional differentiating field.
- No plain-object throws.
- New routes have at least one HTTP or domain test when they expose new behavior.
