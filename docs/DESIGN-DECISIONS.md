# Design decisions

## No runtime dependencies, `node:sqlite` for storage
The built-in SQLite module avoids native compilation, which regularly breaks installs on Windows, and keeps the supply chain empty for a tool that handles financial data. The trade-off is requiring Node 22.13+, and `node:sqlite` is still marked experimental (its warning is suppressed). Terminal handling, argument parsing and tests also use Node's built-ins.

## Money is stored as integers
Amounts are whole numbers of the currency's minor unit (paise, cents, yen), taken from `Intl` so JPY has no decimals and INR has two. Floats cannot represent most decimals exactly (`0.1 + 0.2`), and totals would drift. Amounts are parsed from strings without float arithmetic, and a value with too many decimal places is rejected, not rounded.

## Time: UTC instant + time zone + local day
Each expense stores the UTC instant, the IANA time zone and the local calendar day (`YYYY-MM-DD`) at the time it was saved. Weekly and monthly periods group by the stored local day, so a purchase at 11:45 PM belongs to the day it happened, and changing your time zone later doesn't move old expenses.

## Currencies are never combined
`₹100` and `$10` are not `110`. Totals are returned one entry per currency. Charts and breakdowns use one primary currency and say how to see the others. Conversion would need exchange rates, which would break the offline, no-network design.

## Categorisation is deterministic and local
Keyword matching with plural folding, phrase matching, and user rules that outrank built-ins. It's explainable ("matched `chips`"), predictable and private. The cost is vocabulary: it only knows the words it has been given, so the user can teach it more.

## Migrations and frozen seed data
Schema changes are numbered migrations using `PRAGMA user_version`, each run in a transaction. The starter categories live in `categoriesV1.js`, a frozen snapshot used by migration 2, so a later edit can't change what an old migration does.

## Fair period comparisons
An unfinished week or month is compared with the same number of days at the start of the previous one. Comparing 3 days against a full week would always look like a drop.

## Local-only is enforced by a test
`tests/privacy.test.js` scans the source for networking and process-spawning modules, `fetch`, and hard-coded URLs.
