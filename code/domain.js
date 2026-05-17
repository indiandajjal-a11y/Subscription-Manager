import { randomUUID } from "node:crypto";
import { fail } from "./errors.js";

const SPEC_STATUSES = ["draft", "active", "retired"];
const OFFERING_STATUSES = ["draft", "active", "retired"];
const VALUE_TYPES = ["number", "string", "boolean"];
const PRICE_TYPES = ["standard", "discount"];
const CHARGING_SOURCES = ["MA", "DA", "LOYALTY", "MOBILE_MONEY"];
const DISCOUNT_TYPES = ["fixed", "percentage"];
const RULE_TYPES = ["serviceClass", "segment", "multiPurchase", "renewal", "channel"];
const OPERATORS = ["equals", "notEquals", "in", "notIn"];
const POLICIES = ["one-off", "auto-renewal", "gift"];
const ORDER_STATUSES = ["acknowledged", "inProgress", "completed", "failed", "cancelled"];
const FULFILLMENT_STEPS = ["debit", "attachOffer", "neaActivation"];
const CHANNEL_TYPES = ["USSD", "SMS", "WEB", "CRM", "MOBILE_APP", "THIRD_PARTY", "SELF_CARE"];
const CHANNEL_STATUSES = ["active", "inactive"];
const REQUIRED_CHARACTERISTICS = {
  dataVolume: { valueType: "number", units: ["GB", "MB"] },
  validityPeriod: { valueType: "number", units: ["days"] },
  bundleType: { valueType: "string", values: ["daily", "weekly", "monthly", "one-off"] },
  neaActivationRequired: { valueType: "boolean" }
};

export function configFromEnv(env = process.env) {
  return {
    cartTtlMinutes: Number(env.CART_TTL_MINUTES || 30),
    supportedCurrencies: (env.SUPPORTED_CURRENCIES || "USD,INR,NGN,JPY").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean)
  };
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function assertRequired(value, field) {
  if (value === undefined || value === null || value === "") {
    fail(400, "REQUIRED_FIELD", `${field} is required.`, field);
  }
}

function assertEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    fail(422, "INVALID_ENUM", `${field} must be one of: ${allowed.join(", ")}.`, field);
  }
}

function normalizeCharacteristics(characteristics = []) {
  if (!Array.isArray(characteristics)) {
    fail(400, "INVALID_CHARACTERISTICS", "characteristics must be an array.", "characteristics");
  }
  return characteristics.map((item) => {
    assertRequired(item.name, "characteristics.name");
    assertEnum(item.valueType, VALUE_TYPES, "characteristics.valueType");
    assertRequired(item.value, "characteristics.value");
    return {
      id: item.id || randomUUID(),
      name: item.name,
      valueType: item.valueType,
      value: String(item.value),
      unit: item.unit
    };
  });
}

function validateRequiredCharacteristics(characteristics) {
  const byName = new Map(characteristics.map((item) => [item.name, item]));
  for (const [name, rule] of Object.entries(REQUIRED_CHARACTERISTICS)) {
    const item = byName.get(name);
    if (!item) fail(400, "MISSING_REQUIRED_CHARACTERISTIC", `${name} characteristic is required.`, "characteristics");
    if (item.valueType !== rule.valueType) fail(400, "INVALID_CHARACTERISTIC_TYPE", `${name} must have valueType ${rule.valueType}.`, "characteristics");
    if (rule.units && !rule.units.includes(item.unit)) fail(400, "INVALID_CHARACTERISTIC_UNIT", `${name} unit must be ${rule.units.join(" or ")}.`, "characteristics");
    if (rule.values && !rule.values.includes(item.value)) fail(400, "INVALID_CHARACTERISTIC_VALUE", `${name} value is not allowed.`, "characteristics");
  }
}

function ensureUniqueName(records, name, currentId, entity) {
  for (const item of records.values()) {
    if (item.name === name && item.id !== currentId) {
      fail(409, "DUPLICATE_NAME", `${entity} name must be unique.`, "name");
    }
  }
}

