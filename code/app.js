import { ApiError, errorBody, fail } from "./errors.js";
import {
  abandonShoppingCart,
  activateChannel,
  activateProductOffering,
  activateProductSpecification,
  addCartItem,
  addEligibilityRule,
  addProductOfferingPrice,
  cancelProductOrder,
  captureChannelSubscriptionRequest,
  captureProductOrderFromCart,
  compensateProductOrder,
  checkoutShoppingCart,
  configFromEnv,
  createChannel,
  createProductOffering,
  createProductSpecification,
  createShoppingCart,
  createTerminateOrderFromSubscription,
  createTerminateOrder,
  deactivateChannel,
  deleteEligibilityRule,
  deleteProductOfferingPrice,
  getProductOffering,
  getProductOfferingPrice,
  getCompensationConfig,
  getChargingResolutionRecord,
  getProductInventory,
  getProductOrder,
  getProductSpecification,
  getShoppingCart,
  getChannel,
  getSubscriberAccountByOrder,
  issueChannelAuthToken,
  listChannelInteractions,
  listChannelAuthTokens,
  listChannels,
  listCompensationRecords,
  listNotificationEvents,
  listProductInventory,
  listProductOfferings,
  listProductOrders,
  listProductSpecifications,
  removeCartItem,
  retireProductOffering,
  retireProductSpecification,
  retryProductOrderFulfillment,
  revokeChannelAuthToken,
  regenerateChannelApiKey,
  setCompensationConfig,
  createSubscriberAccountSnapshot,
  updateChannel,
  updateProductInventoryStatus,
  updateProductOrderState,
  updateProductOffering,
  updateProductOfferingPrice,
  updateProductSpecification,
  validateChannelAuth,
  validateProductOrder,
  validateProductOrderWithSubscriberAccount,
  executeProductOrderFulfillment,
  validateShoppingCart
} from "./domain.js";
import { store as defaultStore } from "./store.js";
import { RealChargingSystemClient, sprint4ConfigFromEnv } from "./sprint4.js";
import {
  createCustomerSegment,
  getCustomerSegment,
  listCustomerSegments,
  updateCustomerSegment,
  createRenewalSchedule,
  getRenewalSchedule,
  listRenewalSchedules,
  updateRenewalSchedule,
  createPartyRelationship,
  getPartyRelationship,
  listPartyRelationships
} from "./sprint6.js";
import {
  createCommunicationTemplate,
  createCurrencyConfig,
  createStaffNumberLink,
  dispatchNotificationEvent,
  getCommunicationTemplate,
  getCurrencyConfig,
  getNotificationDispatchRecord,
  listCommunicationTemplates,
  listCurrencyConfigs,
  listNotificationDispatchRecords,
  listStaffNumberLinks,
  retireCommunicationTemplate,
  retireCurrencyConfig,
  deactivateStaffNumberLink,
  subscribeCart,
  updateCommunicationTemplate,
  updateCurrencyConfig
} from "./sprint7.js";
import {
  createBonusDetectionConfig,
  createDormantCleanupRequest,
  createParty,
  createTariffMigrationOrder,
  createTickProvisioningRule,
  deactivateTickProvisioningRule,
  fulfillTariffMigrationOrder,
  getBonusDetectionConfig,
  getConsolidatedBalanceCheck,
  getDormantCleanupRequest,
  getTariffMigrationRequest,
  getTickProvisioningRule,
  listBonusDetectionConfigs,
  listBonusDetectionRecords,
  listDormantCleanupRequests,
  listParties,
  listTickProvisioningRules,
  runBonusDetectionForOrder,
  updateBonusDetectionConfig,
  updateTickProvisioningRule,
  validateTariffMigrationOrder
} from "./sprint8.js";
import {
  auditLog,
  createTransferLimit,
  getActiveSimUpgradeConfig,
  getCreditTransfer,
  getCustomerPreference,
  getSimUpgradeEvent,
  handleSimUpgradeSubscriberResponse,
  listCreditTransfers,
  listSimUpgradeEvents,
  listTransferLimits,
  notificationDispatchedForOrder,
  processSimUpgradeDeviceEvent,
  readiness,
  receiveSimUpgradeCallback,
  requestCreditTransfer,
  setTransferPin,
  updateTransferLimit,
  upsertCustomerPreference,
  upsertSimUpgradeConfig,
  withAsyncIdempotency,
  withIdempotency
} from "./sprint9.js";

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function saveIfNeeded(persistence, db) {
  if (persistence?.save) await persistence.save(db);
}

function parseUrl(req) {
  const url = new URL(req.url, "http://localhost");
  return {
    pathname: url.pathname,
    query: Object.fromEntries(url.searchParams.entries())
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    fail(400, "MALFORMED_JSON", "Request body must be valid JSON.", "body");
  }
}

function match(method, pathname, pattern) {
  const actual = pathname.split("/").filter(Boolean);
  const expected = pattern.split("/").filter(Boolean);
  if (actual.length !== expected.length) return null;
  const params = {};
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index].startsWith(":")) {
      params[expected[index].slice(1)] = decodeURIComponent(actual[index]);
    } else if (actual[index] !== expected[index]) {
      return null;
    }
  }
  return { method, params };
}

function is(method, reqMethod, pathname, pattern) {
  if (method !== reqMethod) return null;
  const m = match(method, pathname, pattern);
  if (!m || !m.params) return null;
  return m.params;
}

function isPublicRoute(method, pathname) {
  return [
    ["GET", "/health"],
    ["GET", "/api/v1/health"],
    ["GET", "/api/v1/ready"],
    ["POST", "/api/v1/auth/token"],
    ["POST", "/api/v1/sim-upgrade/device-event"],
    ["POST", "/api/v1/sim-upgrade/cs-callback"],
    ["GET", "/api/v1/catalog/offerings"]
  ].some(([routeMethod, routePath]) => method === routeMethod && pathname === routePath);
}

function ensureChannelMatch(auth, resourceChannelId) {
  if (!auth || !resourceChannelId) return;
  if (auth.channelId !== resourceChannelId) {
    fail(403, "CHANNEL_MISMATCH", "Authenticated channel does not match the requested resource.", "authorization");
  }
}

