import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { fail } from "./errors.js";
import {
  addCartItem,
  createShoppingCart,
  getProductOffering,
  listNotificationEvents,
  listProductInventory,
  listProductOrders,
  nowIso
} from "./domain.js";
import { dispatchNotificationEvent, subscribeCart } from "./sprint7.js";
import { ensureSubscriberNotDecommissioned } from "./sprint8.js";

const SIM_TYPES = ["LEGACY", "4G_COMPATIBLE", "UNKNOWN"];
const SIM_ACTIONS = ["PROMPTED", "DND_EXCLUDED", "RATE_LIMITED", "SIM_NOT_LEGACY", "CS_UPDATE_FAILED"];
const TRIGGER_TYPES = ["DEVICE_ACTIVATION", "BROWSING_EVENT"];
const TRANSFER_LIMIT_TYPES = ["PER_TRANSFER", "DAILY_SENDER", "DAILY_RECIPIENT", "MONTHLY_SENDER"];
const TRANSFER_STATUSES = ["pending", "inProgress", "completed", "failed", "reversed"];

function ensureMap(db, name) {
  if (!db[name]) db[name] = new Map();
  return db[name];
}

function required(value, field) {
  if (value === undefined || value === null || value === "") fail(400, "REQUIRED_FIELD", `${field} is required.`, field);
}

function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) fail(422, "INVALID_ENUM", `${field} must be one of: ${allowed.join(", ")}.`, field);
}

function recordNotification(db, eventType, body = {}) {
  const event = {
    id: randomUUID(),
    eventType,
    orderId: body.orderId || null,
    subscriberId: body.subscriberId,
    channelId: body.channelId || "USSD",
    recipientType: body.recipientType || "SELF",
    recipientId: body.recipientId || body.subscriberId,
    orderType: body.orderType || null,
    payload: body.payload || {},
    status: "pending",
    createdAt: nowIso()
  };
  ensureMap(db, "notificationEvents").set(event.id, event);
  return event;
}

export function getActiveSimUpgradeConfig(db) {
  return [...ensureMap(db, "simUpgradeConfigs").values()].find((config) => config.status === "active") || null;
}

export function upsertSimUpgradeConfig(db, body = {}) {
  required(body.upgradeOfferingId, "upgradeOfferingId");
  required(body.csTimerAttribute, "csTimerAttribute");
  getProductOffering(db, body.upgradeOfferingId);
  const configs = ensureMap(db, "simUpgradeConfigs");
  const existing = body.id ? configs.get(body.id) : getActiveSimUpgradeConfig(db);
  const timestamp = nowIso();
  const config = {
    id: existing?.id || randomUUID(),
    upgradeOfferingId: body.upgradeOfferingId,
    legacySimAttribute: body.legacySimAttribute || existing?.legacySimAttribute || "SIM_TYPE",
    legacySimValue: body.legacySimValue || existing?.legacySimValue || "2G",
    csTimerAttribute: body.csTimerAttribute,
    csTimerValueSeconds: Number(body.csTimerValueSeconds ?? existing?.csTimerValueSeconds ?? 60),
    rateLimitDays: Number(body.rateLimitDays ?? existing?.rateLimitDays ?? 7),
    ussdMenuTemplateId: body.ussdMenuTemplateId || existing?.ussdMenuTemplateId || null,
    status: body.status || existing?.status || "active",
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };
  configs.set(config.id, config);
  return config;
}

export function upsertCustomerPreference(db, body = {}) {
  required(body.subscriberId, "subscriberId");
  const prefs = ensureMap(db, "customerPreferences");
  const existing = prefs.get(body.subscriberId);
  const dndEnabled = body.dndEnabled ?? existing?.dndEnabled ?? false;
  const pref = {
    id: existing?.id || randomUUID(),
    subscriberId: body.subscriberId,
    dndEnabled,
    dndSetAt: dndEnabled ? (body.dndSetAt || existing?.dndSetAt || nowIso()) : null,
    dndSetBy: body.dndSetBy || body.channelId || existing?.dndSetBy || null,
    preferences: body.preferences || existing?.preferences || {},
    updatedAt: nowIso()
  };
  prefs.set(pref.subscriberId, pref);
  return pref;
}

