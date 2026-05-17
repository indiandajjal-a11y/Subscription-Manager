import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHandler } from "../code/app.js";
import { createStore } from "../code/store.js";
import { createChannel } from "../code/domain.js";

const characteristics = [
  { name: "dataVolume", valueType: "number", value: "5", unit: "GB" },
  { name: "validityPeriod", valueType: "number", value: "30", unit: "days" },
  { name: "bundleType", valueType: "string", value: "monthly" },
  { name: "neaActivationRequired", valueType: "boolean", value: "true" }
];

async function withServer(fn, options = {}) {
  const db = options.db || createStore();
  const server = http.createServer(createHandler(db, options.config));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`, db);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function request(baseUrl, method, path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json", ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null
  };
}

async function createActiveOffering(baseUrl) {
  const specResponse = await request(baseUrl, "POST", "/api/v1/catalog/specifications", {
    name: `HTTP Spec ${crypto.randomUUID()}`,
    version: "1.0",
    characteristics
  });
  assert.equal(specResponse.status, 201);

  const activateSpec = await request(baseUrl, "POST", `/api/v1/catalog/specifications/${specResponse.body.id}/activate`);
  assert.equal(activateSpec.status, 200);

  const offeringResponse = await request(baseUrl, "POST", "/api/v1/catalog/offerings", {
    name: `HTTP Offering ${crypto.randomUUID()}`,
    productSpecificationId: specResponse.body.id,
    channelAvailability: ["USSD"]
  });
  assert.equal(offeringResponse.status, 201);

  const priceResponse = await request(baseUrl, "POST", `/api/v1/catalog/offerings/${offeringResponse.body.id}/prices`, {
    priceType: "standard",
    amount: 100,
    currency: "NGN",
    chargingSource: "MA",
    isDefault: true
  });
  assert.equal(priceResponse.status, 201);

  const activateOffering = await request(baseUrl, "POST", `/api/v1/catalog/offerings/${offeringResponse.body.id}/activate`);
  assert.equal(activateOffering.status, 200);
  return offeringResponse.body.id;
}

test("HTTP catalog/cart happy path creates an acknowledged product order", async () => {
  await withServer(async (baseUrl) => {
    const offeringId = await createActiveOffering(baseUrl);
    const cartResponse = await request(baseUrl, "POST", "/api/v1/cart", {
      channelId: "USSD",
      subscriberId: "2348012345678",
      currency: "NGN"
    });
    assert.equal(cartResponse.status, 201);

    const itemResponse = await request(baseUrl, "POST", `/api/v1/cart/${cartResponse.body.cartId}/items`, {
      productOfferingId: offeringId,
      purchasePolicy: "one-off"
    });
    assert.equal(itemResponse.status, 201);

    const validateResponse = await request(baseUrl, "POST", `/api/v1/cart/${cartResponse.body.cartId}/validate`, {
      subscriberAttributes: { serviceClass: "PREPAID" }
    });
    assert.equal(validateResponse.status, 200);
    assert.equal(validateResponse.body.status, "validated");
    assert.equal(validateResponse.body.items[0].pricedAmount, 100);

    const checkoutResponse = await request(baseUrl, "POST", `/api/v1/cart/${cartResponse.body.cartId}/checkout`);
    assert.equal(checkoutResponse.status, 201);
    assert.equal(checkoutResponse.body.status, "acknowledged");
    assert.equal(checkoutResponse.body.cartId, cartResponse.body.cartId);

    const orderResponse = await request(baseUrl, "GET", `/api/v1/product-order/${checkoutResponse.body.orderId}`);
    assert.equal(orderResponse.status, 200);
    assert.equal(orderResponse.body.status, "acknowledged");
    assert.equal(orderResponse.body.items.length, 1);

    const orderValidationResponse = await request(baseUrl, "POST", `/api/v1/orders/${checkoutResponse.body.orderId}/validate`, {});
    assert.equal(orderValidationResponse.status, 200);
    assert.equal(orderValidationResponse.body.status, "inProgress");

    const fulfillmentResponse = await request(baseUrl, "POST", `/api/v1/orders/${checkoutResponse.body.orderId}/fulfill`, {});
    assert.equal(fulfillmentResponse.status, 200);
    assert.equal(fulfillmentResponse.body.status, "completed");
  });
});

test("HTTP validation returns the standard error envelope", async () => {
  await withServer(async (baseUrl) => {
    const response = await request(baseUrl, "POST", "/api/v1/cart", {
      channelId: "USSD",
      subscriberId: "2348012345678",
      currency: "EUR"
    });

    assert.equal(response.status, 422);
    assert.equal(response.body.error.code, "VALIDATION_ERROR");
    assert.equal(response.body.error.details[0].reasonCode, "UNSUPPORTED_CURRENCY");
  });
});

test("HTTP channel filtering only returns permitted active offerings", async () => {
  await withServer(async (baseUrl) => {
    await createActiveOffering(baseUrl);

    const ussdResponse = await request(baseUrl, "GET", "/api/v1/catalog/offerings?status=active&channelId=USSD");
    assert.equal(ussdResponse.status, 200);
    assert.equal(ussdResponse.body.length, 1);

    const smsResponse = await request(baseUrl, "GET", "/api/v1/catalog/offerings?status=active&channelId=SMS");
    assert.equal(smsResponse.status, 200);
    assert.equal(smsResponse.body.length, 0);
  });
});

test("HTTP Sprint 3 channel request can create order and inventory", async () => {
  await withServer(async (baseUrl) => {
    const offeringId = await createActiveOffering(baseUrl);
    const channelResponse = await request(baseUrl, "POST", "/api/v1/channels", {
      name: "USSD",
      type: "USSD"
    });
    assert.equal(channelResponse.status, 201);

    const interactionResponse = await request(baseUrl, "POST", `/api/v1/channels/${channelResponse.body.id}/ussd/pull`, {
      subscriberId: "2348012345678",
      productOfferingId: offeringId,
      currency: "NGN",
      subscriberAttributes: {},
      autoCheckout: true
    });
    assert.equal(interactionResponse.status, 201);
    assert.equal(interactionResponse.body.status, "orderCreated");

    const orderValidationResponse = await request(baseUrl, "POST", `/api/v1/orders/${interactionResponse.body.orderId}/validate`, {});
    assert.equal(orderValidationResponse.status, 200);

    const fulfillResponse = await request(baseUrl, "POST", `/api/v1/orders/${interactionResponse.body.orderId}/fulfill`, {});
    assert.equal(fulfillResponse.status, 200);
    assert.equal(fulfillResponse.body.status, "completed");

    const inventoryResponse = await request(baseUrl, "GET", "/api/v1/inventory?subscriberId=2348012345678");
    assert.equal(inventoryResponse.status, 200);
    assert.equal(inventoryResponse.body.length, 1);
  });
});

test("HTTP Sprint 4 auth endpoint issues tokens and protects subscription routes", async () => {
  const db = createStore();
  const channel = createChannel(db, {
      name: "USSD",
      channelId: "USSD",
      type: "USSD"
    });
  await withServer(async (baseUrl) => {
    const missingToken = await request(baseUrl, "POST", "/api/v1/cart", {
      channelId: "USSD",
      subscriberId: "2348012345678",
      currency: "NGN"
    });
    assert.equal(missingToken.status, 401);
    assert.equal(missingToken.body.error.details[0].reasonCode, "MISSING_TOKEN");

    const tokenResponse = await request(baseUrl, "POST", "/api/v1/auth/token", {
      channelId: "USSD",
      apiKey: channel.apiKey
    });
    assert.equal(tokenResponse.status, 200);
    assert.equal(tokenResponse.body.tokenType, "Bearer");

    const authHeaders = { authorization: `Bearer ${tokenResponse.body.accessToken}` };
    const mismatch = await request(baseUrl, "POST", "/api/v1/cart", {
      channelId: "SMS",
      subscriberId: "2348012345678",
      currency: "NGN"
    }, authHeaders);
    assert.equal(mismatch.status, 403);
    assert.equal(mismatch.body.error.details[0].reasonCode, "CHANNEL_MISMATCH");

    const cartResponse = await request(baseUrl, "POST", "/api/v1/cart", {
      channelId: "USSD",
      subscriberId: "2348012345678",
      currency: "NGN"
    }, authHeaders);
    assert.equal(cartResponse.status, 201);
  }, {
    db,
    config: {
      enableAuthEnforcement: true,
      jwtSecret: "http-test-secret",
      jwtTtlSeconds: 60
    }
  });
});