function ensureOfferingAuthorized(db, auth, productOfferingId) {
  if (!auth || !productOfferingId) return;
  const channel = getChannel(db, auth.channelId);
  const offering = getProductOffering(db, productOfferingId);
  const available = offering.channelAvailability.length === 0 || offering.channelAvailability.includes(auth.channelId);
  const allowed = !channel.allowedOfferingIds?.length || channel.allowedOfferingIds.includes(productOfferingId);
  if (!available || !allowed) {
    fail(403, "OFFERING_NOT_AUTHORIZED_FOR_CHANNEL", "Channel is not authorized for this offering.", "productOfferingId");
  }
}

async function validateWithChargingSystem(db, orderId, config, chargingSystemClient) {
  const order = getProductOrder(db, orderId);
  if (order.orderType === "terminate") return validateProductOrder(db, orderId, {});
  const client = chargingSystemClient || new RealChargingSystemClient({ ...sprint4ConfigFromEnv(), ...config });
  const csResult = await client.fetchSubscriberAccount({
    subscriberId: order.subscriberId,
    transactionRef: order.id,
    requestType: "GAD"
  });
  if (csResult.status === "failed") {
    let reason;
    if (csResult.failureReason === "CS_TIMEOUT") {
      reason = "CS_TIMEOUT";
    } else {
      reason = "CS_SUBSCRIBER_FETCH_FAILED";
    }
    updateProductOrderState(db, order.id, { status: "failed", reason });
    order.failureReasonCode = reason;
    order.failureMessage = "Charging System subscriber fetch failed.";
    fail(422, reason, "Charging System subscriber fetch failed.", "chargingSystem");
  }
  const account = createSubscriberAccountSnapshot(db, order.id, csResult);
  return validateProductOrderWithSubscriberAccount(db, order.id, account);
}

async function executeAndSend(res, persistence, db, status, action) {
  const result = await action();

  await saveIfNeeded(persistence, db);

  return send(res, status, result);
}

function route(method, pathname, expectedMethod, expectedPath) {
  return method === expectedMethod && pathname === expectedPath;
}

function routeWithParams(method, pathname, expectedMethod, pattern) {
  if (method !== expectedMethod) return null;
  return is(method, expectedMethod, pathname, pattern);
}

function createOrderFromRequest(db, body, auth) {
  if (body.orderType === "modify" && body.modifyType === "TARIFF_MIGRATION") return createTariffMigrationOrder(db, body);
  if (body.orderType === "terminate") return createTerminateOrderFromSubscription(db, body, { ...auth, subscriberId: body.subscriberId });
  return captureProductOrderFromCart(db, body);
}

async function validateOrderForRequest(db, order, orderId, mergedConfig) {
  if (order.orderType === "modify" && order.modifyType === "TARIFF_MIGRATION") {
    return validateTariffMigrationOrder(db, orderId, { chargingSystemClient: mergedConfig.chargingSystemClient });
  }
  if (mergedConfig.enableAuthEnforcement) {
    return validateWithChargingSystem(db, orderId, mergedConfig, mergedConfig.chargingSystemClient);
  }
  return validateProductOrder(db, orderId, {});
}

async function handleHealthRoutes({ res, pathname, method, db, mergedConfig }) {
  if (isHealthStatusRoute(method, pathname)) {
    return sendHealthStatus(res);
  }

  if (route(method, pathname, "GET", "/api/v1/ready")) {
    return sendReadiness(res, db, mergedConfig);
  }

  return false;
}

function isHealthStatusRoute(method, pathname) {
  return route(method, pathname, "GET", "/health") || route(method, pathname, "GET", "/api/v1/health");
}

function sendHealthStatus(res) {
  send(res, 200, { status: "ok", checks: { db: "ok" } });
  return true;
}

async function sendReadiness(res, db, mergedConfig) {
  send(res, 200, await readiness(db, { chargingSystemClient: mergedConfig.chargingSystemClient }));
  return true;
}