export function getCustomerPreference(db, subscriberId) {
  return ensureMap(db, "customerPreferences").get(subscriberId) || {
    id: null,
    subscriberId,
    dndEnabled: false,
    dndSetAt: null,
    dndSetBy: null,
    preferences: {},
    updatedAt: null
  };
}

function mockSimCheckClient() {
  return {
    checkSim: async () => ({
      simType: process.env.SIM_CHECK_MOCK_RESULT || "LEGACY",
      simRef: "mock-sim",
      failureReason: null
    })
  };
}

function withinDays(value, days) {
  return value && Date.now() - new Date(value).getTime() < Number(days) * 24 * 60 * 60 * 1000;
}

function createSimEvent(db, body) {
  const event = {
    id: randomUUID(),
    subscriberId: body.subscriberId,
    deviceId: body.deviceId,
    triggerType: body.triggerType,
    simType: "UNKNOWN",
    actionTaken: null,
    csTimerUpdateRef: null,
    upgradeOrderId: null,
    receivedAt: nowIso(),
    resolvedAt: null
  };
  ensureMap(db, "simUpgradeEvents").set(event.id, event);
  return event;
}

export async function processSimUpgradeDeviceEvent(db, body = {}, options = {}) {
  required(body.subscriberId, "subscriberId");
  required(body.deviceId, "deviceId");
  oneOf(body.triggerType || "DEVICE_ACTIVATION", TRIGGER_TYPES, "triggerType");
  const config = getActiveSimUpgradeConfig(db);
  if (!config) fail(422, "SIM_UPGRADE_CONFIG_MISSING", "Active SimUpgradeConfig is required.", "simUpgradeConfig");
  const duplicate = listSimUpgradeEvents(db, { subscriberId: body.subscriberId })
    .find((event) => event.deviceId === body.deviceId && withinDays(event.receivedAt, config.rateLimitDays));
  if (duplicate) fail(409, "DEVICE_EVENT_DUPLICATE", "Device event was already processed inside the rate-limit window.", "deviceId");

  const event = createSimEvent(db, { ...body, triggerType: body.triggerType || "DEVICE_ACTIVATION" });
  const preference = getCustomerPreference(db, body.subscriberId);
  if (preference.dndEnabled) return resolveSimEvent(event, "DND_EXCLUDED");

  const rateLimit = ensureMap(db, "simUpgradeRateLimits").get(body.subscriberId);
  if (withinDays(rateLimit?.lastPromptedAt, config.rateLimitDays)) return resolveSimEvent(event, "RATE_LIMITED");

  let simResult;
  try {
    simResult = await (options.simCheckClient || mockSimCheckClient()).checkSim(body);
  } catch {
    return resolveSimEvent(event, "CS_UPDATE_FAILED", "UNKNOWN");
  }
  event.simType = SIM_TYPES.includes(simResult.simType) ? simResult.simType : "UNKNOWN";
  if (event.simType !== "LEGACY") return resolveSimEvent(event, "SIM_NOT_LEGACY", event.simType);

  const csResult = await updateSimTimer(options.chargingSystemClient, body.subscriberId, event.id, config);
  if (csResult.status === "failed") return resolveSimEvent(event, "CS_UPDATE_FAILED", event.simType);

  event.csTimerUpdateRef = csResult.transactionId || csResult.responseCode || `SIM-UPGRADE-${event.id}`;
  ensureMap(db, "simUpgradeRateLimits").set(body.subscriberId, {
    id: rateLimit?.id || randomUUID(),
    subscriberId: body.subscriberId,
    lastPromptedAt: nowIso(),
    promptCount: Number(rateLimit?.promptCount || 0) + 1
  });
  return resolveSimEvent(event, "PROMPTED", event.simType, false);
}

async function updateSimTimer(client, subscriberId, eventId, config) {
  if (!client?.updateSubscriberAttributes) return { status: "success", transactionId: `mock-cs-${eventId}` };
  return client.updateSubscriberAttributes({
    subscriberId,
    transactionRef: `SIM-UPGRADE-${eventId}`,
    attributes: [{ name: config.csTimerAttribute, value: String(config.csTimerValueSeconds) }]
  });
}

