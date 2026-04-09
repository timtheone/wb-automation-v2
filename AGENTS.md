# WB Automation V2 - Engineering Rules

These rules apply to all work in this repository.

## Package Manager

- Always use `pnpm`.
- Use workspace-aware commands such as `pnpm --filter <package> ...`.
- Do not use `npm`, `yarn`, or `bun` unless explicitly requested.

## Architecture

- Follow SOLID principles when designing or changing code.
- Prefer composition over inheritance.
- Keep controllers, routes, and UI layers thin.
- Keep business logic in services or domain modules.
- Depend on abstractions and inject dependencies where practical.
- Reuse shared workspace packages before adding duplicate logic.

## Code Quality

- Write concise, readable, maintainable TypeScript.
- Prefer explicit names and small focused functions.
- Avoid unnecessary cleverness.
- Match existing project conventions and file structure.
- Avoid unrelated refactors in the same change.
- Minimize comments; add them only when intent is not obvious.
- Prefer strict typing and avoid `any` unless there is a clear justification.

## Safety and Reliability

- Preserve existing behavior unless the task requires a change.
- Validate inputs and handle errors explicitly.
- Do not expose secrets, tokens, or sensitive data in logs, responses, tests, or UI.
- Keep diffs minimal and targeted.

## Testing

- Add or update tests for every non-trivial change, bug fix, or new behavior.
- Run relevant tests for the changed area before considering the task complete.
- If a change affects shared behavior, run the broader relevant test suite as well.
- Do not mark work complete if tests are failing unless you clearly report the blocker.

## Monorepo Conventions

- Respect workspace boundaries.
- Put shared logic in shared packages when it is used across apps.
- Prefer extending existing modules over creating parallel implementations.

## Done Criteria

- Code is readable.
- Types are correct.
- Tests cover the change.
- Relevant checks pass.
- No unrelated changes are included.
