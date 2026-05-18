import { randomUUID } from "node:crypto";
import { fail } from "./errors.js";
import {
  checkoutShoppingCart,
  executeProductOrderFulfillment,
  getChannel,
  getChargingResolutionRecord,
  getProductInventory,
  getProductOffering,
  getShoppingCart,
  listNotificationEvents,
  nowIso,
  validateProductOrderWithSubscriberAccount,
  validateShoppingCart
} from "./domain.js";

const TEMPLATE_STATUSES = ["active", "retired"];
const TEMPLATE_CHANNELS = ["USSD", "SMS", "ALL"];
const DISPATCH_STATUSES = ["pending", "sent", "failed", "skipped"];
const CURRENCY_STATUSES = ["active", "retired"];
const STAFF_LINK_STATUSES = ["active", "inactive"];
const PURCHASE_POLICY_ALIASES = {
  SELF_ONE_OFF: "one-off",
  SELF_AUTO_RENEWAL: "auto-renewal",
  GIFT: "gift"
};

function ensureMap(db, name) {
  if (!db[name]) db[name] = new Map();
  return db[name];
}

function requireField(value, field) {
  if (value === undefined || value === null || value === "") {
    fail(400, "REQUIRED_FIELD", `${field} is required.`, field);
  }
}

function assertOneOf(value, allowed, field) {
  if (!allowed.includes(value)) fail(422, "INVALID_ENUM", `${field} must be one of: ${allowed.join(", ")}.`, field);
}

export function normalizePurchasePolicy(input = "SELF_ONE_OFF") {
  if (typeof input === "string") return PURCHASE_POLICY_ALIASES[input] || input;
  return {
    ...input,
    type: PURCHASE_POLICY_ALIASES[input.type] || input.type || "one-off"
  };
}

export function createCommunicationTemplate(db, body = {}) {
  requireField(body.name, "name");
  requireField(body.eventType, "eventType");
  requireField(body.bodyTemplate, "bodyTemplate");
  const channelType = body.channelType || "ALL";
  assertOneOf(channelType, TEMPLATE_CHANNELS, "channelType");
  const timestamp = nowIso();
  const template = {
    id: randomUUID(),
    name: body.name,
    version: 1,
    eventType: body.eventType,
    channelType,
    locale: body.locale || "en",
    offeringId: body.offeringId || null,
    bodyTemplate: body.bodyTemplate,
    maxLength: body.maxLength === undefined ? null : Number(body.maxLength),
    appendPromo: Boolean(body.appendPromo),
    promoText: body.promoText || "",
    status: body.status || "active",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  assertOneOf(template.status, TEMPLATE_STATUSES, "status");
  ensureMap(db, "communicationTemplates").set(template.id, template);
  return template;
}

export function listCommunicationTemplates(db, query = {}) {
  return [...ensureMap(db, "communicationTemplates").values()]
    .filter((item) => !query.eventType || item.eventType === query.eventType)
    .filter((item) => !query.channelType || item.channelType === query.channelType)
    .filter((item) => !query.offeringId || item.offeringId === query.offeringId)
    .filter((item) => !query.status || item.status === query.status);
}

export function getCommunicationTemplate(db, templateId) {
  const template = ensureMap(db, "communicationTemplates").get(templateId);
  if (!template) fail(404, "TEMPLATE_NOT_FOUND", "CommunicationTemplate was not found.", "templateId");
  return template;
}

export function updateCommunicationTemplate(db, templateId, body = {}) {
  const template = getCommunicationTemplate(db, templateId);
  for (const field of ["name", "eventType", "channelType", "locale", "offeringId", "bodyTemplate", "appendPromo", "promoText", "status"]) {
    if (body[field] !== undefined) template[field] = body[field];
  }
  if (body.maxLength !== undefined) template.maxLength = body.maxLength === null ? null : Number(body.maxLength);
  assertOneOf(template.channelType, TEMPLATE_CHANNELS, "channelType");
  assertOneOf(template.status, TEMPLATE_STATUSES, "status");
  template.version += 1;
  template.updatedAt = nowIso();
  return template;
}

export function retireCommunicationTemplate(db, templateId) {
  return updateCommunicationTemplate(db, templateId, { status: "retired" });
}

function templateScore(template, event, channelType, offeringId) {
  if (template.status !== "active" || template.eventType !== event.eventType) return -1;
  const channelMatches = template.channelType === channelType || template.channelType === "ALL";
  if (!channelMatches) return -1;
  if (template.offeringId && template.offeringId !== offeringId) return -1;
  const offeringScore = template.offeringId ? 20 : 0;
  const channelScore = template.channelType === channelType ? 10 : 0;
  return offeringScore + channelScore;
}

export function selectCommunicationTemplate(db, event, channelType, offeringId = null) {
  return listCommunicationTemplates(db)
    .map((template) => ({ template, score: templateScore(template, event, channelType, offeringId) }))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => b.score - a.score || b.template.version - a.template.version)[0]?.template || null;
}

