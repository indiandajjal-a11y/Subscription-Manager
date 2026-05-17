import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createStore } from "../code/store.js";
import {
  activateProductOffering,
  activateProductSpecification,
  addCartItem,
  addProductOfferingPrice,
  cancelProductOrder,
  captureProductOrderFromCart,
  checkoutShoppingCart,
  createProductOffering,
  createProductSpecification,
  createShoppingCart,
  executeProductOrderFulfillment,
  getProductOrder,
  listProductOrders,
  removeCartItem,
  retireProductOffering,
  updateProductOrderState,
  validateProductOrder,
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

function createValidatedCart(db, options = {}) {
  const spec = activateProductSpecification(db, createProductSpecification(db, {
    name: `Sprint 2 Spec ${randomUUID()}`,
    version: "1.0",
    characteristics: options.characteristics || characteristics
  }).id);
  const offering = createProductOffering(db, {
    name: `Sprint 2 Offering ${randomUUID()}`,
    productSpecificationId: spec.id,
    channelAvailability: options.channelAvailability || ["USSD"],
    eligibilityRules: options.eligibilityRules || []
  });
  addProductOfferingPrice(db, offering.id, {
    priceType: "standard",
    amount: options.amount || 250,
    currency: "NGN",
    chargingSource: options.chargingSource || "MA",
    daId: options.daId,
    isDefault: true
  });
  activateProductOffering(db, offering.id);

  const cart = createShoppingCart(db, { channelId: options.channelId || "USSD", subscriberId: "2348012345678", currency: "NGN" });
  addCartItem(db, cart.id, { productOfferingId: offering.id, quantity: 2, purchasePolicy: "one-off" });
  validateShoppingCart(db, cart.id, { subscriberAttributes: options.subscriberAttributes || { serviceClass: "PREPAID" } });
  return { cart, offering };
}

test("Sprint 2 checkout creates a ProductOrder with item snapshot and totals", () => {
  const db = createStore();
  const { cart, offering } = createValidatedCart(db);
  const order = checkoutShoppingCart(db, cart.id);

  assert.equal(order.status, "acknowledged");
  assert.equal(order.cartId, cart.id);
  assert.equal(order.totalAmount, 500);
  assert.equal(order.currency, "NGN");
  assert.equal(order.orderType, "provision");
  assert.equal(order.failureReasonCode, null);
  assert.equal(order.fulfillmentSteps.length, 0);
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].productOfferingId, offering.id);
  assert.equal(order.items[0].pricedAmount, 500);
  assert.equal(order.items[0].pricedCurrency, "NGN");
  assert.equal(order.items[0].amount, 500);
  assert.equal(order.stateHistory[0].eventType, "OrderStateChangeEvent");
});

test("Sprint 2 captures ProductOrder from cart through official POST style", () => {
  const db = createStore();
  const { cart } = createValidatedCart(db);
  const order = captureProductOrderFromCart(db, { cartId: cart.id });

  assert.equal(order.cartId, cart.id);
  assert.equal(order.status, "acknowledged");
});

test("Sprint 2 prevents duplicate active orders for the same cart", () => {
  const db = createStore();
  const { cart } = createValidatedCart(db);
  checkoutShoppingCart(db, cart.id);
  assert.deepEqual(reason(() => checkoutShoppingCart(db, cart.id)), {
    status: 409,
    reasonCode: "CART_CLOSED"
  });
});

test("Sprint 2 can list and retrieve product orders", () => {
  const db = createStore();
  const { cart } = createValidatedCart(db);
  const order = checkoutShoppingCart(db, cart.id);

  assert.equal(getProductOrder(db, order.id).id, order.id);
  assert.equal(listProductOrders(db, { subscriberId: "2348012345678" }).length, 1);
  assert.equal(listProductOrders(db, { status: "acknowledged" })[0].id, order.id);
});

