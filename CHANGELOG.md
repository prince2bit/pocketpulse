# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - First release

### Added
- `add`: record expenses in plain language, with a preview, confirmation and duplicate warning.
- Automatic local timestamps stored as UTC with the IANA time zone and local calendar day.
- Currencies: INR (default), USD, EUR, GBP, AED, CAD, AUD, JPY, SGD, stored as integer minor units and never combined.
- Offline keyword categorisation with learnable and custom rules, plus category management (`categories`).
- Dashboard, `today`, `week`, `month`, `range` and `trends`, with category filters and fair period comparisons.
- Interactive home screen with arrow-key menus and a first-run currency setup.
- `list`, `settings` (currency, time zone, theme) and seven colour themes (default: ocean).
- SQLite storage with versioned migrations.

### Known limitations
- Expenses cannot be edited or deleted yet.
- No export, backup or budget features yet.
