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
  if (method === "GET" && pathname === "/health") return true;
  if (method === "POST" && pathname === "/api/v1/auth/token") return true;
  if (method === "GET" && pathname === "/api/v1/catalog/offerings") return true;
  return false;
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

export function createHandler(db = defaultStore, config = configFromEnv(), persistence = undefined) {
  const mergedConfig = { ...configFromEnv(), ...config };
  return async function handler(req, res) {
    try {
      const { pathname, query } = parseUrl(req);
      const method = req.method;
      let params;
      let auth = null;

      if (method === "GET" && pathname === "/health") return send(res, 200, { status: "ok" });

      if (mergedConfig.enableAuthEnforcement && pathname.startsWith("/api/v1/") && !isPublicRoute(method, pathname)) {
        auth = validateChannelAuth(db, req.headers, mergedConfig);
      }

      if (method === "POST" && pathname === "/api/v1/auth/token") {
        const result = issueChannelAuthToken(db, await readJson(req), mergedConfig);
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
      if ((params = is(method, "GET", pathname, "/api/v1/catalog/specifications/:id"))) {
        return send(res, 200, getProductSpecification(db, params.id));
      }
      if ((params = routeWithParams(method, pathname, "PATCH", "/api/v1/catalog/specifications/:id"))) {
        const result = updateProductSpecification(db, params.id, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/catalog/specifications/:id/activate"))) {
        const result = activateProductSpecification(db, params.id);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/catalog/specifications/:id/retire"))) {
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
      if ((params = is(method, "GET", pathname, "/api/v1/catalog/offerings/:id"))) {
        const result = getProductOffering(db, params.id);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "PATCH", pathname, "/api/v1/catalog/offerings/:id"))) {
        const result = updateProductOffering(db, params.id, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/catalog/offerings/:id/activate"))) {
        const result = activateProductOffering(db, params.id);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/catalog/offerings/:id/retire"))) {
        const result = retireProductOffering(db, params.id);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/catalog/offerings/:id/compensation-config"))) {
        const result = setCompensationConfig(db, params.id, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "GET", pathname, "/api/v1/catalog/offerings/:id/compensation-config"))) {
        return send(res, 200, getCompensationConfig(db, params.id));
      }
      if ((params = is(method, "POST", pathname, "/api/v1/catalog/offerings/:id/prices"))) {
        const result = addProductOfferingPrice(db, params.id, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if ((params = is(method, "GET", pathname, "/api/v1/catalog/offerings/:id/prices"))) {
        return send(res, 200, getProductOffering(db, params.id).prices);
      }
      if ((params = is(method, "GET", pathname, "/api/v1/catalog/offerings/:id/prices/:priceId"))) {
        return send(res, 200, getProductOfferingPrice(db, params.id, params.priceId));
      }
      if ((params = is(method, "PATCH", pathname, "/api/v1/catalog/offerings/:id/prices/:priceId"))) {
        const result = updateProductOfferingPrice(db, params.id, params.priceId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "DELETE", pathname, "/api/v1/catalog/offerings/:id/prices/:priceId"))) {
        deleteProductOfferingPrice(db, params.id, params.priceId);
        await saveIfNeeded(persistence, db);
        return send(res, 200, { deleted: true });
      }
      if ((params = is(method, "POST", pathname, "/api/v1/catalog/offerings/:id/eligibility-rules"))) {
        const result = addEligibilityRule(db, params.id, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if ((params = is(method, "DELETE", pathname, "/api/v1/catalog/offerings/:id/eligibility-rules/:ruleId"))) {
        deleteEligibilityRule(db, params.id, params.ruleId);
        await saveIfNeeded(persistence, db);
        return send(res, 200, { deleted: true });
      }

      if (method === "POST" && pathname === "/api/v1/catalog/segments") {
        const result = createCustomerSegment(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if (method === "GET" && pathname === "/api/v1/catalog/segments") {
        return send(res, 200, listCustomerSegments(db, query));
      }
      if ((params = is(method, "GET", pathname, "/api/v1/catalog/segments/:segmentId"))) {
        return send(res, 200, getCustomerSegment(db, params.segmentId));
      }
      if ((params = is(method, "PATCH", pathname, "/api/v1/catalog/segments/:segmentId"))) {
        const result = updateCustomerSegment(db, params.segmentId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "DELETE", pathname, "/api/v1/catalog/segments/:segmentId"))) {
        const result = updateCustomerSegment(db, params.segmentId, { status: "retired" });
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }

      if (method === "POST" && pathname === "/api/v1/cart") {
        const body = await readJson(req);
        ensureChannelMatch(auth, body.channelId);
        const cart = createShoppingCart(db, body, mergedConfig);
        await saveIfNeeded(persistence, db);
        return send(res, 201, { cartId: cart.id, expiresAt: cart.expiresAt, currency: cart.currency });
      }
      if ((params = is(method, "GET", pathname, "/api/v1/cart/:cartId"))) {
        const cart = getShoppingCart(db, params.cartId, true);
        ensureChannelMatch(auth, cart.channelId);
        return send(res, 200, cart);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/cart/:cartId/items"))) {
        const body = await readJson(req);
        const cart = getShoppingCart(db, params.cartId, false);
        ensureChannelMatch(auth, cart.channelId);
        ensureOfferingAuthorized(db, auth, body.productOfferingId);
        const item = addCartItem(db, params.cartId, body);
        await saveIfNeeded(persistence, db);
        return send(res, 201, { cartItemId: item.id });
      }
      if ((params = is(method, "DELETE", pathname, "/api/v1/cart/:cartId/items/:itemId"))) {
        removeCartItem(db, params.cartId, params.itemId);
        await saveIfNeeded(persistence, db);
        res.writeHead(204);
        return res.end();
      }
      if ((params = is(method, "POST", pathname, "/api/v1/cart/:cartId/validate"))) {
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
      if ((params = is(method, "POST", pathname, "/api/v1/cart/:cartId/checkout"))) {
        ensureChannelMatch(auth, getShoppingCart(db, params.cartId, false).channelId);
        const order = checkoutShoppingCart(db, params.cartId);
        await saveIfNeeded(persistence, db);
        return send(res, 201, { orderId: order.id, cartId: order.cartId, status: order.status });
      }
      if ((params = is(method, "DELETE", pathname, "/api/v1/cart/:cartId"))) {
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
      if ((params = is(method, "GET", pathname, "/api/v1/product-order/:orderId"))) {
        return send(res, 200, getProductOrder(db, params.orderId));
      }
      if ((params = is(method, "POST", pathname, "/api/v1/product-order/:orderId/state"))) {
        const result = updateProductOrderState(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/product-order/:orderId/validate"))) {
        const result = validateProductOrder(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/product-order/:orderId/fulfill"))) {
        const result = executeProductOrderFulfillment(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, result.status === "failed" ? 422 : 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/product-order/:orderId/cancel"))) {
        const result = cancelProductOrder(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/product-order/:orderId/compensate"))) {
        const result = compensateProductOrder(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/product-order/:orderId/retry"))) {
        const result = retryProductOrderFulfillment(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }

      if (method === "GET" && pathname === "/api/v1/orders") {
        return send(res, 200, listProductOrders(db, query));
      }
      if (method === "POST" && pathname === "/api/v1/orders") {
        const body = await readJson(req);
        const result = body.orderType === "terminate"
          ? createTerminateOrderFromSubscription(db, body, { ...auth, subscriberId: body.subscriberId })
          : captureProductOrderFromCart(db, body);
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if ((params = is(method, "GET", pathname, "/api/v1/orders/:orderId"))) {
        const order = getProductOrder(db, params.orderId);
        ensureChannelMatch(auth, order.channelId);
        return send(res, 200, order);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/orders/:orderId/validate"))) {
        await readJson(req);
        const order = getProductOrder(db, params.orderId);
        ensureChannelMatch(auth, order.channelId);
        const result = mergedConfig.enableAuthEnforcement
          ? await validateWithChargingSystem(db, params.orderId, mergedConfig, mergedConfig.chargingSystemClient)
          : validateProductOrder(db, params.orderId, {});
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/orders/:orderId/fulfill"))) {
        const order = getProductOrder(db, params.orderId);
        ensureChannelMatch(auth, order.channelId);
        const result = executeProductOrderFulfillment(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, result.status === "failed" ? 422 : 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/orders/:orderId/cancel"))) {
        const result = cancelProductOrder(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/orders/:orderId/cancel-request"))) {
        ensureChannelMatch(auth, getProductOrder(db, params.orderId).channelId);
        const result = createTerminateOrder(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, { terminateOrderId: result.id, originalOrderId: result.originalOrderId, status: result.status });
      }
      if ((params = is(method, "GET", pathname, "/api/v1/orders/:orderId/subscriber-account"))) {
        const order = getProductOrder(db, params.orderId);
        ensureChannelMatch(auth, order.channelId);
        const result = getSubscriberAccountByOrder(db, params.orderId);
        if (!result) fail(404, "SUBSCRIBER_ACCOUNT_NOT_FOUND", "SubscriberAccount snapshot was not found.", "orderId");
        return send(res, 200, result);
      }
      if ((params = is(method, "GET", pathname, "/api/v1/orders/:orderId/charging-resolution"))) {
        const order = getProductOrder(db, params.orderId);
        ensureChannelMatch(auth, order.channelId);
        const result = getChargingResolutionRecord(db, params.orderId);
        if (!result) fail(404, "CHARGING_RESOLUTION_NOT_FOUND", "ChargingResolutionRecord was not found.", "orderId");
        return send(res, 200, result);
      }

      if (method === "GET" && pathname === "/api/v1/inventory") {
        return send(res, 200, listProductInventory(db, query));
      }
      if ((params = is(method, "GET", pathname, "/api/v1/inventory/:inventoryId"))) {
        return send(res, 200, getProductInventory(db, params.inventoryId));
      }
      if ((params = is(method, "GET", pathname, "/api/v1/subscriptions/:subscriptionId"))) {
        return send(res, 200, getProductInventory(db, params.subscriptionId));
      }
      if ((params = is(method, "PATCH", pathname, "/api/v1/inventory/:inventoryId/status"))) {
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

      if (method === "GET" && pathname === "/api/v1/renewal-schedules") {
        return send(res, 200, listRenewalSchedules(db, query));
      }
      if (method === "POST" && pathname === "/api/v1/renewal-schedules") {
        const result = createRenewalSchedule(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if ((params = is(method, "GET", pathname, "/api/v1/renewal-schedules/:scheduleId"))) {
        return send(res, 200, getRenewalSchedule(db, params.scheduleId));
      }
      if ((params = is(method, "DELETE", pathname, "/api/v1/renewal-schedules/:scheduleId"))) {
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
      if ((params = is(method, "GET", pathname, "/api/v1/party-relationships/:relationshipId"))) {
        return send(res, 200, getPartyRelationship(db, params.relationshipId));
      }

      if (method === "POST" && pathname === "/api/v1/channels") {
        const result = createChannel(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if (method === "GET" && pathname === "/api/v1/channels") {
        return send(res, 200, listChannels(db, query));
      }
      if ((params = is(method, "GET", pathname, "/api/v1/channels/:channelId"))) {
        return send(res, 200, getChannel(db, params.channelId));
      }
      if ((params = is(method, "PATCH", pathname, "/api/v1/channels/:channelId"))) {
        const result = updateChannel(db, params.channelId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/channels/:channelId/activate"))) {
        const result = activateChannel(db, params.channelId);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/channels/:channelId/deactivate"))) {
        const result = deactivateChannel(db, params.channelId);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/channels/:channelId/regenerate-key"))) {
        const result = regenerateChannelApiKey(db, params.channelId);
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/channels/:channelId/subscription-requests"))) {
        const result = captureChannelSubscriptionRequest(db, params.channelId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/channels/:channelId/ussd/pull"))) {
        const result = captureChannelSubscriptionRequest(db, params.channelId, await readJson(req), { expectedType: "USSD", requestType: "ussdPull" });
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/channels/:channelId/ussd/push"))) {
        const result = captureChannelSubscriptionRequest(db, params.channelId, await readJson(req), { expectedType: "USSD", requestType: "ussdPush" });
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/channels/:channelId/sms/messages"))) {
        const result = captureChannelSubscriptionRequest(db, params.channelId, await readJson(req), { expectedType: "SMS", requestType: "smsMessage" });
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/channels/:channelId/crm/subscription-requests"))) {
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
