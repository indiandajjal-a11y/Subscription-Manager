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
  getProductOffering,
  listNotificationEvents,
  listProductInventory,
  updateProductOffering,
  validateProductOrderWithSubscriberAccount,
  validateShoppingCart,
  getProductOrder
} from "../code/domain.js";

import {
  createCustomerSegment,
  getCustomerSegment,
  listCustomerSegments,
  updateCustomerSegment,
  createRenewalSchedule,
  getRenewalSchedule,
  listRenewalSchedules,
  updateRenewalSchedule,
  RenewalScheduler,
  createPartyRelationship,
  listPartyRelationships,
  updatePartyRelationship,
  validateGiftOrder,
  computeCSAttributeUpdates,
  getCompensationPolicy,
  getDefaultCompensationPolicy,
  createRenewalOrder,
  updateOrderRetry,
  createNotificationEventWithRecipient,
  resolveSegmentFromRules
} from "../code/sprint6.js";

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

function offeringWithPrice(db, priceBody = {}, offeringBody = {}) {
  const spec = activateProductSpecification(db, createProductSpecification(db, {
    name: `Sprint 6 Spec ${randomUUID()}`,
    version: "1.0",
    characteristics
  }).id);
  const offering = createProductOffering(db, {
    name: `Sprint 6 Offering ${randomUUID()}`,
    productSpecificationId: spec.id,
    channelAvailability: ["USSD"],
    ...offeringBody
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

function acknowledgedOrder(db, priceBody = {}, subscriberAttributes = {}, offeringBody = {}) {
  const offering = offeringWithPrice(db, priceBody, offeringBody);
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "2348012345678", currency: "NGN" });
  addCartItem(db, cart.id, { productOfferingId: offering.id });
  validateShoppingCart(db, cart.id, { subscriberAttributes });
  return { order: checkoutShoppingCart(db, cart.id), offering };
}

function completedOrder(db, priceBody = {}, accountData = {}, offeringBody = {}) {
  const { order, offering } = acknowledgedOrder(db, priceBody, {}, offeringBody);
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

// ============================================================================
// SEGMENT RESOLUTION TESTS (5 scenarios)
// ============================================================================

test("Sprint 6: Segment matches serviceClass rule → resolves correctly", () => {
  const db = createStore();
  
  const segment = createCustomerSegment(db, {
    name: "VIP Segment",
    description: "VIP customer segment",
    resolutionRules: [
      { attributeName: "serviceClass", operator: "equals", value: "VIP" }
    ]
  });
  updateCustomerSegment(db, segment.id, { status: "active" });

  const resolved = resolveSegmentFromRules(db, { serviceClass: "VIP" });
  assert.equal(resolved, segment.id);
});

test("Sprint 6: No segment matches → resolvedSegmentId = null", () => {
  const db = createStore();
  
  const segment = createCustomerSegment(db, {
    name: "Premium Segment",
    description: "Premium customers",
    resolutionRules: [
      { attributeName: "serviceClass", operator: "equals", value: "PREMIUM" }
    ]
  });
  updateCustomerSegment(db, segment.id, { status: "active" });

  const resolved = resolveSegmentFromRules(db, { serviceClass: "BASIC" });
  assert.equal(resolved, null);
});

test("Sprint 6: Retired segment excluded from resolution", () => {
  const db = createStore();
  
  const segment = createCustomerSegment(db, {
    name: "Retired Segment",
    description: "Old segment",
    resolutionRules: [
      { attributeName: "serviceClass", operator: "equals", value: "BASIC" }
    ]
  });
  // Keep status as draft/retired
  updateCustomerSegment(db, segment.id, { status: "retired" });

  const resolved = resolveSegmentFromRules(db, { serviceClass: "BASIC" });
  assert.equal(resolved, null);
});

test("Sprint 6: resolveSegmentFromRules handles multiple rules with 'in' operator", () => {
  const db = createStore();
  
  const segment = createCustomerSegment(db, {
    name: "Multi-rule Segment",
    description: "Multiple resolution rules",
    resolutionRules: [
      { attributeName: "serviceClass", operator: "in", value: ["VIP", "PREMIUM"] },
      { attributeName: "segment", operator: "equals", value: "CONSUMER" }
    ]
  });
  updateCustomerSegment(db, segment.id, { status: "active" });

  const resolved = resolveSegmentFromRules(db, { serviceClass: "VIP", segment: "CONSUMER" });
  assert.equal(resolved, segment.id);

  const notResolved = resolveSegmentFromRules(db, { serviceClass: "BASIC", segment: "CONSUMER" });
  assert.equal(notResolved, null);
});

test("Sprint 6: Segment resolution with contains operator", () => {
  const db = createStore();
  
  const segment = createCustomerSegment(db, {
    name: "Segment with Contains",
    description: "Using contains operator",
    resolutionRules: [
      { attributeName: "phoneNumber", operator: "contains", value: "234801" }
    ]
  });
  updateCustomerSegment(db, segment.id, { status: "active" });

  const resolved = resolveSegmentFromRules(db, { phoneNumber: "2348012345678" });
  assert.equal(resolved, segment.id);
});

// ============================================================================
// CS ATTRIBUTE UPDATE TESTS (5 scenarios)
// ============================================================================

test("Sprint 6: CS attribute update with fixed value source", () => {
  const db = createStore();
  const offering = offeringWithPrice(db, {}, {
    csAttributeUpdates: [
      { attributeName: "offerType", valueSource: "fixed", fixedValue: "PROMOTION" }
    ]
  });

  const updates = computeCSAttributeUpdates(db, offering);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].attributeName, "offerType");
  assert.equal(updates[0].value, "PROMOTION");
});

