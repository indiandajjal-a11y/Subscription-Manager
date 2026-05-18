import { randomUUID } from "node:crypto";
import { fail } from "./errors.js";
import {
  createTerminateOrder,
  executeProductOrderFulfillment,
  getProductOffering,
  getProductOrder,
  getSubscriberAccountByOrder,
  listProductInventory,
  nowIso,
  validateProductOrder
} from "./domain.js";
import { formatDataVolume, formatDate, getDefaultCurrencyConfig, renderTemplate, selectCommunicationTemplate } from "./sprint7.js";

const PARTY_STATUSES = ["active", "decommissioned"];
const CLEANUP_STATUSES = ["pending", "inProgress", "completed", "failed"];
const TICK_RULE_STATUSES = ["active", "inactive"];
const TICK_TRIGGER_TYPES = ["ADD_TICK", "REMOVE_TICK"];

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

function recordNotification(db, eventType, body = {}) {
  const timestamp = nowIso();
  const notification = {
    id: randomUUID(),
    eventType,
    orderId: body.orderId || null,
    subscriberId: body.subscriberId,
    channelId: body.channelId || "CRM",
    recipientType: body.recipientType || "SELF",
    recipientId: body.recipientId || body.subscriberId,
    orderType: body.orderType || null,
    payload: body.payload || {},
    status: "pending",
    createdAt: timestamp
  };
  ensureMap(db, "notificationEvents").set(notification.id, notification);
  const order = body.orderId ? db.productOrders.get(body.orderId) : null;
  if (order) order.notificationEvents = [...(order.notificationEvents || []), notification];
  return notification;
}

export function createParty(db, body = {}) {
  requireField(body.subscriberId, "subscriberId");
  const parties = ensureMap(db, "parties");
  const existing = [...parties.values()].find((party) => party.subscriberId === body.subscriberId);
  if (existing) fail(409, "PARTY_ALREADY_EXISTS", "Party already exists for subscriberId.", "subscriberId");
  const timestamp = nowIso();
  const party = {
    id: randomUUID(),
    subscriberId: body.subscriberId,
    status: body.status || "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    decommissionedAt: null,
    decommissionedBy: null,
    decommissionReason: null
  };
  assertOneOf(party.status, PARTY_STATUSES, "status");
  parties.set(party.id, party);
  return party;
}

export function findPartyBySubscriberId(db, subscriberId) {
  return [...ensureMap(db, "parties").values()].find((party) => party.subscriberId === subscriberId) || null;
}

export function listParties(db, query = {}) {
  return [...ensureMap(db, "parties").values()]
    .filter((party) => !query.subscriberId || party.subscriberId === query.subscriberId)
    .filter((party) => !query.status || party.status === query.status);
}

export function ensureSubscriberNotDecommissioned(db, subscriberId) {
  const party = findPartyBySubscriberId(db, subscriberId);
  if (party?.status === "decommissioned") {
    fail(422, "SUBSCRIBER_DECOMMISSIONED", `Subscriber ${subscriberId} has been decommissioned.`, "subscriberId");
  }
}

function decommissionParty(db, subscriberId, body = {}) {
  const party = findPartyBySubscriberId(db, subscriberId) || createParty(db, { subscriberId });
  if (party.status === "decommissioned") {
    fail(409, "SUBSCRIBER_ALREADY_DECOMMISSIONED", `Subscriber ${subscriberId} has already been decommissioned.`, "subscriberId");
  }
  const timestamp = nowIso();
  party.status = "decommissioned";
  party.decommissionedAt = timestamp;
  party.decommissionedBy = body.decommissionedBy || body.requestedBy || "CRM";
  party.decommissionReason = body.decommissionReason || null;
  party.updatedAt = timestamp;
  return party;
}

function offlineCleanupClient(options = {}) {
  return options.offlineCleanupClient || {
    cleanup: async () => ({ status: "success", cleanupRef: `offline-${randomUUID()}`, failureReason: null })
  };
}

