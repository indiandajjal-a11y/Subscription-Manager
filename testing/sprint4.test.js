import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { createStore } from "../code/store.js";
import {
  activateProductOffering,
  activateProductSpecification,
  addCartItem,
  addProductOfferingPrice,
  checkoutShoppingCart,
  createChannelWithApiKey,
  createProductOffering,
  createProductSpecification,
  createShoppingCart,
  createSubscriberAccountSnapshot,
  executeProductOrderFulfillment,
  issueChannelAuthToken,
  listNotificationEvents,
  listProductInventory,
  revokeChannelAuthToken,
  validateChannelAuth,
  validateProductOrderWithSubscriberAccount,
  validateShoppingCart
} from "../code/domain.js";
import { RealChargingSystemClient } from "../code/sprint4.js";

const characteristics = [
  { name: "dataVolume", valueType: "number", value: "5", unit: "GB" },
  { name: "validityPeriod", valueType: "number", value: "30", unit: "days" },
  { name: "bundleType", valueType: "string", value: "monthly" },
  { name: "neaActivationRequired", valueType: "boolean", value: "true" }
];

function reason(fn) {
  try {
    fn();
  } catch (error) {
    return { status: error.status, reasonCode: error.reasonCode };
  }
  assert.fail("Expected function to throw");
}

function acknowledgedOrder(db) {
  const spec = activateProductSpecification(db, createProductSpecification(db, {
    name: `Sprint 4 Spec ${randomUUID()}`,
    version: "1.0",
    characteristics
  }).id);
  const offering = createProductOffering(db, {
    name: `Sprint 4 Offering ${randomUUID()}`,
    productSpecificationId: spec.id,
    channelAvailability: ["API_PARTNER"],
    eligibilityRules: [{
      ruleType: "segment",
      operator: "equals",
      value: "CONSUMER",
      failureReasonCode: "SUBSCRIBER_INELIGIBLE"
    }]
  });
  addProductOfferingPrice(db, offering.id, {
    priceType: "standard",
    amount: 100,
    currency: "NGN",
    chargingSource: "MA",
    isDefault: true
  });
  activateProductOffering(db, offering.id);
  const cart = createShoppingCart(db, { channelId: "API_PARTNER", subscriberId: "2348012345678", currency: "NGN" });
  addCartItem(db, cart.id, { productOfferingId: offering.id });
  validateShoppingCart(db, cart.id, { subscriberAttributes: { segment: "CONSUMER" } });
  return checkoutShoppingCart(db, cart.id);
}

test("Sprint 4 issues, validates, and revokes channel auth tokens", () => {
  const db = createStore();
  const channel = createChannelWithApiKey(db, {
    name: "Partner Gateway",
    channelId: "PARTNER",
    type: "API_PARTNER"
  });

  const token = issueChannelAuthToken(db, {
    channelId: "PARTNER",
    apiKey: channel.apiKey
  }, { jwtSecret: "test-secret", jwtTtlSeconds: 60 });

  assert.equal(token.tokenType, "Bearer");
  assert.equal(validateChannelAuth(db, { authorization: `Bearer ${token.accessToken}` }, { jwtSecret: "test-secret" }).channelId, "PARTNER");
  assert.equal(validateChannelAuth(db, { "x-api-key": channel.apiKey }).channelType, "API_PARTNER");

  assert.deepEqual(revokeChannelAuthToken(db, { token: token.accessToken, revokedBy: "test" }).revoked, true);
  assert.deepEqual(reason(() => validateChannelAuth(db, { authorization: `Bearer ${token.accessToken}` }, { jwtSecret: "test-secret" })), {
    status: 401,
    reasonCode: "TOKEN_REVOKED"
  });
});

test("Sprint 4 validates ProductOrders with a live SubscriberAccount snapshot", () => {
  const db = createStore();
  const order = acknowledgedOrder(db);
  const account = createSubscriberAccountSnapshot(db, order.id, {
    subscriberId: order.subscriberId,
    serviceClass: "PREPAID",
    segment: "CONSUMER",
    mainBalance: 500,
    currency: "NGN",
    daBalances: []
  });

  const validated = validateProductOrderWithSubscriberAccount(db, order.id, account);

  assert.equal(validated.status, "inProgress");
  assert.equal(validated.subscriberAccountId, account.id);
  assert.equal(validated.validationResult.overallValid, true);
});