test("Sprint 6: CS attribute update with calculatedFromExpiry and offsetDays", () => {
  const db = createStore();
  const offering = offeringWithPrice(db, {}, {
    csAttributeUpdates: [
      { attributeName: "expiryDate", valueSource: "calculatedFromExpiry", offsetDays: 30 }
    ]
  });

  const activationDate = new Date("2024-01-01").toISOString();
  const updates = computeCSAttributeUpdates(db, offering, activationDate);
  
  assert.equal(updates.length, 1);
  assert.equal(updates[0].attributeName, "expiryDate");
  // Should be 30 days from activation
  const expectedExpiry = new Date("2024-01-31").toISOString().slice(0, 10);
  assert.equal(updates[0].value, expectedExpiry);
});

test("Sprint 6: CS attribute update with offeringCharacteristic source", () => {
  const db = createStore();
  const spec = activateProductSpecification(db, createProductSpecification(db, {
    name: `Spec with Char ${randomUUID()}`,
    version: "1.0",
    characteristics: [
      ...characteristics,
      { name: "bundleCategory", valueType: "string", value: "voice_data" }
    ]
  }).id);
  
  const offering = createProductOffering(db, {
    name: `Offering ${randomUUID()}`,
    productSpecificationId: spec.id,
    channelAvailability: ["USSD"],
    csAttributeUpdates: [
      { attributeName: "category", valueSource: "offeringCharacteristic", offeringCharacteristicName: "bundleCategory" }
    ]
  });
  addProductOfferingPrice(db, offering.id, {
    priceType: "standard",
    amount: 100,
    currency: "NGN",
    chargingSource: "MA",
    isDefault: true
  });
  activateProductOffering(db, offering.id);

  const updates = computeCSAttributeUpdates(db, offering);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].attributeName, "category");
  assert.equal(updates[0].value, "voice_data");
});

test("Sprint 6: computeCSAttributeUpdates returns empty array when no updates", () => {
  const db = createStore();
  const offering = offeringWithPrice(db);

  const updates = computeCSAttributeUpdates(db, offering);
  assert.equal(Array.isArray(updates), true);
  assert.equal(updates.length, 0);
});

test("Sprint 6: Multiple CS attribute updates processed together", () => {
  const db = createStore();
  const offering = offeringWithPrice(db, {}, {
    csAttributeUpdates: [
      { attributeName: "offerType", valueSource: "fixed", fixedValue: "PROMOTION" },
      { attributeName: "priority", valueSource: "fixed", fixedValue: "HIGH" }
    ]
  });

  const updates = computeCSAttributeUpdates(db, offering);
  assert.equal(updates.length, 2);
  assert.equal(updates[0].attributeName, "offerType");
  assert.equal(updates[1].attributeName, "priority");
});

// ============================================================================
// RENEWAL SCHEDULE TESTS (8 scenarios)
// ============================================================================

test("Sprint 6: Create renewal schedule for inventory", () => {
  const db = createStore();
  const { inventory } = completedOrder(db);

  const schedule = createRenewalSchedule(db, {
    subscriptionId: inventory.id,
    scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    renewalOfferId: randomUUID()
  });

  assert.equal(schedule.subscriptionId, inventory.id);
  assert.equal(schedule.status, "pending");
  assert.equal(schedule.attemptCount, 0);
});

test("Sprint 6: RenewalScheduler prevents duplicate schedules", () => {
  const db = createStore();
  const { inventory } = completedOrder(db);

  const scheduler = new RenewalScheduler(db);
  const scheduledDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const renewalOfferId = randomUUID();

  const schedule1 = scheduler.scheduleRenewalForInventory(inventory.id, scheduledDate, renewalOfferId);
  const schedule2 = scheduler.scheduleRenewalForInventory(inventory.id, scheduledDate, renewalOfferId);

  assert.equal(schedule1.id, schedule2.id);
  const allSchedules = listRenewalSchedules(db, { subscriptionId: inventory.id, status: "pending" });
  assert.equal(allSchedules.length, 1);
});