export function createCurrencyConfig(db, body = {}) {
  requireField(body.currencyCode, "currencyCode");
  requireField(body.symbol, "symbol");
  const code = String(body.currencyCode).toUpperCase();
  const configs = ensureMap(db, "currencyConfigs");
  if (configs.has(code)) fail(409, "CURRENCY_ALREADY_EXISTS", "CurrencyConfig already exists.", "currencyCode");
  if (body.isDefault) {
    for (const config of configs.values()) config.isDefault = false;
  }
  const timestamp = nowIso();
  const config = {
    id: randomUUID(),
    currencyCode: code,
    symbol: body.symbol,
    minorUnit: Number(body.minorUnit ?? 2),
    isDefault: Boolean(body.isDefault) || configs.size === 0,
    status: body.status || "active",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  assertOneOf(config.status, CURRENCY_STATUSES, "status");
  configs.set(code, config);
  return config;
}

export function listCurrencyConfigs(db, query = {}) {
  return [...ensureMap(db, "currencyConfigs").values()]
    .filter((item) => !query.status || item.status === query.status);
}

export function getCurrencyConfig(db, code) {
  const config = ensureMap(db, "currencyConfigs").get(String(code).toUpperCase());
  if (!config) fail(404, "CURRENCY_NOT_FOUND", "CurrencyConfig was not found.", "currencyCode");
  return config;
}

export function getDefaultCurrencyConfig(db) {
  return listCurrencyConfigs(db, { status: "active" }).find((item) => item.isDefault) || null;
}

export function updateCurrencyConfig(db, code, body = {}) {
  const config = getCurrencyConfig(db, code);
  if (body.isDefault) {
    for (const item of ensureMap(db, "currencyConfigs").values()) item.isDefault = false;
  }
  for (const field of ["symbol", "isDefault", "status"]) {
    if (body[field] !== undefined) config[field] = body[field];
  }
  if (body.minorUnit !== undefined) config.minorUnit = Number(body.minorUnit);
  assertOneOf(config.status, CURRENCY_STATUSES, "status");
  config.updatedAt = nowIso();
  return config;
}

export function retireCurrencyConfig(db, code) {
  const config = getCurrencyConfig(db, code);
  if (config.isDefault) fail(422, "CANNOT_RETIRE_DEFAULT_CURRENCY", "Default currency cannot be retired.", "currencyCode");
  return updateCurrencyConfig(db, code, { status: "retired" });
}

function pad(value) {
  return String(value).padStart(2, "0");
}

export function formatDate(value, format = process.env.NOTIFICATION_DATE_FORMAT || "DD-MM-YYYY HH:MM:SS") {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return format
    .replace("YYYY", String(date.getUTCFullYear()))
    .replace("DD", pad(date.getUTCDate()))
    .replace("SS", pad(date.getUTCSeconds()))
    .replace("HH", pad(date.getUTCHours()))
    .replace("MM", pad(date.getUTCMonth() + 1))
    .replace("MM", pad(date.getUTCMinutes()));
}

export function formatDataVolume(megabytes) {
  const value = Number(megabytes || 0);
  if (value >= 1024) return `${(value / 1024).toFixed(2)} GB`;
  if (value >= 1) return `${Math.round(value)} MB`;
  return `${Math.round(value * 1024)} KB`;
}

function formatMoney(amount, currencyConfig) {
  const minorUnit = Number(currencyConfig?.minorUnit ?? 2);
  return `${currencyConfig?.symbol || ""}${Number(amount || 0).toFixed(minorUnit)}`;
}

function failureReasonText(code) {
  return {
    INSUFFICIENT_BALANCE: "Insufficient balance",
    CS_DEBIT_FAILED: "Charging failed",
    CS_ATTACH_FAILED: "Offer activation failed",
    MULTI_PURCHASE_NOT_ALLOWED: "Bundle already active",
    CS_TIMEOUT: "Service temporarily unavailable"
  }[code] || "Service error";
}

async function liveBalanceData(event, template, chargingSystemClient) {
  const needsBalance = /\{\{(?:mainBalance|aggregateBalance|closestExpiry|da\[[^\]]+\]\.(?:balance|expiry))\}\}/.test(template.bodyTemplate);
  if (!needsBalance || !chargingSystemClient?.fetchSubscriberAccount) return null;
  try {
    const result = await chargingSystemClient.fetchSubscriberAccount({
      subscriberId: event.recipientId || event.subscriberId,
      transactionRef: event.id,
      requestType: "GBAD"
    });
    return result.status === "failed" ? null : result;
  } catch {
    return null;
  }
}