export function createProductSpecification(db, body) {
  assertRequired(body.name, "name");
  assertRequired(body.version, "version");
  ensureUniqueName(db.productSpecifications, body.name, undefined, "ProductSpecification");
  const characteristics = normalizeCharacteristics(body.characteristics);
  validateRequiredCharacteristics(characteristics);
  const timestamp = nowIso();
  const specification = {
    id: randomUUID(),
    name: body.name,
    version: body.version,
    description: body.description,
    status: body.status || "draft",
    characteristics,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  assertEnum(specification.status, SPEC_STATUSES, "status");
  db.productSpecifications.set(specification.id, specification);
  return specification;
}

export function listProductSpecifications(db, query = {}) {
  return [...db.productSpecifications.values()].filter((item) => !query.status || item.status === query.status);
}

export function getProductSpecification(db, id) {
  const specification = db.productSpecifications.get(id);
  if (!specification) fail(404, "SPECIFICATION_NOT_FOUND", "ProductSpecification was not found.", "id");
  return specification;
}

export function updateProductSpecification(db, id, body) {
  const specification = getProductSpecification(db, id);
  if (body.name) ensureUniqueName(db.productSpecifications, body.name, id, "ProductSpecification");
  if (body.characteristics) {
    specification.characteristics = normalizeCharacteristics(body.characteristics);
    validateRequiredCharacteristics(specification.characteristics);
  }
  for (const field of ["name", "description"]) {
    if (body[field] !== undefined) specification[field] = body[field];
  }
  specification.updatedAt = nowIso();
  return specification;
}

export function activateProductSpecification(db, id) {
  const specification = getProductSpecification(db, id);
  if (specification.status !== "draft") fail(409, "INVALID_STATUS_TRANSITION", "Only draft specifications can be activated.", "status");
  try {
    validateRequiredCharacteristics(specification.characteristics);
  } catch (error) {
    error.status = 409;
    throw error;
  }
  specification.status = "active";
  specification.updatedAt = nowIso();
  return specification;
}

export function retireProductSpecification(db, id) {
  const specification = getProductSpecification(db, id);
  const hasActiveOffering = [...db.productOfferings.values()].some((offering) => offering.productSpecificationId === id && offering.status === "active");
  if (hasActiveOffering) fail(409, "SPECIFICATION_HAS_ACTIVE_OFFERINGS", "Cannot retire a ProductSpecification with active ProductOfferings.", "status");
  if (specification.status !== "active") fail(409, "INVALID_STATUS_TRANSITION", "Only active specifications can be retired.", "status");
  specification.status = "retired";
  specification.updatedAt = nowIso();
  return specification;
}

function normalizeEligibilityRules(rules = []) {
  if (!Array.isArray(rules)) fail(400, "INVALID_ELIGIBILITY_RULES", "eligibilityRules must be an array.", "eligibilityRules");
  return rules.map((rule) => normalizeEligibilityRule(rule));
}

function normalizeEligibilityRule(rule) {
  assertEnum(rule.ruleType, RULE_TYPES, "ruleType");
  assertEnum(rule.operator, OPERATORS, "operator");
  assertRequired(rule.value, "value");
  assertRequired(rule.failureReasonCode, "failureReasonCode");
  return {
    id: rule.id || randomUUID(),
    ruleType: rule.ruleType,
    operator: rule.operator,
    value: String(rule.value),
    failureReasonCode: rule.failureReasonCode
  };
}

export function createProductOffering(db, body) {
  assertRequired(body.name, "name");
  assertRequired(body.productSpecificationId, "productSpecificationId");
  ensureUniqueName(db.productOfferings, body.name, undefined, "ProductOffering");
  const specification = getProductSpecification(db, body.productSpecificationId);
  if (specification.status === "retired") fail(409, "SPECIFICATION_RETIRED", "Retired ProductSpecification cannot be referenced by new ProductOfferings.", "productSpecificationId");
  const timestamp = nowIso();
  const offering = {
    id: randomUUID(),
    name: body.name,
    status: body.status || "draft",
    productSpecificationId: body.productSpecificationId,
    prices: [],
    eligibilityRules: normalizeEligibilityRules(body.eligibilityRules || []),
    channelAvailability: body.channelAvailability || [],
    sunsetDate: body.sunsetDate,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  assertEnum(offering.status, OFFERING_STATUSES, "status");
  db.productOfferings.set(offering.id, offering);
  return offering;
}

export function autoRetireIfSunset(offering) {
  if (offering.status !== "retired" && offering.sunsetDate && todayDate() >= offering.sunsetDate) {
    offering.status = "retired";
    offering.updatedAt = nowIso();
  }
  return offering;
}

export function listProductOfferings(db, query = {}) {
  return [...db.productOfferings.values()]
    .map(autoRetireIfSunset)
    .filter((item) => !query.status || item.status === query.status)
    .filter((item) => !query.channelId || item.channelAvailability.length === 0 || item.channelAvailability.includes(query.channelId));
}

export function getProductOffering(db, id) {
  const offering = db.productOfferings.get(id);
  if (!offering) fail(404, "OFFERING_NOT_FOUND", "ProductOffering was not found.", "id");
  return autoRetireIfSunset(offering);
}

export function updateProductOffering(db, id, body) {
  const offering = getProductOffering(db, id);
  if (body.name) ensureUniqueName(db.productOfferings, body.name, id, "ProductOffering");
  for (const field of ["name", "channelAvailability", "sunsetDate"]) {
    if (body[field] !== undefined) offering[field] = body[field];
  }
  offering.updatedAt = nowIso();
  return autoRetireIfSunset(offering);
}

export function activateProductOffering(db, id) {
  const offering = getProductOffering(db, id);
  if (offering.status !== "draft") fail(409, "INVALID_STATUS_TRANSITION", "Only draft ProductOfferings can be activated.", "status");
  const specification = getProductSpecification(db, offering.productSpecificationId);
  if (specification.status !== "active") fail(409, "SPECIFICATION_NOT_ACTIVE", "ProductOffering requires an active ProductSpecification.", "productSpecificationId");
  if (!offering.prices.some((price) => price.isDefault)) {
    fail(409, "NO_DEFAULT_PRICE", "At least one price must be marked as default before the offering can be activated.", "prices");
  }
  offering.status = "active";
  offering.updatedAt = nowIso();
  return offering;
}

export function retireProductOffering(db, id) {
  const offering = getProductOffering(db, id);
  if (offering.status !== "active") fail(409, "INVALID_STATUS_TRANSITION", "Only active ProductOfferings can be retired.", "status");
  offering.status = "retired";
  offering.updatedAt = nowIso();
  return offering;
}

export function addProductOfferingPrice(db, offeringId, body) {
  const offering = getProductOffering(db, offeringId);
  assertEnum(body.priceType, PRICE_TYPES, "priceType");
  assertRequired(body.amount, "amount");
  assertRequired(body.currency, "currency");
  assertEnum(body.chargingSource, CHARGING_SOURCES, "chargingSource");
  const currency = String(body.currency).toUpperCase();
  const price = {
    id: randomUUID(),
    productOfferingId: offeringId,
    priceType: body.priceType,
    amount: Number(body.amount),
    currency,
    chargingSource: body.chargingSource,
    daId: body.daId,
    priority: body.priority === undefined ? undefined : Number(body.priority),
    parentPriceId: body.parentPriceId,
    discountType: body.discountType,
    discountValue: body.discountValue === undefined ? undefined : Number(body.discountValue),
    eligibilityCondition: body.eligibilityCondition,
    isDefault: Boolean(body.isDefault)
  };
  if (price.priceType === "discount") {
    assertRequired(price.parentPriceId, "parentPriceId");
    assertEnum(price.discountType, DISCOUNT_TYPES, "discountType");
    assertRequired(price.discountValue, "discountValue");
    const parent = offering.prices.find((candidate) => candidate.id === price.parentPriceId);
    if (!parent || parent.currency !== price.currency) fail(422, "INVALID_PARENT_PRICE", "Discount parent price must exist on the same offering and currency.", "parentPriceId");
    if (price.discountType === "percentage" && !(price.discountValue > 0 && price.discountValue < 100)) {
      fail(422, "INVALID_PERCENTAGE_DISCOUNT", "Percentage discount must be greater than 0 and less than 100.", "discountValue");
    }
  }
  if (price.isDefault) {
    for (const existing of offering.prices) {
      if (existing.currency === currency) existing.isDefault = false;
    }
  }
  offering.prices.push(price);
  offering.updatedAt = nowIso();
  return price;
}

export function deleteProductOfferingPrice(db, offeringId, priceId) {
  const offering = getProductOffering(db, offeringId);
  const price = offering.prices.find((candidate) => candidate.id === priceId);
  if (!price) fail(404, "PRICE_NOT_FOUND", "ProductOfferingPrice was not found.", "priceId");
  const defaultsForCurrency = offering.prices.filter((candidate) => candidate.currency === price.currency && candidate.isDefault);
  if (price.isDefault && defaultsForCurrency.length === 1) {
    fail(409, "SOLE_DEFAULT_PRICE", "Cannot delete the sole default price for a currency.", "priceId");
  }
  offering.prices = offering.prices.filter((candidate) => candidate.id !== priceId && candidate.parentPriceId !== priceId);
  offering.updatedAt = nowIso();
}

export function addEligibilityRule(db, offeringId, body) {
  const offering = getProductOffering(db, offeringId);
  const rule = normalizeEligibilityRule(body);
  offering.eligibilityRules.push(rule);
  offering.updatedAt = nowIso();
  return rule;
}

export function deleteEligibilityRule(db, offeringId, ruleId) {
  const offering = getProductOffering(db, offeringId);
  if (!offering.eligibilityRules.some((rule) => rule.id === ruleId)) fail(404, "RULE_NOT_FOUND", "EligibilityRule was not found.", "ruleId");
  offering.eligibilityRules = offering.eligibilityRules.filter((rule) => rule.id !== ruleId);
  offering.updatedAt = nowIso();
}

function ensureCartUsable(cart, allowClosed = false) {
  if (new Date(cart.expiresAt).getTime() <= Date.now()) fail(410, "CART_EXPIRED", "ShoppingCart has expired.", "cartId");
  if (!allowClosed && ["checkedOut", "abandoned"].includes(cart.status)) fail(409, "CART_CLOSED", "ShoppingCart is closed.", "status");
}

export function createShoppingCart(db, body, config = configFromEnv()) {
  assertRequired(body.channelId, "channelId");
  assertRequired(body.subscriberId, "subscriberId");
  assertRequired(body.currency, "currency");
  const currency = String(body.currency).toUpperCase();
  if (!config.supportedCurrencies.includes(currency)) fail(422, "UNSUPPORTED_CURRENCY", "Cart currency is not supported.", "currency");
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + config.cartTtlMinutes * 60 * 1000).toISOString();
  const cart = {
    id: randomUUID(),
    channelId: body.channelId,
    subscriberId: body.subscriberId,
    currency,
    status: "active",
    items: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt
  };
  db.shoppingCarts.set(cart.id, cart);
  return cart;
}

export function getShoppingCart(db, cartId, allowClosed = true) {
  const cart = db.shoppingCarts.get(cartId);
  if (!cart) fail(404, "CART_NOT_FOUND", "ShoppingCart was not found.", "cartId");
  ensureCartUsable(cart, allowClosed);
  return cart;
}

function validateOfferingForCart(db, cart, productOfferingId, purchasePolicy, beneficiaryId) {
  const offering = getProductOffering(db, productOfferingId);
  if (offering.status !== "active") fail(422, "OFFERING_NOT_ACTIVE", "ProductOffering is not active.", "productOfferingId");
  if (offering.channelAvailability.length > 0 && !offering.channelAvailability.includes(cart.channelId)) {
    fail(422, "CHANNEL_NOT_ALLOWED", "ProductOffering is not available for this channel.", "channelId");
  }
  if (purchasePolicy === "gift") {
    if (!beneficiaryId) fail(422, "BENEFICIARY_REQUIRED", "beneficiaryId is required for gift purchases.", "beneficiaryId");
    if (beneficiaryId === cart.subscriberId) fail(422, "INVALID_BENEFICIARY", "beneficiaryId must differ from subscriberId for gift purchases.", "beneficiaryId");
  }
  return offering;
}

export function addCartItem(db, cartId, body) {
  const cart = getShoppingCart(db, cartId, false);
  assertRequired(body.productOfferingId, "productOfferingId");
  const purchasePolicy = body.purchasePolicy || "one-off";
  assertEnum(purchasePolicy, POLICIES, "purchasePolicy");
  validateOfferingForCart(db, cart, body.productOfferingId, purchasePolicy, body.beneficiaryId);
  const item = {
    id: randomUUID(),
    cartId,
    productOfferingId: body.productOfferingId,
    quantity: Number(body.quantity || 1),
    purchasePolicy,
    beneficiaryId: body.beneficiaryId,
    pricedAmount: null,
    pricedCurrency: null,
    validationStatus: "pending",
    validationReasonCode: null
  };
  cart.items.push(item);
  cart.status = "active";
  cart.updatedAt = nowIso();
  return item;
}

export function removeCartItem(db, cartId, itemId) {
  const cart = getShoppingCart(db, cartId, false);
  if (!cart.items.some((item) => item.id === itemId)) fail(404, "CART_ITEM_NOT_FOUND", "CartItem was not found.", "itemId");
  cart.items = cart.items.filter((item) => item.id !== itemId);
  cart.updatedAt = nowIso();
}

function ruleMatches(rule, attributes, cart) {
  const actual = rule.ruleType === "channel" ? cart.channelId : attributes[rule.ruleType];
  const expected = rule.value.split(",").map((value) => value.trim());
  if (rule.operator === "equals") return String(actual) === rule.value;
  if (rule.operator === "notEquals") return String(actual) !== rule.value;
  if (rule.operator === "in") return expected.includes(String(actual));
  if (rule.operator === "notIn") return !expected.includes(String(actual));
  return false;
}

function conditionMatches(condition, attributes) {
  if (!condition) return true;
  const match = condition.match(/^\s*([A-Za-z0-9_]+)\s*(==|!=)\s*['"]?([^'"]+)['"]?\s*$/);
  if (!match) return false;
  const [, field, operator, expected] = match;
  const actual = String(attributes[field] ?? "");
  return operator === "==" ? actual === expected : actual !== expected;
}

function characteristicValue(specification, name) {
  return specification?.characteristics.find((item) => item.name === name);
}

function inventoryExpiryForOffering(db, offeringId) {
  const offering = db.productOfferings.get(offeringId);
  const specification = offering ? db.productSpecifications.get(offering.productSpecificationId) : undefined;
  const validity = characteristicValue(specification, "validityPeriod");
  if (!validity || validity.unit !== "days") return undefined;
  const expiresAt = new Date(Date.now() + Number(validity.value) * 24 * 60 * 60 * 1000);
  return expiresAt.toISOString();
}

export function selectPrice(offering, currency, attributes = {}) {
  const prices = offering.prices.filter((price) => price.currency === currency);
  if (prices.length === 0) return null;
  const discounts = prices
    .filter((price) => price.priceType === "discount" && conditionMatches(price.eligibilityCondition, attributes))
    .sort((a, b) => (a.priority ?? 9999) - (b.priority ?? 9999));
  if (discounts[0]) {
    const parent = prices.find((price) => price.id === discounts[0].parentPriceId);
    if (!parent) return null;
    const pricedAmount = discounts[0].discountType === "percentage"
      ? parent.amount * (1 - discounts[0].discountValue / 100)
      : Math.max(0, parent.amount - discounts[0].discountValue);
    return { ...discounts[0], amount: Number(pricedAmount.toFixed(2)), appliedParentPriceId: parent.id };
  }
  return prices
    .filter((price) => price.priceType === "standard")
    .sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      if (a.chargingSource === "DA" && b.chargingSource === "DA") return (a.priority ?? 9999) - (b.priority ?? 9999);
      return 0;
    })[0] || null;
}