export async function createDormantCleanupRequest(db, body = {}, options = {}) {
  requireField(body.subscriberId, "subscriberId");
  const channelType = options.channelType || body.channelType || "CRM";
  if (channelType !== "CRM") fail(403, "CLEANUP_NOT_AUTHORIZED", "Dormant cleanup is restricted to CRM channels.", "channelType");
  const existingParty = findPartyBySubscriberId(db, body.subscriberId);
  if (existingParty?.status === "decommissioned") {
    fail(409, "SUBSCRIBER_ALREADY_DECOMMISSIONED", `Subscriber ${body.subscriberId} has already been decommissioned.`, "subscriberId");
  }
  const timestamp = nowIso();
  const request = {
    id: randomUUID(),
    subscriberId: body.subscriberId,
    requestedBy: body.requestedBy || options.channelId || "CRM",
    requestedAt: timestamp,
    status: "inProgress",
    subscriptionsTerminated: 0,
    partyDecommissioned: false,
    offlineCleanupInvoked: false,
    completedAt: null,
    failureReason: null,
    terminationFailures: []
  };
  assertOneOf(request.status, CLEANUP_STATUSES, "status");
  ensureMap(db, "dormantCleanupRequests").set(request.id, request);

  const activeInventories = listProductInventory(db, { subscriberId: body.subscriberId, status: "active" });
  for (const inventory of activeInventories) {
    try {
      const terminate = createTerminateOrder(db, inventory.productOrderId || inventory.orderId, {
        subscriberId: body.subscriberId,
        channelId: body.channelId || "CRM",
        cancellationReasonCode: "DORMANT_CLEANUP"
      });
      terminate.subscriptionId = inventory.id;
      validateProductOrder(db, terminate.id, { csOfferStatus: "attached" });
      executeProductOrderFulfillment(db, terminate.id, { csOfferStatus: "attached" });
      request.subscriptionsTerminated += 1;
    } catch (error) {
      request.terminationFailures.push({
        subscriptionId: inventory.id,
        reasonCode: error.reasonCode || "TERMINATION_FAILED",
        message: error.message
      });
    }
  }

  for (const schedule of ensureMap(db, "renewalSchedules").values()) {
    const inventoryMatches = activeInventories.some((inventory) => inventory.id === schedule.subscriptionId || inventory.id === schedule.inventoryId);
    if (schedule.status === "pending" && (schedule.subscriberId === body.subscriberId || inventoryMatches)) {
      schedule.status = "cancelled";
      schedule.updatedAt = nowIso();
    }
  }

  const party = decommissionParty(db, body.subscriberId, {
    requestedBy: request.requestedBy,
    decommissionReason: body.decommissionReason
  });
  request.partyDecommissioned = party.status === "decommissioned";

  const cleanupResult = await offlineCleanupClient(options).cleanup({
    subscriberId: body.subscriberId,
    transactionRef: request.id
  });
  request.offlineCleanupInvoked = cleanupResult.status !== "failed";
  request.offlineCleanupResult = cleanupResult;
  request.status = request.partyDecommissioned ? "completed" : "failed";
  request.completedAt = nowIso();
  request.failureReason = request.status === "failed" ? "PARTY_DECOMMISSION_FAILED" : null;
  recordNotification(db, "SUBSCRIBER_DECOMMISSIONED", {
    subscriberId: body.subscriberId,
    channelId: body.channelId || "CRM",
    payload: { cleanupRequestId: request.id, subscriptionsTerminated: request.subscriptionsTerminated }
  });
  return request;
}

export function getDormantCleanupRequest(db, requestId) {
  const request = ensureMap(db, "dormantCleanupRequests").get(requestId);
  if (!request) fail(404, "DORMANT_CLEANUP_NOT_FOUND", "DormantCleanupRequest was not found.", "requestId");
  return request;
}

export function listDormantCleanupRequests(db, query = {}) {
  return [...ensureMap(db, "dormantCleanupRequests").values()]
    .filter((request) => !query.subscriberId || request.subscriberId === query.subscriberId)
    .filter((request) => !query.status || request.status === query.status);
}

function daBalancesFromCs(csData) {
  return (csData?.daBalances || []).map((da) => ({
    daId: da.daId,
    balance: Number(da.balance || 0),
    expiry: da.expiry || da.expiryDate || null
  }));
}