test("Sprint 4 rate-limits token issuance per channel", () => {
  const db = createStore();
  const channel = createChannelWithApiKey(db, {
    name: "Limited Partner",
    channelId: "LIMITED",
    type: "API_PARTNER"
  });

  issueChannelAuthToken(db, {
    channelId: "LIMITED",
    apiKey: channel.apiKey
  }, { jwtSecret: "test-secret", authTokenRateLimit: 1 });

  assert.deepEqual(reason(() => issueChannelAuthToken(db, {
    channelId: "LIMITED",
    apiKey: channel.apiKey
  }, { jwtSecret: "test-secret", authTokenRateLimit: 1 })), {
    status: 429,
    reasonCode: "RATE_LIMIT_EXCEEDED"
  });
});

test("Sprint 4 stores ProductInventory closure fields and honors activation notification flags", () => {
  const db = createStore();
  const order = acknowledgedOrder(db);
  const account = createSubscriberAccountSnapshot(db, order.id, {
    subscriberId: order.subscriberId,
    serviceClass: "PREPAID",
    segment: "CONSUMER",
    mainBalance: 500,
    currency: "NGN"
  });
  validateProductOrderWithSubscriberAccount(db, order.id, account);
  const completed = executeProductOrderFulfillment(db, order.id, {
    inventory: {
      refillId: "REFILL-100",
      notificationFlags: { onActivation: false },
      csAttachmentId: "CS-ATTACH-1"
    }
  });

  const inventory = listProductInventory(db, { subscriberId: order.subscriberId })[0];
  assert.equal(completed.subscriptionId, inventory.id);
  assert.equal(inventory.refillId, "REFILL-100");
  assert.equal(inventory.notificationFlags.onActivation, false);
  assert.equal(inventory.csAttachmentId, "CS-ATTACH-1");
  assert.equal(listNotificationEvents(db, { orderId: order.id, eventType: "ORDER_COMPLETED" }).length, 0);
});

test("Sprint 4 RealChargingSystemClient retries transient CS failures and maps remove/credit-back calls", async () => {
  let gadCalls = 0;
  let removeSeen = null;
  let creditBackSeen = null;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};

    if (req.url === "/gad") {
      gadCalls += 1;
      if (gadCalls === 1) {
        res.writeHead(503, { "content-type": "application/json" });
        return res.end(JSON.stringify({ responseCode: "TEMPORARY_FAILURE" }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ subscriberId: body.subscriberId, mainBalance: 1000, responseCode: "0" }));
    }

    if (req.url === "/scapv2/remove") {
      removeSeen = body;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ removalId: "REMOVE-1", status: "success" }));
    }

    if (req.url === "/scapv2/credit-back") {
      creditBackSeen = body;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ transactionId: "CREDIT-1", status: "success" }));
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const client = new RealChargingSystemClient({
      csEndpointUrl: `http://127.0.0.1:${port}`,
      csTimeoutMs: 1000,
      csTransientErrorCodes: ["503"],
      csClientRetryCount: 1
    });

    const account = await client.fetchSubscriberAccount({ subscriberId: "2348012345678", transactionRef: "ORDER-1" });
    assert.equal(gadCalls, 2);
    assert.equal(account.subscriberId, "2348012345678");

    const remove = await client.removeOffer({ subscriberId: "2348012345678", productOfferingId: "OFFER-1", transactionRef: "ORDER-1" });
    assert.equal(remove.removalId, "REMOVE-1");
    assert.equal(removeSeen.productOfferingId, "OFFER-1");

    const creditBack = await client.creditBack({
      subscriberId: "2348012345678",
      amount: 100,
      currency: "NGN",
      chargingSource: "MA",
      originalTransactionRef: "ORDER-1",
      transactionRef: "CREDIT-ORDER-1"
    });
    assert.equal(creditBack.transactionId, "CREDIT-1");
    assert.equal(creditBackSeen.originalTransactionRef, "ORDER-1");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
