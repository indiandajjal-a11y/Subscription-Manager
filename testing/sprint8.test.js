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
import { createRenewalSchedule, getRenewalSchedule } from "../code/sprint6.js";
import { createCommunicationTemplate, createCurrencyConfig, dispatchNotificationEvent } from "../code/sprint7.js";
import {
  createBonusDetectionConfig,
  createDormantCleanupRequest,
  createParty,
  createTariffMigrationOrder,
  createTickProvisioningRule,
  fulfillTariffMigrationOrder,
  getConsolidatedBalanceCheck,
  listBonusDetectionRecords,
  runBonusDetectionForOrder,
  validateTariffMigrationOrder
} from "../code/sprint8.js";

const characteristics = [
  { name: "dataVolume", valueType: "number", value: "2", unit: "GB" },
  { name: "validityPeriod", valueType: "number", value: "30", unit: "days" },
  { name: "bundleType", valueType: "string", value: "monthly" },
  { name: "neaActivationRequired", valueType: "boolean", value: "true" }
];

function activeOffering(db, options = {}) {
  if (!db.currencyConfigs.size) createCurrencyConfig(db, { currencyCode: "NGN", symbol: "NGN ", minorUnit: 2, isDefault: true });
  const spec = activateProductSpecification(db, createProductSpecification(db, {
    name: `Sprint 8 Spec ${randomUUID()}`,
    version: "1.0",
    characteristics
  }).id);
  const offering = createProductOffering(db, {
    name: `Sprint 8 Offering ${randomUUID()}`,
    productSpecificationId: spec.id,
    channelAvailability: ["USSD", "SMS", "CRM"],
    ...options.offering
  });
  addProductOfferingPrice(db, offering.id, {
    priceType: "standard",
    amount: options.amount || 500,
    currencyCode: "NGN",
    chargingSource: "MA",
    isDefault: true
  });
  return activateProductOffering(db, offering.id);
}

function completedOrder(db, options = {}) {
  const offering = activeOffering(db, options);
  const cart = createShoppingCart(db, {
    channelId: options.channelId || "USSD",
    subscriberId: options.subscriberId || "2348012345678",
    currency: "NGN"
  });
  addCartItem(db, cart.id, { productOfferingId: offering.id });
  validateShoppingCart(db, cart.id, { subscriberAttributes: {} });
  const order = checkoutShoppingCart(db, cart.id);
  const account = createSubscriberAccountSnapshot(db, order.id, {
    subscriberId: order.subscriberId,
    serviceClass: "PREPAID",
    segment: "CONSUMER",
    mainBalance: 10000,
    currency: "NGN",
    daBalances: options.daBalances || [],
    offerIds: []
  });
  validateProductOrderWithSubscriberAccount(db, order.id, account);
  return {
    order: executeProductOrderFulfillment(db, order.id, { inventory: { csAttachmentId: "ATTACH-S8" } }),
    offering
  };
}

test("Sprint 8: dormant cleanup terminates active inventory, cancels renewal, decommissions party, and blocks new carts", async () => {
  const db = createStore();
  const { order } = completedOrder(db, { subscriberId: "234800000001" });
  const inventory = [...db.productInventories.values()].find((item) => item.productOrderId === order.id);
  const schedule = createRenewalSchedule(db, {
    subscriptionId: inventory.id,
    subscriberId: inventory.subscriberId,
    productOfferingId: inventory.productOfferingId,
    scheduledAt: "2026-06-01T00:00:00Z",
    renewalOfferId: inventory.productOfferingId
  });

  const cleanup = await createDormantCleanupRequest(db, {
    subscriberId: "234800000001",
    channelId: "CRM",
    decommissionReason: "MSISDN_REALLOCATION"
  });

  assert.equal(cleanup.status, "completed");
  assert.equal(cleanup.subscriptionsTerminated, 1);
  assert.equal(db.productInventories.get(inventory.id).status, "terminated");
  assert.equal(getRenewalSchedule(db, schedule.id).status, "cancelled");
  assert.equal([...db.parties.values()][0].status, "decommissioned");
  assert.equal(listNotificationEvents(db, { eventType: "SUBSCRIBER_DECOMMISSIONED" }).length, 1);
  assert.throws(() => createShoppingCart(db, { channelId: "USSD", subscriberId: "234800000001", currency: "NGN" }), /decommissioned/);
});

