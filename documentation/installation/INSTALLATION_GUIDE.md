# Installation Guide

## Prerequisites

- Node.js 20 or newer
- npm
- PostgreSQL 14 or newer if using database persistence

## Install Dependencies

```powershell
cd "C:\Subscription Manager"
npm.cmd install
```

## Run in Local In-Memory Mode

```powershell
cd "C:\Subscription Manager"
npm.cmd start
```

The API will listen on:

```text
http://localhost:3000
```

Health check:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/health"
```

## Run with PostgreSQL

Create a database, then set `DATABASE_URL`:

```powershell
$env:DATABASE_URL = "postgres://user:password@localhost:5432/subscription_manager"
```

Apply the Sprint 1 migration:

```powershell
psql "$env:DATABASE_URL" -f "C:\Subscription Manager\database\001_sprint1_tmf_foundation.sql"
```

Apply the Sprint 2 migration when upgrading an existing Sprint 1 database:

```powershell
psql "$env:DATABASE_URL" -f "C:\Subscription Manager\database\002_sprint2_product_order_state_machine.sql"
```

Apply the Sprint 3 migration when upgrading an existing Sprint 2 database:

```powershell
psql "$env:DATABASE_URL" -f "C:\Subscription Manager\database\003_sprint3_inventory_channels_compensation.sql"
```

If you originally applied Sprint 2 before the official prompt gap-closure pass, apply:

```powershell
psql "$env:DATABASE_URL" -f "C:\Subscription Manager\database\004_sprint2_official_prompt_gap_closure.sql"
```

Start the API with PostgreSQL persistence:

```powershell
$env:STORAGE_PROVIDER = "postgres"
npm.cmd start
```

## Configuration

| Variable | Default | Description |
|---|---:|---|
| `PORT` | `3000` | HTTP server port |
| `SUPPORTED_CURRENCIES` | `USD,INR,NGN,JPY` | Comma-separated ISO 4217 currencies accepted for carts |
| `CART_TTL_MINUTES` | `30` | Cart expiry period in minutes |
| `DATABASE_URL` | none | PostgreSQL connection string |
| `STORAGE_PROVIDER` | memory | Set to `postgres` for PostgreSQL persistence |
| `NOTIFICATION_SMS_MAX_LENGTH` | `160` | Sprint 7 SMS truncation limit |
| `NOTIFICATION_DATE_FORMAT` | `DD-MM-YYYY HH:MM:SS` | Sprint 7 default date rendering format |

## Run Tests

```powershell
cd "C:\Subscription Manager"
npm.cmd test
```

Sprint 7 stable expected result:

- `105` passing tests
- `0` failures

On Windows PowerShell, prefer `npm.cmd test`; `npm test` may invoke `npm.ps1` and fail when script execution is disabled.
