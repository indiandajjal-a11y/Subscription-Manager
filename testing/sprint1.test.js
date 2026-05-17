import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createStore } from "../code/store.js";
import {
  activateProductOffering,
  activateProductSpecification,
  addCartItem,
  addEligibilityRule,
  addProductOfferingPrice,
  abandonShoppingCart,
  checkoutShoppingCart,
  createProductOffering,
  createProductSpecification,
  createShoppingCart,
  getProductOffering,
  retireProductOffering,
  retireProductSpecification,
  selectPrice,
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

function activeSpecification(db) {
  const spec = createProductSpecification(db, { name: `Spec ${randomUUID()}`, version: "1.0", characteristics });
  return activateProductSpecification(db, spec.id);
}

function activeOffering(db, options = {}) {
  const spec = options.specification || activeSpecification(db);
  const offering = createProductOffering(db, {
    name: `Offering ${randomUUID()}`,
    productSpecificationId: spec.id,
    channelAvailability: options.channelAvailability || []
  });
  addProductOfferingPrice(db, offering.id, {
    priceType: "standard",
    amount: options.amount || 100,
    currency: options.currency || "NGN",
    chargingSource: "MA",
    isDefault: true
  });
  return activateProductOffering(db, offering.id);
}

test("1. create spec with all required characteristics returns id", () => {
  const db = createStore();
  const spec = createProductSpecification(db, { name: "Monthly 5GB", version: "1.0", characteristics });
  assert.ok(spec.id);
});

test("2. create spec missing bundleType fails with field error", () => {
  const db = createStore();
  const missingBundleType = characteristics.filter((item) => item.name !== "bundleType");
  assert.deepEqual(reason(() => createProductSpecification(db, { name: "Bad", version: "1.0", characteristics: missingBundleType })), {
    status: 400,
    reasonCode: "MISSING_REQUIRED_CHARACTERISTIC"
  });
});

test("3. activate spec sets active status", () => {
  const db = createStore();
  const spec = createProductSpecification(db, { name: "Monthly", version: "1.0", characteristics });
  assert.equal(activateProductSpecification(db, spec.id).status, "active");
});

test("4. activate incomplete spec returns 409", () => {
  const db = createStore();
  const spec = { id: "incomplete", name: "Incomplete", version: "1.0", status: "draft", characteristics: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  db.productSpecifications.set(spec.id, spec);
  assert.deepEqual(reason(() => activateProductSpecification(db, spec.id)), {
    status: 409,
    reasonCode: "MISSING_REQUIRED_CHARACTERISTIC"
  });
});

test("5. retire active spec without active offerings", () => {
  const db = createStore();
  const spec = activeSpecification(db);
  assert.equal(retireProductSpecification(db, spec.id).status, "retired");
});

test("6. retire spec with active offering returns conflict", () => {
  const db = createStore();
  const spec = activeSpecification(db);
  activeOffering(db, { specification: spec });
  assert.deepEqual(reason(() => retireProductSpecification(db, spec.id)), {
    status: 409,
    reasonCode: "SPECIFICATION_HAS_ACTIVE_OFFERINGS"
  });
});

test("7. create offering referencing retired spec returns conflict", () => {
  const db = createStore();
  const spec = retireProductSpecification(db, activeSpecification(db).id);
  assert.deepEqual(reason(() => createProductOffering(db, { name: "Retired ref", productSpecificationId: spec.id })), {
    status: 409,
    reasonCode: "SPECIFICATION_RETIRED"
  });
});

test("8. activate offering without prices returns conflict", () => {
  const db = createStore();
  const offering = createProductOffering(db, { name: "No price", productSpecificationId: activeSpecification(db).id });
  assert.deepEqual(reason(() => activateProductOffering(db, offering.id)), {
    status: 409,
    reasonCode: "NO_DEFAULT_PRICE"
  });
});

test("9. adding second default price unsets first for same currency", () => {
  const db = createStore();
  const offering = createProductOffering(db, { name: "Prices", productSpecificationId: activeSpecification(db).id });
  const first = addProductOfferingPrice(db, offering.id, { priceType: "standard", amount: 100, currency: "NGN", chargingSource: "MA", isDefault: true });
  const second = addProductOfferingPrice(db, offering.id, { priceType: "standard", amount: 90, currency: "NGN", chargingSource: "DA", priority: 1, isDefault: true });
  assert.equal(offering.prices.find((price) => price.id === first.id).isDefault, false);
  assert.equal(offering.prices.find((price) => price.id === second.id).isDefault, true);
});

test("10. sunset date in past triggers auto-retire on get", () => {
  const db = createStore();
  const offering = activeOffering(db);
  offering.sunsetDate = "2000-01-01";
  assert.equal(getProductOffering(db, offering.id).status, "retired");
});

test("11. create cart returns cart id and expiresAt", () => {
  const db = createStore();
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "2348012345678", currency: "NGN" });
  assert.ok(cart.id);
  assert.ok(cart.expiresAt);
});