test("Sprint 8: balance check renders active subscriptions with one live GBAD response", async () => {
  const db = createStore();
  completedOrder(db, { subscriberId: "234800000002" });
  completedOrder(db, { subscriberId: "234800000002" });
  createCommunicationTemplate(db, {
    name: "Balance check",
    eventType: "BALANCE_CHECK",
    channelType: "USSD",
    bodyTemplate: "Bundles:\n{{#each activeSubscriptions}}{{index}}. {{offeringName}} {{dataVolume}} expires {{endDate}}\n{{/each}}\nMain {{mainBalance}} Total {{aggregateBalance}}"
  });
  let calls = 0;
  const result = await getConsolidatedBalanceCheck(db, "234800000002", {}, {
    channelType: "USSD",
    chargingSystemClient: {
      fetchSubscriberAccount: async () => {
        calls += 1;
        return {
          status: "success",
          mainBalance: 250,
          currency: "NGN",
          daBalances: [{ daId: "DATA_DA_1", balance: 2048, expiry: "2026-06-01T00:00:00Z" }]
        };
      }
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.activeSubscriptions.length, 2);
  assert.match(result.renderedBody, /1\. Sprint 8 Offering/);
  assert.match(result.renderedBody, /Main NGN 250\.00 Total 2\.00 GB/);
});

test("Sprint 8: bonus detection writes audit record and dispatchable DATA_BONUS_AWARDED event", async () => {
  const db = createStore();
  const { order, offering } = completedOrder(db, {
    subscriberId: "234800000003",
    daBalances: [{ daId: "BONUS_DA_1", balance: 100 }]
  });
  createBonusDetectionConfig(db, offering.id, {
    bonusDataSourceDaId: "BONUS_DA_1",
    bonusThresholdMB: 100
  });
  createCommunicationTemplate(db, {
    name: "Bonus SMS",
    eventType: "DATA_BONUS_AWARDED",
    channelType: "SMS",
    bodyTemplate: "Bonus {{bonusDeltaMB}} awarded. Before {{preProvisionBalance}} after {{postProvisionBalance}}"
  });

  const records = await runBonusDetectionForOrder(db, order.id, {
    chargingSystemClient: {
      fetchSubscriberAccount: async () => ({
        status: "success",
        subscriberId: order.subscriberId,
        daBalances: [{ daId: "BONUS_DA_1", balance: 250 }]
      })
    }
  });
  const event = listNotificationEvents(db, { eventType: "DATA_BONUS_AWARDED" })[0];
  const dispatch = await dispatchNotificationEvent(db, event.id, { channelType: "SMS" });

  assert.equal(records[0].bonusDetected, true);
  assert.equal(listBonusDetectionRecords(db, { orderId: order.id }).length, 1);
  assert.match(dispatch.renderedBody, /Bonus 150 MB awarded/);
});

test("Sprint 8: tariff migration validates TICK rule and completes best-effort TICK provisioning", async () => {
  const db = createStore();
  createCurrencyConfig(db, { currencyCode: "NGN", symbol: "NGN ", minorUnit: 2, isDefault: true });
  const rule = createTickProvisioningRule(db, {
    name: "Prepaid to postpaid",
    triggerType: "ADD_TICK",
    fromServiceClass: ["PREPAID"],
    toServiceClass: ["POSTPAID"],
    tickOfferId: "TICK-POSTPAID"
  });
  const order = createTariffMigrationOrder(db, {
    orderType: "modify",
    modifyType: "TARIFF_MIGRATION",
    subscriberId: "234800000004",
    channelId: "CRM",
    toServiceClass: "POSTPAID"
  });

  const validated = await validateTariffMigrationOrder(db, order.id, { fromServiceClass: "PREPAID" });
  const completed = await fulfillTariffMigrationOrder(db, order.id, {
    tickProvisioningClient: {
      addTick: async () => ({ status: "success", tickRef: "TICK-1", failureReason: null })
    }
  });

  assert.equal(validated.tariffMigrationRequest.tickRuleApplied, rule.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.fulfillmentSteps.some((step) => step.stepName === "tickProvisioning"), true);
  assert.equal(listNotificationEvents(db, { eventType: "TARIFF_MIGRATION_COMPLETED" }).length, 1);
});

test("Sprint 8: non-CRM dormant cleanup is rejected and same-class tariff migration fails", async () => {
  const db = createStore();
  createParty(db, { subscriberId: "234800000005" });
  await assert.rejects(
    () => createDormantCleanupRequest(db, { subscriberId: "234800000005", channelType: "USSD" }, { channelType: "USSD" }),
    /restricted to CRM/
  );

  const order = createTariffMigrationOrder(db, {
    subscriberId: "234800000006",
    channelId: "CRM",
    toServiceClass: "PREPAID"
  });
  await assert.rejects(
    () => validateTariffMigrationOrder(db, order.id, { fromServiceClass: "PREPAID" }),
    /already active/
  );
});