function resolveSimEvent(event, actionTaken, simType = event.simType, resolved = true) {
  oneOf(actionTaken, SIM_ACTIONS, "actionTaken");
  event.actionTaken = actionTaken;
  event.simType = simType;
  if (resolved) event.resolvedAt = nowIso();
  return { eventId: event.id, actionTaken, simType: event.simType };
}

export async function receiveSimUpgradeCallback(db, body = {}, options = {}) {
  required(body.eventId, "eventId");
  const event = getSimUpgradeEvent(db, body.eventId);
  if (event.actionTaken !== "PROMPTED") fail(409, "SIM_EVENT_NOT_PROMPTED", "Only prompted SIM upgrade events can receive callbacks.", "eventId");
  const config = getActiveSimUpgradeConfig(db);
  const notification = recordNotification(db, "SIM_UPGRADE_MENU", {
    subscriberId: event.subscriberId,
    channelId: "USSD",
    payload: { eventId: event.id, callbackRef: body.callbackRef, upgradeOfferingId: config?.upgradeOfferingId }
  });
  const dispatch = await dispatchNotificationEvent(db, notification.id, {
    channelType: "USSD",
    gatewayClient: options.gatewayClient
  });
  return { eventId: event.id, notificationEventId: notification.id, dispatchId: dispatch.id, dispatchStatus: dispatch.status };
}

export async function handleSimUpgradeSubscriberResponse(db, body = {}, options = {}) {
  required(body.eventId, "eventId");
  required(body.response, "response");
  const event = getSimUpgradeEvent(db, body.eventId);
  const config = getActiveSimUpgradeConfig(db);
  if (!config) fail(422, "SIM_UPGRADE_CONFIG_MISSING", "Active SimUpgradeConfig is required.", "simUpgradeConfig");
  if (body.response === "DECLINE") {
    event.resolvedAt = nowIso();
    const notification = recordNotification(db, "SIM_UPGRADE_DECLINED", { subscriberId: event.subscriberId, channelId: "USSD", payload: { eventId: event.id } });
    return { eventId: event.id, response: "DECLINE", notificationEventId: notification.id };
  }
  if (body.response !== "ACCEPT") fail(422, "INVALID_SIM_RESPONSE", "response must be ACCEPT or DECLINE.", "response");
  const cart = createShoppingCart(db, { channelId: body.channelId || "USSD", subscriberId: event.subscriberId, currency: body.currency || "NGN" });
  addCartItem(db, cart.id, { productOfferingId: config.upgradeOfferingId, quantity: 1, purchasePolicy: "SELF_ONE_OFF" });
  const subscribed = await subscribeCart(db, cart.id, {
    validationBody: body.validationBody || {},
    fulfillmentBody: body.fulfillmentBody || {},
    channelType: "USSD",
    gatewayClient: options.gatewayClient
  });
  event.upgradeOrderId = subscribed.orderId;
  event.resolvedAt = nowIso();
  const notification = recordNotification(db, "SIM_UPGRADE_ACCEPTED", {
    orderId: subscribed.orderId,
    subscriberId: event.subscriberId,
    channelId: "USSD",
    payload: { eventId: event.id }
  });
  return { eventId: event.id, response: "ACCEPT", orderId: subscribed.orderId, notificationEventId: notification.id };
}

export function getSimUpgradeEvent(db, eventId) {
  const event = ensureMap(db, "simUpgradeEvents").get(eventId);
  if (!event) fail(404, "SIM_UPGRADE_EVENT_NOT_FOUND", "SimUpgradeEvent was not found.", "eventId");
  return event;
}

export function listSimUpgradeEvents(db, query = {}) {
  return [...ensureMap(db, "simUpgradeEvents").values()]
    .filter((event) => !query.subscriberId || event.subscriberId === query.subscriberId)
    .filter((event) => !query.actionTaken || event.actionTaken === query.actionTaken);
}

