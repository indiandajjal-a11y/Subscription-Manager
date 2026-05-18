import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createStore } from "../code/store.js";
import {
  activateProductOffering,
  activateProductSpecification,
  addProductOfferingPrice,
  createProductOffering,
  createProductSpecification,
  listNotificationEvents
} from "../code/domain.js";
import { createCommunicationTemplate, createCurrencyConfig } from "../code/sprint7.js";
import {
  auditLog,
  createTransferLimit,
  getCustomerPreference,
  handleSimUpgradeSubscriberResponse,
  listCreditTransfers,
  processSimUpgradeDeviceEvent,
  readiness,
  receiveSimUpgradeCallback,
  requestCreditTransfer,
  setTransferPin,
  updateTransferLimit,
  upsertCustomerPreference,
  upsertSimUpgradeConfig,
  withAsyncIdempotency
} from "../code/sprint9.js";

const characteristics = [
  { name: "dataVolume", valueType: "number", value: "1", unit: "GB" },
  { name: "validityPeriod", valueType: "number", value: "30", unit: "days" },
  { name: "bundleType", valueType: "string", value: "monthly" },
  { name: "neaActivationRequired", valueType: "boolean", value: "true" }
];

function offering(db) {
  if (!db.currencyConfigs.size) createCurrencyConfig(db, { currencyCode: "NGN", symbol: "NGN ", minorUnit: 2, isDefault: true });
  const spec = activateProductSpecification(db, createProductSpecification(db, {
    name: `Sprint 9 Spec ${randomUUID()}`,
    version: "1.0",
    characteristics
  }).id);
  const item = createProductOffering(db, {
    name: `4G Upgrade ${randomUUID()}`,
    productSpecificationId: spec.id,
    channelAvailability: ["USSD", "SMS", "CRM"],
    psoFlagCharacteristicName: "PSO_FLAG"
  });
  addProductOfferingPrice(db, item.id, {
    priceType: "standard",
    amount: 0,
    currencyCode: "NGN",
    chargingSource: "MA",
    isDefault: true
  });
  return activateProductOffering(db, item.id);
}

function configureSimUpgrade(db) {
  const upgrade = offering(db);
  createCommunicationTemplate(db, {
    name: "SIM menu",
    eventType: "SIM_UPGRADE_MENU",
    channelType: "USSD",
    bodyTemplate: "Reply 1 to upgrade, 2 to decline."
  });
  return upsertSimUpgradeConfig(db, {
    upgradeOfferingId: upgrade.id,
    csTimerAttribute: "SimUpgradeTimerAttr",
    csTimerValueSeconds: 30,
    rateLimitDays: 7
  });
}

test("Sprint 13: SIM upgrade respects DND, rate limit, SIM type, and callback dispatch", async () => {
  const db = createStore();
  configureSimUpgrade(db);
  upsertCustomerPreference(db, { subscriberId: "234900000001", dndEnabled: true, dndSetBy: "CRM" });

  const dnd = await processSimUpgradeDeviceEvent(db, {
    subscriberId: "234900000001",
    deviceId: "IMEI-DND",
    triggerType: "DEVICE_ACTIVATION"
  });
  assert.equal(dnd.actionTaken, "DND_EXCLUDED");
  assert.equal(getCustomerPreference(db, "234900000001").dndEnabled, true);

  const prompted = await processSimUpgradeDeviceEvent(db, {
    subscriberId: "234900000002",
    deviceId: "IMEI-LEGACY",
    triggerType: "DEVICE_ACTIVATION"
  }, {
    simCheckClient: { checkSim: async () => ({ simType: "LEGACY" }) }
  });
  assert.equal(prompted.actionTaken, "PROMPTED");

  const duplicate = processSimUpgradeDeviceEvent(db, {
    subscriberId: "234900000002",
    deviceId: "IMEI-LEGACY",
    triggerType: "DEVICE_ACTIVATION"
  });
  await assert.rejects(() => duplicate, /already processed/);

  const callback = await receiveSimUpgradeCallback(db, {
    subscriberId: "234900000002",
    eventId: prompted.eventId,
    callbackRef: "CS-CB-1"
  });
  assert.equal(callback.dispatchStatus, "sent");
  assert.equal(listNotificationEvents(db, { eventType: "SIM_UPGRADE_MENU" }).length, 1);
});

test("Sprint 13: SIM upgrade acceptance uses the combined subscribe path", async () => {
  const db = createStore();
  configureSimUpgrade(db);
  const prompted = await processSimUpgradeDeviceEvent(db, {
    subscriberId: "234900000003",
    deviceId: "IMEI-ACCEPT",
    triggerType: "DEVICE_ACTIVATION"
  }, {
    simCheckClient: { checkSim: async () => ({ simType: "LEGACY" }) }
  });

  const accepted = await handleSimUpgradeSubscriberResponse(db, {
    eventId: prompted.eventId,
    response: "ACCEPT",
    currency: "NGN"
  });

  assert.equal(accepted.response, "ACCEPT");
  assert.ok(accepted.orderId);
  assert.equal(listNotificationEvents(db, { eventType: "SIM_UPGRADE_ACCEPTED" }).length, 1);
});

