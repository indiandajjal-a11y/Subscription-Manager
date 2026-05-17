import { ApiError, errorBody, fail } from "./errors.js";
import {
  abandonShoppingCart,
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
  deleteEligibilityRule,
  deleteProductOfferingPrice,
  getProductOffering,
  getProductInventory,
  getProductOrder,
  getProductSpecification,
  getShoppingCart,
  getChannel,
  listChannelInteractions,
  listChannels,
  listProductInventory,
  listProductOfferings,
  listProductOrders,
  listProductSpecifications,
  removeCartItem,
  retireProductOffering,
  retireProductSpecification,
  retryProductOrderFulfillment,
  updateChannel,
  updateProductOrderState,
  updateProductOffering,
  updateProductSpecification,
  validateProductOrder,
  executeProductOrderFulfillment,
  validateShoppingCart
} from "./domain.js";
import { store as defaultStore } from "./store.js";

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

export function createHandler(db = defaultStore, config = configFromEnv(), persistence = undefined) {
  return async function handler(req, res) {
    try {
      const { pathname, query } = parseUrl(req);
      const method = req.method;
      let params;

      if (method === "GET" && pathname === "/health") return send(res, 200, { status: "ok" });

      if (method === "POST" && pathname === "/api/v1/catalog/specifications") {
        const result = createProductSpecification(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if (method === "GET" && pathname === "/api/v1/catalog/specifications") {
        return send(res, 200, listProductSpecifications(db, query));
      }
      if ((params = is(method, "GET", pathname, "/api/v1/catalog/specifications/:id"))) {
        return send(res, 200, getProductSpecification(db, params.id));
      }
      if ((params = is(method, "PATCH", pathname, "/api/v1/catalog/specifications/:id"))) {
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
      if ((params = is(method, "POST", pathname, "/api/v1/catalog/offerings/:id/prices"))) {
        const result = addProductOfferingPrice(db, params.id, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if ((params = is(method, "GET", pathname, "/api/v1/catalog/offerings/:id/prices"))) {
        return send(res, 200, getProductOffering(db, params.id).prices);
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

      if (method === "POST" && pathname === "/api/v1/cart") {
        const cart = createShoppingCart(db, await readJson(req), config);
        await saveIfNeeded(persistence, db);
        return send(res, 201, { cartId: cart.id, expiresAt: cart.expiresAt, currency: cart.currency });
      }
      if ((params = is(method, "GET", pathname, "/api/v1/cart/:cartId"))) {
        return send(res, 200, getShoppingCart(db, params.cartId, true));
      }
      if ((params = is(method, "POST", pathname, "/api/v1/cart/:cartId/items"))) {
        const item = addCartItem(db, params.cartId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, { cartItemId: item.id });
      }
      if ((params = is(method, "DELETE", pathname, "/api/v1/cart/:cartId/items/:itemId"))) {
        removeCartItem(db, params.cartId, params.itemId);
        await saveIfNeeded(persistence, db);
        return send(res, 200, { deleted: true });
      }
      if ((params = is(method, "POST", pathname, "/api/v1/cart/:cartId/validate"))) {
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
        return send(res, 200, result);
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
        const result = captureProductOrderFromCart(db, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 201, result);
      }
      if ((params = is(method, "GET", pathname, "/api/v1/orders/:orderId"))) {
        return send(res, 200, getProductOrder(db, params.orderId));
      }
      if ((params = is(method, "POST", pathname, "/api/v1/orders/:orderId/validate"))) {
        const result = validateProductOrder(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/orders/:orderId/fulfill"))) {
        const result = executeProductOrderFulfillment(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }
      if ((params = is(method, "POST", pathname, "/api/v1/orders/:orderId/cancel"))) {
        const result = cancelProductOrder(db, params.orderId, await readJson(req));
        await saveIfNeeded(persistence, db);
        return send(res, 200, result);
      }

      if (method === "GET" && pathname === "/api/v1/inventory") {
        return send(res, 200, listProductInventory(db, query));
      }
      if ((params = is(method, "GET", pathname, "/api/v1/inventory/:inventoryId"))) {
        return send(res, 200, getProductInventory(db, params.inventoryId));
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