function pinKey() {
  return createHash("sha256").update(process.env.TRANSFER_PIN_ENCRYPTION_KEY || "test-transfer-pin-key").digest();
}

function encryptPin(pin) {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", pinKey(), iv);
  return {
    encryptedPin: Buffer.concat([cipher.update(String(pin), "utf8"), cipher.final()]).toString("base64"),
    iv: iv.toString("base64")
  };
}

function decryptPin(record) {
  const decipher = createDecipheriv("aes-256-cbc", pinKey(), Buffer.from(record.iv, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(record.encryptedPin, "base64")), decipher.final()]).toString("utf8");
}

function validatePinFormat(pin, field = "pin") {
  if (!/^\d{4,6}$/.test(String(pin || ""))) fail(422, "INVALID_PIN_FORMAT", "PIN must be 4 to 6 numeric digits.", field);
}

function pinFailures(db, subscriberId) {
  const windowSeconds = Number(process.env.TRANSFER_PIN_LOCKOUT_WINDOW_SECONDS || 300);
  const since = Date.now() - windowSeconds * 1000;
  return [...ensureMap(db, "pinAttemptLogs").values()]
    .filter((log) => log.subscriberId === subscriberId && !log.success && new Date(log.attemptedAt).getTime() >= since);
}

function logPinAttempt(db, body) {
  const log = { id: randomUUID(), transferId: null, attemptedAt: nowIso(), ...body };
  ensureMap(db, "pinAttemptLogs").set(log.id, log);
  return log;
}

function assertPinUnlocked(db, subscriberId) {
  const maxAttempts = Number(process.env.TRANSFER_PIN_MAX_ATTEMPTS || 3);
  if (pinFailures(db, subscriberId).length >= maxAttempts) fail(429, "PIN_LOCKED", "PIN is locked after repeated failed attempts.", "pin");
}

export function setTransferPin(db, body = {}, options = {}) {
  required(body.subscriberId, "subscriberId");
  validatePinFormat(body.newPin || body.pin, "newPin");
  const pins = ensureMap(db, "subscriberPins");
  const existing = pins.get(body.subscriberId);
  if (existing && !options.adminReset) {
    validatePinFormat(body.currentPin, "currentPin");
    assertPinUnlocked(db, body.subscriberId);
    const success = decryptPin(existing) === String(body.currentPin);
    logPinAttempt(db, { subscriberId: body.subscriberId, attemptType: "PIN_CHANGE", success, channelId: body.channelId || "USSD" });
    if (!success) fail(401, "INVALID_PIN", "PIN validation failed.", "currentPin");
  }
  const encrypted = encryptPin(body.newPin || body.pin);
  const record = {
    id: existing?.id || randomUUID(),
    subscriberId: body.subscriberId,
    ...encrypted,
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
    lastChangedBy: body.channelId || options.channelId || "USSD"
  };
  pins.set(record.subscriberId, record);
  return { subscriberId: record.subscriberId, updatedAt: record.updatedAt };
}

export function createTransferLimit(db, body = {}) {
  required(body.limitType, "limitType");
  oneOf(body.limitType, TRANSFER_LIMIT_TYPES, "limitType");
  required(body.maxAmount, "maxAmount");
  const limit = {
    id: randomUUID(),
    limitType: body.limitType,
    maxAmount: Number(body.maxAmount),
    currency: body.currency || "NGN",
    serviceClass: body.serviceClass || [],
    status: body.status || "active"
  };
  ensureMap(db, "transferLimits").set(limit.id, limit);
  return limit;
}

export function listTransferLimits(db, query = {}) {
  return [...ensureMap(db, "transferLimits").values()]
    .filter((limit) => !query.status || limit.status === query.status)
    .filter((limit) => !query.limitType || limit.limitType === query.limitType);
}

export function updateTransferLimit(db, limitId, body = {}) {
  const limit = ensureMap(db, "transferLimits").get(limitId);
  if (!limit) fail(404, "TRANSFER_LIMIT_NOT_FOUND", "TransferLimit was not found.", "limitId");
  for (const field of ["limitType", "maxAmount", "currency", "serviceClass", "status"]) {
    if (body[field] !== undefined) limit[field] = field === "maxAmount" ? Number(body[field]) : body[field];
  }
  oneOf(limit.limitType, TRANSFER_LIMIT_TYPES, "limitType");
  return limit;
}