test("Sprint 6: RenewalScheduler skips terminated subscriptions", () => {
  const db = createStore();
  const { inventory } = completedOrder(db);

  const schedule = createRenewalSchedule(db, {
    subscriptionId: inventory.id,
    scheduledAt: new Date(Date.now() - 1000).toISOString(), // Past time
    renewalOfferId: randomUUID()
  });

  inventory.status = "terminated";
  const scheduler = new RenewalScheduler(db);
  scheduler.poll(); // Should skip terminated inventory

  const updated = getRenewalSchedule(db, schedule.id);
  assert.equal(updated.status, "pending"); // Should remain pending, not completed
});

test("Sprint 6: Renewal order creation from subscription", () => {
  const db = createStore();
  const { inventory, offering } = completedOrder(db);

  const renewalOffering = offeringWithPrice(db, {}, { name: "Renewal Offer" });
  const renewal = createRenewalOrder(db, inventory, {
    renewalOfferId: renewalOffering.id,
    channelId: inventory.channelId
  });

  assert.equal(renewal.orderType, "renew");
  assert.equal(renewal.originalSubscriptionId, inventory.id);
  assert.equal(renewal.subscriberId, inventory.subscriberId);
  assert.equal(renewal.items[0].productOfferingId, renewalOffering.id);
});

test("Sprint 6: Update renewal schedule with completed status", () => {
  const db = createStore();
  const schedule = createRenewalSchedule(db, {
    subscriptionId: randomUUID(),
    scheduledAt: nowIso(),
    renewalOfferId: randomUUID()
  });

  const renewalOrderId = randomUUID();
  const updated = updateRenewalSchedule(db, schedule.id, {
    status: "completed",
    renewalOrderId,
    attemptCount: 1
  });

  assert.equal(updated.status, "completed");
  assert.equal(updated.renewalOrderId, renewalOrderId);
  assert.equal(updated.attemptCount, 1);
});

test("Sprint 6: RenewalScheduler.poll triggers based on scheduledAt time", () => {
  const db = createStore();
  const { inventory } = completedOrder(db);

  const pastDate = new Date(Date.now() - 5000).toISOString(); // 5 seconds ago
  const schedule = createRenewalSchedule(db, {
    subscriptionId: inventory.id,
    scheduledAt: pastDate,
    renewalOfferId: randomUUID()
  });

  const scheduler = new RenewalScheduler(db);
  scheduler.poll();

  const updated = getRenewalSchedule(db, schedule.id);
  assert.equal(updated.status, "completed");
});

test("Sprint 6: List renewal schedules with filter by status", () => {
  const db = createStore();
  const { inventory } = completedOrder(db);

  createRenewalSchedule(db, {
    subscriptionId: inventory.id,
    scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    renewalOfferId: randomUUID()
  });

  const pending = listRenewalSchedules(db, { subscriptionId: inventory.id, status: "pending" });
  assert.equal(pending.length, 1);

  const completed = listRenewalSchedules(db, { subscriptionId: inventory.id, status: "completed" });
  assert.equal(completed.length, 0);
});

// ============================================================================
// GIFT ORDER TESTS (8 scenarios)
// ============================================================================

test("Sprint 6: Gift order validation succeeds with beneficiaryId", () => {
  const db = createStore();
  const offering = offeringWithPrice(db, {}, { giftingEnabled: true, maxGiftBeneficiaries: 5 });

  assert.doesNotThrow(() => {
    validateGiftOrder(db, offering, "sponsor-123", "beneficiary-456");
  });
});

test("Sprint 6: Gift order fails when giftingEnabled = false", () => {
  const db = createStore();
  const offering = offeringWithPrice(db, {}, { giftingEnabled: false });

  assert.deepEqual(reason(() => validateGiftOrder(db, offering, "sponsor-123", "beneficiary-456")), {
    status: 422,
    reasonCode: "GIFTING_NOT_ALLOWED_FOR_OFFERING"
  });
});

test("Sprint 6: Self-gift is rejected", () => {
  const db = createStore();
  const offering = offeringWithPrice(db, {}, { giftingEnabled: true });

  assert.deepEqual(reason(() => validateGiftOrder(db, offering, "same-id", "same-id")), {
    status: 422,
    reasonCode: "SELF_GIFT_NOT_ALLOWED"
  });
});

