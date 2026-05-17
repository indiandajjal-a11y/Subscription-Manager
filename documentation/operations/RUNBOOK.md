# Operations Runbook

## Health Check

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/health"
```

Expected response:

```json
{ "status": "ok" }
```

## Start Service

In-memory:

```powershell
cd "C:\Subscription Manager"
npm.cmd start
```

PostgreSQL:

```powershell
cd "C:\Subscription Manager"
$env:DATABASE_URL = "postgres://user:password@localhost:5432/subscription_manager"
$env:STORAGE_PROVIDER = "postgres"
npm.cmd start
```

## Stop Service

Find the Node process:

```powershell
Get-Process node
```

Stop it:

```powershell
Stop-Process -Id <pid>
```

## Common Checks

Run tests:

```powershell
npm.cmd test
```

Check configured currencies:

```powershell
$env:SUPPORTED_CURRENCIES
```

Check PostgreSQL connection string:

```powershell
$env:DATABASE_URL
```

## Sprint 4 Auth And CS Settings

Enable protected subscription routes:

```powershell
$env:ENABLE_AUTH_ENFORCEMENT = "true"
```

JWT and token rate settings:

```powershell
$env:JWT_SECRET = "replace-with-a-strong-secret"
$env:JWT_TTL_SECONDS = "3600"
$env:AUTH_TOKEN_RATE_LIMIT = "10"
```

Charging System adapter settings:

```powershell
$env:CS_ENDPOINT_URL = "https://charging-system.example"
$env:CS_TIMEOUT_MS = "5000"
$env:CS_TRANSIENT_ERROR_CODES = "500,502,503,504"
$env:CS_CLIENT_RETRY_COUNT = "2"
```

If `CS_ENDPOINT_URL` is not set, the Sprint 4 CS client uses local mock responses.

## Sprint 6 Operational Checks

- Run `npm.cmd test` before release. Expected stable result: `98` passing tests, `0` failures.
- Confirm segment management routes respond under `/api/v1/catalog/segments`.
- Confirm renewal schedule inspection works through `/api/v1/renewal-schedules`.
- Confirm sponsor/beneficiary records can be listed through `/api/v1/party-relationships`.
- For CS attribute update troubleshooting, check fulfillment step records and the CS adapter result from `updateSubscriberAttributes`.
- For retry troubleshooting, inspect `retryAttempts`, `nextRetryAt`, and `retryStepName` on the ProductOrder.

## Known Limitations

- PostgreSQL adapter writes full in-memory state after mutations; this is acceptable for prototype scale but should be replaced by per-aggregate repositories before high-volume production use.
- Token revocation cache is in memory and does not survive process restarts.
- Production CS wire-protocol hardening remains vendor-specific integration work.
