import test from "node:test";
import assert from "node:assert/strict";
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
  issueChannelAuthToken,
  revokeChannelAuthToken,
  validateChannelAuth,
  validateProductOrderWithSubscriberAccount,
  validateShoppingCart
} from "../code/domain.js";

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
