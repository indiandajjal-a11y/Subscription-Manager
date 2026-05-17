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
  createProductOffering,
  createProductSpecification,
  createShoppingCart,
  createSubscriberAccountSnapshot,
  createTerminateOrderFromSubscription,
  executeProductOrderFulfillment,
  getCancellationEligibilityResult,
  getChargingResolutionRecord,
  listNotificationEvents,
  listProductInventory,
  updateProductOffering,
  validateProductOrder,
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

function offeringWithPrice(db, priceBody = {}) {
  const spec = activateProductSpecification(db, createProductSpecification(db, {
    name: `Sprint 5 Spec ${randomUUID()}`,
    version: "1.0",
    characteristics
  }).id);
  const offering = createProductOffering(db, {
    name: `Sprint 5 Offering ${randomUUID()}`,
    productSpecificationId: spec.id,
    channelAvailability: ["USSD"]
  });
  addProductOfferingPrice(db, offering.id, {
    priceType: "standard",
    amount: 100,
    currency: "NGN",
    chargingSource: "MA",
    isDefault: true,
    ...priceBody
  });
  return activateProductOffering(db, offering.id);
}

function acknowledgedOrder(db, priceBody = {}, subscriberAttributes = {}) {
  const offering = offeringWithPrice(db, priceBody);
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "2348012345678", currency: "NGN" });
  addCartItem(db, cart.id, { productOfferingId: offering.id });
  validateShoppingCart(db, cart.id, { subscriberAttributes });
  return { order: checkoutShoppingCart(db, cart.id), offering };
}

function completedOrder(db, priceBody = {}, accountData = {}) {
  const { order, offering } = acknowledgedOrder(db, priceBody);
  const account = createSubscriberAccountSnapshot(db, order.id, {
    subscriberId: order.subscriberId,
    serviceClass: "PREPAID",
    segment: "CONSUMER",
    mainBalance: 1000,
    currency: "NGN",
    daBalances: [],
    ...accountData
  });
  validateProductOrderWithSubscriberAccount(db, order.id, account);
  const completed = executeProductOrderFulfillment(db, order.id, { inventory: { csAttachmentId: "ATTACH-1" } });
  return { order: completed, offering, inventory: listProductInventory(db, { subscriberId: order.subscriberId })[0] };
}

test("Sprint 5 creates terminate orders from subscriptionId and completes cancellation details", () => {
  const db = createStore();
  const { inventory } = completedOrder(db);

  const terminate = createTerminateOrderFromSubscription(db, {
    subscriptionId: inventory.id,
    subscriberId: inventory.subscriberId,
    cancellationReason: "Subscriber requested"
  }, { channelId: "USSD", subscriberId: inventory.subscriberId });

  assert.equal(terminate.orderType, "terminate");
  assert.equal(terminate.subscriptionId, inventory.id);
  assert.equal(validateProductOrder(db, terminate.id, { csOfferStatus: "notAttached" }).status, "inProgress");
  assert.equal(getCancellationEligibilityResult(db, terminate.id).eligibilityPassed, true);

  const completed = executeProductOrderFulfillment(db, terminate.id, {});
  assert.equal(completed.status, "completed");
  assert.equal(inventory.status, "terminated");
  assert.equal(inventory.terminationReason, "Subscriber requested");
  assert.equal(completed.cancellationConfirmedAt, inventory.terminatedAt);
  assert.equal(listNotificationEvents(db, { orderId: terminate.id, eventType: "ORDER_CANCELLED" }).length, 1);
});

test("Sprint 5 blocks inactive, unowned, and window-restricted cancellation", () => {
  const db = createStore();
  const { inventory, offering } = completedOrder(db);

  assert.deepEqual(reason(() => createTerminateOrderFromSubscription(db, {
    subscriptionId: inventory.id,
    subscriberId: "another-subscriber"
  }, { channelId: "USSD", subscriberId: "another-subscriber" })), {
    status: 403,
    reasonCode: "SUBSCRIPTION_NOT_OWNED"
  });

  updateProductOffering(db, offering.id, { cancellationWindowHours: 24 });
  const terminate = createTerminateOrderFromSubscription(db, {
    subscriptionId: inventory.id,
    subscriberId: inventory.subscriberId
  }, { channelId: "USSD", subscriberId: inventory.subscriberId });
  assert.deepEqual(reason(() => validateProductOrder(db, terminate.id, {})), {
    status: 422,
    reasonCode: "CANCELLATION_WINDOW_NOT_ELAPSED"
  });

  inventory.status = "terminated";
  assert.deepEqual(reason(() => createTerminateOrderFromSubscription(db, {
    subscriptionId: inventory.id,
    subscriberId: inventory.subscriberId
  }, { channelId: "USSD", subscriberId: inventory.subscriberId })), {
    status: 422,
    reasonCode: "SUBSCRIPTION_ALREADY_INACTIVE"
  });
});