test("11a. create cart without currency returns 400", () => {
  const db = createStore();
  assert.deepEqual(reason(() => createShoppingCart(db, { channelId: "USSD", subscriberId: "234" })), {
    status: 400,
    reasonCode: "REQUIRED_FIELD"
  });
});

test("11b. create cart with unsupported currency returns 422", () => {
  const db = createStore();
  assert.deepEqual(reason(() => createShoppingCart(db, { channelId: "USSD", subscriberId: "234", currency: "EUR" })), {
    status: 422,
    reasonCode: "UNSUPPORTED_CURRENCY"
  });
});

test("12. add active offering to cart creates item", () => {
  const db = createStore();
  const offering = activeOffering(db);
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "234", currency: "NGN" });
  assert.ok(addCartItem(db, cart.id, { productOfferingId: offering.id }).id);
});

test("13. add retired offering to cart is rejected", () => {
  const db = createStore();
  const offering = activeOffering(db);
  retireProductOffering(db, offering.id);
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "234", currency: "NGN" });
  assert.deepEqual(reason(() => addCartItem(db, cart.id, { productOfferingId: offering.id })), {
    status: 422,
    reasonCode: "OFFERING_NOT_ACTIVE"
  });
});

test("14. gift item without beneficiaryId is rejected", () => {
  const db = createStore();
  const offering = activeOffering(db);
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "234", currency: "NGN" });
  assert.deepEqual(reason(() => addCartItem(db, cart.id, { productOfferingId: offering.id, purchasePolicy: "gift" })), {
    status: 422,
    reasonCode: "BENEFICIARY_REQUIRED"
  });
});

test("14b. gift item with beneficiary equal to subscriber is rejected", () => {
  const db = createStore();
  const offering = activeOffering(db);
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "234", currency: "NGN" });
  assert.deepEqual(reason(() => addCartItem(db, cart.id, { productOfferingId: offering.id, purchasePolicy: "gift", beneficiaryId: "234" })), {
    status: 422,
    reasonCode: "INVALID_BENEFICIARY"
  });
});

test("15. wrong-channel cart cannot add item", () => {
  const db = createStore();
  const offering = activeOffering(db, { channelAvailability: ["USSD"] });
  const cart = createShoppingCart(db, { channelId: "SMS", subscriberId: "234", currency: "NGN" });
  assert.deepEqual(reason(() => addCartItem(db, cart.id, { productOfferingId: offering.id })), {
    status: 422,
    reasonCode: "CHANNEL_NOT_ALLOWED"
  });
});

test("16. validate eligible cart marks item valid and priced", () => {
  const db = createStore();
  const offering = activeOffering(db);
  addEligibilityRule(db, offering.id, { ruleType: "serviceClass", operator: "equals", value: "PREPAID", failureReasonCode: "INELIGIBLE_SERVICE_CLASS" });
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "234", currency: "NGN" });
  addCartItem(db, cart.id, { productOfferingId: offering.id });
  const result = validateShoppingCart(db, cart.id, { subscriberAttributes: { serviceClass: "PREPAID" } });
  assert.equal(result.cart.status, "validated");
  assert.equal(result.cart.items[0].pricedAmount, 100);
});

test("16a. missing cart currency price marks item invalid", () => {
  const db = createStore();
  const offering = activeOffering(db, { currency: "USD" });
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "234", currency: "NGN" });
  addCartItem(db, cart.id, { productOfferingId: offering.id });
  const result = validateShoppingCart(db, cart.id, { subscriberAttributes: {} });
  assert.equal(result.errors[0].reasonCode, "NO_PRICE_FOR_CURRENCY");
  assert.equal(result.cart.status, "active");
});

