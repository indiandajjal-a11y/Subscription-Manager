import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createStore } from "../code/store.js";
import {
  activateProductOffering,
  activateProductSpecification,
  addCartItem,
  addProductOfferingPrice,
  createTerminateOrder,
  captureChannelSubscriptionRequest,
  compensateProductOrder,
  createChannel,
  checkoutShoppingCart,
  createProductOffering,
  createProductSpecification,
  createShoppingCart,
  executeProductOrderFulfillment,
  getChannel,
  getCompensationConfig,
  getProductInventory,
  listCompensationRecords,
  listChannelInteractions,
  listChannels,
  listNotificationEvents,
  listProductInventory,
  retryProductOrderFulfillment,
  setCompensationConfig,
  updateChannel,
  updateProductInventoryStatus,
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

function activeOffering(db, channelName = "USSD") {
  const spec = activateProductSpecification(db, createProductSpecification(db, {
    name: `Sprint 3 Spec ${randomUUID()}`,
    version: "1.0",
    characteristics
  }).id);
  const offering = createProductOffering(db, {
    name: `Sprint 3 Offering ${randomUUID()}`,
    productSpecificationId: spec.id,
    channelAvailability: [channelName]
  });
  addProductOfferingPrice(db, offering.id, {
    priceType: "standard",
    amount: 100,
    currency: "NGN",
    chargingSource: "MA",
    isDefault: true
  });
  return activateProductOffering(db, offering.id);
}

function completedOrder(db) {
  const offering = activeOffering(db);
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "2348012345678", currency: "NGN" });
  addCartItem(db, cart.id, { productOfferingId: offering.id });
  validateShoppingCart(db, cart.id, {});
  const order = checkoutShoppingCart(db, cart.id);
  validateProductOrder(db, order.id);
  return executeProductOrderFulfillment(db, order.id, {});
}

test("Sprint 3 creates ProductInventory records when an order completes", () => {
  const db = createStore();
  const order = completedOrder(db);
  const inventory = listProductInventory(db, { subscriberId: order.subscriberId });

  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].productOrderId, order.id);
  assert.equal(inventory[0].orderId, order.id);
  assert.equal(inventory[0].status, "active");
  assert.equal(inventory[0].startDate, order.completedAt.slice(0, 10));
  assert.equal(inventory[0].endDate, inventory[0].expiresAt.slice(0, 10));
  assert.equal(inventory[0].chargingSource, "MA");
  assert.ok(inventory[0].expiresAt);
  assert.equal(getProductInventory(db, inventory[0].id).id, inventory[0].id);
});

test("Sprint 3 inventory creation is idempotent for repeated completed order handling", () => {
  const db = createStore();
  const order = completedOrder(db);
  assert.deepEqual(reason(() => executeProductOrderFulfillment(db, order.id, {})), {
    status: 409,
    reasonCode: "INVALID_ORDER_STATE_TRANSITION"
  });
  assert.equal(listProductInventory(db, { subscriberId: order.subscriberId }).length, 1);
});

test("Sprint 3 compensates and retries failed ProductOrders", () => {
  const db = createStore();
  const offering = activeOffering(db);
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "2348012345678", currency: "NGN" });
  addCartItem(db, cart.id, { productOfferingId: offering.id });
  validateShoppingCart(db, cart.id, {});
  const order = checkoutShoppingCart(db, cart.id);
  validateProductOrder(db, order.id);
  executeProductOrderFulfillment(db, order.id, { chargingResult: "failed", failureReasonCode: "INSUFFICIENT_BALANCE" });

  const compensated = compensateProductOrder(db, order.id, { action: "creditBack" });
  assert.equal(compensated.compensation.status, "completed");
  const retry = retryProductOrderFulfillment(db, order.id, { reason: "Balance restored" });
  assert.equal(retry.status, "inProgress");
  assert.equal(retry.fulfillment.chargingStatus, "pending");
});

test("Sprint 3 compensation config is copied to provision orders and credit-back records are written", () => {
  const db = createStore();
  const offering = activeOffering(db);
  const config = setCompensationConfig(db, offering.id, { compensationType: "creditBack" });
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "2348012345678", currency: "NGN" });
  addCartItem(db, cart.id, { productOfferingId: offering.id });
  validateShoppingCart(db, cart.id, {});
  const order = checkoutShoppingCart(db, cart.id);

  assert.equal(getCompensationConfig(db, offering.id).id, config.id);
  assert.equal(order.compensationPolicy, "creditBack");
  validateProductOrder(db, order.id);
  executeProductOrderFulfillment(db, order.id, { failedStep: "attachOffer" });

  assert.equal(order.status, "failed");
  assert.equal(listCompensationRecords(db, { orderId: order.id, compensationType: "creditBack" }).length, 1);
  assert.equal(listNotificationEvents(db, { orderId: order.id, eventType: "COMPENSATION_COMPLETED" }).length, 1);
});

