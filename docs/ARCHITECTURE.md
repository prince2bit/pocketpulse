# Architecture

PocketPulse is layered so that drawing, business rules and SQL stay separate.

```
cli  ->  services  ->  database (repositories)  ->  SQLite
 |           ^
 v           |
 ui  (draws plain data; never touches the database)
```

| Folder | Responsibility |
|---|---|
| `src/index.js` | Entry point. Builds the real terminal context and database, runs the command, handles top-level errors. |
| `src/app.js` | Composition root. Creates repositories and services and returns them as one object. |
| `src/cli/` | Argument parsing, the command registry, each command, and the interactive home screen. |
| `src/services/` | Business rules: expense validation, category matching and management, text parsing, settings, analytics. |
| `src/database/` | Connection handling, migrations, seed data, and one repository per table group. All SQL lives here. |
| `src/ui/` | Theme and colour support, panels, charts, dashboard and report rendering, prompts. Pure functions over plain data. |
| `src/utils/` | Money, dates and time zones, text normalisation, errors. |

## Dependency injection

Commands never read the terminal or open the database directly. They receive a `ctx` object (`theme`, `write`, `error`, `getApp`, `getPrompts`, `interactive`, ...). `index.js` builds the real one and the tests build fakes, which is why most of the CLI can be tested without a terminal.

## Flow of `add`

1. `parserService` splits the text into description, amount and currency, and reports ambiguity.
2. `expenseService.validate` checks every field and returns a draft (nothing is saved).
3. `categoryService.suggest` proposes a category using `categorizer`.
4. The command shows a preview and asks for confirmation.
5. `expenseService.save` stamps the time, resolves the category and writes the row.

## Testing

Tests use Node's built-in runner. Most use an in-memory SQLite database and an injected clock. `tests/e2e.test.js` runs the real program as a subprocess. `tests/privacy.test.js` fails if any source file imports a networking module.