async function handleAuthRoutes({ req, res, method, pathname, query, db, persistence, mergedConfig }) {
  if (method === "POST" && pathname === "/api/v1/auth/token") {
    const result = await withAsyncIdempotency(db, req.headers["idempotency-key"], "auth-token", async () =>
      issueChannelAuthToken(db, await readJson(req), mergedConfig)
    );
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  if (method === "POST" && pathname === "/api/v1/auth/revoke") {
    const body = await readJson(req);
    const result = revokeChannelAuthToken(db, body);
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  if (method === "GET" && pathname === "/api/v1/auth/tokens") {
    send(res, 200, listChannelAuthTokens(db, query));
    return true;
  }
  return false;
}

async function handleCatalogSpecifications({ req, res, method, pathname, query, db, persistence }) {
  if (route(method, pathname, "POST", "/api/v1/catalog/specifications")) {
    return executeAndSend(res, persistence, db, 201, async () =>
      createProductSpecification(db, await readJson(req))
    );
  }
  if (route(method, pathname, "GET", "/api/v1/catalog/specifications")) {
    send(res, 200, listProductSpecifications(db, query));
    return true;
  }
  const params = is(method, "GET", pathname, "/api/v1/catalog/specifications/:id");
  if (params) {
    send(res, 200, getProductSpecification(db, params.id));
    return true;
  }
  const patchSpecification = routeWithParams(method, pathname, "PATCH", "/api/v1/catalog/specifications/:id");
  if (patchSpecification) {
    const result = updateProductSpecification(db, patchSpecification.id, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const activateSpecification = is(method, "POST", pathname, "/api/v1/catalog/specifications/:id/activate");
  if (activateSpecification) {
    const result = activateProductSpecification(db, activateSpecification.id);
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const retireSpecification = is(method, "POST", pathname, "/api/v1/catalog/specifications/:id/retire");
  if (retireSpecification) {
    const result = retireProductSpecification(db, retireSpecification.id);
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  return false;
}

async function handleCatalogOfferings({ req, res, method, pathname, query, db, persistence }) {
  if (method === "POST" && pathname === "/api/v1/catalog/offerings") {
    const result = createProductOffering(db, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  if (method === "GET" && pathname === "/api/v1/catalog/offerings") {
    send(res, 200, listProductOfferings(db, query));
    return true;
  }
  const getOffering = is(method, "GET", pathname, "/api/v1/catalog/offerings/:id");
  if (getOffering) {
    send(res, 200, getProductOffering(db, getOffering.id));
    return true;
  }
  const updateOffering = is(method, "PATCH", pathname, "/api/v1/catalog/offerings/:id");
  if (updateOffering) {
    const result = updateProductOffering(db, updateOffering.id, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const activateOffering = is(method, "POST", pathname, "/api/v1/catalog/offerings/:id/activate");
  if (activateOffering) {
    const result = activateProductOffering(db, activateOffering.id);
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const retireOffering = is(method, "POST", pathname, "/api/v1/catalog/offerings/:id/retire");
  if (retireOffering) {
    const result = retireProductOffering(db, retireOffering.id);
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const compensationOffering = is(method, "POST", pathname, "/api/v1/catalog/offerings/:id/compensation-config");
  if (compensationOffering) {
    const result = setCompensationConfig(db, compensationOffering.id, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const getCompensationOffering = is(method, "GET", pathname, "/api/v1/catalog/offerings/:id/compensation-config");
  if (getCompensationOffering) {
    send(res, 200, getCompensationConfig(db, getCompensationOffering.id));
    return true;
  }
  return false;
}

async function handleOfferingPricingRoutes({ req, res, method, pathname, db, persistence }) {
  const addPrice = is(method, "POST", pathname, "/api/v1/catalog/offerings/:id/prices");
  if (addPrice) {
    const result = addProductOfferingPrice(db, addPrice.id, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  const getPrices = is(method, "GET", pathname, "/api/v1/catalog/offerings/:id/prices");
  if (getPrices) {
    send(res, 200, getProductOffering(db, getPrices.id).prices);
    return true;
  }
  const getPrice = is(method, "GET", pathname, "/api/v1/catalog/offerings/:id/prices/:priceId");
  if (getPrice) {
    send(res, 200, getProductOfferingPrice(db, getPrice.id, getPrice.priceId));
    return true;
  }
  const updatePrice = is(method, "PATCH", pathname, "/api/v1/catalog/offerings/:id/prices/:priceId");
  if (updatePrice) {
    const result = updateProductOfferingPrice(db, updatePrice.id, updatePrice.priceId, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const deletePrice = is(method, "DELETE", pathname, "/api/v1/catalog/offerings/:id/prices/:priceId");
  if (deletePrice) {
    deleteProductOfferingPrice(db, deletePrice.id, deletePrice.priceId);
    await saveIfNeeded(persistence, db);
    send(res, 200, { deleted: true });
    return true;
  }
  return false;
}

async function handleOfferingEligibilityRoutes({ req, res, method, pathname, db, persistence }) {
  const addEligibility = is(method, "POST", pathname, "/api/v1/catalog/offerings/:id/eligibility-rules");
  if (addEligibility) {
    const result = addEligibilityRule(db, addEligibility.id, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  const deleteEligibility = is(method, "DELETE", pathname, "/api/v1/catalog/offerings/:id/eligibility-rules/:ruleId");
  if (deleteEligibility) {
    deleteEligibilityRule(db, deleteEligibility.id, deleteEligibility.ruleId);
    await saveIfNeeded(persistence, db);
    send(res, 200, { deleted: true });
    return true;
  }
  return false;
}

async function handleAdminCurrencyRoutes({ req, res, method, pathname, query, db, persistence }) {
  if (method === "POST" && pathname === "/api/v1/admin/currencies") {
    const result = createCurrencyConfig(db, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  if (method === "GET" && pathname === "/api/v1/admin/currencies") {
    send(res, 200, listCurrencyConfigs(db, query));
    return true;
  }
  const getCurrency = is(method, "GET", pathname, "/api/v1/admin/currencies/:code");
  if (getCurrency) {
    send(res, 200, getCurrencyConfig(db, getCurrency.code));
    return true;
  }
  const patchCurrency = is(method, "PATCH", pathname, "/api/v1/admin/currencies/:code");
  if (patchCurrency) {
    const result = updateCurrencyConfig(db, patchCurrency.code, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const deleteCurrency = is(method, "DELETE", pathname, "/api/v1/admin/currencies/:code");
  if (deleteCurrency) {
    const result = retireCurrencyConfig(db, deleteCurrency.code);
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  return false;
}

async function handleAdminTemplateRoutes({ req, res, method, pathname, query, db, persistence }) {
  if (method === "POST" && pathname === "/api/v1/admin/templates") {
    const result = createCommunicationTemplate(db, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  if (method === "GET" && pathname === "/api/v1/admin/templates") {
    send(res, 200, listCommunicationTemplates(db, query));
    return true;
  }
  const getTemplate = is(method, "GET", pathname, "/api/v1/admin/templates/:templateId");
  if (getTemplate) {
    send(res, 200, getCommunicationTemplate(db, getTemplate.templateId));
    return true;
  }
  const patchTemplate = is(method, "PATCH", pathname, "/api/v1/admin/templates/:templateId");
  if (patchTemplate) {
    const result = updateCommunicationTemplate(db, patchTemplate.templateId, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const deleteTemplate = is(method, "DELETE", pathname, "/api/v1/admin/templates/:templateId");
  if (deleteTemplate) {
    const result = retireCommunicationTemplate(db, deleteTemplate.templateId);
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  return false;
}

async function handleAdminPartyRoutes({ req, res, method, pathname, query, db, persistence, mergedConfig, auth }) {
  if (method === "POST" && pathname === "/api/v1/admin/parties") {
    const result = createParty(db, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  if (method === "GET" && pathname === "/api/v1/admin/parties") {
    send(res, 200, listParties(db, query));
    return true;
  }
  if (method === "POST" && pathname === "/api/v1/admin/dormant-cleanup") {
    const result = await createDormantCleanupRequest(db, await readJson(req), {
      channelType: auth?.channelType || query.channelType || "CRM",
      channelId: auth?.channelId || query.channelId || "CRM",
      offlineCleanupClient: mergedConfig.offlineCleanupClient
    });
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  if (method === "GET" && pathname === "/api/v1/admin/dormant-cleanup") {
    send(res, 200, listDormantCleanupRequests(db, query));
    return true;
  }
  const getDormant = is(method, "GET", pathname, "/api/v1/admin/dormant-cleanup/:requestId");
  if (getDormant) {
    send(res, 200, getDormantCleanupRequest(db, getDormant.requestId));
    return true;
  }
  return false;
}

async function handleAdminBonusTickRoutes({ req, res, method, pathname, query, db, persistence }) {
  const bonusCreate = is(method, "POST", pathname, "/api/v1/catalog/offerings/:id/bonus-detection");
  if (bonusCreate) {
    const result = createBonusDetectionConfig(db, bonusCreate.id, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  if (method === "GET" && pathname === "/api/v1/admin/bonus-detection") {
    send(res, 200, listBonusDetectionConfigs(db, query));
    return true;
  }
  const getBonus = is(method, "GET", pathname, "/api/v1/catalog/offerings/:id/bonus-detection");
  if (getBonus) {
    send(res, 200, getBonusDetectionConfig(db, getBonus.id));
    return true;
  }
  const patchBonus = is(method, "PATCH", pathname, "/api/v1/catalog/offerings/:id/bonus-detection");
  if (patchBonus) {
    const result = updateBonusDetectionConfig(db, patchBonus.id, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  if (method === "GET" && pathname === "/api/v1/admin/bonus-detection-records") {
    send(res, 200, listBonusDetectionRecords(db, query));
    return true;
  }
  if (method === "POST" && pathname === "/api/v1/admin/tick-rules") {
    const result = createTickProvisioningRule(db, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  if (method === "GET" && pathname === "/api/v1/admin/tick-rules") {
    send(res, 200, listTickProvisioningRules(db, query));
    return true;
  }
  const getTick = is(method, "GET", pathname, "/api/v1/admin/tick-rules/:ruleId");
  if (getTick) {
    send(res, 200, getTickProvisioningRule(db, getTick.ruleId));
    return true;
  }
  const patchTick = is(method, "PATCH", pathname, "/api/v1/admin/tick-rules/:ruleId");
  if (patchTick) {
    const result = updateTickProvisioningRule(db, patchTick.ruleId, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const deleteTick = is(method, "DELETE", pathname, "/api/v1/admin/tick-rules/:ruleId");
  if (deleteTick) {
    const result = deactivateTickProvisioningRule(db, deleteTick.ruleId);
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  return false;
}

async function handleSimUpgradeRoutes(routeContext) {
  if (await handleSimUpgradeConfigRoutes(routeContext)) return true;
  return await handleSimUpgradeEventRoutes(routeContext);
}

async function handleSimUpgradeConfigRoutes({ req, res, method, pathname, query, db, persistence }) {
  if (method === "GET" && pathname === "/api/v1/admin/sim-upgrade-config") {
    send(res, 200, getActiveSimUpgradeConfig(db));
    return true;
  }
  if (method === "PATCH" && pathname === "/api/v1/admin/sim-upgrade-config") {
    const result = upsertSimUpgradeConfig(db, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  if (method === "GET" && pathname === "/api/v1/admin/sim-upgrade-events") {
    send(res, 200, listSimUpgradeEvents(db, query));
    return true;
  }
  const getEvent = is(method, "GET", pathname, "/api/v1/admin/sim-upgrade-events/:eventId");
  if (getEvent) {
    send(res, 200, getSimUpgradeEvent(db, getEvent.eventId));
    return true;
  }
  return false;
}

async function handleSimUpgradeEventRoutes({ req, res, method, pathname, db, persistence, mergedConfig }) {
  if (method === "POST" && pathname === "/api/v1/sim-upgrade/device-event") {
    if (mergedConfig.deviceMgmtApiKey && req.headers["x-device-mgmt-key"] !== mergedConfig.deviceMgmtApiKey) {
      fail(401, "INVALID_DEVICE_MGMT_KEY", "Invalid device management API key.", "X-Device-Mgmt-Key");
    }
    const result = await processSimUpgradeDeviceEvent(db, await readJson(req), {
      simCheckClient: mergedConfig.simCheckClient,
      chargingSystemClient: mergedConfig.chargingSystemClient
    });
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  if (method === "POST" && pathname === "/api/v1/sim-upgrade/cs-callback") {
    if (mergedConfig.csCallbackApiKey && req.headers["x-cs-callback-key"] !== mergedConfig.csCallbackApiKey) {
      fail(401, "INVALID_CS_CALLBACK_KEY", "Invalid CS callback API key.", "X-CS-Callback-Key");
    }
    const result = await receiveSimUpgradeCallback(db, await readJson(req), { gatewayClient: mergedConfig.gatewayClient });
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  if (method === "POST" && pathname === "/api/v1/sim-upgrade/subscriber-response") {
    const result = await handleSimUpgradeSubscriberResponse(db, await readJson(req), { gatewayClient: mergedConfig.gatewayClient });
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  return false;
}

async function handleCustomerPreferencesRoutes({ req, res, method, pathname, db, persistence }) {
  if (method === "POST" && pathname === "/api/v1/admin/customer-preferences") {
    const result = upsertCustomerPreference(db, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }

  const getPreference = is(method, "GET", pathname, "/api/v1/admin/customer-preferences/:subscriberId");
  if (getPreference) {
    send(res, 200, getCustomerPreference(db, getPreference.subscriberId));
    return true;
  }

  const patchPreference = is(method, "PATCH", pathname, "/api/v1/admin/customer-preferences/:subscriberId");
  if (patchPreference) {
    const result = upsertCustomerPreference(db, { ...(await readJson(req)), subscriberId: patchPreference.subscriberId });
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  return false;
}

async function handleCustomerSegmentRoutes({ req, res, method, pathname, query, db, persistence }) {
  if (method === "POST" && pathname === "/api/v1/catalog/segments") {
    const result = createCustomerSegment(db, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  if (method === "GET" && pathname === "/api/v1/catalog/segments") {
    send(res, 200, listCustomerSegments(db, query));
    return true;
  }
  const getSegment = is(method, "GET", pathname, "/api/v1/catalog/segments/:segmentId");
  if (getSegment) {
    send(res, 200, getCustomerSegment(db, getSegment.segmentId));
    return true;
  }
  const patchSegment = is(method, "PATCH", pathname, "/api/v1/catalog/segments/:segmentId");
  if (patchSegment) {
    const result = updateCustomerSegment(db, patchSegment.segmentId, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const deleteSegment = is(method, "DELETE", pathname, "/api/v1/catalog/segments/:segmentId");
  if (deleteSegment) {
    const result = updateCustomerSegment(db, deleteSegment.segmentId, { status: "retired" });
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  return false;
}

async function handleAdminAuditRoutes({ res, method, pathname, query, db }) {
  if (method === "GET" && pathname === "/api/v1/admin/audit-log") {
    send(res, 200, auditLog(db, query));
    return true;
  }
  return false;
}

async function handleCartRoutes({ req, res, method, pathname, db, persistence, mergedConfig, auth }) {
  if (method === "POST" && pathname === "/api/v1/cart") {
    const body = await readJson(req);
    ensureChannelMatch(auth, body.channelId);
    const cart = withIdempotency(db, req.headers["idempotency-key"], "cart-create", () =>
      createShoppingCart(db, body, mergedConfig)
    );
    await saveIfNeeded(persistence, db);
    send(res, 201, { cartId: cart.id, expiresAt: cart.expiresAt, currency: cart.currency });
    return true;
  }
  const getCart = is(method, "GET", pathname, "/api/v1/cart/:cartId");
  if (getCart) {
    const cart = getShoppingCart(db, getCart.cartId, true);
    ensureChannelMatch(auth, cart.channelId);
    send(res, 200, cart);
    return true;
  }
  const addCart = is(method, "POST", pathname, "/api/v1/cart/:cartId/items");
  if (addCart) {
    const body = await readJson(req);
    const cart = getShoppingCart(db, addCart.cartId, false);
    ensureChannelMatch(auth, cart.channelId);
    ensureOfferingAuthorized(db, auth, body.productOfferingId);
    const item = addCartItem(db, addCart.cartId, body);
    await saveIfNeeded(persistence, db);
    send(res, 201, { cartItemId: item.id });
    return true;
  }
  const deleteCartItemRoute = is(method, "DELETE", pathname, "/api/v1/cart/:cartId/items/:itemId");
  if (deleteCartItemRoute) {
    removeCartItem(db, deleteCartItemRoute.cartId, deleteCartItemRoute.itemId);
    await saveIfNeeded(persistence, db);
    res.writeHead(204);
    res.end();
    return true;
  }
  const validateCart = is(method, "POST", pathname, "/api/v1/cart/:cartId/validate");
  if (validateCart) {
    ensureChannelMatch(auth, getShoppingCart(db, validateCart.cartId, false).channelId);
    const result = validateShoppingCart(db, validateCart.cartId, await readJson(req));
    await saveIfNeeded(persistence, db);
    if (result.errors.length > 0) {
      send(res, 422, {
        error: {
          code: "VALIDATION_ERROR",
          message: "One or more cart items failed validation.",
          details: result.errors.map((error) => ({
            field: `items.${error.cartItemId}`,
            reasonCode: error.reasonCode,
            message: error.message
          }))
        },
        cart: result.cart
      });
      return true;
    }
    send(res, 200, result.cart);
    return true;
  }
  const checkoutCart = is(method, "POST", pathname, "/api/v1/cart/:cartId/checkout");
  if (checkoutCart) {
    ensureChannelMatch(auth, getShoppingCart(db, checkoutCart.cartId, false).channelId);
    const order = checkoutShoppingCart(db, checkoutCart.cartId);
    await saveIfNeeded(persistence, db);
    send(res, 201, { orderId: order.id, cartId: order.cartId, status: order.status });
    return true;
  }
  const subscribeCartRoute = is(method, "POST", pathname, "/api/v1/cart/:cartId/subscribe");
  if (subscribeCartRoute) {
    ensureChannelMatch(auth, getShoppingCart(db, subscribeCartRoute.cartId, false).channelId);
    const body = await readJson(req);
    const result = await subscribeCart(db, subscribeCartRoute.cartId, {
      validationBody: body.validationBody || body,
      fulfillmentBody: body.fulfillmentBody || {},
      subscriberAccount: body.subscriberAccount,
      gatewayClient: mergedConfig.gatewayClient,
      channelType: body.channelType
    });
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const abandonCart = is(method, "DELETE", pathname, "/api/v1/cart/:cartId");
  if (abandonCart) {
    const result = abandonShoppingCart(db, abandonCart.cartId);
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  return false;
}

async function handleProductOrderRoutes({ req, res, method, pathname, query, db, persistence }) {
  if (method === "GET" && pathname === "/api/v1/product-order") {
    send(res, 200, listProductOrders(db, query));
    return true;
  }
  if (method === "POST" && pathname === "/api/v1/product-order") {
    const result = captureProductOrderFromCart(db, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  const getProductOrderRoute = is(method, "GET", pathname, "/api/v1/product-order/:orderId");
  if (getProductOrderRoute) {
    send(res, 200, getProductOrder(db, getProductOrderRoute.orderId));
    return true;
  }
  const updateOrderState = is(method, "POST", pathname, "/api/v1/product-order/:orderId/state");
  if (updateOrderState) {
    const result = updateProductOrderState(db, updateOrderState.orderId, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const validateProductOrderRoute = is(method, "POST", pathname, "/api/v1/product-order/:orderId/validate");
  if (validateProductOrderRoute) {
    const result = validateProductOrder(db, validateProductOrderRoute.orderId, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const fulfillProductOrderRoute = is(method, "POST", pathname, "/api/v1/product-order/:orderId/fulfill");
  if (fulfillProductOrderRoute) {
    const result = executeProductOrderFulfillment(db, fulfillProductOrderRoute.orderId, await readJson(req));
    await saveIfNeeded(persistence, db);
    if (result.status === "failed") {
      send(res, 422, result);
    } else {
      send(res, 200, result);
    }
    return true;
  }
  const cancelProductOrderRoute = is(method, "POST", pathname, "/api/v1/product-order/:orderId/cancel");
  if (cancelProductOrderRoute) {
    const result = cancelProductOrder(db, cancelProductOrderRoute.orderId, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const compensateProductOrderRoute = is(method, "POST", pathname, "/api/v1/product-order/:orderId/compensate");
  if (compensateProductOrderRoute) {
    const result = compensateProductOrder(db, compensateProductOrderRoute.orderId, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const retryProductOrderRoute = is(method, "POST", pathname, "/api/v1/product-order/:orderId/retry");
  if (retryProductOrderRoute) {
    const result = retryProductOrderFulfillment(db, retryProductOrderRoute.orderId, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  return false;
}

async function handleOrdersCollectionRoutes({ req, res, method, pathname, query, db, persistence, auth }) {
  if (method === "GET" && pathname === "/api/v1/orders") {
    send(res, 200, listProductOrders(db, query));
    return true;
  }
  if (method === "POST" && pathname === "/api/v1/orders") {
    const body = await readJson(req);
    const result = withIdempotency(db, req.headers["idempotency-key"], "orders-create", () =>
      createOrderFromRequest(db, body, auth)
    );
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  return false;
}

async function handleOrderLifecycleRoutes({ req, res, method, pathname, db, persistence, mergedConfig, auth }) {
  const validateOrderRoute = is(method, "POST", pathname, "/api/v1/orders/:orderId/validate");
  if (validateOrderRoute) {
    await readJson(req);
    const order = getProductOrder(db, validateOrderRoute.orderId);
    ensureChannelMatch(auth, order.channelId);
    const result = await validateOrderForRequest(db, order, validateOrderRoute.orderId, mergedConfig);
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }

  const fulfillOrder = is(method, "POST", pathname, "/api/v1/orders/:orderId/fulfill");
  if (fulfillOrder) {
    const order = getProductOrder(db, fulfillOrder.orderId);
    ensureChannelMatch(auth, order.channelId);
    const body = await readJson(req);
    let result;
    if (order.orderType === "modify" && order.modifyType === "TARIFF_MIGRATION") {
      result = await fulfillTariffMigrationOrder(db, fulfillOrder.orderId, {
        chargingSystemClient: mergedConfig.chargingSystemClient,
        tickProvisioningClient: mergedConfig.tickProvisioningClient
      });
    } else {
      result = executeProductOrderFulfillment(db, fulfillOrder.orderId, body);
    }
    if (result.status === "completed" && ["provision", "gift"].includes(result.orderType)) {
      await runBonusDetectionForOrder(db, fulfillOrder.orderId, { chargingSystemClient: mergedConfig.chargingSystemClient });
    }
    await saveIfNeeded(persistence, db);
    if (result.status === "failed") {
      send(res, 422, result);
    } else {
      send(res, 200, result);
    }
    return true;
  }

  const cancelOrder = is(method, "POST", pathname, "/api/v1/orders/:orderId/cancel");
  if (cancelOrder) {
    const result = cancelProductOrder(db, cancelOrder.orderId, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }

  const cancelRequest = is(method, "POST", pathname, "/api/v1/orders/:orderId/cancel-request");
  if (cancelRequest) {
    ensureChannelMatch(auth, getProductOrder(db, cancelRequest.orderId).channelId);
    const result = createTerminateOrder(db, cancelRequest.orderId, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 201, { terminateOrderId: result.id, originalOrderId: result.originalOrderId, status: result.status });
    return true;
  }
  return false;
}

async function handleOrderQueryRoutes({ res, method, pathname, db, auth }) {
  const getOrder = is(method, "GET", pathname, "/api/v1/orders/:orderId");
  if (getOrder) {
    const order = getProductOrder(db, getOrder.orderId);
    ensureChannelMatch(auth, order.channelId);
    send(res, 200, { ...order, notificationDispatched: notificationDispatchedForOrder(db, getOrder.orderId) });
    return true;
  }

  const getSubscriberAccount = is(method, "GET", pathname, "/api/v1/orders/:orderId/subscriber-account");
  if (getSubscriberAccount) {
    const order = getProductOrder(db, getSubscriberAccount.orderId);
    ensureChannelMatch(auth, order.channelId);
    const result = getSubscriberAccountByOrder(db, getSubscriberAccount.orderId);
    if (!result) fail(404, "SUBSCRIBER_ACCOUNT_NOT_FOUND", "SubscriberAccount snapshot was not found.", "orderId");
    send(res, 200, result);
    return true;
  }

  const getChargingResolution = is(method, "GET", pathname, "/api/v1/orders/:orderId/charging-resolution");
  if (getChargingResolution) {
    const order = getProductOrder(db, getChargingResolution.orderId);
    ensureChannelMatch(auth, order.channelId);
    const result = getChargingResolutionRecord(db, getChargingResolution.orderId);
    if (!result) fail(404, "CHARGING_RESOLUTION_NOT_FOUND", "ChargingResolutionRecord was not found.", "orderId");
    send(res, 200, result);
    return true;
  }

  const getTariffMigration = is(method, "GET", pathname, "/api/v1/orders/:orderId/tariff-migration");
  if (getTariffMigration) {
    const order = getProductOrder(db, getTariffMigration.orderId);
    ensureChannelMatch(auth, order.channelId);
    send(res, 200, getTariffMigrationRequest(db, getTariffMigration.orderId));
    return true;
  }
  return false;
}

async function handleTransferPinRoutes({ req, res, method, pathname, query, db, persistence, mergedConfig, auth }) {
  if (method === "POST" && pathname === "/api/v1/transfer/pin") {
    const result = setTransferPin(db, await readJson(req), { channelId: auth?.channelId });
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  if (method === "POST" && pathname === "/api/v1/transfer/pin/reset") {
    if ((auth?.channelType || query.channelType) !== "CRM") fail(403, "PIN_RESET_NOT_AUTHORIZED", "Admin PIN reset is restricted to CRM channels.", "channelType");
    const result = setTransferPin(db, await readJson(req), { adminReset: true, channelId: auth?.channelId || "CRM" });
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  if (method === "POST" && pathname === "/api/v1/transfer/request") {
    const result = await withAsyncIdempotency(db, req.headers["idempotency-key"], "transfer-request", async () =>
      requestCreditTransfer(db, await readJson(req), { chargingSystemClient: mergedConfig.chargingSystemClient })
    );
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const getTransfer = is(method, "GET", pathname, "/api/v1/transfer/:transferId");
  if (getTransfer) {
    send(res, 200, getCreditTransfer(db, getTransfer.transferId));
    return true;
  }
  if (method === "GET" && pathname === "/api/v1/transfer") {
    send(res, 200, listCreditTransfers(db, query));
    return true;
  }
  return false;
}

async function handleTransferLimitRoutes({ req, res, method, pathname, query, db, persistence }) {
  if (method === "GET" && pathname === "/api/v1/admin/transfer-limits") {
    send(res, 200, listTransferLimits(db, query));
    return true;
  }
  if (method === "POST" && pathname === "/api/v1/admin/transfer-limits") {
    const result = createTransferLimit(db, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  const patchLimit = is(method, "PATCH", pathname, "/api/v1/admin/transfer-limits/:limitId");
  if (patchLimit) {
    const result = updateTransferLimit(db, patchLimit.limitId, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const deleteLimit = is(method, "DELETE", pathname, "/api/v1/admin/transfer-limits/:limitId");
  if (deleteLimit) {
    const result = updateTransferLimit(db, deleteLimit.limitId, { status: "inactive" });
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  return false;
}

async function handleInventoryRoutes({ req, res, method, pathname, query, db, persistence, mergedConfig, auth }) {
  if (method === "GET" && pathname === "/api/v1/inventory") {
    send(res, 200, listProductInventory(db, query));
    return true;
  }
  const getInventory = is(method, "GET", pathname, "/api/v1/inventory/:inventoryId");
  if (getInventory) {
    send(res, 200, getProductInventory(db, getInventory.inventoryId));
    return true;
  }
  const getSubscription = is(method, "GET", pathname, "/api/v1/subscriptions/:subscriptionId");
  if (getSubscription) {
    send(res, 200, getProductInventory(db, getSubscription.subscriptionId));
    return true;
  }
  const getBalanceCheck = is(method, "GET", pathname, "/api/v1/subscribers/:subscriberId/balance-check");
  if (getBalanceCheck) {
    const result = await getConsolidatedBalanceCheck(db, getBalanceCheck.subscriberId, query, {
      channelType: auth?.channelType || query.channelType || "USSD",
      channelId: auth?.channelId || query.channelId,
      chargingSystemClient: mergedConfig.chargingSystemClient
    });
    send(res, 200, result);
    return true;
  }
  const patchInventory = is(method, "PATCH", pathname, "/api/v1/inventory/:inventoryId/status");
  if (patchInventory) {
    const result = updateProductInventoryStatus(db, patchInventory.inventoryId, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  return false;
}

async function handleNotificationRoutes({ res, method, pathname, query, db, persistence, mergedConfig }) {
  if (method === "GET" && pathname === "/api/v1/compensation-records") {
    send(res, 200, listCompensationRecords(db, query));
    return true;
  }
  if (method === "GET" && pathname === "/api/v1/notification-events") {
    send(res, 200, listNotificationEvents(db, query));
    return true;
  }
  const dispatchEvent = is(method, "POST", pathname, "/api/v1/notification-events/:eventId/dispatch");
  if (dispatchEvent) {
    const result = await dispatchNotificationEvent(db, dispatchEvent.eventId, {
      gatewayClient: mergedConfig.gatewayClient,
      chargingSystemClient: mergedConfig.chargingSystemClient
    });
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  if (method === "GET" && pathname === "/api/v1/admin/dispatch-records") {
    send(res, 200, listNotificationDispatchRecords(db, query));
    return true;
  }
  const getDispatchRecord = is(method, "GET", pathname, "/api/v1/admin/dispatch-records/:dispatchId");
  if (getDispatchRecord) {
    send(res, 200, getNotificationDispatchRecord(db, getDispatchRecord.dispatchId));
    return true;
  }
  const getOrderNotifications = is(method, "GET", pathname, "/api/v1/orders/:orderId/notification-events");
  if (getOrderNotifications) {
    send(res, 200, listNotificationEvents(db, { orderId: getOrderNotifications.orderId }));
    return true;
  }
  return false;
}

async function handleRenewalRoutes({ req, res, method, pathname, query, db, persistence }) {
  if (method === "GET" && pathname === "/api/v1/renewal-schedules") {
    send(res, 200, listRenewalSchedules(db, query));
    return true;
  }
  if (method === "POST" && pathname === "/api/v1/renewal-schedules") {
    const result = createRenewalSchedule(db, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  const getRenewal = is(method, "GET", pathname, "/api/v1/renewal-schedules/:scheduleId");
  if (getRenewal) {
    send(res, 200, getRenewalSchedule(db, getRenewal.scheduleId));
    return true;
  }
  const cancelRenewal = is(method, "DELETE", pathname, "/api/v1/renewal-schedules/:scheduleId");
  if (cancelRenewal) {
    const result = updateRenewalSchedule(db, cancelRenewal.scheduleId, { status: "cancelled" });
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  return false;
}

async function handleRelationshipRoutes({ req, res, method, pathname, query, db, persistence }) {
  if (method === "GET" && pathname === "/api/v1/party-relationships") {
    send(res, 200, listPartyRelationships(db, query));
    return true;
  }
  if (method === "POST" && pathname === "/api/v1/party-relationships") {
    const result = createPartyRelationship(db, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  const getRelationship = is(method, "GET", pathname, "/api/v1/party-relationships/:relationshipId");
  if (getRelationship) {
    send(res, 200, getPartyRelationship(db, getRelationship.relationshipId));
    return true;
  }
  return false;
}

async function handleStaffRoutes({ req, res, method, pathname, query, db, persistence }) {
  if (method === "POST" && pathname === "/api/v1/staff/link") {
    const result = createStaffNumberLink(db, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  if (method === "GET" && pathname === "/api/v1/staff/links") {
    send(res, 200, listStaffNumberLinks(db, query));
    return true;
  }
  const deleteStaffLink = is(method, "DELETE", pathname, "/api/v1/staff/links/:linkId");
  if (deleteStaffLink) {
    const result = deactivateStaffNumberLink(db, deleteStaffLink.linkId);
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  return false;
}

async function handleChannelRoutes(routeContext) {
  if (await handleChannelManagementRoutes(routeContext)) return true;
  return await handleChannelSubscriptionCaptureRoutes(routeContext);
}

async function handleChannelManagementRoutes({ req, res, method, pathname, query, db, persistence }) {
  if (method === "POST" && pathname === "/api/v1/channels") {
    const result = createChannel(db, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  if (method === "GET" && pathname === "/api/v1/channels") {
    send(res, 200, listChannels(db, query));
    return true;
  }
  const getChannelRoute = is(method, "GET", pathname, "/api/v1/channels/:channelId");
  if (getChannelRoute) {
    send(res, 200, getChannel(db, getChannelRoute.channelId));
    return true;
  }
  const patchChannel = is(method, "PATCH", pathname, "/api/v1/channels/:channelId");
  if (patchChannel) {
    const result = updateChannel(db, patchChannel.channelId, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const activateChannelRoute = is(method, "POST", pathname, "/api/v1/channels/:channelId/activate");
  if (activateChannelRoute) {
    const result = activateChannel(db, activateChannelRoute.channelId);
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const deactivateChannelRoute = is(method, "POST", pathname, "/api/v1/channels/:channelId/deactivate");
  if (deactivateChannelRoute) {
    const result = deactivateChannel(db, deactivateChannelRoute.channelId);
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  const regenerateChannelKey = is(method, "POST", pathname, "/api/v1/channels/:channelId/regenerate-key");
  if (regenerateChannelKey) {
    const result = regenerateChannelApiKey(db, regenerateChannelKey.channelId);
    await saveIfNeeded(persistence, db);
    send(res, 200, result);
    return true;
  }
  if (method === "GET" && pathname === "/api/v1/channel-interactions") {
    send(res, 200, listChannelInteractions(db, query));
    return true;
  }
  return false;
}

async function handleChannelSubscriptionCaptureRoutes({ req, res, method, pathname, db, persistence }) {
  const captureSubscriptionRequest = is(method, "POST", pathname, "/api/v1/channels/:channelId/subscription-requests");
  if (captureSubscriptionRequest) {
    const result = captureChannelSubscriptionRequest(db, captureSubscriptionRequest.channelId, await readJson(req));
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  const captureUssdPull = is(method, "POST", pathname, "/api/v1/channels/:channelId/ussd/pull");
  if (captureUssdPull) {
    const result = captureChannelSubscriptionRequest(db, captureUssdPull.channelId, await readJson(req), { expectedType: "USSD", requestType: "ussdPull" });
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  const captureUssdPush = is(method, "POST", pathname, "/api/v1/channels/:channelId/ussd/push");
  if (captureUssdPush) {
    const result = captureChannelSubscriptionRequest(db, captureUssdPush.channelId, await readJson(req), { expectedType: "USSD", requestType: "ussdPush" });
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  const captureSmsMessage = is(method, "POST", pathname, "/api/v1/channels/:channelId/sms/messages");
  if (captureSmsMessage) {
    const result = captureChannelSubscriptionRequest(db, captureSmsMessage.channelId, await readJson(req), { expectedType: "SMS", requestType: "smsMessage" });
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  const captureCrmSubscription = is(method, "POST", pathname, "/api/v1/channels/:channelId/crm/subscription-requests");
  if (captureCrmSubscription) {
    const result = captureChannelSubscriptionRequest(db, captureCrmSubscription.channelId, await readJson(req), { expectedType: "CRM", requestType: "crmSubscription" });
    await saveIfNeeded(persistence, db);
    send(res, 201, result);
    return true;
  }
  return false;
}

export function createHandler(db = defaultStore, config = configFromEnv(), persistence = undefined) {
  const mergedConfig = { ...configFromEnv(), ...config };
  return async function handler(req, res) {
    try {
      const { pathname, query } = parseUrl(req);
      const method = req.method;
      let auth = null;

      if (mergedConfig.enableAuthEnforcement && pathname.startsWith("/api/v1/") && !isPublicRoute(method, pathname)) {
        auth = validateChannelAuth(db, req.headers, mergedConfig);
      }

      const routeContext = {
        req,
        res,
        method,
        pathname,
        query,
        db,
        persistence,
        mergedConfig,
        auth
      };

      const routeHandlers = [
        handleHealthRoutes,
        handleAuthRoutes,
        handleCatalogSpecifications,
        handleCatalogOfferings,
        handleOfferingPricingRoutes,
        handleOfferingEligibilityRoutes,
        handleAdminCurrencyRoutes,
        handleAdminTemplateRoutes,
        handleAdminPartyRoutes,
        handleAdminBonusTickRoutes,
        handleSimUpgradeRoutes,
        handleCustomerPreferencesRoutes,
        handleCustomerSegmentRoutes,
        handleAdminAuditRoutes,
        handleCartRoutes,
        handleProductOrderRoutes,
        handleOrdersCollectionRoutes,
        handleOrderLifecycleRoutes,
        handleOrderQueryRoutes,
        handleTransferPinRoutes,
        handleTransferLimitRoutes,
        handleInventoryRoutes,
        handleNotificationRoutes,
        handleRenewalRoutes,
        handleRelationshipRoutes,
        handleStaffRoutes,
        handleChannelRoutes
      ];

      for (const handler of routeHandlers) {
        if (await handler(routeContext)) return;
      }

      send(res, 404, errorBody(new ApiError(404, "ROUTE_NOT_FOUND", "Route was not found.", "path", "NOT_FOUND")));
    } catch (error) {
      if (error instanceof ApiError) return send(res, error.status, errorBody(error));
      console.error(error);
      return send(res, 500, errorBody(new ApiError(500, "INTERNAL_ERROR", "Unexpected server error.", "server", "INTERNAL_ERROR")));
    }
  };
}

