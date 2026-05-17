# Subscription Manager

Sprint 1 implementation for the ISP Subscription Manager TMF foundation:

- TMF620 `ProductSpecification`, `ProductOffering`, `ProductOfferingPrice`
- TMF663 `ShoppingCart` and `CartItem`
- TMF622 `ProductOrder` lifecycle foundation
- TMF637-style `ProductInventory` records
- Channel integration foundation for USSD, SMS, CRM, partners, and self-care

## Run

```powershell
cd "Subscription Manager"
npm.cmd start
```

The API listens on `http://localhost:3000` by default. Use `PORT=3001` to change it.

The default storage mode is in-memory, which is useful for local development and tests.

## PostgreSQL

Install dependencies:

```powershell
cd "C:\Subscription Manager"
npm.cmd install
```

Create a PostgreSQL database, then apply:

```powershell
psql "$env:DATABASE_URL" -f database/001_sprint1_tmf_foundation.sql
```

Start with PostgreSQL persistence:

```powershell
$env:DATABASE_URL = "postgres://user:password@localhost:5432/subscription_manager"
$env:STORAGE_PROVIDER = "postgres"
npm.cmd start
```

## Test

PowerShell may block `npm.ps1` on this machine, so the test command can be run directly:

```powershell
cd "Subscription Manager"
npm.cmd test
```

If `npm.cmd` is available:

```powershell
npm.cmd test
```

## Configuration

- `SUPPORTED_CURRENCIES`: comma-separated ISO 4217 codes, default `USD,INR,NGN,JPY`
- `CART_TTL_MINUTES`: default `30`

## Persistence

The service can run with either in-memory storage or PostgreSQL persistence. The PostgreSQL adapter hydrates the Sprint 1 domain model on startup and writes catalog/cart/order state transactionally after mutating requests.

Project documentation is available in `documentation/`.

Key documents:

- `documentation/installation/INSTALLATION_GUIDE.md`
- `documentation/release-notes/RELEASE_NOTES_SPRINT_1.md`
- `documentation/release-notes/RELEASE_NOTES_SPRINT_2.md`
- `documentation/release-notes/RELEASE_NOTES_SPRINT_3.md`
- `documentation/technical/ARCHITECTURE.md`
- `documentation/technical/API_EXAMPLES.md`
- `documentation/operations/RUNBOOK.md`
- `documentation/marketing/PRODUCT_OVERVIEW.md`