export function validateShoppingCart(db, cartId, body = {}) {
  const cart = getShoppingCart(db, cartId, false);
  const attributes = body.subscriberAttributes || {};
  const errors = [];
  for (const item of cart.items) {
    item.validationStatus = "valid";
    item.validationReasonCode = null;
    item.pricedAmount = null;
    item.pricedCurrency = null;
    try {
      const offering = validateOfferingForCart(db, cart, item.productOfferingId, item.purchasePolicy, item.beneficiaryId);
      const failedRule = offering.eligibilityRules.find((rule) => !ruleMatches(rule, attributes, cart));
      if (failedRule) fail(422, failedRule.failureReasonCode, "Subscriber is not eligible for this ProductOffering.", "eligibilityRules");
      const price = selectPrice(offering, cart.currency, attributes);
      if (!price) fail(422, "NO_PRICE_FOR_CURRENCY", "No ProductOfferingPrice exists for the cart currency.", "currency");
      item.pricedAmount = Number((price.amount * item.quantity).toFixed(2));
      item.pricedCurrency = cart.currency;
    } catch (error) {
      item.validationStatus = "invalid";
      item.validationReasonCode = error.reasonCode || "VALIDATION_FAILED";
      errors.push({ cartItemId: item.id, productOfferingId: item.productOfferingId, reasonCode: item.validationReasonCode, message: error.message });
    }
  }
  cart.status = errors.length === 0 ? "validated" : "active";
  cart.updatedAt = nowIso();
  return { cart, errors };
}