test("Sprint 13: PIN setup, failed attempts, lockout, and successful transfer", async () => {
  const db = createStore();
  setTransferPin(db, { subscriberId: "234900000004", pin: "1234", channelId: "USSD" });
  assert.equal(db.subscriberPins.get("234900000004").encryptedPin.includes("1234"), false);
  createTransferLimit(db, { limitType: "PER_TRANSFER", maxAmount: 1000, currency: "NGN" });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(() => requestCreditTransfer(db, {
      senderSubscriberId: "234900000004",
      recipientSubscriberId: "234900000005",
      amount: 100,
      currency: "NGN",
      pin: "9999"
    }), /PIN validation failed|PIN is locked/);
  }
  await assert.rejects(() => requestCreditTransfer(db, {
    senderSubscriberId: "234900000004",
    recipientSubscriberId: "234900000005",
    amount: 100,
    currency: "NGN",
    pin: "1234"
  }), /PIN is locked/);

  const db2 = createStore();
  setTransferPin(db2, { subscriberId: "234900000006", pin: "1234" });
  createTransferLimit(db2, { limitType: "PER_TRANSFER", maxAmount: 1000, currency: "NGN" });
  const transfer = await requestCreditTransfer(db2, {
    senderSubscriberId: "234900000006",
    recipientSubscriberId: "234900000007",
    amount: 200,
    currency: "NGN",
    pin: "1234"
  }, {
    chargingSystemClient: {
      fetchSubscriberAccount: async () => ({ status: "success", mainBalance: 500, currency: "NGN" }),
      debit: async () => ({ status: "success", transactionId: "DEBIT-1" }),
      credit: async () => ({ status: "success", transactionId: "CREDIT-1" })
    }
  });
  assert.equal(transfer.status, "completed");
  assert.equal(transfer.senderDebitRef, "DEBIT-1");
  assert.equal(transfer.recipientCreditRef, "CREDIT-1");
  assert.equal(listNotificationEvents(db2, { eventType: "TRANSFER_SENT" }).length, 1);
  assert.equal(listNotificationEvents(db2, { eventType: "TRANSFER_RECEIVED" }).length, 1);
});

test("Sprint 13: transfer limits, self-transfer guard, credit failure reversal, and history", async () => {
  const db = createStore();
  setTransferPin(db, { subscriberId: "234900000008", pin: "1234" });
  createTransferLimit(db, { limitType: "PER_TRANSFER", maxAmount: 50, currency: "NGN" });
  await assert.rejects(() => requestCreditTransfer(db, {
    senderSubscriberId: "234900000008",
    recipientSubscriberId: "234900000008",
    amount: 10,
    currency: "NGN",
    pin: "1234"
  }), /Sender and recipient must differ/);
  await assert.rejects(() => requestCreditTransfer(db, {
    senderSubscriberId: "234900000008",
    recipientSubscriberId: "234900000009",
    amount: 60,
    currency: "NGN",
    pin: "1234"
  }), /PER_TRANSFER transfer limit exceeded/);

  const [limit] = [...db.transferLimits.values()];
  updateTransferLimit(db, limit.id, { status: "inactive" });
  const reversed = await requestCreditTransfer(db, {
    senderSubscriberId: "234900000008",
    recipientSubscriberId: "234900000009",
    amount: 60,
    currency: "NGN",
    pin: "1234"
  }, {
    chargingSystemClient: {
      fetchSubscriberAccount: async () => ({ status: "success", mainBalance: 100, currency: "NGN" }),
      debit: async () => ({ status: "success", transactionId: "DEBIT-2" }),
      credit: async () => ({ status: "failed", failureReason: "CS_DOWN" }),
      creditBack: async () => ({ status: "success", transactionId: "REV-1" })
    }
  });
  assert.equal(reversed.status, "reversed");
  assert.equal(listCreditTransfers(db, { senderSubscriberId: "234900000008" }).length, 1);
});

test("Sprint 13: idempotency, audit log, and readiness are available", async () => {
  const db = createStore();
  let calls = 0;
  const first = await withAsyncIdempotency(db, "IDEMP-1", "unit", async () => {
    calls += 1;
    return { value: randomUUID() };
  });
  const second = await withAsyncIdempotency(db, "IDEMP-1", "unit", async () => {
    calls += 1;
    return { value: "changed" };
  });
  assert.equal(calls, 1);
  assert.deepEqual(first, second);

  setTransferPin(db, { subscriberId: "234900000010", pin: "1234" });
  await requestCreditTransfer(db, {
    senderSubscriberId: "234900000010",
    recipientSubscriberId: "234900000011",
    amount: 10,
    currency: "NGN",
    pin: "1234"
  });
  assert.equal(auditLog(db, { subscriberId: "234900000010" }).some((entry) => entry.entityType === "CreditTransferRequest"), true);

  const ready = await readiness(db, {
    chargingSystemClient: { fetchSubscriberAccount: async () => ({ status: "failed" }) }
  });
  assert.equal(ready.status, "degraded");
  assert.equal(ready.checks.cs, "error");
});