function aggregateDataBalance(daBalances) {
  return formatDataVolume(daBalances.reduce((sum, da) => sum + Number(da.balance || 0), 0));
}

function closestExpiry(daBalances) {
  return daBalances.map((da) => da.expiry).filter(Boolean).sort()[0] || null;
}

function activeSubscriptionSummary(db, inventory) {
  const offering = getProductOffering(db, inventory.productOfferingId);
  const spec = db.productSpecifications.get(offering.productSpecificationId);
  const dataVolume = spec?.characteristics.find((item) => item.name === "dataVolume");
  const volumeMb = dataVolume?.unit === "GB" ? Number(dataVolume.value || 0) * 1024 : Number(dataVolume?.value || 0);
  return {
    subscriptionId: inventory.id,
    offeringName: offering.name,
    dataVolume: formatDataVolume(volumeMb),
    endDate: formatDate(inventory.endDate || inventory.expiresAt),
    status: "active"
  };
}

function renderEachBlocks(templateBody, context) {
  return templateBody.replace(/\{\{#each activeSubscriptions\}\}([\s\S]*?)\{\{\/each\}\}/g, (_match, block) =>
    context.activeSubscriptions.map((subscription, index) =>
      block.replace(/\{\{([^}]+)\}\}/g, (_token, name) => {
        const key = name.trim();
        if (key === "index") return String(index + 1);
        return subscription[key] ?? "";
      }).trim()
    ).join("\n")
  );
}

function formatMoney(amount, currencyCode, db) {
  const currency = [...ensureMap(db, "currencyConfigs").values()].find((config) => config.currencyCode === currencyCode);
  return `${currency?.symbol || ""}${Number(amount || 0).toFixed(Number(currency?.minorUnit ?? 2))}`;
}

async function renderBalanceCheckTemplate(db, template, event, context, options = {}) {
  let bodyTemplate = renderEachBlocks(template.bodyTemplate, context);
  const mainBalance = context.liveBalances.mainBalance === "N/A"
    ? "N/A"
    : formatMoney(context.liveBalances.mainBalance, context.liveBalances.currency, db);
  bodyTemplate = bodyTemplate
    .replaceAll("{{mainBalance}}", mainBalance)
    .replaceAll("{{aggregateBalance}}", context.liveBalances.aggregateDataBalance)
    .replaceAll("{{aggregateDataBalance}}", context.liveBalances.aggregateDataBalance)
    .replaceAll("{{closestExpiry}}", context.liveBalances.closestExpiry)
    .replaceAll("{{activeSubscriptionCount}}", String(context.activeSubscriptions.length))
    .replaceAll("{{asOf}}", context.asOf);
  const expandedTemplate = { ...template, bodyTemplate };
  return renderTemplate(db, expandedTemplate, event, { ...options, chargingSystemClient: null });
}

export async function getConsolidatedBalanceCheck(db, subscriberId, query = {}, options = {}) {
  requireField(subscriberId, "subscriberId");
  ensureSubscriberNotDecommissioned(db, subscriberId);
  const requestId = randomUUID();
  const activeInventories = listProductInventory(db, { subscriberId, status: "active" })
    .sort((a, b) => String(a.endDate || a.expiresAt || "").localeCompare(String(b.endDate || b.expiresAt || "")));
  let csDataAvailable = true;
  let csData = null;
  try {
    csData = options.chargingSystemClient?.fetchSubscriberAccount
      ? await options.chargingSystemClient.fetchSubscriberAccount({
        subscriberId,
        requestType: "GBAD",
        transactionRef: `BALANCE_CHECK-${requestId}`
      })
      : { status: "success", subscriberId, mainBalance: 0, currency: getDefaultCurrencyConfig(db)?.currencyCode || "NGN", daBalances: [] };
    if (csData.status === "failed") csDataAvailable = false;
  } catch {
    csDataAvailable = false;
  }
  if (!csDataAvailable) csData = { mainBalance: null, currency: getDefaultCurrencyConfig(db)?.currencyCode || "NGN", daBalances: [] };
  const daBalances = daBalancesFromCs(csData);
  const asOf = nowIso();
  const result = {
    subscriberId,
    currency: csData.currency || getDefaultCurrencyConfig(db)?.currencyCode || "NGN",
    activeSubscriptions: activeInventories.map((inventory) => activeSubscriptionSummary(db, inventory)),
    liveBalances: {
      mainBalance: csData.mainBalance ?? "N/A",
      currency: csData.currency || getDefaultCurrencyConfig(db)?.currencyCode || "NGN",
      daBalances,
      aggregateDataBalance: csDataAvailable ? aggregateDataBalance(daBalances) : "N/A",
      closestExpiry: csDataAvailable ? formatDate(closestExpiry(daBalances)) : "N/A",
      fetchedAt: asOf
    },
    asOf,
    metadata: activeInventories.length === 0 ? { reasonCode: "NO_ACTIVE_SUBSCRIPTIONS" } : {}
  };
  if (query.format === "json") return { ...result, csDataAvailable };

  const channelType = query.channelType || options.channelType || "USSD";
  const event = {
    id: requestId,
    eventType: "BALANCE_CHECK",
    subscriberId,
    recipientId: subscriberId,
    channelId: query.channelId || options.channelId || channelType,
    payload: {
      aggregateDataBalance: result.liveBalances.aggregateDataBalance,
      activeSubscriptionCount: result.activeSubscriptions.length
    }
  };
  const template = selectCommunicationTemplate(db, event, channelType, activeInventories[0]?.productOfferingId || null);
  if (!template) return { ...result, renderedBody: null, templateId: null, csDataAvailable };
  return {
    subscriberId,
    renderedBody: await renderBalanceCheckTemplate(db, template, event, result, {
      channelType,
      chargingSystemClient: options.chargingSystemClient
    }),
    asOf,
    templateId: template.id,
    csDataAvailable,
    activeSubscriptions: result.activeSubscriptions,
    metadata: result.metadata
  };
}

export function createBonusDetectionConfig(db, productOfferingId, body = {}) {
  getProductOffering(db, productOfferingId);
  requireField(body.bonusDataSourceDaId, "bonusDataSourceDaId");
  const timestamp = nowIso();
  const config = {
    id: randomUUID(),
    productOfferingId,
    bonusDetectionEnabled: body.bonusDetectionEnabled ?? true,
    bonusDataSourceDaId: body.bonusDataSourceDaId,
    bonusThresholdMB: Number(body.bonusThresholdMB ?? 1),
    notificationEventType: body.notificationEventType || "DATA_BONUS_AWARDED",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  ensureMap(db, "bonusDetectionConfigs").set(productOfferingId, config);
  return config;
}

export function listBonusDetectionConfigs(db, query = {}) {
  return [...ensureMap(db, "bonusDetectionConfigs").values()]
    .filter((config) => !query.productOfferingId || config.productOfferingId === query.productOfferingId);
}

export function getBonusDetectionConfig(db, productOfferingId) {
  const config = ensureMap(db, "bonusDetectionConfigs").get(productOfferingId);
  if (!config) fail(404, "BONUS_CONFIG_NOT_FOUND", "BonusDetectionConfig was not found.", "productOfferingId");
  return config;
}

export function updateBonusDetectionConfig(db, productOfferingId, body = {}) {
  const config = getBonusDetectionConfig(db, productOfferingId);
  for (const field of ["bonusDetectionEnabled", "bonusDataSourceDaId", "notificationEventType"]) {
    if (body[field] !== undefined) config[field] = body[field];
  }
  if (body.bonusThresholdMB !== undefined) config.bonusThresholdMB = Number(body.bonusThresholdMB);
  config.updatedAt = nowIso();
  return config;
}

function daBalance(account, daId) {
  return Number((account?.daBalances || []).find((da) => da.daId === daId)?.balance || 0);
}

export async function runBonusDetectionForOrder(db, orderId, options = {}) {
  const order = getProductOrder(db, orderId);
  if (order.status !== "completed" || !["provision", "gift"].includes(order.orderType)) return [];
  const records = [];
  for (const item of order.items) {
    const config = ensureMap(db, "bonusDetectionConfigs").get(item.productOfferingId);
    if (!config?.bonusDetectionEnabled) continue;
    const inventory = [...db.productInventories.values()].find((candidate) => candidate.orderItemId === item.id);
    const account = getSubscriberAccountByOrder(db, order.id);
    const preProvisionBalance = daBalance(account, config.bonusDataSourceDaId);
    let postProvisionBalance = null;
    let fetchFailed = false;
    try {
      const post = await options.chargingSystemClient?.fetchSubscriberAccount?.({
        subscriberId: inventory?.subscriberId || order.subscriberId,
        requestType: "GBAD",
        transactionRef: `BONUS-${order.id}`
      });
      if (!post || post.status === "failed") fetchFailed = true;
      else postProvisionBalance = daBalance(post, config.bonusDataSourceDaId);
    } catch {
      fetchFailed = true;
    }
    const deltaMB = postProvisionBalance === null ? 0 : Number((postProvisionBalance - preProvisionBalance).toFixed(2));
    const bonusDetected = !fetchFailed && deltaMB >= Number(config.bonusThresholdMB);
    const event = bonusDetected
      ? recordNotification(db, config.notificationEventType, {
        orderId: order.id,
        subscriberId: inventory?.subscriberId || order.subscriberId,
        channelId: order.channelId,
        orderType: order.orderType,
        payload: {
          bonusDeltaMB: deltaMB,
          preProvisionBalance,
          postProvisionBalance,
          subscriptionId: inventory?.id
        }
      })
      : null;
    const record = {
      id: randomUUID(),
      orderId: order.id,
      subscriptionId: inventory?.id || null,
      daId: config.bonusDataSourceDaId,
      preProvisionBalance,
      postProvisionBalance,
      deltaMB,
      thresholdMB: config.bonusThresholdMB,
      bonusDetected,
      notificationEventId: event?.id || null,
      checkedAt: nowIso(),
      failureReason: fetchFailed ? "BALANCE_CHECK_CS_UNAVAILABLE" : null
    };
    ensureMap(db, "bonusDetectionRecords").set(record.id, record);
    records.push(record);
  }
  return records;
}

export function listBonusDetectionRecords(db, query = {}) {
  return [...ensureMap(db, "bonusDetectionRecords").values()]
    .filter((record) => !query.orderId || record.orderId === query.orderId)
    .filter((record) => !query.subscriptionId || record.subscriptionId === query.subscriptionId);
}

export function createTickProvisioningRule(db, body = {}) {
  requireField(body.name, "name");
  requireField(body.triggerType, "triggerType");
  requireField(body.tickOfferId, "tickOfferId");
  assertOneOf(body.triggerType, TICK_TRIGGER_TYPES, "triggerType");
  const timestamp = nowIso();
  const rule = {
    id: randomUUID(),
    name: body.name,
    triggerType: body.triggerType,
    fromServiceClass: body.fromServiceClass || [],
    toServiceClass: body.toServiceClass || [],
    tickOfferId: body.tickOfferId,
    async: body.async ?? true,
    status: body.status || "active",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  assertOneOf(rule.status, TICK_RULE_STATUSES, "status");
  ensureMap(db, "tickProvisioningRules").set(rule.id, rule);
  return rule;
}

export function listTickProvisioningRules(db, query = {}) {
  return [...ensureMap(db, "tickProvisioningRules").values()]
    .filter((rule) => !query.status || rule.status === query.status)
    .filter((rule) => !query.triggerType || rule.triggerType === query.triggerType);
}

export function getTickProvisioningRule(db, ruleId) {
  const rule = ensureMap(db, "tickProvisioningRules").get(ruleId);
  if (!rule) fail(404, "TICK_RULE_NOT_FOUND", "TICKProvisioningRule was not found.", "ruleId");
  return rule;
}

export function updateTickProvisioningRule(db, ruleId, body = {}) {
  const rule = getTickProvisioningRule(db, ruleId);
  for (const field of ["name", "triggerType", "fromServiceClass", "toServiceClass", "tickOfferId", "async", "status"]) {
    if (body[field] !== undefined) rule[field] = body[field];
  }
  assertOneOf(rule.triggerType, TICK_TRIGGER_TYPES, "triggerType");
  assertOneOf(rule.status, TICK_RULE_STATUSES, "status");
  rule.updatedAt = nowIso();
  return rule;
}

export function deactivateTickProvisioningRule(db, ruleId) {
  return updateTickProvisioningRule(db, ruleId, { status: "inactive" });
}

function matchingTickRule(db, fromServiceClass, toServiceClass) {
  return listTickProvisioningRules(db, { status: "active" }).find((rule) =>
    rule.fromServiceClass.includes(fromServiceClass) && rule.toServiceClass.includes(toServiceClass)
  ) || null;
}

export function createTariffMigrationOrder(db, body = {}) {
  requireField(body.subscriberId, "subscriberId");
  requireField(body.channelId, "channelId");
  requireField(body.toServiceClass, "toServiceClass");
  const timestamp = nowIso();
  const order = {
    id: randomUUID(),
    cartId: null,
    subscriberId: body.subscriberId,
    channelId: body.channelId,
    currency: body.currency || getDefaultCurrencyConfig(db)?.currencyCode || "NGN",
    orderType: "modify",
    modifyType: "TARIFF_MIGRATION",
    status: "acknowledged",
    validationStatus: "pending",
    validationReasonCode: null,
    failureReasonCode: null,
    failureMessage: null,
    totalAmount: 0,
    items: [],
    stateHistory: [{ id: randomUUID(), eventType: "OrderStateChangeEvent", status: "acknowledged", changedAt: timestamp, reason: "Tariff migration order created" }],
    fulfillment: { chargingStatus: "skipped", provisioningStatus: "pending", failureReasonCode: null },
    fulfillmentSteps: [],
    validatedAt: null,
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  ensureMap(db, "productOrders").set(order.id, order);
  const migration = {
    id: randomUUID(),
    orderId: order.id,
    subscriberId: body.subscriberId,
    channelId: body.channelId,
    fromServiceClass: body.fromServiceClass || null,
    toServiceClass: body.toServiceClass,
    status: "pending",
    tickRuleApplied: null,
    tickAction: "NO_ACTION",
    tickOfferId: null,
    requestedAt: timestamp,
    completedAt: null
  };
  ensureMap(db, "tariffMigrationRequests").set(order.id, migration);
  order.tariffMigrationRequest = migration;
  return order;
}

export async function validateTariffMigrationOrder(db, orderId, options = {}) {
  const order = getProductOrder(db, orderId);
  if (order.orderType !== "modify" || order.modifyType !== "TARIFF_MIGRATION") {
    fail(422, "NOT_TARIFF_MIGRATION_ORDER", "Order is not a tariff migration order.", "orderType");
  }
  if (order.status !== "acknowledged") fail(409, "INVALID_ORDER_STATE_TRANSITION", "Only acknowledged tariff migrations can be validated.", "status");
  const migration = ensureMap(db, "tariffMigrationRequests").get(order.id);
  let fromServiceClass = migration.fromServiceClass || options.fromServiceClass || null;
  if (!fromServiceClass && options.chargingSystemClient?.fetchSubscriberAccount) {
    const account = await options.chargingSystemClient.fetchSubscriberAccount({
      subscriberId: order.subscriberId,
      requestType: "GAD",
      transactionRef: order.id
    });
    fromServiceClass = account.serviceClass;
  }
  fromServiceClass ||= "PREPAID";
  if (fromServiceClass === migration.toServiceClass) {
    fail(422, "TARIFF_MIGRATION_SAME_CLASS", "Requested service class is already active.", "toServiceClass");
  }
  const rule = matchingTickRule(db, fromServiceClass, migration.toServiceClass);
  migration.fromServiceClass = fromServiceClass;
  migration.tickRuleApplied = rule?.id || null;
  migration.tickAction = rule?.triggerType || "NO_ACTION";
  migration.tickOfferId = rule?.tickOfferId || null;
  migration.status = "inProgress";
  order.validationStatus = "valid";
  order.validatedAt = nowIso();
  order.status = "inProgress";
  order.updatedAt = order.validatedAt;
  order.stateHistory.push({ id: randomUUID(), eventType: "OrderStateChangeEvent", status: "inProgress", changedAt: order.updatedAt, reason: "Tariff migration validation passed" });
  return order;
}

function tickClient(options = {}) {
  return options.tickProvisioningClient || {
    addTick: async () => ({ status: "success", tickRef: `tick-${randomUUID()}`, failureReason: null }),
    removeTick: async () => ({ status: "success", tickRef: `tick-${randomUUID()}`, failureReason: null })
  };
}

function addFulfillmentStep(order, stepName, status, requestPayload, responsePayload, failureReason = null) {
  const step = {
    id: randomUUID(),
    orderId: order.id,
    stepName,
    status,
    requestPayload,
    responsePayload,
    executedAt: nowIso(),
    failureReason
  };
  order.fulfillmentSteps.push(step);
  return step;
}

export async function fulfillTariffMigrationOrder(db, orderId, options = {}) {
  const order = getProductOrder(db, orderId);
  if (order.orderType !== "modify" || order.modifyType !== "TARIFF_MIGRATION") {
    fail(422, "NOT_TARIFF_MIGRATION_ORDER", "Order is not a tariff migration order.", "orderType");
  }
  if (order.status !== "inProgress" || order.validationStatus !== "valid") {
    fail(409, "ORDER_NOT_VALIDATED", "Tariff migration must be validated before fulfillment.", "status");
  }
  const migration = ensureMap(db, "tariffMigrationRequests").get(order.id);
  const csResult = options.chargingSystemClient?.updateSubscriberAttributes
    ? await options.chargingSystemClient.updateSubscriberAttributes({
      subscriberId: order.subscriberId,
      updates: [{ attribute: "ServiceClass", value: migration.toServiceClass }],
      transactionRef: order.id
    })
    : { status: "success", transactionId: `cs-${randomUUID()}` };
  addFulfillmentStep(order, "csAttributeUpdate", csResult.status === "failed" ? "failed" : "success", {
    subscriberId: order.subscriberId,
    fromServiceClass: migration.fromServiceClass,
    toServiceClass: migration.toServiceClass
  }, csResult, csResult.status === "failed" ? (csResult.failureReason || "CS_ATTRIBUTE_UPDATE_FAILED") : null);
  if (csResult.status === "failed") {
    order.status = "failed";
    order.failureReasonCode = "CS_ATTRIBUTE_UPDATE_FAILED";
    order.failureMessage = "Service class update failed.";
    order.completedAt = nowIso();
    order.updatedAt = order.completedAt;
    migration.status = "failed";
    migration.completedAt = order.completedAt;
    return order;
  }

  if (migration.tickAction !== "NO_ACTION") {
    const method = migration.tickAction === "ADD_TICK" ? "addTick" : "removeTick";
    const stepName = migration.tickAction === "ADD_TICK" ? "tickProvisioning" : "tickDeprovisioning";
    const tickResult = await tickClient(options)[method]({
      subscriberId: order.subscriberId,
      tickOfferId: migration.tickOfferId,
      transactionRef: order.id
    });
    addFulfillmentStep(order, stepName, tickResult.status === "failed" ? "failed" : "success", {
      subscriberId: order.subscriberId,
      tickOfferId: migration.tickOfferId,
      tickAction: migration.tickAction
    }, tickResult, tickResult.failureReason || null);
  }

  const timestamp = nowIso();
  order.status = "completed";
  order.completedAt = timestamp;
  order.updatedAt = timestamp;
  order.fulfillment.provisioningStatus = "completed";
  order.stateHistory.push({ id: randomUUID(), eventType: "OrderStateChangeEvent", status: "completed", changedAt: timestamp, reason: "Tariff migration completed" });
  migration.status = "completed";
  migration.completedAt = timestamp;
  recordNotification(db, "TARIFF_MIGRATION_COMPLETED", {
    orderId: order.id,
    subscriberId: order.subscriberId,
    channelId: order.channelId,
    orderType: order.orderType,
    payload: { tariffMigrationRequestId: migration.id, tickAction: migration.tickAction }
  });
  return order;
}

export function getTariffMigrationRequest(db, orderId) {
  const request = ensureMap(db, "tariffMigrationRequests").get(orderId);
  if (!request) fail(404, "TARIFF_MIGRATION_NOT_FOUND", "TariffMigrationRequest was not found.", "orderId");
  return request;
}
