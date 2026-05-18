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
  executeProductOrderFulfillment,
  listNotificationEvents,
  validateProductOrderWithSubscriberAccount,
  validateShoppingCart
} from "../code/domain.js";
import { createCustomerSegment, updateCustomerSegment } from "../code/sprint6.js";
import {
  createCommunicationTemplate,
  createCurrencyConfig,
  createStaffNumberLink,
  dispatchNotificationEvent,
  formatDataVolume,
  formatDate,
  getDefaultCurrencyConfig,
  listNotificationDispatchRecords,
  renderTemplate,
  retireCurrencyConfig,
  selectCommunicationTemplate,
  subscribeCart
} from "../code/sprint7.js";

const characteristics = [
  { name: "dataVolume", valueType: "number", value: "2", unit: "GB" },
  { name: "validityPeriod", valueType: "number", value: "30", unit: "days" },
  { name: "bundleType", valueType: "string", value: "monthly" },
  { name: "neaActivationRequired", valueType: "boolean", value: "true" }
];

function activeOffering(db, options = {}) {
  if (!db.currencyConfigs.size) createCurrencyConfig(db, { currencyCode: "NGN", symbol: "NGN ", minorUnit: 2, isDefault: true });
  const spec = activateProductSpecification(db, createProductSpecification(db, {
    name: `Sprint 7 Spec ${randomUUID()}`,
    version: "1.0",
    characteristics
  }).id);
  const offering = createProductOffering(db, {
    name: `Sprint 7 Offering ${randomUUID()}`,
    productSpecificationId: spec.id,
    channelAvailability: ["USSD", "SMS"],
    ...options.offering
  });
  addProductOfferingPrice(db, offering.id, {
    priceType: "standard",
    amount: options.amount || 500,
    currencyCode: "NGN",
    chargingSource: "MA",
    isDefault: true,
    priceAlteration: options.priceAlteration || []
  });
  return activateProductOffering(db, offering.id);
}

function completedOrder(db, options = {}) {
  const offering = activeOffering(db, options);
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: options.subscriberId || "2348012345678" });
  addCartItem(db, cart.id, { productOfferingId: offering.id, purchasePolicy: options.purchasePolicy || "SELF_ONE_OFF" });
  validateShoppingCart(db, cart.id, { subscriberAttributes: options.subscriberAttributes || {} });
  const order = checkoutShoppingCart(db, cart.id);
  const account = createSubscriberAccountSnapshot(db, order.id, {
    subscriberId: order.subscriberId,
    serviceClass: options.serviceClass || "PREPAID",
    segment: "CONSUMER",
    mainBalance: 10000,
    currency: "NGN",
    daBalances: [],
    offerIds: []
  });
  validateProductOrderWithSubscriberAccount(db, order.id, account);
  return {
    order: executeProductOrderFulfillment(db, order.id, { inventory: { csAttachmentId: "ATTACH-S7" } }),
    offering
  };
}

test("Sprint 7: currency config supplies default cart currency and blocks retiring default", () => {
  const db = createStore();
  const config = createCurrencyConfig(db, { currencyCode: "NGN", symbol: "NGN ", minorUnit: 2, isDefault: true });
  assert.equal(getDefaultCurrencyConfig(db).currencyCode, "NGN");
  assert.throws(() => retireCurrencyConfig(db, config.currencyCode), /Default currency/);

  activeOffering(db);
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "23480" });
  assert.equal(cart.currency, "NGN");
});

test("Sprint 7: template selection prefers offering-specific SMS template over default", () => {
  const db = createStore();
  const offering = activeOffering(db);
  const fallback = createCommunicationTemplate(db, {
    name: "Default complete",
    eventType: "ORDER_COMPLETED",
    channelType: "SMS",
    bodyTemplate: "Default"
  });
  const specific = createCommunicationTemplate(db, {
    name: "Specific complete",
    eventType: "ORDER_COMPLETED",
    channelType: "SMS",
    offeringId: offering.id,
    bodyTemplate: "Specific"
  });
  const selected = selectCommunicationTemplate(db, { eventType: "ORDER_COMPLETED" }, "SMS", offering.id);
  assert.equal(selected.id, specific.id);
  assert.notEqual(selected.id, fallback.id);
});

test("Sprint 7: notification dispatch renders placeholders and records gateway result", async () => {
  const db = createStore();
  const { order } = completedOrder(db);
  const event = listNotificationEvents(db, { orderId: order.id })[0];
  createCommunicationTemplate(db, {
    name: "Order completed SMS",
    eventType: "ORDER_COMPLETED",
    channelType: "SMS",
    bodyTemplate: "Your {{offeringName}} is active. Charged {{chargedAmount}}. Expires {{endDate|format:DD/MM/YYYY}}",
    maxLength: 160
  });
  const sent = [];
  const record = await dispatchNotificationEvent(db, event.id, {
    channelType: "SMS",
    gatewayClient: { send: async (message) => { sent.push(message); return { status: "sent", gatewayRef: "SMS-1" }; } }
  });
  assert.equal(record.status, "sent");
  assert.equal(record.gatewayRef, "SMS-1");
  assert.equal(sent.length, 1);
  assert.match(record.renderedBody, /Charged NGN 500\.00/);
  assert.equal(listNotificationDispatchRecords(db).length, 1);
});