test("Sprint 2 validates ProductOrder before fulfillment", () => {
  const db = createStore();
  const { cart } = createValidatedCart(db);
  const order = checkoutShoppingCart(db, cart.id);

  const validated = validateProductOrder(db, order.id);
  assert.equal(validated.validationStatus, "valid");
  assert.equal(validated.validationReasonCode, null);
  assert.equal(validated.status, "inProgress");
  assert.ok(validated.validatedAt);
  assert.equal(validated.validationResult.overallValid, true);
});

test("Sprint 2 stores failed OrderValidationResult details", () => {
  const db = createStore();
  const { cart } = createValidatedCart(db);
  const order = checkoutShoppingCart(db, cart.id);

  assert.deepEqual(reason(() => validateProductOrder(db, order.id, { balanceSufficient: false })), {
    status: 422,
    reasonCode: "INSUFFICIENT_BALANCE"
  });
  assert.equal(order.validationResult.overallValid, false);
  assert.equal(order.validationResult.balanceSufficient, false);
});

test("Sprint 2 removing an item from a validated cart resets stale validation", () => {
  const db = createStore();
  const { cart } = createValidatedCart(db);

  assert.equal(cart.status, "validated");
  removeCartItem(db, cart.id, cart.items[0].id);

  assert.equal(cart.status, "active");
  assert.equal(cart.items.length, 0);
});

test("Sprint 2 validation uses prompt reason codes and fails critically unavailable offerings", () => {
  const db = createStore();
  const { cart, offering } = createValidatedCart(db);
  const order = checkoutShoppingCart(db, cart.id);

  retireProductOffering(db, offering.id);

  assert.deepEqual(reason(() => validateProductOrder(db, order.id)), {
    status: 422,
    reasonCode: "OFFERING_NO_LONGER_AVAILABLE"
  });
  assert.equal(order.status, "failed");
  assert.equal(order.items[0].status, "failed");
  assert.ok(order.completedAt);
});

test("Sprint 2 validation re-evaluates subscriber attributes and balances", () => {
  const db = createStore();
  const spec = activateProductSpecification(db, createProductSpecification(db, {
    name: `Sprint 2 Eligibility Spec ${randomUUID()}`,
    version: "1.0",
    characteristics
  }).id);
  const offering = createProductOffering(db, {
    name: `Sprint 2 Eligibility Offering ${randomUUID()}`,
    productSpecificationId: spec.id,
    channelAvailability: ["USSD"],
    eligibilityRules: [{
      ruleType: "segment",
      operator: "equals",
      value: "CONSUMER",
      failureReasonCode: "SUBSCRIBER_INELIGIBLE"
    }]
  });
  addProductOfferingPrice(db, offering.id, {
    priceType: "standard",
    amount: 250,
    currency: "NGN",
    chargingSource: "MA",
    isDefault: true
  });
  activateProductOffering(db, offering.id);
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "2348012345678", currency: "NGN" });
  addCartItem(db, cart.id, { productOfferingId: offering.id });
  validateShoppingCart(db, cart.id, { subscriberAttributes: { segment: "CONSUMER" } });
  const order = checkoutShoppingCart(db, cart.id);

  assert.deepEqual(reason(() => validateProductOrder(db, order.id, {
    subscriberAttributes: {
      segment: "BUSINESS",
      balance: { MA: 1000, DA: [] }
    }
  })), {
    status: 422,
    reasonCode: "SUBSCRIBER_INELIGIBLE"
  });
  assert.equal(order.status, "failed");
  assert.equal(order.failureReasonCode, "SUBSCRIBER_INELIGIBLE");
  assert.ok(order.completedAt);
});

test("Sprint 2 validation sums DA balances from the request body", () => {
  const db = createStore();
  const { cart } = createValidatedCart(db, {
    chargingSource: "DA",
    daId: undefined,
    amount: 150
  });
  const order = checkoutShoppingCart(db, cart.id);

  assert.deepEqual(reason(() => validateProductOrder(db, order.id, {
    subscriberAttributes: {
      balance: {
        MA: 0,
        DA: [
          { daId: "DA01", balance: 100 },
          { daId: "DA02", balance: 50 }
        ]
      }
    }
  })), {
    status: 422,
    reasonCode: "INSUFFICIENT_BALANCE"
  });

  const second = checkoutShoppingCart(db, createValidatedCart(db, {
    chargingSource: "DA",
    amount: 150
  }).cart.id);
  assert.equal(validateProductOrder(db, second.id, {
    subscriberAttributes: {
      balance: {
        MA: 0,
        DA: [
          { daId: "DA01", balance: 150 },
          { daId: "DA02", balance: 150 }
        ]
      }
    }
  }).status, "inProgress");
});