test("Sprint 5 NEA failure flags inventory but still terminates subscription and can suppress notification", () => {
  const db = createStore();
  const { inventory } = completedOrder(db);
  inventory.notificationFlags.onExpiry = false;
  const terminate = createTerminateOrderFromSubscription(db, {
    subscriptionId: inventory.id,
    subscriberId: inventory.subscriberId,
    cancellationReason: "NEA reconciliation"
  }, { channelId: "USSD", subscriberId: inventory.subscriberId });

  validateProductOrder(db, terminate.id, {});
  executeProductOrderFulfillment(db, terminate.id, { failedStep: "neaDeactivation" });

  assert.equal(inventory.status, "terminated");
  assert.equal(inventory.neaDeprovisioningFailed, true);
  assert.equal(listNotificationEvents(db, { orderId: terminate.id, eventType: "ORDER_CANCELLED" }).length, 0);
});

test("Sprint 5 resolves DA priority fallback and records skipped sources", () => {
  const db = createStore();
  const { order } = acknowledgedOrder(db, {
    chargingSource: "DA",
    daId: "DA1",
    chargingPriority: [
      { priority: 1, source: "DA", daId: "DA1" },
      { priority: 2, source: "DA", daId: "DA2" }
    ]
  });
  const account = createSubscriberAccountSnapshot(db, order.id, {
    subscriberId: order.subscriberId,
    mainBalance: 0,
    daBalances: [{ daId: "DA1", balance: 10 }, { daId: "DA2", balance: 150 }]
  });

  validateProductOrderWithSubscriberAccount(db, order.id, account);
  const resolution = getChargingResolutionRecord(db, order.id);

  assert.equal(resolution.chargeAllocations[0].status, "skipped");
  assert.equal(resolution.chargeAllocations[1].status, "debited");
  assert.equal(resolution.chargeAllocations[1].daId, "DA2");
});

test("Sprint 5 supports partial charging across MA and DA", () => {
  const db = createStore();
  const { order } = acknowledgedOrder(db, {
    chargingSource: "MA",
    allowPartialCharge: true,
    chargingPriority: [
      { priority: 1, source: "MA" },
      { priority: 2, source: "DA", daId: "DA1" }
    ]
  });
  const account = createSubscriberAccountSnapshot(db, order.id, {
    subscriberId: order.subscriberId,
    mainBalance: 40,
    daBalances: [{ daId: "DA1", balance: 60 }]
  });

  validateProductOrderWithSubscriberAccount(db, order.id, account);
  executeProductOrderFulfillment(db, order.id, {});
  const resolution = getChargingResolutionRecord(db, order.id);

  assert.deepEqual(resolution.chargeAllocations.map((allocation) => allocation.allocationAmount), [40, 60]);
  assert.equal(resolution.chargeAllocations.reduce((sum, allocation) => sum + allocation.allocationAmount, 0), resolution.chargedAmount);
});

test("Sprint 5 applies highest CS-attribute discount and debits finalChargeAmount", () => {
  const db = createStore();
  const { order } = acknowledgedOrder(db, {
    chargingSource: "MA",
    priceAlteration: [
      {
        name: "VIP fixed",
        alterationType: "DISCOUNT_FIXED",
        alterationValue: 20,
        eligibilityRules: [{ attribute: "serviceClass", operator: "equals", value: "VIP" }]
      },
      {
        name: "VIP percentage",
        alterationType: "DISCOUNT_PERCENTAGE",
        alterationValue: 50,
        eligibilityRules: [{ attribute: "serviceClass", operator: "equals", value: "VIP" }]
      }
    ]
  }, { serviceClass: "VIP" });
  const account = createSubscriberAccountSnapshot(db, order.id, {
    subscriberId: order.subscriberId,
    serviceClass: "VIP",
    mainBalance: 100
  });

  validateProductOrderWithSubscriberAccount(db, order.id, account);
  executeProductOrderFulfillment(db, order.id, {});
  const resolution = getChargingResolutionRecord(db, order.id);
  const debit = order.fulfillmentSteps.find((step) => step.stepName === "debit");

  assert.equal(resolution.appliedDiscount, 50);
  assert.equal(resolution.chargedAmount, 50);
  assert.equal(order.validationResult.finalChargeAmount, 50);
  assert.equal(debit.requestPayload.amount, 50);
});

test("Sprint 5 enforces default charging source and rejects unconfigured prices", () => {
  const db = createStore();
  assert.deepEqual(reason(() => offeringWithPrice(db, { chargingSource: undefined, defaultChargingSource: undefined })), {
    status: 422,
    reasonCode: "CHARGING_SOURCE_NOT_CONFIGURED"
  });

  const { order } = acknowledgedOrder(db, {
    chargingSource: null,
    defaultChargingSource: "MA"
  });
  const account = createSubscriberAccountSnapshot(db, order.id, {
    subscriberId: order.subscriberId,
    mainBalance: 100
  });

  validateProductOrderWithSubscriberAccount(db, order.id, account);
  const resolution = getChargingResolutionRecord(db, order.id);
  assert.equal(resolution.resolvedFromDefault, true);
  assert.equal(resolution.chargeAllocations[0].source, "MA");
});