function inventoryForEvent(db, event) {
  const inventoryId = event.payload?.inventoryId || event.payload?.subscriptionId;
  if (inventoryId && db.productInventories.has(inventoryId)) return getProductInventory(db, inventoryId);
  return [...db.productInventories.values()].find((item) => item.productOrderId === event.orderId) || null;
}

function renderContext(db, event, channelType, balanceData) {
  const order = event.orderId ? db.productOrders.get(event.orderId) : null;
  const inventory = inventoryForEvent(db, event);
  const offering = inventory ? db.productOfferings.get(inventory.productOfferingId) : order?.items?.[0] ? db.productOfferings.get(order.items[0].productOfferingId) : null;
  const charging = order ? getChargingResolutionRecord(db, order.id) : null;
  const currencyConfig = order?.currency ? getCurrencyConfig(db, order.currency) : getDefaultCurrencyConfig(db);
  const daBalances = balanceData?.daBalances || [];
  const aggregate = daBalances.reduce((sum, da) => sum + Number(da.balance || 0), 0);
  const expiries = daBalances.map((da) => da.expiryDate || da.expiry).filter(Boolean).sort();
  return {
    subscriberId: event.subscriberId,
    offeringName: offering?.name || "",
    startDate: inventory?.startDate || inventory?.activatedAt,
    endDate: inventory?.endDate || inventory?.expiresAt,
    activatedAt: inventory?.activatedAt,
    totalAmount: formatMoney(charging?.totalAmount ?? order?.totalAmount ?? 0, currencyConfig),
    chargedAmount: formatMoney(charging?.chargedAmount ?? order?.totalAmount ?? 0, currencyConfig),
    discountAmount: formatMoney(charging?.appliedDiscount ?? 0, currencyConfig),
    currency: currencyConfig?.symbol || order?.currency || "",
    channelId: event.channelId,
    failureReason: failureReasonText(event.payload?.failureReason || event.failureReasonCode || order?.failureReasonCode),
    renewalDate: inventory?.endDate || inventory?.expiresAt,
    beneficiaryId: order?.beneficiaryId || inventory?.beneficiaryId || "",
    sponsorId: order?.sponsorId || inventory?.sponsorId || "",
    mainBalance: balanceData ? formatMoney(balanceData.mainBalance, currencyConfig) : "N/A",
    mainBalanceCurrency: balanceData?.currency || currencyConfig?.currencyCode || "",
    aggregateBalance: formatDataVolume(aggregate),
    closestExpiry: expiries[0] || null,
    aggregateDataBalance: event.payload?.aggregateDataBalance || formatDataVolume(aggregate),
    activeSubscriptionCount: event.payload?.activeSubscriptionCount ?? "",
    dataVolume: offering ? formatDataVolume(Number(db.productSpecifications.get(offering.productSpecificationId)?.characteristics.find((item) => item.name === "dataVolume")?.value || 0) * 1024) : "",
    validityDays: offering ? db.productSpecifications.get(offering.productSpecificationId)?.characteristics.find((item) => item.name === "validityPeriod")?.value || "" : "",
    bonusDeltaMB: event.payload?.bonusDeltaMB === undefined ? "" : formatDataVolume(event.payload.bonusDeltaMB),
    preProvisionBalance: event.payload?.preProvisionBalance === undefined ? "" : formatDataVolume(event.payload.preProvisionBalance),
    postProvisionBalance: event.payload?.postProvisionBalance === undefined ? "" : formatDataVolume(event.payload.postProvisionBalance),
    transferId: event.payload?.transferId || "",
    transferAmount: event.payload?.transferAmount === undefined ? "" : formatMoney(event.payload.transferAmount, currencyConfig),
    transferCurrency: event.payload?.transferCurrency || currencyConfig?.currencyCode || "",
    senderSubscriberId: event.payload?.senderSubscriberId || "",
    recipientSubscriberId: event.payload?.recipientSubscriberId || "",
    transferStatus: event.payload?.transferStatus || "",
    transferCompletedAt: event.payload?.transferCompletedAt || "",
    daBalances
  };
}

