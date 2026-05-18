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

## Review Checklist

- No `if ((x = ...))` patterns.
- No nested ternary chains.
- No duplicate mock method bodies without an intentional differentiating field.
- No plain-object throws.
- New routes have at least one HTTP or domain test when they expose new behavior.
