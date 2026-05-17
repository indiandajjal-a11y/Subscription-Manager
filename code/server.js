import http from "node:http";
import { createHandler } from "./app.js";
import { createPostgresPersistence } from "./postgresPersistence.js";
import { store as memoryStore } from "./store.js";

const port = Number(process.env.PORT || 3000);
const usePostgres = process.env.STORAGE_PROVIDER === "postgres" || Boolean(process.env.DATABASE_URL);
let persistence;
let db = memoryStore;

if (usePostgres) {
  persistence = await createPostgresPersistence();
  db = await persistence.load();
  console.log("PostgreSQL persistence enabled.");
} else {
  console.log("In-memory persistence enabled.");
}

const server = http.createServer(createHandler(db, undefined, persistence));

server.listen(port, () => {
  console.log(`Subscription Manager listening on http://localhost:${port}`);
});

async function shutdown() {
  if (persistence?.close) await persistence.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