test("17. one ineligible item keeps cart active with invalid item", () => {
  const db = createStore();
  const offering = activeOffering(db);
  addEligibilityRule(db, offering.id, { ruleType: "segment", operator: "equals", value: "STAFF", failureReasonCode: "INELIGIBLE_SEGMENT" });
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "234", currency: "NGN" });
  addCartItem(db, cart.id, { productOfferingId: offering.id });
  const result = validateShoppingCart(db, cart.id, { subscriberAttributes: { segment: "RETAIL" } });
  assert.equal(result.cart.status, "active");
  assert.equal(result.cart.items[0].validationStatus, "invalid");
});

test("18. checkout validated cart creates acknowledged order and closes cart", () => {
  const db = createStore();
  const offering = activeOffering(db);
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "234", currency: "NGN" });
  addCartItem(db, cart.id, { productOfferingId: offering.id });
  validateShoppingCart(db, cart.id, {});
  const order = checkoutShoppingCart(db, cart.id);
  assert.ok(order.id);
  assert.equal(order.status, "acknowledged");
  assert.equal(cart.status, "checkedOut");
});

test("19. checkout non-validated cart returns conflict", () => {
  const db = createStore();
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "234", currency: "NGN" });
  assert.deepEqual(reason(() => checkoutShoppingCart(db, cart.id)), {
    status: 409,
    reasonCode: "CART_NOT_VALIDATED"
  });
});

test("20. add item to checked-out cart returns cart closed", () => {
  const db = createStore();
  const offering = activeOffering(db);
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "234", currency: "NGN" });
  addCartItem(db, cart.id, { productOfferingId: offering.id });
  validateShoppingCart(db, cart.id, {});
  checkoutShoppingCart(db, cart.id);
  assert.deepEqual(reason(() => addCartItem(db, cart.id, { productOfferingId: offering.id })), {
    status: 409,
    reasonCode: "CART_CLOSED"
  });
});

test("21. abandon cart closes it for future POST operations", () => {
  const db = createStore();
  const offering = activeOffering(db);
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "234", currency: "NGN" });
  abandonShoppingCart(db, cart.id);
  assert.equal(cart.status, "abandoned");
  assert.deepEqual(reason(() => addCartItem(db, cart.id, { productOfferingId: offering.id })), {
    status: 409,
    reasonCode: "CART_CLOSED"
  });
});

test("22. operation on expired cart returns gone", () => {
  const db = createStore();
  const offering = activeOffering(db);
  const cart = createShoppingCart(db, { channelId: "USSD", subscriberId: "234", currency: "NGN" }, { cartTtlMinutes: -1, supportedCurrencies: ["NGN"] });
  assert.deepEqual(reason(() => addCartItem(db, cart.id, { productOfferingId: offering.id })), {
    status: 410,
    reasonCode: "CART_EXPIRED"
  });
});

test("discount validation, percentage bounds, and DA priority pricing are enforced", () => {
  const db = createStore();
  const offering = createProductOffering(db, { name: "Discounts", productSpecificationId: activeSpecification(db).id });
  const parent = addProductOfferingPrice(db, offering.id, { priceType: "standard", amount: 100, currency: "NGN", chargingSource: "DA", priority: 2, isDefault: true });
  assert.equal(reason(() => addProductOfferingPrice(db, offering.id, { priceType: "discount", amount: 0, currency: "NGN", chargingSource: "MA", discountType: "percentage", discountValue: 150 })).reasonCode, "REQUIRED_FIELD");
  assert.equal(reason(() => addProductOfferingPrice(db, offering.id, { priceType: "discount", amount: 0, currency: "NGN", chargingSource: "MA", parentPriceId: parent.id, discountType: "percentage", discountValue: 150 })).reasonCode, "INVALID_PERCENTAGE_DISCOUNT");
  addProductOfferingPrice(db, offering.id, { priceType: "discount", amount: 0, currency: "NGN", chargingSource: "DA", priority: 1, parentPriceId: parent.id, discountType: "percentage", discountValue: 10, eligibilityCondition: "serviceClass == 'STAFF'" });
  assert.equal(selectPrice(offering, "NGN", { serviceClass: "STAFF" }).amount, 90);
});