test("Sprint 6: maxGiftBeneficiaries limit enforced", () => {
  const db = createStore();
  const offering = offeringWithPrice(db, {}, { giftingEnabled: true, maxGiftBeneficiaries: 2 });

  // Create 2 active gifts
  createPartyRelationship(db, {
    relationshipType: "sponsor",
    sponsorId: "sponsor-1",
    beneficiaryId: "beneficiary-1",
    subscriptionId: randomUUID()
  });
  createPartyRelationship(db, {
    relationshipType: "sponsor",
    sponsorId: "sponsor-1",
    beneficiaryId: "beneficiary-2",
    subscriptionId: randomUUID()
  });

  assert.deepEqual(reason(() => validateGiftOrder(db, offering, "sponsor-1", "beneficiary-3")), {
    status: 422,
    reasonCode: "MAX_GIFT_BENEFICIARIES_EXCEEDED"
  });
});

test("Sprint 6: Duplicate active gift is rejected", () => {
  const db = createStore();
  const offering = offeringWithPrice(db, {}, { giftingEnabled: true });

  createPartyRelationship(db, {
    relationshipType: "sponsor",
    sponsorId: "sponsor-1",
    beneficiaryId: "beneficiary-1",
    subscriptionId: randomUUID()
  });

  assert.deepEqual(reason(() => validateGiftOrder(db, offering, "sponsor-1", "beneficiary-1")), {
    status: 422,
    reasonCode: "GIFT_ALREADY_ACTIVE"
  });
});

test("Sprint 6: Create party relationship for gift order", () => {
  const db = createStore();
  const subscriptionId = randomUUID();

  const relationship = createPartyRelationship(db, {
    relationshipType: "sponsor",
    sponsorId: "sponsor-123",
    beneficiaryId: "beneficiary-456",
    subscriptionId,
    orderId: randomUUID()
  });

  assert.equal(relationship.relationshipType, "sponsor");
  assert.equal(relationship.sponsorId, "sponsor-123");
  assert.equal(relationship.beneficiaryId, "beneficiary-456");
  assert.equal(relationship.status, "active");
});

test("Sprint 6: Gift relationship lifecycle - create and update status", () => {
  const db = createStore();
  
  const relationship = createPartyRelationship(db, {
    relationshipType: "sponsor",
    sponsorId: "sponsor-1",
    beneficiaryId: "beneficiary-1",
    subscriptionId: randomUUID()
  });

  const terminated = updatePartyRelationship(db, relationship.id, { status: "terminated" });
  assert.equal(terminated.status, "terminated");

  const listed = listPartyRelationships(db, { sponsorId: "sponsor-1" });
  assert.equal(listed[0].status, "terminated");
});

// ============================================================================
// COMPENSATION POLICY TESTS (4 scenarios)
// ============================================================================

test("Sprint 6: Get default compensation policy", () => {
  const policy = getDefaultCompensationPolicy();

  assert.equal(policy.creditBackEnabled, true);
  assert.equal(policy.retryEnabled, false);
  assert.equal(policy.retryCount, 3);
  assert.equal(policy.retryIntervalSeconds, 60);
});

test("Sprint 6: Get compensation policy from offering", () => {
  const db = createStore();
  const offering = offeringWithPrice(db, {}, {
    compensationPolicy: {
      creditBackEnabled: false,
      retryEnabled: true,
      retryCount: 5,
      retryIntervalSeconds: 600
    }
  });

  const policy = getCompensationPolicy(db, offering.id);
  assert.equal(policy.creditBackEnabled, false);
  assert.equal(policy.retryEnabled, true);
  assert.equal(policy.retryCount, 5);
  assert.equal(policy.retryIntervalSeconds, 600);
});

test("Sprint 6: Update order retry tracking", () => {
  const db = createStore();
  const { order } = acknowledgedOrder(db);

  const updated = updateOrderRetry(db, order.id, {
    retryCount: 1,
    nextRetryAt: new Date(Date.now() + 300000).toISOString(),
    retryStepName: "attachOffer"
  });

  assert.equal(updated.retryAttempts, 1);
  assert.equal(updated.retryStepName, "attachOffer");
});

test("Sprint 6: Notification with recipient context", () => {
  const db = createStore();
  const { order } = acknowledgedOrder(db);

  const notification = createNotificationEventWithRecipient(db, "RENEWAL_COMPLETED", order, {
    recipientType: "sponsor",
    recipientId: "sponsor-123",
    payload: { subscriptionId: "sub-456" }
  });

  assert.equal(notification.eventType, "RENEWAL_COMPLETED");
  assert.equal(notification.recipientType, "sponsor");
  assert.equal(notification.recipientId, "sponsor-123");
  assert.equal(notification.payload.subscriptionId, "sub-456");
  assert.equal(notification.status, "pending");
});

// ============================================================================
// HELPER FUNCTION
// ============================================================================

function nowIso() {
  return new Date().toISOString();
}