function validateTransferLimits(db, body) {
  const active = listTransferLimits(db, { status: "active" }).filter((limit) => limit.currency === body.currency);
  for (const limit of active) {
    const used = transferUsedAmount(db, limit.limitType, body);
    if (used + Number(body.amount) > Number(limit.maxAmount)) {
      fail(422, "TRANSFER_LIMIT_EXCEEDED", `${limit.limitType} transfer limit exceeded.`, "amount", { limitType: limit.limitType });
    }
  }
}

function transferUsedAmount(db, limitType, body) {
  const now = new Date();
  const transfers = [...ensureMap(db, "creditTransferRequests").values()].filter((transfer) => transfer.status === "completed");
  const sameCurrency = (transfer) => transfer.currency === body.currency;
  const sameDay = (transfer) => transfer.completedAt?.slice(0, 10) === now.toISOString().slice(0, 10);
  if (limitType === "PER_TRANSFER") return 0;
  if (limitType === "DAILY_SENDER") return transfers.filter((t) => sameCurrency(t) && sameDay(t) && t.senderSubscriberId === body.senderSubscriberId).reduce((sum, t) => sum + t.amount, 0);
  if (limitType === "DAILY_RECIPIENT") return transfers.filter((t) => sameCurrency(t) && sameDay(t) && t.recipientSubscriberId === body.recipientSubscriberId).reduce((sum, t) => sum + t.amount, 0);
  return transfers.filter((t) => sameCurrency(t) && t.senderSubscriberId === body.senderSubscriberId && t.completedAt?.slice(0, 7) === now.toISOString().slice(0, 7)).reduce((sum, t) => sum + t.amount, 0);
}

async function validateTransferPin(db, body, transferId) {
  const record = ensureMap(db, "subscriberPins").get(body.senderSubscriberId);
  if (!record) fail(401, "INVALID_PIN", "PIN has not been configured.", "pin");
  assertPinUnlocked(db, body.senderSubscriberId);
  const success = decryptPin(record) === String(body.pin);
  logPinAttempt(db, { subscriberId: body.senderSubscriberId, transferId, attemptType: "TRANSFER", success, channelId: body.channelId || "USSD" });
  if (!success) fail(401, "INVALID_PIN", "PIN validation failed.", "pin");
}

export async function requestCreditTransfer(db, body = {}, options = {}) {
  required(body.senderSubscriberId, "senderSubscriberId");
  required(body.recipientSubscriberId, "recipientSubscriberId");
  required(body.amount, "amount");
  validatePinFormat(body.pin, "pin");
  if (body.senderSubscriberId === body.recipientSubscriberId) fail(422, "SELF_TRANSFER_NOT_ALLOWED", "Sender and recipient must differ.", "recipientSubscriberId");
  ensureSubscriberNotDecommissioned(db, body.senderSubscriberId);
  const currency = body.currency || "NGN";
  await validateTransferPin(db, body, null);
  validateTransferLimits(db, { ...body, currency });
  await ensureSenderBalance(options.chargingSystemClient, body.senderSubscriberId, body.amount, currency);
  const transfer = createTransferRecord(db, { ...body, currency });
  return executeCreditTransfer(db, transfer.id, options);
}

function createTransferRecord(db, body) {
  const transfer = {
    id: randomUUID(),
    senderSubscriberId: body.senderSubscriberId,
    recipientSubscriberId: body.recipientSubscriberId,
    amount: Number(body.amount),
    currency: body.currency,
    channelId: body.channelId || "USSD",
    status: "pending",
    senderDebitRef: null,
    recipientCreditRef: null,
    failureReasonCode: null,
    requestedAt: nowIso(),
    completedAt: null,
    reversedAt: null,
    reversalReason: null
  };
  ensureMap(db, "creditTransferRequests").set(transfer.id, transfer);
  return transfer;
}

