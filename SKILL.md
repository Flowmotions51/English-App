---
name: commit-writer
description: Commits logical changes of feature or bugfix 
---

# Commit Writer

## Workflow

1. Run `git diff --cached`. If empty, ask the user to stage changes.
2. Pick a type: `feature`, `fix`, `refactor`, `docs`, `test`, `chore`.
3. Pick a scope from the touched paths. `backend/`, `frontend`.
4. Write the subject line: `<type>(<scope>): <description>`. Imperative mood, no period, <= 72 chars.
5. If the diff touches `backend/src/main/resources/db/migration`, append a `DB MIGRATION:` message + the path of the changes migration files.

## Examples

| Diff                                           			| Message                                                    |
| ----------------------------------------------------------------------| -----------------------------------------------------------|
| New file `backend/`                           			| `new-feature-backend`		                             |
| New file `frontend/`                                                  | `new-feature-frontend` New stats feature was added         |
| New line in `backend/src/main/resourses/db/migration`                 | `new-db-migration` Added a column in review_sessions table |
