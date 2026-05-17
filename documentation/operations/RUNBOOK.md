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

## Known Sprint 1 Limitations

- No authentication or authorization
- No charging integration
- No provisioning integration
- PostgreSQL adapter writes full Sprint 1 state after mutations; this is acceptable for Sprint 1 scale but should be replaced by per-aggregate repositories in later sprints.