async function ensureSenderBalance(client, subscriberId, amount, currency) {
  if (!client?.fetchSubscriberAccount) return;
  const account = await client.fetchSubscriberAccount({ subscriberId, requestType: "GBAD", transactionRef: `TRANSFER-BALANCE-${randomUUID()}` });
  if (account.status === "failed" || Number(account.mainBalance || 0) < Number(amount)) {
    fail(422, "INSUFFICIENT_BALANCE", "Sender main account balance is insufficient.", "amount");
  }
  if (account.currency && account.currency !== currency) fail(422, "CURRENCY_MISMATCH", "Sender account currency does not match transfer currency.", "currency");
}

export async function executeCreditTransfer(db, transferId, options = {}) {
  const transfer = getCreditTransfer(db, transferId);
  oneOf(transfer.status, ["pending"], "status");
  transfer.status = "inProgress";
  const client = options.chargingSystemClient || {};
  const debit = client.debit ? await client.debit({
    subscriberId: transfer.senderSubscriberId,
    amount: transfer.amount,
    currency: transfer.currency,
    transactionRef: transfer.id
  }) : { transactionId: `debit-${randomUUID()}`, status: "success" };
  if (debit.status === "failed") return failTransfer(db, transfer, "TRANSFER_DEBIT_FAILED");
  transfer.senderDebitRef = debit.transactionId;

  const creditMethod = client.credit || client.creditBack;
  const credit = creditMethod ? await creditMethod.call(client, {
    subscriberId: transfer.recipientSubscriberId,
    amount: transfer.amount,
    currency: transfer.currency,
    transactionRef: transfer.id,
    creditReason: "TRANSFER"
  }) : { transactionId: `credit-${randomUUID()}`, status: "success" };
  if (credit.status === "failed") {
    if (client.creditBack) await client.creditBack({ subscriberId: transfer.senderSubscriberId, amount: transfer.amount, currency: transfer.currency, originalTransactionRef: transfer.senderDebitRef });
    transfer.status = "reversed";
    transfer.failureReasonCode = "TRANSFER_CREDIT_FAILED";
    transfer.reversedAt = nowIso();
    transfer.reversalReason = "CS_CREDIT_FAILED";
    recordNotification(db, "TRANSFER_REVERSED", transferNotification(transfer, transfer.senderSubscriberId));
    return transfer;
  }
  transfer.recipientCreditRef = credit.transactionId;
  transfer.status = "completed";
  transfer.completedAt = nowIso();
  recordNotification(db, "TRANSFER_SENT", transferNotification(transfer, transfer.senderSubscriberId));
  recordNotification(db, "TRANSFER_RECEIVED", transferNotification(transfer, transfer.recipientSubscriberId));
  return transfer;
}

function failTransfer(db, transfer, reasonCode) {
  transfer.status = "failed";
  transfer.failureReasonCode = reasonCode;
  transfer.completedAt = nowIso();
  recordNotification(db, "TRANSFER_FAILED", transferNotification(transfer, transfer.senderSubscriberId));
  return transfer;
}

function transferNotification(transfer, recipientId) {
  return {
    subscriberId: recipientId,
    recipientId,
    channelId: transfer.channelId,
    payload: {
      transferId: transfer.id,
      transferAmount: transfer.amount,
      transferCurrency: transfer.currency,
      senderSubscriberId: transfer.senderSubscriberId,
      recipientSubscriberId: transfer.recipientSubscriberId,
      transferStatus: transfer.status,
      transferCompletedAt: transfer.completedAt
    }
  };
}

export function getCreditTransfer(db, transferId) {
  const transfer = ensureMap(db, "creditTransferRequests").get(transferId);
  if (!transfer) fail(404, "TRANSFER_NOT_FOUND", "CreditTransferRequest was not found.", "transferId");
  return transfer;
}

export function listCreditTransfers(db, query = {}) {
  return [...ensureMap(db, "creditTransferRequests").values()]
    .filter((transfer) => !query.senderSubscriberId || transfer.senderSubscriberId === query.senderSubscriberId)
    .filter((transfer) => !query.recipientSubscriberId || transfer.recipientSubscriberId === query.recipientSubscriberId)
    .filter((transfer) => !query.status || transfer.status === query.status);
}