test("Sprint 7: template rendering handles data formatting, division by zero, and SMS truncation", async () => {
  const db = createStore();
  const { order } = completedOrder(db);
  const event = listNotificationEvents(db, { orderId: order.id })[0];
  const template = createCommunicationTemplate(db, {
    name: "Math SMS",
    eventType: "ORDER_COMPLETED",
    channelType: "SMS",
    bodyTemplate: "Bundle {{dataVolume}} half {{expr: 10 / 0}} " + "x ".repeat(120),
    maxLength: 80
  });
  const rendered = await renderTemplate(db, template, event, { channelType: "SMS" });
  assert.match(rendered, /Bundle 2\.00 GB half N\/A/);
  assert.ok(rendered.length <= 80);
  assert.equal(formatDataVolume(500), "500 MB");
  assert.equal(formatDataVolume(0.5), "512 KB");
  assert.equal(formatDate("2026-05-18T10:30:05Z", "DD/MM/YYYY HH:MM"), "18/05/2026 10:30");
});

test("Sprint 7: live balance placeholder fetches GBAD once and degrades to N/A on failure", async () => {
  const db = createStore();
  const { order } = completedOrder(db);
  const event = listNotificationEvents(db, { orderId: order.id })[0];
  const template = createCommunicationTemplate(db, {
    name: "Balance SMS",
    eventType: "ORDER_COMPLETED",
    channelType: "SMS",
    bodyTemplate: "Main {{mainBalance}} DA {{da[DATA_DA_1].balance}}"
  });
  let calls = 0;
  const rendered = await renderTemplate(db, template, event, {
    channelType: "SMS",
    chargingSystemClient: {
      fetchSubscriberAccount: async () => {
        calls += 1;
        return { status: "success", mainBalance: 1000, currency: "NGN", daBalances: [{ daId: "DATA_DA_1", balance: 2048 }] };
      }
    }
  });
  assert.equal(calls, 1);
  assert.match(rendered, /Main NGN 1000\.00 DA 2\.00 GB/);
});

test("Sprint 7: staff secondary link applies STAFF segment override during order validation", () => {
  const db = createStore();
  const staffSegment = createCustomerSegment(db, {
    name: "STAFF",
    description: "Staff segment",
    resolutionRules: [{ attributeName: "serviceClass", operator: "equals", value: "STAFF" }]
  });
  updateCustomerSegment(db, staffSegment.id, { status: "active" });
  const offering = activeOffering(db, {
    offering: {
      eligibilityRules: [{
        ruleType: "customerSegment",
        operator: "equals",
        value: staffSegment.id,
        failureReasonCode: "SEGMENT_NOT_RESOLVED"
      }],
      maxSecondaryNumbers: 1
    }
  });
  createStaffNumberLink(db, { primaryNumber: "staff-primary", secondaryNumber: "secondary-1", offeringId: offering.id }, { primaryServiceClass: "STAFF" });
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "secondary-1", currency: "NGN" });
  addCartItem(db, cart.id, { productOfferingId: offering.id });
  validateShoppingCart(db, cart.id, { subscriberAttributes: { customerSegment: staffSegment.id } });
  const order = checkoutShoppingCart(db, cart.id);
  const account = createSubscriberAccountSnapshot(db, order.id, {
    subscriberId: "secondary-1",
    serviceClass: "PREPAID",
    segment: "CONSUMER",
    mainBalance: 10000,
    currency: "NGN",
    daBalances: []
  });
  const validated = validateProductOrderWithSubscriberAccount(db, order.id, account);
  assert.equal(validated.status, "inProgress");
  assert.equal(account.resolvedViaStaffLink, true);
  assert.equal(account.resolvedSegmentId, staffSegment.id);
});

test("Sprint 7: combined subscribe endpoint completes USSD-style flow and dispatches notification", async () => {
  const db = createStore();
  const offering = activeOffering(db);
  createCommunicationTemplate(db, {
    name: "Completed",
    eventType: "ORDER_COMPLETED",
    channelType: "USSD",
    bodyTemplate: "Active {{offeringName}}"
  });
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "23480999", currency: "NGN" });
  addCartItem(db, cart.id, { productOfferingId: offering.id, purchasePolicy: { type: "SELF_ONE_OFF" } });
  const result = await subscribeCart(db, cart.id, {
    channelType: "USSD",
    subscriberAccount: {
      id: randomUUID(),
      subscriberId: "23480999",
      serviceClass: "PREPAID",
      segment: "CONSUMER",
      mainBalance: 9999,
      currency: "NGN",
      daBalances: [],
      offerIds: []
    }
  });
  assert.equal(result.status, "completed");
  assert.equal(result.notificationSent, true);
});
