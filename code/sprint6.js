import { randomUUID } from "node:crypto";
import { fail } from "./errors.js";
import { nowIso, getProductOffering, getProductOrder, getProductInventory } from "./domain.js";

// ============================================================================
// CUSTOMER SEGMENT (TMF629) MODEL - Segment Resolution Rules
// ============================================================================

const SEGMENT_RULE_OPERATORS = ["equals", "in", "notIn", "contains"];
const SEGMENT_STATUSES = ["draft", "active", "retired"];

export function createCustomerSegment(db, body = {}) {
  if (!body.name) fail(400, "REQUIRED_FIELD", "name is required.", "name");
  if (!body.description) fail(400, "REQUIRED_FIELD", "description is required.", "description");
  if (!Array.isArray(body.resolutionRules)) fail(400, "REQUIRED_FIELD", "resolutionRules is required.", "resolutionRules");

  if (!db.customerSegments) db.customerSegments = new Map();

  // Validate resolution rules
  for (const rule of body.resolutionRules) {
    if (!rule.attributeName) fail(400, "REQUIRED_FIELD", "resolutionRules[].attributeName is required.", "resolutionRules");
    if (!rule.operator) fail(400, "REQUIRED_FIELD", "resolutionRules[].operator is required.", "resolutionRules");
    if (!SEGMENT_RULE_OPERATORS.includes(rule.operator)) {
      fail(422, "INVALID_OPERATOR", `Operator must be one of: ${SEGMENT_RULE_OPERATORS.join(", ")}`, "resolutionRules");
    }
    if (rule.value === undefined) fail(400, "REQUIRED_FIELD", "resolutionRules[].value is required.", "resolutionRules");
  }

  const timestamp = nowIso();
  const segment = {
    id: randomUUID(),
    name: body.name,
    description: body.description,
    resolutionRules: body.resolutionRules.map((rule) => ({
      id: rule.id || randomUUID(),
      attributeName: rule.attributeName,
      operator: rule.operator,
      value: rule.value
    })),
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp
  };

  db.customerSegments.set(segment.id, segment);
  return segment;
}

export function getCustomerSegment(db, segmentId) {
  if (!db.customerSegments) db.customerSegments = new Map();
  const segment = db.customerSegments.get(segmentId);
  if (!segment) fail(404, "SEGMENT_NOT_FOUND", "CustomerSegment was not found.", "segmentId");
  return segment;
}

export function listCustomerSegments(db, query = {}) {
  if (!db.customerSegments) db.customerSegments = new Map();
  return [...db.customerSegments.values()]
    .filter((item) => !query.status || item.status === query.status)
    .filter((item) => !query.name || item.name.includes(query.name));
}

export function updateCustomerSegment(db, segmentId, body = {}) {
  const segment = getCustomerSegment(db, segmentId);

  if (body.name !== undefined) segment.name = body.name;
  if (body.description !== undefined) segment.description = body.description;
  if (body.status !== undefined) {
    if (!SEGMENT_STATUSES.includes(body.status)) {
      fail(422, "INVALID_STATUS", `Status must be one of: ${SEGMENT_STATUSES.join(", ")}`, "status");
    }
    segment.status = body.status;
  }
  if (body.resolutionRules !== undefined) {
    for (const rule of body.resolutionRules) {
      if (!SEGMENT_RULE_OPERATORS.includes(rule.operator)) {
        fail(422, "INVALID_OPERATOR", `Operator must be one of: ${SEGMENT_RULE_OPERATORS.join(", ")}`, "resolutionRules");
      }
    }
    segment.resolutionRules = body.resolutionRules.map((rule) => ({
      id: rule.id || randomUUID(),
      attributeName: rule.attributeName,
      operator: rule.operator,
      value: rule.value
    }));
  }

  segment.updatedAt = nowIso();
  return segment;
}

// ============================================================================
// RENEWAL SCHEDULE MODEL
// ============================================================================

const RENEWAL_SCHEDULE_STATUSES = ["pending", "inProgress", "completed", "failed", "cancelled", "scheduled", "processed"];
const normalizeRenewalStatus = (status) => ({ scheduled: "pending", processed: "completed" }[status] || status);