export function checkoutShoppingCart(db, cartId) {
  const cart = getShoppingCart(db, cartId, false);
  if (cart.status !== "validated") fail(409, "CART_NOT_VALIDATED", "ShoppingCart must be validated before checkout.", "status");
  if (cart.items.length === 0) fail(409, "EMPTY_CART", "ShoppingCart must contain at least one item before checkout.", "items");
  const invalidItem = cart.items.find((item) => item.validationStatus !== "valid");
  if (invalidItem) fail(409, "CART_HAS_INVALID_ITEMS", "ShoppingCart has invalid items and cannot be checked out.", "items");
  const duplicateOrder = [...db.productOrders.values()].find((candidate) => candidate.cartId === cartId && candidate.status !== "cancelled");
  if (duplicateOrder) fail(409, "ORDER_ALREADY_EXISTS", "A ProductOrder already exists for this ShoppingCart.", "cartId");
  const timestamp = nowIso();
  const order = {
    id: randomUUID(),
    cartId,
    subscriberId: cart.subscriberId,
    channelId: cart.channelId,
    currency: cart.currency,
    orderType: "provision",
    status: "acknowledged",
    failureReasonCode: null,
    failureMessage: null,
    validationStatus: "pending",
    validationReasonCode: null,
    totalAmount: Number(cart.items.reduce((sum, item) => sum + Number(item.pricedAmount || 0), 0).toFixed(2)),
    items: cart.items.map((item) => ({
      id: randomUUID(),
      orderId: undefined,
      cartItemId: item.id,
      productOfferingId: item.productOfferingId,
      quantity: item.quantity,
      purchasePolicy: item.purchasePolicy,
      beneficiaryId: item.beneficiaryId,
      pricedAmount: item.pricedAmount,
      pricedCurrency: item.pricedCurrency,
      amount: item.pricedAmount,
      currency: item.pricedCurrency,
      status: "acknowledged",
      fulfillmentStatus: "pending",
      failureReasonCode: null
    })),
    stateHistory: [{ id: randomUUID(), eventType: "OrderStateChangeEvent", status: "acknowledged", changedAt: timestamp, reason: "Created from validated ShoppingCart" }],
    fulfillment: {
      chargingStatus: "pending",
      provisioningStatus: "pending",
      failureReasonCode: null
    },
    fulfillmentSteps: [],
    validatedAt: null,
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  for (const item of order.items) item.orderId = order.id;
  db.productOrders.set(order.id, order);
  cart.status = "checkedOut";
  cart.updatedAt = timestamp;
  return order;
}

export function captureProductOrderFromCart(db, body = {}) {
  assertRequired(body.cartId, "cartId");
  return checkoutShoppingCart(db, body.cartId);
}

export function abandonShoppingCart(db, cartId) {
  const cart = getShoppingCart(db, cartId, false);
  cart.status = "abandoned";
  cart.updatedAt = nowIso();
  return cart;
}

export function listProductOrders(db, query = {}) {
  return [...db.productOrders.values()]
    .filter((order) => !query.status || order.status === query.status)
    .filter((order) => !query.subscriberId || order.subscriberId === query.subscriberId)
    .filter((order) => !query.cartId || order.cartId === query.cartId);
}

export function getProductOrder(db, orderId) {
  const order = db.productOrders.get(orderId);
  if (!order) fail(404, "ORDER_NOT_FOUND", "ProductOrder was not found.", "orderId");
  return order;
}

function transitionProductOrder(order, nextStatus, reason) {
  assertEnum(nextStatus, ORDER_STATUSES, "status");
  const allowed = {
    acknowledged: ["inProgress", "cancelled"],
    inProgress: ["completed", "failed", "cancelled"],
    completed: [],
    failed: [],
    cancelled: []
  };
  if (!allowed[order.status].includes(nextStatus)) {
    fail(409, "INVALID_ORDER_STATE_TRANSITION", `Cannot transition ProductOrder from ${order.status} to ${nextStatus}.`, "status");
  }
  const timestamp = nowIso();
  order.status = nextStatus;
  order.updatedAt = timestamp;
  order.stateHistory.push({ id: randomUUID(), eventType: "OrderStateChangeEvent", status: nextStatus, changedAt: timestamp, reason });
  return order;
}

export function updateProductOrderState(db, orderId, body = {}) {
  assertRequired(body.status, "status");
  const order = getProductOrder(db, orderId);
  return transitionProductOrder(order, body.status, body.reason || "Manual state transition");
}

function recordOrderValidationResult(db, order, result) {
  const validation = {
    id: db.orderValidationResults.get(order.id)?.id || randomUUID(),
    orderId: order.id,
    channelValid: result.channelValid,
    subscriberEligible: result.subscriberEligible,
    offeringAvailable: result.offeringAvailable,
    balanceSufficient: result.balanceSufficient,
    overallValid: result.overallValid,
    failureReasonCodes: result.failureReasonCodes,
    validatedAt: nowIso()
  };
  db.orderValidationResults.set(order.id, validation);
  order.validationResult = validation;
  return validation;
}

export function validateProductOrder(db, orderId, body = {}) {
  const order = getProductOrder(db, orderId);
  if (order.status !== "acknowledged") {
    fail(409, "ORDER_NOT_VALIDATABLE", "Only acknowledged ProductOrders can be validated.", "status");
  }
  const failureReasonCodes = [];
  const cart = db.shoppingCarts.get(order.cartId);
  if (!cart || cart.status !== "checkedOut") {
    failureReasonCodes.push("SOURCE_CART_NOT_CHECKED_OUT");
  }
  if (order.items.length === 0) {
    failureReasonCodes.push("ORDER_HAS_NO_ITEMS");
  }
  const unpricedItem = order.items.find((item) => item.pricedAmount === null || item.pricedCurrency !== order.currency);
  if (unpricedItem) {
    failureReasonCodes.push("ORDER_ITEM_NOT_PRICED");
  }
  const inactiveOfferingItem = order.items.find((item) => {
    const offering = db.productOfferings.get(item.productOfferingId);
    return !offering || autoRetireIfSunset(offering).status !== "active";
  });
  if (inactiveOfferingItem) {
    failureReasonCodes.push("ORDER_OFFERING_NOT_ACTIVE");
  }
  const subscriberEligible = body.subscriberEligible !== false;
  if (!subscriberEligible) failureReasonCodes.push("SUBSCRIBER_NOT_ELIGIBLE");
  const balanceSufficient = body.balanceSufficient !== false;
  if (!balanceSufficient) failureReasonCodes.push("INSUFFICIENT_BALANCE");
  const channelValid = !order.items.some((item) => {
    const offering = db.productOfferings.get(item.productOfferingId);
    return offering?.channelAvailability?.length > 0 && !offering.channelAvailability.includes(order.channelId);
  });
  if (!channelValid) failureReasonCodes.push("CHANNEL_NOT_ALLOWED");

  const validation = recordOrderValidationResult(db, order, {
    channelValid,
    subscriberEligible,
    offeringAvailable: !inactiveOfferingItem,
    balanceSufficient,
    overallValid: failureReasonCodes.length === 0,
    failureReasonCodes
  });
  if (!validation.overallValid) {
    order.validationStatus = "invalid";
    order.validationReasonCode = failureReasonCodes[0];
    order.updatedAt = validation.validatedAt;
    fail(422, failureReasonCodes[0], "ProductOrder validation failed.", "validationResult");
  }
  order.validationStatus = "valid";
  order.validationReasonCode = null;
  order.validatedAt = validation.validatedAt;
  for (const item of order.items) item.status = "inProgress";
  transitionProductOrder(order, "inProgress", "Order validation passed");
  return order;
}

function fulfillmentStep(order, stepName, status, requestPayload, responsePayload, failureReason = null) {
  assertEnum(stepName, FULFILLMENT_STEPS, "stepName");
  const step = {
    id: randomUUID(),
    orderId: order.id,
    stepName,
    status,
    requestPayload,
    responsePayload,
    executedAt: nowIso(),
    failureReason
  };
  order.fulfillmentSteps.push(step);
  return step;
}

export function executeProductOrderFulfillment(db, orderId, body = {}) {
  const order = getProductOrder(db, orderId);
  if (order.status !== "inProgress") fail(409, "ORDER_NOT_FULFILLABLE", "Only in-progress ProductOrders can be fulfilled.", "status");
  if (order.validationStatus !== "valid" || !order.validatedAt) fail(409, "ORDER_NOT_VALIDATED", "ProductOrder must be validated before fulfillment.", "status");

  const failedStep = body.failedStep;
  const debitStatus = body.chargingResult === "failed" || failedStep === "debit" ? "failed" : "success";
  fulfillmentStep(order, "debit", debitStatus, { orderId: order.id, amount: order.totalAmount, currency: order.currency }, { result: debitStatus }, debitStatus === "failed" ? body.failureReasonCode || "CHARGING_FAILED" : null);
  if (debitStatus !== "success") {
    order.fulfillment.chargingStatus = "failed";
    order.fulfillment.provisioningStatus = "pending";
    order.fulfillment.failureReasonCode = body.failureReasonCode || "CHARGING_FAILED";
    order.failureReasonCode = order.fulfillment.failureReasonCode;
    order.failureMessage = "Debit fulfillment step failed.";
    order.completedAt = nowIso();
    for (const item of order.items) {
      item.status = "failed";
      item.failureReasonCode = order.failureReasonCode;
      item.fulfillmentStatus = "failed";
    }
    return transitionProductOrder(order, "failed", order.failureReasonCode);
  }
  order.fulfillment.chargingStatus = "completed";

  const attachStatus = body.attachOfferResult === "failed" || failedStep === "attachOffer" ? "failed" : "success";
  fulfillmentStep(order, "attachOffer", attachStatus, { orderId: order.id, items: order.items.map((item) => item.productOfferingId) }, { result: attachStatus }, attachStatus === "failed" ? body.failureReasonCode || "ATTACH_OFFER_FAILED" : null);
  if (attachStatus !== "success") {
    order.fulfillment.provisioningStatus = "failed";
    order.fulfillment.failureReasonCode = body.failureReasonCode || "ATTACH_OFFER_FAILED";
    order.failureReasonCode = order.fulfillment.failureReasonCode;
    order.failureMessage = "Attach offer fulfillment step failed.";
    order.completedAt = nowIso();
    for (const item of order.items) {
      item.status = "failed";
      item.failureReasonCode = order.failureReasonCode;
      item.fulfillmentStatus = "failed";
    }
    return transitionProductOrder(order, "failed", order.failureReasonCode);
  }

  const neaStatus = body.provisioningResult === "failed" || failedStep === "neaActivation" ? "failed" : "success";
  fulfillmentStep(order, "neaActivation", neaStatus, { orderId: order.id, subscriberId: order.subscriberId }, { result: neaStatus }, neaStatus === "failed" ? body.failureReasonCode || "NEA_ACTIVATION_FAILED" : null);
  if (neaStatus !== "success") {
    order.fulfillment.provisioningStatus = "failed";
    order.fulfillment.failureReasonCode = body.failureReasonCode || "NEA_ACTIVATION_FAILED";
    order.failureReasonCode = order.fulfillment.failureReasonCode;
    order.failureMessage = "NEA activation fulfillment step failed.";
    order.completedAt = nowIso();
    for (const item of order.items) {
      item.status = "failed";
      item.failureReasonCode = order.failureReasonCode;
      item.fulfillmentStatus = "failed";
    }
    return transitionProductOrder(order, "failed", order.failureReasonCode);
  }

  order.fulfillment.provisioningStatus = "completed";
  order.fulfillment.failureReasonCode = null;
  order.failureReasonCode = null;
  order.failureMessage = null;
  for (const item of order.items) {
    item.status = "completed";
    item.fulfillmentStatus = "completed";
  }
  order.completedAt = nowIso();
  const completed = transitionProductOrder(order, "completed", "Charging and provisioning completed");
  createProductInventoryRecordsForOrder(db, completed);
  return completed;
}

export function cancelProductOrder(db, orderId, body = {}) {
  const order = getProductOrder(db, orderId);
  if (order.status !== "acknowledged") {
    fail(409, "ORDER_CANNOT_BE_CANCELLED", "Sprint 2 only supports cancellation before validation.", "status");
  }
  for (const item of order.items) {
    item.status = "cancelled";
    item.fulfillmentStatus = item.fulfillmentStatus === "completed" ? "completed" : "cancelled";
  }
  order.failureReasonCode = body.reasonCode || "ORDER_CANCELLED";
  order.failureMessage = body.reason || "Order cancelled";
  order.completedAt = nowIso();
  return transitionProductOrder(order, "cancelled", body.reason || "Order cancelled");
}

export function compensateProductOrder(db, orderId, body = {}) {
  const order = getProductOrder(db, orderId);
  if (order.status !== "failed") fail(409, "ORDER_NOT_COMPENSATABLE", "Only failed ProductOrders can be compensated.", "status");
  const timestamp = nowIso();
  const compensation = {
    id: randomUUID(),
    action: body.action || "creditBack",
    status: "completed",
    reasonCode: body.reasonCode || order.fulfillment.failureReasonCode || "ORDER_FAILED",
    createdAt: timestamp
  };
  order.compensation = compensation;
  order.updatedAt = timestamp;
  order.stateHistory.push({ id: randomUUID(), eventType: "OrderStateChangeEvent", status: order.status, changedAt: timestamp, reason: `Compensation completed: ${compensation.action}` });
  return order;
}

export function retryProductOrderFulfillment(db, orderId, body = {}) {
  const order = getProductOrder(db, orderId);
  if (order.status !== "failed") fail(409, "ORDER_NOT_RETRYABLE", "Only failed ProductOrders can be retried.", "status");
  const timestamp = nowIso();
  order.status = "inProgress";
  order.validationStatus = "pending";
  order.validationReasonCode = null;
  order.validatedAt = null;
  order.completedAt = null;
  order.failureReasonCode = null;
  order.failureMessage = null;
  order.fulfillment = {
    chargingStatus: "pending",
    provisioningStatus: "pending",
    failureReasonCode: null
  };
  for (const item of order.items) {
    item.status = "acknowledged";
    item.fulfillmentStatus = "pending";
    item.failureReasonCode = null;
  }
  order.updatedAt = timestamp;
  order.stateHistory.push({ id: randomUUID(), eventType: "OrderStateChangeEvent", status: "inProgress", changedAt: timestamp, reason: body.reason || "Retry fulfillment" });
  return order;
}

function createProductInventoryRecordsForOrder(db, order) {
  for (const item of order.items) {
    const exists = [...db.productInventories.values()].some((inventory) => inventory.orderItemId === item.id);
    if (exists) continue;
    const timestamp = nowIso();
    const inventory = {
      id: randomUUID(),
      productOrderId: order.id,
      orderItemId: item.id,
      subscriberId: item.beneficiaryId || order.subscriberId,
      sponsorId: item.beneficiaryId ? order.subscriberId : undefined,
      channelId: order.channelId,
      productOfferingId: item.productOfferingId,
      quantity: item.quantity,
      status: "active",
      activatedAt: timestamp,
      expiresAt: inventoryExpiryForOffering(db, item.productOfferingId),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    db.productInventories.set(inventory.id, inventory);
  }
}

export function listProductInventory(db, query = {}) {
  return [...db.productInventories.values()]
    .filter((item) => !query.subscriberId || item.subscriberId === query.subscriberId)
    .filter((item) => !query.status || item.status === query.status)
    .filter((item) => !query.productOfferingId || item.productOfferingId === query.productOfferingId);
}

export function getProductInventory(db, inventoryId) {
  const inventory = db.productInventories.get(inventoryId);
  if (!inventory) fail(404, "INVENTORY_NOT_FOUND", "ProductInventory record was not found.", "inventoryId");
  return inventory;
}

export function createChannel(db, body = {}) {
  assertRequired(body.name, "name");
  assertRequired(body.type, "type");
  assertEnum(body.type, CHANNEL_TYPES, "type");
  const duplicate = [...db.channels.values()].find((channel) => channel.name === body.name);
  if (duplicate) fail(409, "DUPLICATE_CHANNEL", "Channel name must be unique.", "name");
  const timestamp = nowIso();
  const channel = {
    id: randomUUID(),
    name: body.name,
    type: body.type,
    status: body.status || "active",
    externalId: body.externalId,
    callbackUrl: body.callbackUrl,
    metadata: body.metadata || {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
  assertEnum(channel.status, CHANNEL_STATUSES, "status");
  db.channels.set(channel.id, channel);
  return channel;
}

export function listChannels(db, query = {}) {
  return [...db.channels.values()]
    .filter((channel) => !query.type || channel.type === query.type)
    .filter((channel) => !query.status || channel.status === query.status);
}

export function getChannel(db, channelId) {
  const channel = db.channels.get(channelId) || [...db.channels.values()].find((item) => item.name === channelId);
  if (!channel) fail(404, "CHANNEL_NOT_FOUND", "Channel was not found.", "channelId");
  return channel;
}

export function updateChannel(db, channelId, body = {}) {
  const channel = getChannel(db, channelId);
  for (const field of ["name", "externalId", "callbackUrl", "metadata"]) {
    if (body[field] !== undefined) channel[field] = body[field];
  }
  if (body.type !== undefined) {
    assertEnum(body.type, CHANNEL_TYPES, "type");
    channel.type = body.type;
  }
  if (body.status !== undefined) {
    assertEnum(body.status, CHANNEL_STATUSES, "status");
    channel.status = body.status;
  }
  channel.updatedAt = nowIso();
  return channel;
}

function ensureChannelReady(db, channelId, expectedType = undefined) {
  const channel = getChannel(db, channelId);
  if (channel.status !== "active") fail(409, "CHANNEL_INACTIVE", "Channel is inactive.", "channelId");
  if (expectedType && channel.type !== expectedType) fail(422, "CHANNEL_TYPE_MISMATCH", `Channel must be type ${expectedType}.`, "channelId");
  return channel;
}

export function captureChannelSubscriptionRequest(db, channelId, body = {}, options = {}) {
  const channel = ensureChannelReady(db, channelId, options.expectedType);
  assertRequired(body.subscriberId, "subscriberId");
  assertRequired(body.productOfferingId, "productOfferingId");
  assertRequired(body.currency, "currency");
  const timestamp = nowIso();
  const interaction = {
    id: randomUUID(),
    channelId: channel.id,
    channelType: channel.type,
    requestType: options.requestType || "subscription",
    subscriberId: body.subscriberId,
    productOfferingId: body.productOfferingId,
    status: "accepted",
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: body.metadata || {}
  };
  try {
    const cart = createShoppingCart(db, {
      channelId: channel.name,
      subscriberId: body.subscriberId,
      currency: body.currency
    });
    const item = addCartItem(db, cart.id, {
      productOfferingId: body.productOfferingId,
      quantity: body.quantity || 1,
      purchasePolicy: body.purchasePolicy || "one-off",
      beneficiaryId: body.beneficiaryId
    });
    const validation = validateShoppingCart(db, cart.id, { subscriberAttributes: body.subscriberAttributes || {} });
    interaction.cartId = cart.id;
    interaction.cartItemId = item.id;
    if (validation.errors.length > 0) {
      interaction.status = "validationFailed";
      interaction.reasonCode = validation.errors[0].reasonCode;
    } else if (body.autoCheckout !== false) {
      const order = checkoutShoppingCart(db, cart.id);
      interaction.orderId = order.id;
      interaction.status = "orderCreated";
    } else {
      interaction.status = "cartValidated";
    }
  } catch (error) {
    interaction.status = "failed";
    interaction.reasonCode = error.reasonCode || "CHANNEL_REQUEST_FAILED";
    db.channelInteractions.set(interaction.id, interaction);
    throw error;
  }
  interaction.updatedAt = nowIso();
  db.channelInteractions.set(interaction.id, interaction);
  return interaction;
}

export function listChannelInteractions(db, query = {}) {
  return [...db.channelInteractions.values()]
    .filter((item) => !query.channelId || item.channelId === query.channelId)
    .filter((item) => !query.subscriberId || item.subscriberId === query.subscriberId)
    .filter((item) => !query.status || item.status === query.status);
}