function simplePlaceholderValue(name, context, dateFormat) {
  const daMatch = /^da\[([^\]]+)\]\.(balance|expiry)$/.exec(name);
  if (daMatch) {
    const da = context.daBalances.find((item) => item.daId === daMatch[1]);
    if (!da) return "N/A";
    return daMatch[2] === "balance" ? formatDataVolume(da.balance) : formatDate(da.expiryDate || da.expiry, dateFormat);
  }
  const inlineFormat = /^(\w+)\|format:(.+)$/.exec(name);
  if (inlineFormat) return formatDate(context[inlineFormat[1]], inlineFormat[2]);
  if (["startDate", "endDate", "activatedAt", "renewalDate", "closestExpiry", "transferCompletedAt"].includes(name)) return formatDate(context[name], dateFormat);
  return context[name] ?? "N/A";
}

function evaluateExpression(expression) {
  const sanitized = expression.replace(/[^0-9+*/().\s-]/g, "");
  if (!sanitized.trim()) return "N/A";
  try {
    const result = Function(`"use strict"; return (${sanitized});`)();
    if (!Number.isFinite(result)) return "N/A";
    return String(Number(result.toFixed(2)));
  } catch {
    return "EXPR_ERROR";
  }
}

export async function renderTemplate(db, template, event, options = {}) {
  const balanceData = await liveBalanceData(event, template, options.chargingSystemClient);
  const context = renderContext(db, event, options.channelType || "SMS", balanceData);
  const dateFormat = options.dateFormat || process.env.NOTIFICATION_DATE_FORMAT || "DD-MM-YYYY HH:MM:SS";
  let body = template.bodyTemplate.replace(/\{\{expr:\s*([^}]+(?:\}\}[^}]*)*)\}\}/g, (_match, expr) => {
    const replaced = expr.replace(/\{\{([^}]+)\}\}/g, (_placeholder, name) => String(simplePlaceholderValue(name.trim(), context, dateFormat)).replace(/[^0-9.-]/g, ""));
    return evaluateExpression(replaced);
  });
  body = body.replace(/\{\{([^}]+)\}\}/g, (_match, name) => simplePlaceholderValue(name.trim(), context, dateFormat));
  const promo = template.appendPromo && template.promoText ? ` ${template.promoText}` : "";
  const withPromo = `${body}${promo}`;
  return limitMessage(withPromo, template.maxLength || (template.channelType === "SMS" ? Number(process.env.NOTIFICATION_SMS_MAX_LENGTH || 160) : null), template.appendPromo ? promo : "");
}