test("Sprint 2 enforces allowed ProductOrder state transitions", () => {
  const db = createStore();
  const { cart } = createValidatedCart(db);
  const order = checkoutShoppingCart(db, cart.id);

  assert.deepEqual(reason(() => updateProductOrderState(db, order.id, { status: "completed" })), {
    status: 409,
    reasonCode: "INVALID_ORDER_STATE_TRANSITION"
  });

  assert.equal(updateProductOrderState(db, order.id, { status: "inProgress", reason: "Accepted for fulfillment" }).status, "inProgress");
  assert.equal(updateProductOrderState(db, order.id, { status: "completed", reason: "Fulfilled" }).status, "completed");
});

test("Sprint 2 fulfillment completes charging and provisioning", () => {
  const db = createStore();
  const { cart } = createValidatedCart(db);
  const order = checkoutShoppingCart(db, cart.id);
  validateProductOrder(db, order.id);

  const fulfilled = executeProductOrderFulfillment(db, order.id, {});
  assert.equal(fulfilled.status, "completed");
  assert.equal(fulfilled.fulfillment.chargingStatus, "completed");
  assert.equal(fulfilled.fulfillment.provisioningStatus, "completed");
  assert.equal(fulfilled.items[0].fulfillmentStatus, "completed");
  assert.equal(fulfilled.fulfillmentSteps.map((step) => step.stepName).join(","), "debit,attachOffer,neaActivation");
  assert.equal(fulfilled.fulfillmentSteps.every((step) => step.status === "success"), true);
});

test("Sprint 2 fulfillment can fail on charging", () => {
  const db = createStore();
  const { cart } = createValidatedCart(db);
  const order = checkoutShoppingCart(db, cart.id);
  validateProductOrder(db, order.id);

  const failed = executeProductOrderFulfillment(db, order.id, {
    chargingResult: "failed",
    failureReasonCode: "INSUFFICIENT_BALANCE"
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.failureReasonCode, "FULFILLMENT_STEP_FAILED");
  assert.equal(failed.fulfillment.failureReasonCode, "INSUFFICIENT_BALANCE");
  assert.equal(failed.fulfillmentSteps.length, 1);
});

test("Sprint 2 fulfillment skips NEA when the specification does not require activation", () => {
  const db = createStore();
  const noNeaCharacteristics = characteristics.map((item) => item.name === "neaActivationRequired" ? { ...item, value: "false" } : item);
  const { cart } = createValidatedCart(db, { characteristics: noNeaCharacteristics });
  const order = checkoutShoppingCart(db, cart.id);
  validateProductOrder(db, order.id);

  const fulfilled = executeProductOrderFulfillment(db, order.id, {});
  const neaStep = fulfilled.fulfillmentSteps.find((step) => step.stepName === "neaActivation");

  assert.equal(fulfilled.status, "completed");
  assert.equal(neaStep.status, "skipped");
});

test("Sprint 2 cancellation is allowed before completion and blocked after completion", () => {
  const db = createStore();
  const first = checkoutShoppingCart(db, createValidatedCart(db).cart.id);
  assert.equal(cancelProductOrder(db, first.id, { reason: "Customer request" }).status, "cancelled");

  const second = checkoutShoppingCart(db, createValidatedCart(db).cart.id);
  validateProductOrder(db, second.id);
  executeProductOrderFulfillment(db, second.id, {});
  assert.deepEqual(reason(() => cancelProductOrder(db, second.id, { reason: "Too late" })), {
    status: 409,
    reasonCode: "INVALID_ORDER_STATE_TRANSITION"
  });
});