export function createRenewalSchedule(db, body = {}) {
  if (!body.subscriptionId) fail(400, "REQUIRED_FIELD", "subscriptionId is required.", "subscriptionId");
  if (!body.scheduledAt) fail(400, "REQUIRED_FIELD", "scheduledAt is required.", "scheduledAt");
  if (!body.renewalOfferId) fail(400, "REQUIRED_FIELD", "renewalOfferId is required.", "renewalOfferId");

  if (!db.renewalSchedules) db.renewalSchedules = new Map();

  const timestamp = nowIso();
  const schedule = {
    id: randomUUID(),
    subscriptionId: body.subscriptionId,
    scheduledAt: body.scheduledAt,
    renewalOfferId: body.renewalOfferId,
    attemptCount: 0,
    status: "pending",
    renewalOrderId: null,
    lastAttemptAt: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  db.renewalSchedules.set(schedule.id, schedule);
  return schedule;
}

export function getRenewalSchedule(db, scheduleId) {
  if (!db.renewalSchedules) db.renewalSchedules = new Map();
  const schedule = db.renewalSchedules.get(scheduleId);
  if (!schedule) fail(404, "SCHEDULE_NOT_FOUND", "RenewalSchedule was not found.", "scheduleId");
  return schedule;
}

export function listRenewalSchedules(db, query = {}) {
  if (!db.renewalSchedules) db.renewalSchedules = new Map();
  return [...db.renewalSchedules.values()]
    .filter((item) => !query.subscriptionId || item.subscriptionId === query.subscriptionId)
    .filter((item) => !query.status || item.status === query.status);
}

export function updateRenewalSchedule(db, scheduleId, body = {}) {
  const schedule = getRenewalSchedule(db, scheduleId);

  if (body.status !== undefined) {
    if (!RENEWAL_SCHEDULE_STATUSES.includes(body.status)) {
      fail(422, "INVALID_STATUS", `Status must be one of: ${RENEWAL_SCHEDULE_STATUSES.join(", ")}`, "status");
    }
    schedule.status = normalizeRenewalStatus(body.status);
  }
  if (body.renewalOrderId !== undefined) schedule.renewalOrderId = body.renewalOrderId;
  if (body.attemptCount !== undefined) schedule.attemptCount = body.attemptCount;
  if (body.lastAttemptAt !== undefined) schedule.lastAttemptAt = body.lastAttemptAt;

  schedule.updatedAt = nowIso();
  return schedule;
}

// ============================================================================
// RENEWAL SCHEDULER - Background Poller
// ============================================================================

export class RenewalScheduler {
  constructor(db, pollIntervalSeconds = 60) {
    this.db = db;
    this.pollIntervalSeconds = pollIntervalSeconds;
    this.isRunning = false;
    this.pollTimer = null;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.poll();
  }

  stop() {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  poll() {
    try {
      const now = new Date();
      const schedules = [
        ...listRenewalSchedules(this.db, { status: "pending" }),
        ...listRenewalSchedules(this.db, { status: "scheduled" })
      ];

      for (const schedule of schedules) {
        const scheduledDate = new Date(schedule.scheduledAt);
        if (scheduledDate <= now) {
          const inventory = getProductInventory(this.db, schedule.subscriptionId);
          if (inventory && inventory.status === "active") {
            updateRenewalSchedule(this.db, schedule.id, {
              status: "completed",
              attemptCount: schedule.attemptCount + 1,
              lastAttemptAt: now.toISOString()
            });
          }
        }
      }
    } catch (error) {
      console.error("Renewal scheduler poll error:", error);
    }

    if (this.isRunning) this.pollTimer = setTimeout(() => this.poll(), this.pollIntervalSeconds * 1000);
  }

  scheduleRenewalForInventory(inventoryId, scheduledAt, renewalOfferId) {
    const inventory = getProductInventory(this.db, inventoryId);
    if (!inventory) fail(404, "INVENTORY_NOT_FOUND", "ProductInventory not found.", "inventoryId");

    const existingSchedule = listRenewalSchedules(this.db, { subscriptionId: inventoryId, status: "pending" });
    if (existingSchedule.length > 0) {
      return existingSchedule[0];
    }

    return createRenewalSchedule(this.db, {
      subscriptionId: inventoryId,
      scheduledAt,
      renewalOfferId
    });
  }
}

// ============================================================================
// PARTY RELATIONSHIP (TMF632) MODEL - Sponsor/Beneficiary
// ============================================================================

const PARTY_RELATIONSHIP_TYPES = ["GIFT_SPONSOR", "GIFT_BENEFICIARY", "sponsor", "beneficiary"];
const PARTY_RELATIONSHIP_STATUSES = ["active", "inactive", "terminated"];

export function createPartyRelationship(db, body = {}) {
  if (!body.relationshipType) fail(400, "REQUIRED_FIELD", "relationshipType is required.", "relationshipType");
  if (!PARTY_RELATIONSHIP_TYPES.includes(body.relationshipType)) {
    fail(422, "INVALID_RELATIONSHIP_TYPE", `relationshipType must be one of: ${PARTY_RELATIONSHIP_TYPES.join(", ")}`, "relationshipType");
  }
  if (!body.sponsorId) fail(400, "REQUIRED_FIELD", "sponsorId is required.", "sponsorId");
  if (!body.beneficiaryId) fail(400, "REQUIRED_FIELD", "beneficiaryId is required.", "beneficiaryId");
  if (!body.subscriptionId) fail(400, "REQUIRED_FIELD", "subscriptionId is required.", "subscriptionId");

  if (!db.partyRelationships) db.partyRelationships = new Map();

  const timestamp = nowIso();
  const relationship = {
    id: randomUUID(),
    relationshipType: body.relationshipType,
    sponsorId: body.sponsorId,
    beneficiaryId: body.beneficiaryId,
    subscriptionId: body.subscriptionId,
    orderId: body.orderId || null,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp
  };

  db.partyRelationships.set(relationship.id, relationship);
  return relationship;
}

export function getPartyRelationship(db, relationshipId) {
  if (!db.partyRelationships) db.partyRelationships = new Map();
  const relationship = db.partyRelationships.get(relationshipId);
  if (!relationship) fail(404, "RELATIONSHIP_NOT_FOUND", "PartyRelationship was not found.", "relationshipId");
  return relationship;
}

export function listPartyRelationships(db, query = {}) {
  if (!db.partyRelationships) db.partyRelationships = new Map();
  return [...db.partyRelationships.values()]
    .filter((item) => !query.sponsorId || item.sponsorId === query.sponsorId)
    .filter((item) => !query.beneficiaryId || item.beneficiaryId === query.beneficiaryId)
    .filter((item) => !query.status || item.status === query.status)
    .filter((item) => !query.subscriptionId || item.subscriptionId === query.subscriptionId);
}

export function updatePartyRelationship(db, relationshipId, body = {}) {
  const relationship = getPartyRelationship(db, relationshipId);

  if (body.status !== undefined) {
    if (!PARTY_RELATIONSHIP_STATUSES.includes(body.status)) {
      fail(422, "INVALID_STATUS", `Status must be one of: ${PARTY_RELATIONSHIP_STATUSES.join(", ")}`, "status");
    }
    relationship.status = body.status;
  }

  relationship.updatedAt = nowIso();
  return relationship;
}

// ============================================================================
// GIFT ORDER VALIDATION
// ============================================================================

export function validateGiftOrder(db, offering, sponsorId, beneficiaryId) {
  if (!offering.giftingEnabled) {
    fail(422, "GIFTING_NOT_ALLOWED_FOR_OFFERING", "Gifting is not enabled for this offering.", "giftingEnabled");
  }

  if (sponsorId === beneficiaryId) {
    fail(422, "SELF_GIFT_NOT_ALLOWED", "An account cannot gift to itself.", "beneficiaryId");
  }

  const maxBeneficiaries = offering.maxGiftBeneficiaries || 5;
  const activeGifts = listPartyRelationships(db, { sponsorId, status: "active" });
  if (activeGifts.length >= maxBeneficiaries) {
    fail(422, "MAX_GIFT_BENEFICIARIES_EXCEEDED", `Maximum gift beneficiaries (${maxBeneficiaries}) exceeded.`, "beneficiaryId");
  }

  const duplicateGift = activeGifts.find((rel) => rel.beneficiaryId === beneficiaryId);
  if (duplicateGift) {
    fail(422, "GIFT_ALREADY_ACTIVE", "An active gift already exists for this beneficiary.", "beneficiaryId");
  }
}

// ============================================================================
// CS ATTRIBUTE UPDATE FUNCTIONS
// ============================================================================

export function computeCSAttributeUpdates(db, offering, activationDate = null) {
  const productSpec = offering.productSpecificationId ? db.productSpecifications?.get(offering.productSpecificationId) : null;
  const configuredUpdates = offering.csAttributeUpdates?.length ? offering.csAttributeUpdates : productSpec?.csAttributeUpdates || [];
  if (configuredUpdates.length === 0) {
    return [];
  }

  const updates = [];

  for (const update of configuredUpdates) {
    const attributeName = update.attributeName || update.attribute;
    const offeringCharacteristicName = update.offeringCharacteristicName || update.characteristicName;
    const { valueSource, fixedValue, offsetDays } = update;

    let value;
    if (valueSource === "fixed") {
      value = fixedValue;
    } else if (valueSource === "offeringCharacteristic") {
      const characteristic = productSpec?.characteristics?.find((c) => c.name === offeringCharacteristicName);
      value = characteristic?.value;
    } else if (valueSource === "calculatedFromExpiry") {
      if (!activationDate) {
        fail(400, "REQUIRED_FIELD", "activationDate is required for calculatedFromExpiry valueSource.", "activationDate");
      }
      const activationMs = new Date(activationDate).getTime();
      const expiryDate = new Date(activationMs + (offsetDays || 30) * 24 * 60 * 60 * 1000);
      value = expiryDate.toISOString().slice(0, 10);
    }

    if (value !== undefined) {
      updates.push({
        id: randomUUID(),
        attribute: attributeName,
        attributeName,
        value,
        valueSource,
        appliedAt: nowIso()
      });
    }
  }

  return updates;
}

// ============================================================================
// COMPENSATION POLICY FUNCTIONS
// ============================================================================

export function getCompensationPolicy(db, offeringId) {
  const offering = getProductOffering(db, offeringId);
  return (
    offering.compensationPolicy || {
      creditBackEnabled: true,
      retryEnabled: false,
      retryCount: 3,
      retryIntervalSeconds: 60,
      retryAsync: true
    }
  );
}

export function getDefaultCompensationPolicy() {
  return {
    creditBackEnabled: true,
    retryEnabled: false,
    retryCount: 3,
    retryIntervalSeconds: 60,
    retryAsync: true
  };
}

// ============================================================================
// EXTENDED PRODUCT ORDER FUNCTIONS
// ============================================================================

export function createRenewalOrder(db, subscription, body = {}) {
  if (!subscription) fail(400, "REQUIRED_FIELD", "subscription is required.", "subscription");
  if (!body.renewalOfferId) fail(400, "REQUIRED_FIELD", "renewalOfferId is required.", "renewalOfferId");

  const timestamp = nowIso();
  const order = {
    id: randomUUID(),
    orderType: "renew",
    originalSubscriptionId: subscription.id,
    subscriptionId: subscription.id,
    subscriberId: subscription.subscriberId,
    sponsorId: subscription.sponsorId || null,
    channelId: body.channelId || subscription.channelId,
    currency: subscription.currency || "NGN",
    productOfferingId: body.renewalOfferId,
    status: "acknowledged",
    failureReasonCode: null,
    failureMessage: null,
    validationStatus: "pending",
    validationReasonCode: null,
    totalAmount: 0,
    items: [
      {
        id: randomUUID(),
        productOfferingId: body.renewalOfferId,
        quantity: subscription.quantity || 1,
        purchasePolicy: "auto-renewal",
        beneficiaryId: subscription.beneficiaryId || null,
        pricedAmount: 0,
        pricedCurrency: subscription.currency || "NGN"
      }
    ],
    createdAt: timestamp,
    updatedAt: timestamp
  };

  if (!db.productOrders) db.productOrders = new Map();
  db.productOrders.set(order.id, order);
  return order;
}

export function updateOrderRetry(db, orderId, body = {}) {
  const order = getProductOrder(db, orderId);

  if (body.retryCount !== undefined) order.retryAttempts = body.retryCount;
  if (body.retryAttempts !== undefined) order.retryAttempts = body.retryAttempts;
  if (body.nextRetryAt !== undefined) order.nextRetryAt = body.nextRetryAt;
  if (body.retryStepName !== undefined) order.retryStepName = body.retryStepName;

  order.updatedAt = nowIso();
  return order;
}

// ============================================================================
// NOTIFICATION WITH RECIPIENT CONTEXT
// ============================================================================

export function createNotificationEventWithRecipient(db, eventType, order, body = {}) {
  if (!db.notificationEvents) db.notificationEvents = new Map();

  const timestamp = nowIso();
  const notification = {
    id: randomUUID(),
    eventType,
    orderId: order.id,
    subscriberId: order.subscriberId,
    channelId: order.channelId,
    recipientType: body.recipientType || "SELF",
    recipientId: body.recipientId || order.subscriberId,
    payload: body.payload || {},
    status: "pending",
    createdAt: timestamp
  };

  db.notificationEvents.set(notification.id, notification);
  if (!order.notificationEvents) order.notificationEvents = [];
  order.notificationEvents.push(notification);

  return notification;
}

// ============================================================================
// SEGMENT RESOLUTION HELPER
// ============================================================================

export function resolveSegmentFromRules(db, subscriberAttributes = {}) {
  if (!db.customerSegments) return null;

  const activeSegments = [...db.customerSegments.values()].filter((seg) => seg.status === "active");

  for (const segment of activeSegments) {
    let matchesAllRules = true;

    for (const rule of segment.resolutionRules) {
      const attributeValue = subscriberAttributes[rule.attributeName];
      let ruleMatches = false;

      switch (rule.operator) {
        case "equals":
          ruleMatches = attributeValue === rule.value;
          break;
        case "in":
          ruleMatches = Array.isArray(rule.value) ? rule.value.includes(attributeValue) : attributeValue === rule.value;
          break;
        case "notIn":
          ruleMatches = Array.isArray(rule.value) ? !rule.value.includes(attributeValue) : attributeValue !== rule.value;
          break;
        case "contains":
          ruleMatches = String(attributeValue || "").includes(String(rule.value));
          break;
      }

      if (!ruleMatches) {
        matchesAllRules = false;
        break;
      }
    }

    if (matchesAllRules) {
      return segment.id;
    }
  }

  return null;
}
