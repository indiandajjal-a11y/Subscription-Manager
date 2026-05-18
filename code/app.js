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
  return method === reqMethod ? match(method, pathname, pattern)?.params || null : null;
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
    const reason = csResult.failureReason === "CS_TIMEOUT" ? "CS_TIMEOUT" : "CS_SUBSCRIBER_FETCH_FAILED";
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
  return method === expectedMethod
    ? is(method, expectedMethod, pathname, pattern)
    : null;
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

export function createHandler(db = defaultStore, config = configFromEnv(), persistence = undefined) {
  const mergedConfig = { ...configFromEnv(), ...config };
  return async function handler(req, res) {
    try {
      const { pathname, query } = parseUrl(req);
      const method = req.method;
      let params;
      let auth = null;

      if ((method === "GET" && pathname === "/health") || (method === "GET" && pathname === "/api/v1/health")) {
        return send(res, 200, { status: "ok", checks: { db: "ok" } });
      }
      if (method === "GET" && pathname === "/api/v1/ready") {
        return send(res, 200, await readiness(db, { chargingSystemClient: mergedConfig.chargingSystemClient }));
      }

      if (mergedConfig.enableAuthEnforcement && pathname.startsWith("/api/v1/") && !isPublicRoute(method, pathname)) {
        auth = validateChannelAuth(db, req.headers, mergedConfig);
      }

      if (method === "POST" && pathname === "/api/v1/auth/token") {
        const result = await withAsyncIdempotency(db, req.headers["idempotency-key"], "auth-token", async () =>
          issueChannelAuthToken(db, await readJson(req), mergedConfig)
        );
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if (method === "POST" && pathname === "/api/v1/auth/revoke") {
        const body = await readJson(req);
        const result = revokeChannelAuthToken(db, body);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if (method === "GET" && pathname === "/api/v1/auth/tokens") {
        return send(res, 200, listChannelAuthTokens(db, query));
      }

      if (route(method, pathname, "POST", "/api/v1/catalog/specifications")) {
  return executeAndSend(res, persistence, db, 201, async () =>
    createProductSpecification(db, await readJson(req))
  );
}
if (route(method, pathname, "GET", "/api/v1/catalog/specifications")) {
  return send(res, 200, listProductSpecifications(db, query));
} 
      params = is(method, "GET", pathname, "/api/v1/catalog/specifications/:id");
      if (params) {
        return send(res, 200, getProductSpecification(db, params.id));
      }
      params = routeWithParams(method, pathname, "PATCH", "/api/v1/catalog/specifications/:id");
      if (params) {
        const result = updateProductSpecification(db, params.id, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "POST", pathname, "/api/v1/catalog/specifications/:id/activate");
      if (params) {
        const result = activateProductSpecification(db, params.id);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "POST", pathname, "/api/v1/catalog/specifications/:id/retire");
      if (params) {
        const result = retireProductSpecification(db, params.id);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }

      if (method === "POST" && pathname === "/api/v1/catalog/offerings") {
        const result = createProductOffering(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if (method === "GET" && pathname === "/api/v1/catalog/offerings") {
        const result = listProductOfferings(db, query);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "GET", pathname, "/api/v1/catalog/offerings/:id");
      if (params) {
        const result = getProductOffering(db, params.id);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "PATCH", pathname, "/api/v1/catalog/offerings/:id");
      if (params) {
        const result = updateProductOffering(db, params.id, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "POST", pathname, "/api/v1/catalog/offerings/:id/activate");
      if (params) {
        const result = activateProductOffering(db, params.id);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "POST", pathname, "/api/v1/catalog/offerings/:id/retire");
      if (params) {
        const result = retireProductOffering(db, params.id);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "POST", pathname, "/api/v1/catalog/offerings/:id/compensation-config");
      if (params) {
        const result = setCompensationConfig(db, params.id, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "GET", pathname, "/api/v1/catalog/offerings/:id/compensation-config");
      if (params) {
        return send(res, 200, getCompensationConfig(db, params.id));
      }
      params = is(method, "POST", pathname, "/api/v1/catalog/offerings/:id/prices");
      if (params) {
        const result = addProductOfferingPrice(db, params.id, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      params = is(method, "GET", pathname, "/api/v1/catalog/offerings/:id/prices");
      if (params) {
        return send(res, 200, getProductOffering(db, params.id).prices);
      }
      params = is(method, "GET", pathname, "/api/v1/catalog/offerings/:id/prices/:priceId");
      if (params) {
        return send(res, 200, getProductOfferingPrice(db, params.id, params.priceId));
      }
      params = is(method, "PATCH", pathname, "/api/v1/catalog/offerings/:id/prices/:priceId");
      if (params) {
        const result = updateProductOfferingPrice(db, params.id, params.priceId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "DELETE", pathname, "/api/v1/catalog/offerings/:id/prices/:priceId");
      if (params) {
        deleteProductOfferingPrice(db, params.id, params.priceId);
        await saveIfNeeded(persistence, db);
        return send(res, 200, { deleted: true });
      }
      params = is(method, "POST", pathname, "/api/v1/catalog/offerings/:id/eligibility-rules");
      if (params) {
        const result = addEligibilityRule(db, params.id, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      params = is(method, "DELETE", pathname, "/api/v1/catalog/offerings/:id/eligibility-rules/:ruleId");
      if (params) {
        deleteEligibilityRule(db, params.id, params.ruleId);
        await saveIfNeeded(persistence, db);
        return send(res, 200, { deleted: true });
      }

      if (method === "POST" && pathname === "/api/v1/admin/currencies") {
        const result = createCurrencyConfig(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if (method === "GET" && pathname === "/api/v1/admin/currencies") {
        return send(res, 200, listCurrencyConfigs(db, query));
      }
      params = is(method, "GET", pathname, "/api/v1/admin/currencies/:code");
      if (params) {
        return send(res, 200, getCurrencyConfig(db, params.code));
      }
      params = is(method, "PATCH", pathname, "/api/v1/admin/currencies/:code");
      if (params) {
        const result = updateCurrencyConfig(db, params.code, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "DELETE", pathname, "/api/v1/admin/currencies/:code");
      if (params) {
        const result = retireCurrencyConfig(db, params.code);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }

      if (method === "POST" && pathname === "/api/v1/admin/templates") {
        const result = createCommunicationTemplate(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if (method === "GET" && pathname === "/api/v1/admin/templates") {
        return send(res, 200, listCommunicationTemplates(db, query));
      }
      params = is(method, "GET", pathname, "/api/v1/admin/templates/:templateId");
      if (params) {
        return send(res, 200, getCommunicationTemplate(db, params.templateId));
      }
      params = is(method, "PATCH", pathname, "/api/v1/admin/templates/:templateId");
      if (params) {
        const result = updateCommunicationTemplate(db, params.templateId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "DELETE", pathname, "/api/v1/admin/templates/:templateId");
      if (params) {
        const result = retireCommunicationTemplate(db, params.templateId);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }

      if (method === "POST" && pathname === "/api/v1/admin/parties") {
        const result = createParty(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if (method === "GET" && pathname === "/api/v1/admin/parties") {
        return send(res, 200, listParties(db, query));
      }
      if (method === "POST" && pathname === "/api/v1/admin/dormant-cleanup") {
        const result = await createDormantCleanupRequest(db, await readJson(req), {
          channelType: auth?.channelType || query.channelType || "CRM",
          channelId: auth?.channelId || query.channelId || "CRM",
          offlineCleanupClient: mergedConfig.offlineCleanupClient
        });
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if (method === "GET" && pathname === "/api/v1/admin/dormant-cleanup") {
        return send(res, 200, listDormantCleanupRequests(db, query));
      }
      params = is(method, "GET", pathname, "/api/v1/admin/dormant-cleanup/:requestId");
      if (params) {
        return send(res, 200, getDormantCleanupRequest(db, params.requestId));
      }

      params = is(method, "POST", pathname, "/api/v1/catalog/offerings/:id/bonus-detection");
      if (params) {
        const result = createBonusDetectionConfig(db, params.id, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if (method === "GET" && pathname === "/api/v1/admin/bonus-detection") {
        return send(res, 200, listBonusDetectionConfigs(db, query));
      }
      params = is(method, "GET", pathname, "/api/v1/catalog/offerings/:id/bonus-detection");
      if (params) {
        return send(res, 200, getBonusDetectionConfig(db, params.id));
      }
      params = is(method, "PATCH", pathname, "/api/v1/catalog/offerings/:id/bonus-detection");
      if (params) {
        const result = updateBonusDetectionConfig(db, params.id, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if (method === "GET" && pathname === "/api/v1/admin/bonus-detection-records") {
        return send(res, 200, listBonusDetectionRecords(db, query));
      }

      if (method === "POST" && pathname === "/api/v1/admin/tick-rules") {
        const result = createTickProvisioningRule(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if (method === "GET" && pathname === "/api/v1/admin/tick-rules") {
        return send(res, 200, listTickProvisioningRules(db, query));
      }
      params = is(method, "GET", pathname, "/api/v1/admin/tick-rules/:ruleId");
      if (params) {
        return send(res, 200, getTickProvisioningRule(db, params.ruleId));
      }
      params = is(method, "PATCH", pathname, "/api/v1/admin/tick-rules/:ruleId");
      if (params) {
        const result = updateTickProvisioningRule(db, params.ruleId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "DELETE", pathname, "/api/v1/admin/tick-rules/:ruleId");
      if (params) {
        const result = deactivateTickProvisioningRule(db, params.ruleId);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }

      if (method === "GET" && pathname === "/api/v1/admin/sim-upgrade-config") {
        return send(res, 200, getActiveSimUpgradeConfig(db));
      }
      if (method === "PATCH" && pathname === "/api/v1/admin/sim-upgrade-config") {
        const result = upsertSimUpgradeConfig(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if (method === "POST" && pathname === "/api/v1/admin/customer-preferences") {
        const result = upsertCustomerPreference(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      params = is(method, "GET", pathname, "/api/v1/admin/customer-preferences/:subscriberId");
      if (params) return send(res, 200, getCustomerPreference(db, params.subscriberId));
      params = is(method, "PATCH", pathname, "/api/v1/admin/customer-preferences/:subscriberId");
      if (params) {
        const result = upsertCustomerPreference(db, { ...(await readJson(req)), subscriberId: params.subscriberId });
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if (method === "POST" && pathname === "/api/v1/sim-upgrade/device-event") {
        if (mergedConfig.deviceMgmtApiKey && req.headers["x-device-mgmt-key"] !== mergedConfig.deviceMgmtApiKey) {
          fail(401, "INVALID_DEVICE_MGMT_KEY", "Invalid device management API key.", "X-Device-Mgmt-Key");
        }
        const result = await processSimUpgradeDeviceEvent(db, await readJson(req), {
          simCheckClient: mergedConfig.simCheckClient,
          chargingSystemClient: mergedConfig.chargingSystemClient
        });
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if (method === "POST" && pathname === "/api/v1/sim-upgrade/cs-callback") {
        if (mergedConfig.csCallbackApiKey && req.headers["x-cs-callback-key"] !== mergedConfig.csCallbackApiKey) {
          fail(401, "INVALID_CS_CALLBACK_KEY", "Invalid CS callback API key.", "X-CS-Callback-Key");
        }
        const result = await receiveSimUpgradeCallback(db, await readJson(req), { gatewayClient: mergedConfig.gatewayClient });
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if (method === "POST" && pathname === "/api/v1/sim-upgrade/subscriber-response") {
        const result = await handleSimUpgradeSubscriberResponse(db, await readJson(req), { gatewayClient: mergedConfig.gatewayClient });
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if (method === "GET" && pathname === "/api/v1/admin/sim-upgrade-events") {
        return send(res, 200, listSimUpgradeEvents(db, query));
      }
      params = is(method, "GET", pathname, "/api/v1/admin/sim-upgrade-events/:eventId");
      if (params) return send(res, 200, getSimUpgradeEvent(db, params.eventId));

      if (method === "GET" && pathname === "/api/v1/admin/audit-log") {
        return send(res, 200, auditLog(db, query));
      }

      if (method === "POST" && pathname === "/api/v1/catalog/segments") {
        const result = createCustomerSegment(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if (method === "GET" && pathname === "/api/v1/catalog/segments") {
        return send(res, 200, listCustomerSegments(db, query));
      }
      params = is(method, "GET", pathname, "/api/v1/catalog/segments/:segmentId");
      if (params) {
        return send(res, 200, getCustomerSegment(db, params.segmentId));
      }
      params = is(method, "PATCH", pathname, "/api/v1/catalog/segments/:segmentId");
      if (params) {
        const result = updateCustomerSegment(db, params.segmentId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "DELETE", pathname, "/api/v1/catalog/segments/:segmentId");
      if (params) {
        const result = updateCustomerSegment(db, params.segmentId, { status: "retired" });
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }

      if (method === "POST" && pathname === "/api/v1/cart") {
        const body = await readJson(req);
        ensureChannelMatch(auth, body.channelId);
        const cart = withIdempotency(db, req.headers["idempotency-key"], "cart-create", () =>
          createShoppingCart(db, body, mergedConfig)
        );
        await saveIfNeeded(persistence, db);
        return send(res, 201, { cartId: cart.id, expiresAt: cart.expiresAt, currency: cart.currency });
      }
      params = is(method, "GET", pathname, "/api/v1/cart/:cartId");
      if (params) {
        const cart = getShoppingCart(db, params.cartId, true);
        ensureChannelMatch(auth, cart.channelId);
        return send(res, 200, cart);
      }
      params = is(method, "POST", pathname, "/api/v1/cart/:cartId/items");
      if (params) {
        const body = await readJson(req);
        const cart = getShoppingCart(db, params.cartId, false);
        ensureChannelMatch(auth, cart.channelId);
        ensureOfferingAuthorized(db, auth, body.productOfferingId);
        const item = addCartItem(db, params.cartId, body);
        await saveIfNeeded(persistence, db);
        return send(res, 201, { cartItemId: item.id });
      }
      params = is(method, "DELETE", pathname, "/api/v1/cart/:cartId/items/:itemId");
      if (params) {
        removeCartItem(db, params.cartId, params.itemId);
        await saveIfNeeded(persistence, db);
        res.writeHead(204);
        return res.end();
      }
      params = is(method, "POST", pathname, "/api/v1/cart/:cartId/validate");
      if (params) {
        ensureChannelMatch(auth, getShoppingCart(db, params.cartId, false).channelId);
        const result = validateShoppingCart(db, params.cartId, await readJson(req));
        await saveIfNeeded(persistence, db);
        if (result.errors.length > 0) {
          return send(res, 422, {
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
        }
        return send(res, 200, result.cart);
      }
      params = is(method, "POST", pathname, "/api/v1/cart/:cartId/checkout");
      if (params) {
        ensureChannelMatch(auth, getShoppingCart(db, params.cartId, false).channelId);
        const order = checkoutShoppingCart(db, params.cartId);
        await saveIfNeeded(persistence, db);
        return send(res, 201, { orderId: order.id, cartId: order.cartId, status: order.status });
      }
      params = is(method, "POST", pathname, "/api/v1/cart/:cartId/subscribe");
      if (params) {
        ensureChannelMatch(auth, getShoppingCart(db, params.cartId, false).channelId);
        const body = await readJson(req);
        const result = await subscribeCart(db, params.cartId, {
          validationBody: body.validationBody || body,
          fulfillmentBody: body.fulfillmentBody || {},
          subscriberAccount: body.subscriberAccount,
          gatewayClient: mergedConfig.gatewayClient,
          channelType: body.channelType
        });
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "DELETE", pathname, "/api/v1/cart/:cartId");
      if (params) {
        const result = abandonShoppingCart(db, params.cartId);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }

      if (method === "GET" && pathname === "/api/v1/product-order") {
        return send(res, 200, listProductOrders(db, query));
      }
      if (method === "POST" && pathname === "/api/v1/product-order") {
        const result = captureProductOrderFromCart(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      params = is(method, "GET", pathname, "/api/v1/product-order/:orderId");
      if (params) {
        return send(res, 200, getProductOrder(db, params.orderId));
      }
      params = is(method, "POST", pathname, "/api/v1/product-order/:orderId/state");
      if (params) {
        const result = updateProductOrderState(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "POST", pathname, "/api/v1/product-order/:orderId/validate");
      if (params) {
        const result = validateProductOrder(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "POST", pathname, "/api/v1/product-order/:orderId/fulfill");
      if (params) {
        const result = executeProductOrderFulfillment(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, result.status === "failed" ? 422 : 200, result);
      }
      params = is(method, "POST", pathname, "/api/v1/product-order/:orderId/cancel");
      if (params) {
        const result = cancelProductOrder(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "POST", pathname, "/api/v1/product-order/:orderId/compensate");
      if (params) {
        const result = compensateProductOrder(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "POST", pathname, "/api/v1/product-order/:orderId/retry");
      if (params) {
        const result = retryProductOrderFulfillment(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }

      if (method === "GET" && pathname === "/api/v1/orders") {
        return send(res, 200, listProductOrders(db, query));
      }
      if (method === "POST" && pathname === "/api/v1/orders") {
        const body = await readJson(req);
        const result = withIdempotency(db, req.headers["idempotency-key"], "orders-create", () =>
          createOrderFromRequest(db, body, auth)
        );
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      params = is(method, "GET", pathname, "/api/v1/orders/:orderId");
      if (params) {
        const order = getProductOrder(db, params.orderId);
        ensureChannelMatch(auth, order.channelId);
        return send(res, 200, { ...order, notificationDispatched: notificationDispatchedForOrder(db, params.orderId) });
      }
      params = is(method, "POST", pathname, "/api/v1/orders/:orderId/validate");
      if (params) {
        await readJson(req);
        const order = getProductOrder(db, params.orderId);
        ensureChannelMatch(auth, order.channelId);
        const result = await validateOrderForRequest(db, order, params.orderId, mergedConfig);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "POST", pathname, "/api/v1/orders/:orderId/fulfill");
      if (params) {
        const order = getProductOrder(db, params.orderId);
        ensureChannelMatch(auth, order.channelId);
        const body = await readJson(req);
        const result = order.orderType === "modify" && order.modifyType === "TARIFF_MIGRATION"
          ? await fulfillTariffMigrationOrder(db, params.orderId, {
            chargingSystemClient: mergedConfig.chargingSystemClient,
            tickProvisioningClient: mergedConfig.tickProvisioningClient
          })
          : executeProductOrderFulfillment(db, params.orderId, body);
        if (result.status === "completed" && ["provision", "gift"].includes(result.orderType)) {
          await runBonusDetectionForOrder(db, params.orderId, { chargingSystemClient: mergedConfig.chargingSystemClient });
        }
        await saveIfNeeded(persistence, db);
        return send(res, result.status === "failed" ? 422 : 200, result);
      }
      params = is(method, "POST", pathname, "/api/v1/orders/:orderId/cancel");
      if (params) {
        const result = cancelProductOrder(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "POST", pathname, "/api/v1/orders/:orderId/cancel-request");
      if (params) {
        ensureChannelMatch(auth, getProductOrder(db, params.orderId).channelId);
        const result = createTerminateOrder(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, { terminateOrderId: result.id, originalOrderId: result.originalOrderId, status: result.status });
      }
      params = is(method, "GET", pathname, "/api/v1/orders/:orderId/subscriber-account");
      if (params) {
        const order = getProductOrder(db, params.orderId);
        ensureChannelMatch(auth, order.channelId);
        const result = getSubscriberAccountByOrder(db, params.orderId);
        if (!result) fail(404, "SUBSCRIBER_ACCOUNT_NOT_FOUND", "SubscriberAccount snapshot was not found.", "orderId");
        return send(res, 200, result);
      }
      params = is(method, "GET", pathname, "/api/v1/orders/:orderId/charging-resolution");
      if (params) {
        const order = getProductOrder(db, params.orderId);
        ensureChannelMatch(auth, order.channelId);
        const result = getChargingResolutionRecord(db, params.orderId);
        if (!result) fail(404, "CHARGING_RESOLUTION_NOT_FOUND", "ChargingResolutionRecord was not found.", "orderId");
        return send(res, 200, result);
      }
      params = is(method, "GET", pathname, "/api/v1/orders/:orderId/tariff-migration");
      if (params) {
        const order = getProductOrder(db, params.orderId);
        ensureChannelMatch(auth, order.channelId);
        return send(res, 200, getTariffMigrationRequest(db, params.orderId));
      }

      if (method === "POST" && pathname === "/api/v1/transfer/pin") {
        const result = setTransferPin(db, await readJson(req), { channelId: auth?.channelId });
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if (method === "POST" && pathname === "/api/v1/transfer/pin/reset") {
        if ((auth?.channelType || query.channelType) !== "CRM") fail(403, "PIN_RESET_NOT_AUTHORIZED", "Admin PIN reset is restricted to CRM channels.", "channelType");
        const result = setTransferPin(db, await readJson(req), { adminReset: true, channelId: auth?.channelId || "CRM" });
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if (method === "POST" && pathname === "/api/v1/transfer/request") {
        const result = await withAsyncIdempotency(db, req.headers["idempotency-key"], "transfer-request", async () =>
          requestCreditTransfer(db, await readJson(req), { chargingSystemClient: mergedConfig.chargingSystemClient })
        );
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "GET", pathname, "/api/v1/transfer/:transferId");
      if (params) return send(res, 200, getCreditTransfer(db, params.transferId));
      if (method === "GET" && pathname === "/api/v1/transfer") {
        return send(res, 200, listCreditTransfers(db, query));
      }
      if (method === "GET" && pathname === "/api/v1/admin/transfer-limits") {
        return send(res, 200, listTransferLimits(db, query));
      }
      if (method === "POST" && pathname === "/api/v1/admin/transfer-limits") {
        const result = createTransferLimit(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      params = is(method, "PATCH", pathname, "/api/v1/admin/transfer-limits/:limitId");
      if (params) {
        const result = updateTransferLimit(db, params.limitId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "DELETE", pathname, "/api/v1/admin/transfer-limits/:limitId");
      if (params) {
        const result = updateTransferLimit(db, params.limitId, { status: "inactive" });
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }

      if (method === "GET" && pathname === "/api/v1/inventory") {
        return send(res, 200, listProductInventory(db, query));
      }
      params = is(method, "GET", pathname, "/api/v1/inventory/:inventoryId");
      if (params) {
        return send(res, 200, getProductInventory(db, params.inventoryId));
      }
      params = is(method, "GET", pathname, "/api/v1/subscriptions/:subscriptionId");
      if (params) {
        return send(res, 200, getProductInventory(db, params.subscriptionId));
      }
      params = is(method, "GET", pathname, "/api/v1/subscribers/:subscriberId/balance-check");
      if (params) {
        const result = await getConsolidatedBalanceCheck(db, params.subscriberId, query, {
          channelType: auth?.channelType || query.channelType || "USSD",
          channelId: auth?.channelId || query.channelId,
          chargingSystemClient: mergedConfig.chargingSystemClient
        });
        return send(res, 200, result);
      }
      params = is(method, "PATCH", pathname, "/api/v1/inventory/:inventoryId/status");
      if (params) {
        const result = updateProductInventoryStatus(db, params.inventoryId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if (method === "GET" && pathname === "/api/v1/compensation-records") {
        return send(res, 200, listCompensationRecords(db, query));
      }
      if (method === "GET" && pathname === "/api/v1/notification-events") {
        return send(res, 200, listNotificationEvents(db, query));
      }
      params = is(method, "POST", pathname, "/api/v1/notification-events/:eventId/dispatch");
      if (params) {
        const result = await dispatchNotificationEvent(db, params.eventId, {
          gatewayClient: mergedConfig.gatewayClient,
          chargingSystemClient: mergedConfig.chargingSystemClient
        });
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if (method === "GET" && pathname === "/api/v1/admin/dispatch-records") {
        return send(res, 200, listNotificationDispatchRecords(db, query));
      }
      params = is(method, "GET", pathname, "/api/v1/admin/dispatch-records/:dispatchId");
      if (params) {
        return send(res, 200, getNotificationDispatchRecord(db, params.dispatchId));
      }
      params = is(method, "GET", pathname, "/api/v1/orders/:orderId/notification-events");
      if (params) {
        return send(res, 200, listNotificationEvents(db, { orderId: params.orderId }));
      }

      if (method === "GET" && pathname === "/api/v1/renewal-schedules") {
        return send(res, 200, listRenewalSchedules(db, query));
      }
      if (method === "POST" && pathname === "/api/v1/renewal-schedules") {
        const result = createRenewalSchedule(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      params = is(method, "GET", pathname, "/api/v1/renewal-schedules/:scheduleId");
      if (params) {
        return send(res, 200, getRenewalSchedule(db, params.scheduleId));
      }
      params = is(method, "DELETE", pathname, "/api/v1/renewal-schedules/:scheduleId");
      if (params) {
        const result = updateRenewalSchedule(db, params.scheduleId, { status: "cancelled" });
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }

      if (method === "GET" && pathname === "/api/v1/party-relationships") {
        return send(res, 200, listPartyRelationships(db, query));
      }
      if (method === "POST" && pathname === "/api/v1/party-relationships") {
        const result = createPartyRelationship(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      params = is(method, "GET", pathname, "/api/v1/party-relationships/:relationshipId");
      if (params) {
        return send(res, 200, getPartyRelationship(db, params.relationshipId));
      }

      if (method === "POST" && pathname === "/api/v1/staff/link") {
        const result = createStaffNumberLink(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if (method === "GET" && pathname === "/api/v1/staff/links") {
        return send(res, 200, listStaffNumberLinks(db, query));
      }
      params = is(method, "DELETE", pathname, "/api/v1/staff/links/:linkId");
      if (params) {
        const result = deactivateStaffNumberLink(db, params.linkId);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }

      if (method === "POST" && pathname === "/api/v1/channels") {
        const result = createChannel(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if (method === "GET" && pathname === "/api/v1/channels") {
        return send(res, 200, listChannels(db, query));
      }
      params = is(method, "GET", pathname, "/api/v1/channels/:channelId");
      if (params) {
        return send(res, 200, getChannel(db, params.channelId));
      }
      params = is(method, "PATCH", pathname, "/api/v1/channels/:channelId");
      if (params) {
        const result = updateChannel(db, params.channelId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "POST", pathname, "/api/v1/channels/:channelId/activate");
      if (params) {
        const result = activateChannel(db, params.channelId);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "POST", pathname, "/api/v1/channels/:channelId/deactivate");
      if (params) {
        const result = deactivateChannel(db, params.channelId);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "POST", pathname, "/api/v1/channels/:channelId/regenerate-key");
      if (params) {
        const result = regenerateChannelApiKey(db, params.channelId);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      params = is(method, "POST", pathname, "/api/v1/channels/:channelId/subscription-requests");
      if (params) {
        const result = captureChannelSubscriptionRequest(db, params.channelId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      params = is(method, "POST", pathname, "/api/v1/channels/:channelId/ussd/pull");
      if (params) {
        const result = captureChannelSubscriptionRequest(db, params.channelId, await readJson(req), { expectedType: "USSD", requestType: "ussdPull" });
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      params = is(method, "POST", pathname, "/api/v1/channels/:channelId/ussd/push");
      if (params) {
        const result = captureChannelSubscriptionRequest(db, params.channelId, await readJson(req), { expectedType: "USSD", requestType: "ussdPush" });
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      params = is(method, "POST", pathname, "/api/v1/channels/:channelId/sms/messages");
      if (params) {
        const result = captureChannelSubscriptionRequest(db, params.channelId, await readJson(req), { expectedType: "SMS", requestType: "smsMessage" });
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      params = is(method, "POST", pathname, "/api/v1/channels/:channelId/crm/subscription-requests");
      if (params) {
        const result = captureChannelSubscriptionRequest(db, params.channelId, await readJson(req), { expectedType: "CRM", requestType: "crmSubscription" });
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if (method === "GET" && pathname === "/api/v1/channel-interactions") {
        return send(res, 200, listChannelInteractions(db, query));
      }

      return send(res, 404, errorBody(new ApiError(404, "ROUTE_NOT_FOUND", "Route was not found.", "path", "NOT_FOUND")));
    } catch (error) {
      if (error instanceof ApiError) return send(res, error.status, errorBody(error));
      console.error(error);
      return send(res, 500, errorBody(new ApiError(500, "INTERNAL_ERROR", "Unexpected server error.", "server", "INTERNAL_ERROR")));
    }
  };
}