function limitMessage(body, maxLength, promo = "") {
  if (!maxLength || body.length <= maxLength) return body;
  const base = promo && body.endsWith(promo) ? body.slice(0, -promo.length) : body;
  const candidate = base.length <= maxLength ? base : base.slice(0, Math.max(0, maxLength - 3));
  const lastSpace = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, lastSpace > 20 ? lastSpace : candidate.length).trimEnd()}...`;
}

export function createNotificationDispatchRecord(db, body = {}) {
  requireField(body.notificationEventId, "notificationEventId");
  const timestamp = nowIso();
  const record = {
    id: randomUUID(),
    notificationEventId: body.notificationEventId,
    templateId: body.templateId || null,
    recipientId: body.recipientId,
    channelType: body.channelType,
    renderedBody: body.renderedBody || "",
    status: body.status || "pending",
    dispatchedAt: body.dispatchedAt || null,
    failureReason: body.failureReason || null,
    gatewayRef: body.gatewayRef || null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  assertOneOf(record.status, DISPATCH_STATUSES, "status");
  ensureMap(db, "notificationDispatchRecords").set(record.id, record);
  return record;
}

export function listNotificationDispatchRecords(db, query = {}) {
  return [...ensureMap(db, "notificationDispatchRecords").values()]
    .filter((item) => !query.status || item.status === query.status)
    .filter((item) => !query.subscriberId || item.recipientId === query.subscriberId);
}

export function getNotificationDispatchRecord(db, dispatchId) {
  const record = ensureMap(db, "notificationDispatchRecords").get(dispatchId);
  if (!record) fail(404, "DISPATCH_RECORD_NOT_FOUND", "NotificationDispatchRecord was not found.", "dispatchId");
  return record;
}

export async function dispatchNotificationEvent(db, eventId, options = {}) {
  const event = ensureMap(db, "notificationEvents").get(eventId);
  if (!event) fail(404, "NOTIFICATION_EVENT_NOT_FOUND", "NotificationEvent was not found.", "eventId");
  const channel = db.channels?.size ? getChannel(db, event.channelId) : { type: options.channelType || "SMS" };
  const channelType = options.channelType || channel.type;
  if (!["USSD", "SMS"].includes(channelType)) {
    return createNotificationDispatchRecord(db, {
      notificationEventId: event.id,
      recipientId: event.recipientId || event.subscriberId,
      channelType,
      status: "skipped",
      failureReason: "CHANNEL_DOES_NOT_SUPPORT_PUSH"
    });
  }
  const inventory = inventoryForEvent(db, event);
  const template = selectCommunicationTemplate(db, event, channelType, inventory?.productOfferingId || null);
  if (!template) {
    return createNotificationDispatchRecord(db, {
      notificationEventId: event.id,
      recipientId: event.recipientId || event.subscriberId,
      channelType,
      status: "skipped",
      failureReason: "NO_TEMPLATE_FOUND"
    });
  }
  const renderedBody = await renderTemplate(db, template, event, { ...options, channelType });
  const sendResult = options.gatewayClient?.send
    ? await options.gatewayClient.send({ recipientId: event.recipientId || event.subscriberId, channelType, body: renderedBody })
    : { status: "sent", gatewayRef: `mock-${randomUUID()}` };
  return createNotificationDispatchRecord(db, {
    notificationEventId: event.id,
    templateId: template.id,
    recipientId: event.recipientId || event.subscriberId,
    channelType,
    renderedBody,
    status: sendResult.status === "failed" ? "failed" : "sent",
    dispatchedAt: nowIso(),
    failureReason: sendResult.failureReason || null,
    gatewayRef: sendResult.gatewayRef || null
  });
}

export async function dispatchPendingNotifications(db, options = {}) {
  const events = listNotificationEvents(db, { status: "pending" });
  const records = [];
  for (const event of events) {
    records.push(await dispatchNotificationEvent(db, event.id, options));
  }
  return records;
}

export function createStaffNumberLink(db, body = {}, options = {}) {
  requireField(body.primaryNumber, "primaryNumber");
  requireField(body.secondaryNumber, "secondaryNumber");
  requireField(body.offeringId, "offeringId");
  if (body.primaryNumber === body.secondaryNumber) fail(422, "SELF_LINK_NOT_ALLOWED", "Primary and secondary numbers must differ.", "secondaryNumber");
  const links = ensureMap(db, "staffNumberLinks");
  const duplicate = [...links.values()].find((link) => link.secondaryNumber === body.secondaryNumber && link.status === "active");
  if (duplicate) fail(422, "SECONDARY_NUMBER_ALREADY_LINKED", "Secondary number is already linked.", "secondaryNumber");
  if (options.primaryServiceClass && options.primaryServiceClass !== "STAFF") {
    fail(422, "PRIMARY_NOT_STAFF", "Primary number must belong to the STAFF service class.", "primaryNumber");
  }
  const offering = getProductOffering(db, body.offeringId);
  const max = Number(offering.maxSecondaryNumbers ?? offering.maxGiftBeneficiaries ?? 0);
  const activeForPrimary = [...links.values()].filter((link) => link.primaryNumber === body.primaryNumber && link.offeringId === body.offeringId && link.status === "active");
  if (max > 0 && activeForPrimary.length >= max) fail(422, "MAX_SECONDARY_NUMBERS_EXCEEDED", "Maximum secondary numbers exceeded.", "secondaryNumber");
  const timestamp = nowIso();
  const link = {
    id: randomUUID(),
    primaryNumber: body.primaryNumber,
    secondaryNumber: body.secondaryNumber,
    offeringId: body.offeringId,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    linkedBy: body.linkedBy || "system"
  };
  links.set(link.id, link);
  return link;
}

export function listStaffNumberLinks(db, query = {}) {
  return [...ensureMap(db, "staffNumberLinks").values()]
    .filter((item) => !query.primaryNumber || item.primaryNumber === query.primaryNumber)
    .filter((item) => !query.secondaryNumber || item.secondaryNumber === query.secondaryNumber)
    .filter((item) => !query.offeringId || item.offeringId === query.offeringId)
    .filter((item) => !query.status || item.status === query.status);
}

export function deactivateStaffNumberLink(db, linkId) {
  const link = ensureMap(db, "staffNumberLinks").get(linkId);
  if (!link) fail(404, "STAFF_LINK_NOT_FOUND", "StaffNumberLink was not found.", "linkId");
  link.status = "inactive";
  link.updatedAt = nowIso();
  return link;
}

export function applyStaffSegmentOverride(db, subscriberAccount, offeringId) {
  const link = listStaffNumberLinks(db, {
    secondaryNumber: subscriberAccount.subscriberId,
    offeringId,
    status: "active"
  })[0];
  if (!link) return subscriberAccount;
  const staffSegment = [...ensureMap(db, "customerSegments").values()].find((segment) => segment.status === "active" && segment.name === "STAFF");
  if (!staffSegment) return subscriberAccount;
  subscriberAccount.resolvedSegmentId = staffSegment.id;
  subscriberAccount.resolvedViaStaffLink = true;
  subscriberAccount.staffLinkId = link.id;
  return subscriberAccount;
}

export async function subscribeCart(db, cartId, options = {}) {
  const cart = getShoppingCart(db, cartId, false);
  const channel = db.channels?.size ? getChannel(db, cart.channelId) : { type: options.channelType || "USSD" };
  if (!["USSD", "SMS"].includes(channel.type)) {
    fail(405, "ENDPOINT_NOT_AVAILABLE_FOR_CHANNEL_TYPE", "Combined subscribe endpoint is available only for USSD and SMS channels.", "channelId");
  }
  const validation = validateShoppingCart(db, cartId, options.validationBody || {});
  if (validation.errors.length > 0) {
    fail(422, validation.errors[0].reasonCode, "Cart validation failed.", "cart");
  }
  const order = checkoutShoppingCart(db, cartId);
  const account = options.subscriberAccount || {
    id: randomUUID(),
    orderId: order.id,
    subscriberId: order.subscriberId,
    serviceClass: "PREPAID",
    segment: "CONSUMER",
    mainBalance: Number.MAX_SAFE_INTEGER,
    currency: order.currency,
    daBalances: [],
    psoFlags: "",
    offerIds: []
  };
  if (!db.subscriberAccounts.has(account.id)) db.subscriberAccounts.set(account.id, account);
  validateProductOrderWithSubscriberAccount(db, order.id, account);
  const completed = executeProductOrderFulfillment(db, order.id, options.fulfillmentBody || {});
  const dispatches = await dispatchPendingNotifications(db, { channelType: channel.type, gatewayClient: options.gatewayClient });
  return {
    orderId: completed.id,
    status: completed.status,
    notificationSent: dispatches.some((record) => record.status === "sent")
  };
}