test("Sprint 3 terminate order completes without mutating the original provision order", () => {
  const db = createStore();
  const original = completedOrder(db);
  const originalStatus = original.status;
  const terminate = createTerminateOrder(db, original.id, {
    channelId: "CRM",
    cancellationReasonCode: "SUBSCRIBER_REQUEST"
  });

  assert.equal(terminate.orderType, "terminate");
  assert.equal(terminate.originalOrderId, original.id);
  assert.equal(validateProductOrder(db, terminate.id).status, "inProgress");
  const completed = executeProductOrderFulfillment(db, terminate.id, {});
  const inventory = listProductInventory(db, { subscriberId: original.subscriberId })[0];

  assert.equal(completed.status, "completed");
  assert.equal(original.status, originalStatus);
  assert.equal(inventory.status, "terminated");
  assert.ok(inventory.terminatedAt);
  assert.equal(listNotificationEvents(db, { orderId: terminate.id, eventType: "ORDER_CANCELLED" }).length, 1);
});

test("Sprint 3 blocks duplicate or inactive subscription terminate requests", () => {
  const db = createStore();
  const original = completedOrder(db);
  createTerminateOrder(db, original.id, { cancellationReasonCode: "FIRST" });

  assert.deepEqual(reason(() => createTerminateOrder(db, original.id, { cancellationReasonCode: "SECOND" })), {
    status: 409,
    reasonCode: "DUPLICATE_TERMINATION_REQUEST"
  });

  const other = completedOrder(db);
  const inventory = listProductInventory(db, { subscriberId: other.subscriberId, status: "active" }).find((item) => item.productOrderId === other.id);
  updateProductInventoryStatus(db, inventory.id, { status: "terminated" });
  assert.deepEqual(reason(() => createTerminateOrder(db, other.id, { cancellationReasonCode: "SECOND" })), {
    status: 409,
    reasonCode: "SUBSCRIPTION_NOT_ACTIVE"
  });
});

test("Sprint 3 manages channels and channel status", () => {
  const db = createStore();
  const channel = createChannel(db, { name: "PartnerA", channelId: "PARTNER_A", type: "THIRD_PARTY", externalId: "partner-a" });

  assert.equal(getChannel(db, channel.id).name, "PartnerA");
  assert.equal(getChannel(db, "PARTNER_A").id, channel.id);
  assert.ok(channel.apiKey);
  assert.ok(channel.apiKeyHash);
  assert.equal(listChannels(db, { type: "THIRD_PARTY" }).length, 1);
  assert.equal(updateChannel(db, channel.id, { status: "inactive" }).status, "inactive");
});

test("Sprint 3 channel registry validates carts and restricts channel offerings", () => {
  const db = createStore();
  const channel = createChannel(db, { name: "CRM Channel", channelId: "CRM", type: "CRM" });
  const allowed = activeOffering(db, "CRM");
  activeOffering(db, "CRM");
  updateChannel(db, channel.id, { allowedOfferingIds: [allowed.id] });

  assert.equal(listProductInventory(db, { subscriberId: "nobody" }).length, 0);
  assert.equal(createShoppingCart(db, { channelId: "CRM", subscriberId: "2348012345678", currency: "NGN" }).channelId, "CRM");
  assert.equal(listChannels(db, { channelType: "CRM" }).length, 1);
  assert.equal(listProductInventory(db, { subscriberId: "2348012345678" }).length, 0);
  assert.deepEqual(reason(() => createShoppingCart(db, { channelId: "UNKNOWN", subscriberId: "2348012345678", currency: "NGN" })), {
    status: 422,
    reasonCode: "UNKNOWN_CHANNEL"
  });
  updateChannel(db, "CRM", { status: "inactive" });
  assert.deepEqual(reason(() => createShoppingCart(db, { channelId: "CRM", subscriberId: "2348012345678", currency: "NGN" })), {
    status: 422,
    reasonCode: "CHANNEL_INACTIVE"
  });
});

test("Sprint 3 captures USSD pull requests and creates an order", () => {
  const db = createStore();
  const channel = createChannel(db, { name: "USSD", type: "USSD" });
  const offering = activeOffering(db, "USSD");

  const interaction = captureChannelSubscriptionRequest(db, channel.id, {
    subscriberId: "2348012345678",
    productOfferingId: offering.id,
    currency: "NGN",
    subscriberAttributes: {},
    autoCheckout: true
  }, { expectedType: "USSD", requestType: "ussdPull" });

  assert.equal(interaction.status, "orderCreated");
  assert.ok(interaction.cartId);
  assert.ok(interaction.orderId);
  assert.equal(listChannelInteractions(db, { subscriberId: "2348012345678" }).length, 1);
});

test("Sprint 3 rejects requests on inactive channels", () => {
  const db = createStore();
  const channel = createChannel(db, { name: "SMS", type: "SMS", status: "inactive" });
  const offering = activeOffering(db, "SMS");

  assert.deepEqual(reason(() => captureChannelSubscriptionRequest(db, channel.id, {
    subscriberId: "2348012345678",
    productOfferingId: offering.id,
    currency: "NGN"
  }, { expectedType: "SMS", requestType: "smsMessage" })), {
    status: 409,
    reasonCode: "CHANNEL_INACTIVE"
  });
});

test("Sprint 3 enforces channel type-specific entry points", () => {
  const db = createStore();
  const channel = createChannel(db, { name: "CRM", type: "CRM" });
  const offering = activeOffering(db, "CRM");

  assert.deepEqual(reason(() => captureChannelSubscriptionRequest(db, channel.id, {
    subscriberId: "2348012345678",
    productOfferingId: offering.id,
    currency: "NGN"
  }, { expectedType: "USSD", requestType: "ussdPull" })), {
    status: 422,
    reasonCode: "CHANNEL_TYPE_MISMATCH"
  });
});