export function withIdempotency(db, key, scope, execute) {
  if (!key) return execute();
  const records = ensureMap(db, "idempotencyRecords");
  const recordKey = `${scope}:${key}`;
  const existing = records.get(recordKey);
  if (existing && Date.now() - new Date(existing.createdAt).getTime() < 24 * 60 * 60 * 1000) return existing.response;
  const response = execute();
  records.set(recordKey, { id: randomUUID(), key, scope, response, createdAt: nowIso(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
  return response;
}

export async function withAsyncIdempotency(db, key, scope, execute) {
  if (!key) return execute();
  const records = ensureMap(db, "idempotencyRecords");
  const recordKey = `${scope}:${key}`;
  const existing = records.get(recordKey);
  if (existing && Date.now() - new Date(existing.createdAt).getTime() < 24 * 60 * 60 * 1000) return existing.response;
  const response = await execute();
  records.set(recordKey, { id: randomUUID(), key, scope, response, createdAt: nowIso(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
  return response;
}

export function auditLog(db, query = {}) {
  const subscriberId = query.subscriberId;
  const entries = [
    ...listProductOrders(db, subscriberId ? { subscriberId } : {}).map((item) => ({ entityType: "ProductOrder", entityId: item.id, subscriberId: item.subscriberId, status: item.status, occurredAt: item.createdAt })),
    ...listProductInventory(db, subscriberId ? { subscriberId } : {}).map((item) => ({ entityType: "ProductInventory", entityId: item.id, subscriberId: item.subscriberId, status: item.status, occurredAt: item.createdAt })),
    ...listCreditTransfers(db, {}).filter((item) => !subscriberId || item.senderSubscriberId === subscriberId || item.recipientSubscriberId === subscriberId).map((item) => ({ entityType: "CreditTransferRequest", entityId: item.id, subscriberId: item.senderSubscriberId, status: item.status, occurredAt: item.requestedAt })),
    ...[...ensureMap(db, "dormantCleanupRequests").values()].filter((item) => !subscriberId || item.subscriberId === subscriberId).map((item) => ({ entityType: "DormantCleanupRequest", entityId: item.id, subscriberId: item.subscriberId, status: item.status, occurredAt: item.requestedAt })),
    ...listNotificationEvents(db, subscriberId ? { subscriberId } : {}).map((item) => ({ entityType: "NotificationEvent", entityId: item.id, subscriberId: item.subscriberId, status: item.status, eventType: item.eventType, occurredAt: item.createdAt }))
  ];
  return entries
    .filter((entry) => !query.entityType || entry.entityType === query.entityType)
    .filter((entry) => !query.from || entry.occurredAt >= query.from)
    .filter((entry) => !query.to || entry.occurredAt <= query.to)
    .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
}

export async function readiness(db, options = {}) {
  const checks = { db: db ? "ok" : "error", cs: "ok" };
  if (options.chargingSystemClient?.fetchSubscriberAccount) {
    try {
      const result = await options.chargingSystemClient.fetchSubscriberAccount({ subscriberId: "READY", requestType: "GAD", transactionRef: "READY" });
      checks.cs = result.status === "failed" ? "error" : "ok";
    } catch {
      checks.cs = "error";
    }
  }
  return { status: Object.values(checks).includes("error") ? "degraded" : "ok", checks };
}

export function notificationDispatchedForOrder(db, orderId) {
  const completedEvents = listNotificationEvents(db, { orderId }).filter((event) => event.eventType === "ORDER_COMPLETED");
  return [...ensureMap(db, "notificationDispatchRecords").values()]
    .some((record) => record.status === "sent" && completedEvents.some((event) => event.id === record.notificationEventId));
}

export function validateRuntimeConfig(env = process.env) {
  if (env.NODE_ENV === "test") return;
  const missing = ["CS_ENDPOINT_URL", "CS_TIMEOUT_MS", "JWT_SECRET"].filter((key) => !env[key]);
  if (missing.length > 0) throw new Error(`Missing required runtime configuration: ${missing.join(", ")}`);
}
