import { randomUUID } from "node:crypto";
import { fail } from "./errors.js";

const SPEC_STATUSES = ["draft", "active", "retired"];
const OFFERING_STATUSES = ["draft", "active", "retired"];
const VALUE_TYPES = ["number", "string", "boolean"];
const PRICE_TYPES = ["standard", "discount"];
const CHARGING_SOURCES = ["MA", "DA", "LOYALTY", "MOBILE_MONEY"];
const DISCOUNT_TYPES = ["fixed", "percentage"];
const RULE_TYPES = ["serviceClass", "segment", "multiPurchase", "renewal", "channel", "psoFlag", "customerSegment"]; // Sprint 6: named CustomerSegment support
const OPERATORS = ["equals", "notEquals", "in", "notIn"];
const POLICIES = ["one-off", "auto-renewal", "gift", "SELF_ONE_OFF", "SELF_AUTO_RENEWAL", "GIFT"];
const ORDER_STATUSES = ["acknowledged", "inProgress", "completed", "failed", "cancelled"];
const FULFILLMENT_STEPS = ["debit", "attachOffer", "csAttributeUpdate", "neaActivation", "removeOffer", "neaDeactivation"];
const CHANNEL_TYPES = ["USSD", "SMS", "WEB", "CRM", "MOBILE_APP", "THIRD_PARTY", "SELF_CARE", "API_PARTNER", "WEB_PORTAL", "IVR", "VOUCHER"]; // Sprint 4: added API_PARTNER
const CHANNEL_STATUSES = ["active", "inactive"];
const COMPENSATION_TYPES = ["none", "creditBack", "retry"];
const REQUIRED_CHARACTERISTICS = {
  dataVolume: { valueType: "number", units: ["GB", "MB"] },
  validityPeriod: { valueType: "number", units: ["days"] },
  bundleType: { valueType: "string", values: ["daily", "weekly", "monthly", "one-off"] },
  neaActivationRequired: { valueType: "boolean" }
};

export function configFromEnv(env = process.env) {
  return {
    cartTtlMinutes: Number(env.CART_TTL_MINUTES || 30),
    supportedCurrencies: (env.SUPPORTED_CURRENCIES || "USD,INR,NGN,JPY").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean),
    enableAuthEnforcement: env.ENABLE_AUTH_ENFORCEMENT === "true",
    jwtSecret: env.JWT_SECRET || "change-me-in-production",
    jwtTtlSeconds: Number(env.JWT_TTL_SECONDS || 3600),
    authTokenRateLimit: Number(env.AUTH_TOKEN_RATE_LIMIT || 10)
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

function normalizePurchasePolicyValue(policy = "one-off") {
  if (typeof policy === "object" && policy !== null) {
    return normalizePurchasePolicyValue(policy.type);
  }
  return {
    SELF_ONE_OFF: "one-off",
    SELF_AUTO_RENEWAL: "auto-renewal",
    GIFT: "gift"
  }[policy] || policy;
}

function activeCurrencyConfig(db, currency) {
  return db.currencyConfigs?.get(String(currency).toUpperCase());
}

function defaultCurrencyCode(db) {
  return [...(db.currencyConfigs || new Map()).values()].find((item) => item.status === "active" && item.isDefault)?.currencyCode || null;
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

function normalizeCsAttributeUpdates(updates = []) {
  if (!Array.isArray(updates)) fail(400, "INVALID_CS_ATTRIBUTE_UPDATES", "csAttributeUpdates must be an array.", "csAttributeUpdates");
  return updates.map((update) => {
    const attribute = update.attribute || update.attributeName;
    const characteristicName = update.characteristicName || update.offeringCharacteristicName;
    assertRequired(attribute, "csAttributeUpdates.attribute");
    assertEnum(update.valueSource, ["fixed", "offeringCharacteristic", "calculatedFromExpiry"], "csAttributeUpdates.valueSource");
    if (update.valueSource === "fixed") assertRequired(update.fixedValue, "csAttributeUpdates.fixedValue");
    if (update.valueSource === "offeringCharacteristic") assertRequired(characteristicName, "csAttributeUpdates.characteristicName");
    return {
      id: update.id || randomUUID(),
      attribute,
      attributeName: attribute,
      valueSource: update.valueSource,
      fixedValue: update.fixedValue,
      characteristicName: characteristicName || null,
      offeringCharacteristicName: characteristicName || null,
      offsetDays: update.offsetDays === undefined ? null : Number(update.offsetDays)
    };
  });
}

function normalizeCompensationPolicy(policy = {}) {
  return {
    creditBackEnabled: policy.creditBackEnabled ?? true,
    retryEnabled: policy.retryEnabled ?? false,
    retryCount: Number(policy.retryCount ?? 3),
    retryIntervalSeconds: Number(policy.retryIntervalSeconds ?? 60),
    retryAsync: policy.retryAsync ?? true
  };
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
    csAttributeUpdates: normalizeCsAttributeUpdates(body.csAttributeUpdates || []),
    bundleCategory: body.bundleCategory || null,
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
  for (const field of ["name", "description", "bundleCategory"]) {
    if (body[field] !== undefined) specification[field] = body[field];
  }
  if (body.csAttributeUpdates !== undefined) {
    specification.csAttributeUpdates = normalizeCsAttributeUpdates(body.csAttributeUpdates);
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
    failureReasonCode: rule.failureReasonCode,
    renewalExemptMultiPurchase: Boolean(rule.renewalExemptMultiPurchase)
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
    cancellationWindowHours: body.cancellationWindowHours === undefined ? null : Number(body.cancellationWindowHours),
    compensationPolicy: normalizeCompensationPolicy(body.compensationPolicy),
    giftingEnabled: Boolean(body.giftingEnabled),
    maxGiftBeneficiaries: body.maxGiftBeneficiaries === undefined ? null : Number(body.maxGiftBeneficiaries),
    maxSecondaryNumbers: body.maxSecondaryNumbers === undefined ? null : Number(body.maxSecondaryNumbers),
    csAttributeUpdates: normalizeCsAttributeUpdates(body.csAttributeUpdates || []),
    bundleCategory: body.bundleCategory || specification.bundleCategory || null,
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
  const channel = query.channelId ? [...db.channels.values()].find((item) => item.id === query.channelId || item.channelId === query.channelId || item.name === query.channelId) : null;
  const allowedOfferingIds = channel?.allowedOfferingIds || [];
  return [...db.productOfferings.values()]
    .map(autoRetireIfSunset)
    .filter((item) => !query.status || item.status === query.status)
    .filter((item) => !query.channelId || item.channelAvailability.length === 0 || item.channelAvailability.includes(query.channelId))
    .filter((item) => allowedOfferingIds.length === 0 || allowedOfferingIds.includes(item.id));
}

export function getProductOffering(db, id) {
  const offering = db.productOfferings.get(id);
  if (!offering) fail(404, "OFFERING_NOT_FOUND", "ProductOffering was not found.", "id");
  return autoRetireIfSunset(offering);
}

export function updateProductOffering(db, id, body) {
  const offering = getProductOffering(db, id);
  if (body.name) ensureUniqueName(db.productOfferings, body.name, id, "ProductOffering");
  for (const field of ["name", "channelAvailability", "sunsetDate", "cancellationWindowHours", "giftingEnabled", "maxGiftBeneficiaries", "maxSecondaryNumbers", "bundleCategory"]) {
    if (body[field] !== undefined) offering[field] = body[field];
  }
  if (body.compensationPolicy !== undefined) offering.compensationPolicy = normalizeCompensationPolicy(body.compensationPolicy);
  if (body.csAttributeUpdates !== undefined) offering.csAttributeUpdates = normalizeCsAttributeUpdates(body.csAttributeUpdates);
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
  assertRequired(body.currency || body.currencyCode, "currency");
  if (body.chargingSource === undefined && body.defaultChargingSource === undefined) {
    fail(422, "CHARGING_SOURCE_NOT_CONFIGURED", "chargingSource or defaultChargingSource is required.", "chargingSource");
  }
  if (body.chargingSource !== undefined && body.chargingSource !== null) assertEnum(body.chargingSource, CHARGING_SOURCES, "chargingSource");
  if (body.defaultChargingSource !== undefined && body.defaultChargingSource !== null) assertEnum(body.defaultChargingSource, CHARGING_SOURCES, "defaultChargingSource");
  const currency = String(body.currency || body.currencyCode).toUpperCase();
  if (db.currencyConfigs?.size > 0) {
    const currencyConfig = activeCurrencyConfig(db, currency);
    if (!currencyConfig || currencyConfig.status !== "active") fail(422, "CURRENCY_NOT_SUPPORTED", "Price currency is not supported.", "currency");
  }
  const price = {
    id: randomUUID(),
    productOfferingId: offeringId,
    priceType: body.priceType,
    amount: Number(body.amount),
    currency,
    currencyCode: currency,
    chargingSource: body.chargingSource || null,
    daId: body.daId,
    defaultChargingSource: body.defaultChargingSource || null,
    allowPartialCharge: Boolean(body.allowPartialCharge),
    chargingPriority: normalizeChargingPriority(body.chargingPriority || []),
    priceAlteration: normalizePriceAlterations(body.priceAlteration || body.priceAlterations || []),
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

function normalizeChargingPriority(priority = []) {
  if (!Array.isArray(priority)) fail(400, "INVALID_CHARGING_PRIORITY", "chargingPriority must be an array.", "chargingPriority");
  return priority.map((rule, index) => {
    const source = rule.source || rule.chargingSource;
    assertEnum(source, CHARGING_SOURCES, "chargingPriority.source");
    return {
      priority: Number(rule.priority || index + 1),
      source,
      daId: rule.daId || null
    };
  }).sort((a, b) => a.priority - b.priority);
}

function normalizePriceAlterations(alterations = []) {
  if (!Array.isArray(alterations)) fail(400, "INVALID_PRICE_ALTERATION", "priceAlteration must be an array.", "priceAlteration");
  return alterations.map((alteration) => {
    assertEnum(alteration.alterationType, ["DISCOUNT_FIXED", "DISCOUNT_PERCENTAGE"], "priceAlteration.alterationType");
    assertRequired(alteration.alterationValue, "priceAlteration.alterationValue");
    return {
      id: alteration.id || randomUUID(),
      name: alteration.name || "Discount",
      alterationType: alteration.alterationType,
      alterationValue: Number(alteration.alterationValue),
      eligibilityRules: alteration.eligibilityRules || []
    };
  });
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

export function getProductOfferingPrice(db, offeringId, priceId) {
  const offering = getProductOffering(db, offeringId);
  const price = offering.prices.find((candidate) => candidate.id === priceId);
  if (!price) fail(404, "PRICE_NOT_FOUND", "ProductOfferingPrice was not found.", "priceId");
  return price;
}

export function updateProductOfferingPrice(db, offeringId, priceId, body = {}) {
  const offering = getProductOffering(db, offeringId);
  const price = getProductOfferingPrice(db, offeringId, priceId);
  if (body.chargingSource !== undefined && body.chargingSource !== null) assertEnum(body.chargingSource, CHARGING_SOURCES, "chargingSource");
  if (body.defaultChargingSource !== undefined && body.defaultChargingSource !== null) assertEnum(body.defaultChargingSource, CHARGING_SOURCES, "defaultChargingSource");
  for (const field of ["amount", "currency", "chargingSource", "daId", "defaultChargingSource", "allowPartialCharge", "isDefault"]) {
    if (body[field] !== undefined) price[field] = field === "amount" ? Number(body[field]) : body[field];
  }
  if (body.currencyCode !== undefined) {
    price.currency = String(body.currencyCode).toUpperCase();
    price.currencyCode = price.currency;
  }
  if (body.chargingPriority !== undefined) price.chargingPriority = normalizeChargingPriority(body.chargingPriority);
  if (body.priceAlteration !== undefined || body.priceAlterations !== undefined) {
    price.priceAlteration = normalizePriceAlterations(body.priceAlteration || body.priceAlterations || []);
  }
  if (!price.chargingSource && !price.defaultChargingSource) {
    fail(422, "CHARGING_SOURCE_NOT_CONFIGURED", "chargingSource or defaultChargingSource is required.", "chargingSource");
  }
  if (price.isDefault) {
    for (const existing of offering.prices) {
      if (existing.id !== price.id && existing.currency === price.currency) existing.isDefault = false;
    }
  }
  offering.updatedAt = nowIso();
  return price;
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
  if (db.channels?.size > 0) {
    const channel = [...db.channels.values()].find((item) => item.id === body.channelId || item.channelId === body.channelId || item.name === body.channelId);
    if (!channel) fail(422, "UNKNOWN_CHANNEL", "Channel is not registered.", "channelId");
    if (channel.status !== "active") fail(422, "CHANNEL_INACTIVE", "Channel is inactive.", "channelId");
  }
  const requestedCurrency = body.currency || defaultCurrencyCode(db);
  assertRequired(requestedCurrency, "currency");
  const currency = String(requestedCurrency).toUpperCase();
  if (db.currencyConfigs?.size > 0) {
    const currencyConfig = activeCurrencyConfig(db, currency);
    if (!currencyConfig || currencyConfig.status !== "active") fail(422, "CURRENCY_NOT_SUPPORTED", "Cart currency is not supported.", "currency");
  } else if (!config.supportedCurrencies.includes(currency)) {
    fail(422, "UNSUPPORTED_CURRENCY", "Cart currency is not supported.", "currency");
  }
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
  if (normalizePurchasePolicyValue(purchasePolicy) === "gift") {
    if (!beneficiaryId) fail(422, "BENEFICIARY_REQUIRED", "beneficiaryId is required for gift purchases.", "beneficiaryId");
    if (beneficiaryId === cart.subscriberId) fail(422, "SELF_GIFT_NOT_ALLOWED", "beneficiaryId must differ from subscriberId for gift purchases.", "beneficiaryId");
    if (!offering.giftingEnabled) fail(422, "GIFTING_NOT_ALLOWED_FOR_OFFERING", "ProductOffering does not allow gifting.", "giftingEnabled");
  }
  return offering;
}

export function addCartItem(db, cartId, body) {
  const cart = getShoppingCart(db, cartId, false);
  assertRequired(body.productOfferingId, "productOfferingId");
  const policyInput = body.purchasePolicy || "one-off";
  const purchasePolicy = normalizePurchasePolicyValue(policyInput);
  assertEnum(purchasePolicy, POLICIES, "purchasePolicy");
  const beneficiaryId = body.beneficiaryId || (typeof policyInput === "object" ? policyInput.beneficiaryId : undefined);
  validateOfferingForCart(db, cart, body.productOfferingId, purchasePolicy, beneficiaryId);
  const item = {
    id: randomUUID(),
    cartId,
    productOfferingId: body.productOfferingId,
    quantity: Number(body.quantity || 1),
    purchasePolicy,
    beneficiaryId,
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
  cart.status = "active";
  for (const item of cart.items) {
    item.validationStatus = "pending";
    item.validationReasonCode = null;
    item.pricedAmount = null;
    item.pricedCurrency = null;
  }
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

function resolveCustomerSegmentId(db, subscriberAccount = {}) {
  if (!db.customerSegments) return null;
  const activeSegments = [...db.customerSegments.values()]
    .filter((segment) => segment.status === "active")
    .sort((a, b) => Number(a.priority || 9999) - Number(b.priority || 9999));
  for (const segment of activeSegments) {
    const rules = segment.resolutionRules || [];
    const matches = rules.every((rule) => {
      const attributeName = rule.attribute || rule.attributeName;
      const actual = subscriberAccount[attributeName];
      const expected = Array.isArray(rule.value) ? rule.value.map(String) : String(rule.value).split(",").map((item) => item.trim());
      if (rule.operator === "equals") return String(actual) === String(rule.value);
      if (rule.operator === "in") return expected.includes(String(actual));
      if (rule.operator === "notIn") return !expected.includes(String(actual));
      if (rule.operator === "contains") {
        if (Array.isArray(actual)) return actual.some((item) => expected.includes(String(item)));
        return String(actual || "").includes(String(rule.value));
      }
      return false;
    });
    if (matches) return segment.id;
  }
  return null;
}

function applyStaffSegmentOverrideIfEligible(db, subscriberAccount, offeringId) {
  const link = [...(db.staffNumberLinks || new Map()).values()].find((candidate) =>
    candidate.secondaryNumber === subscriberAccount.subscriberId &&
    candidate.offeringId === offeringId &&
    candidate.status === "active"
  );
  if (!link) return;
  const staffSegment = [...(db.customerSegments || new Map()).values()].find((segment) =>
    segment.status === "active" && segment.name === "STAFF"
  );
  if (!staffSegment) return;
  subscriberAccount.resolvedSegmentId = staffSegment.id;
  subscriberAccount.resolvedViaStaffLink = true;
  subscriberAccount.staffLinkId = link.id;
}

function conditionMatches(condition, attributes) {
  if (!condition) return true;

  const CONDITION_REGEX =
    /^\s*([A-Za-z0-9_]+)\s*(==|!=)\s*['"]?([^'"\\\r\n]{1,256})['"]?\s*$/;

  const match = CONDITION_REGEX.exec(condition);

  if (!match) return false;

  const [, field, operator, expected] = match;

  const actual = String(attributes[field] ?? "");

  if (operator === "==") return actual === expected;
  return actual !== expected;
}

function characteristicValue(specification, name) {
  return specification?.characteristics.find((item) => item.name === name);
}

function offeringCharacteristicValue(db, offeringId, name) {
  const offering = db.productOfferings.get(offeringId);
  const specification = offering ? db.productSpecifications.get(offering.productSpecificationId) : undefined;
  return characteristicValue(specification, name);
}

function inventoryExpiryForOffering(db, offeringId) {
  const validity = offeringCharacteristicValue(db, offeringId, "validityPeriod");
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

function alterationRuleMatches(rule, attributes = {}) {
  const value = alterationAttributeValue(rule.attribute, attributes);
  const expected = Array.isArray(rule.value) ? rule.value.map(String) : String(rule.value).split(",").map((item) => item.trim());
  if (rule.operator === "equals") return String(value) === String(rule.value);
  if (rule.operator === "in") return expected.includes(String(value));
  if (rule.operator === "notIn") return !expected.includes(String(value));
  if (rule.operator === "contains") {
    if (Array.isArray(value)) return value.some((item) => expected.includes(String(item)));
    return String(value || "").includes(String(rule.value));
  }
  return false;
}

function alterationAttributeValue(attribute, attributes) {
  if (attribute === "psoFlag") return attributes.psoFlags;
  if (attribute === "offerId") return attributes.offerIds;
  if (attribute === "customerSegment") return attributes.customerSegment || attributes.resolvedSegmentId;
  return attributes[attribute];
}

function calculatePriceAlteration(price, amount, attributes = {}) {
  const eligible = (price.priceAlteration || []).filter((alteration) => {
    const rules = alteration.eligibilityRules || [];
    return rules.every((rule) => alterationRuleMatches(rule, attributes));
  }).map((alteration) => {
    const discount = alteration.alterationType === "DISCOUNT_PERCENTAGE"
      ? amount * (alteration.alterationValue / 100)
      : alteration.alterationValue;
    return {
      alteration,
      discount: Math.min(amount, Math.max(0, Number(discount.toFixed(2))))
    };
  }).sort((a, b) => b.discount - a.discount);
  return eligible[0] || { alteration: null, discount: 0 };
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
      if (!price) {
        const reason = db.currencyConfigs?.size > 0 ? "PRICE_NOT_AVAILABLE_IN_CURRENCY" : "NO_PRICE_FOR_CURRENCY";
        fail(422, reason, "No ProductOfferingPrice exists for the cart currency.", "currency");
      }
      const baseAmount = Number((price.amount * item.quantity).toFixed(2));
      const previewDiscount = calculatePriceAlteration(price, baseAmount, attributes);
      item.originalAmount = baseAmount;
      item.appliedPriceAlterationId = previewDiscount.alteration?.id || null;
      item.discountAmount = previewDiscount.discount;
      item.discountStatus = (price.priceAlteration || []).length > 0 ? "indicative" : null;
      item.pricedAmount = Number(Math.max(0, baseAmount - previewDiscount.discount).toFixed(2));
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
  const compensationConfig = compensationConfigForOrder(db, cart.items);
  const order = {
    id: randomUUID(),
    cartId,
    subscriberId: cart.subscriberId,
    channelId: cart.channelId,
    currency: cart.currency,
    orderType: cart.items.some((item) => item.purchasePolicy === "gift" || item.beneficiaryId) ? "gift" : "provision",
    sponsorId: cart.items.some((item) => item.beneficiaryId) ? cart.subscriberId : null,
    beneficiaryId: cart.items.find((item) => item.beneficiaryId)?.beneficiaryId || null,
    originalOrderId: null,
    cancellationReasonCode: null,
    compensationPolicy: compensationConfig?.compensationType || "none",
    retryCount: 0,
    maxRetries: compensationConfig?.maxRetries ?? null,
    retryIntervalSeconds: compensationConfig?.retryIntervalSeconds ?? null,
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
      originalAmount: item.originalAmount ?? item.pricedAmount,
      appliedPriceAlterationId: item.appliedPriceAlterationId || null,
      discountAmount: item.discountAmount || 0,
      discountStatus: item.discountStatus || null,
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
  if (!order.subscriptionId) {
    const inventory = [...db.productInventories.values()].find((item) => item.productOrderId === order.id || item.orderId === order.id);
    if (inventory) order.subscriptionId = inventory.id;
  }
  return order;
}

function transitionProductOrder(order, nextStatus, reason) {
  assertEnum(nextStatus, ORDER_STATUSES, "status");
  const allowed = {
    acknowledged: ["inProgress", "failed", "cancelled"],
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
  if (["completed", "failed", "cancelled"].includes(nextStatus) && !order.completedAt) {
    order.completedAt = timestamp;
  }
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
    appliedPriceAlterationId: result.appliedPriceAlterationId || null,
    discountAmount: Number(result.discountAmount || 0),
    finalChargeAmount: Number(result.finalChargeAmount || 0),
    validatedAt: nowIso()
  };
  db.orderValidationResults.set(order.id, validation);
  order.validationResult = validation;
  return validation;
}

function compensationConfigForOrder(db, items = []) {
  if (!db.compensationConfigs) db.compensationConfigs = new Map();
  const firstConfiguredItem = items.find((item) => db.compensationConfigs.has(item.productOfferingId));
  return firstConfiguredItem ? db.compensationConfigs.get(firstConfiguredItem.productOfferingId) : null;
}

export function setCompensationConfig(db, offeringId, body = {}) {
  getProductOffering(db, offeringId);
  assertEnum(body.compensationType, COMPENSATION_TYPES, "compensationType");
  if (body.compensationType === "retry") {
    assertRequired(body.maxRetries, "maxRetries");
  }
  const timestamp = nowIso();
  if (!db.compensationConfigs) db.compensationConfigs = new Map();
  const existing = db.compensationConfigs.get(offeringId);
  const config = {
    id: existing?.id || randomUUID(),
    productOfferingId: offeringId,
    compensationType: body.compensationType,
    maxRetries: body.compensationType === "retry" ? Number(body.maxRetries) : null,
    retryIntervalSeconds: body.compensationType === "retry" ? Number(body.retryIntervalSeconds || 0) : null,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };
  db.compensationConfigs.set(offeringId, config);
  return config;
}

export function getCompensationConfig(db, offeringId) {
  getProductOffering(db, offeringId);
  const config = db.compensationConfigs?.get(offeringId);
  if (!config) fail(404, "COMPENSATION_CONFIG_NOT_FOUND", "CompensationConfig was not found.", "productOfferingId");
  return config;
}

function recordCompensation(db, order, compensationType, status, requestPayload = {}, responsePayload = {}, failureReason = null) {
  if (!db.compensationRecords) db.compensationRecords = new Map();
  const attemptNumber = [...db.compensationRecords.values()].filter((item) => item.orderId === order.id && item.compensationType === compensationType).length + 1;
  const record = {
    id: randomUUID(),
    orderId: order.id,
    compensationType,
    attemptNumber,
    status,
    requestPayload,
    responsePayload,
    executedAt: nowIso(),
    failureReason
  };
  db.compensationRecords.set(record.id, record);
  order.compensationRecords = [...(order.compensationRecords || []), record];
  return record;
}

export function listCompensationRecords(db, query = {}) {
  return [...(db.compensationRecords || new Map()).values()]
    .filter((item) => !query.orderId || item.orderId === query.orderId)
    .filter((item) => !query.compensationType || item.compensationType === query.compensationType);
}

function recordNotification(db, eventType, order, payload = {}) {
  if (!db.notificationEvents) db.notificationEvents = new Map();
  const notification = {
    id: randomUUID(),
    eventType,
    orderId: order.id,
    subscriberId: order.subscriberId,
    channelId: order.channelId,
    recipientType: payload.recipientType || "SELF",
    recipientId: payload.recipientId || order.subscriberId,
    orderType: order.orderType,
    payload,
    status: "pending",
    createdAt: nowIso()
  };
  db.notificationEvents.set(notification.id, notification);
  order.notificationEvents = [...(order.notificationEvents || []), notification];
  return notification;
}

export function listNotificationEvents(db, query = {}) {
  return [...(db.notificationEvents || new Map()).values()]
    .filter((item) => !query.orderId || item.orderId === query.orderId)
    .filter((item) => !query.eventType || item.eventType === query.eventType);
}

function uniqueReasonCodes(reasonCodes) {
  return [...new Set(reasonCodes)];
}

export function validateProductOrder(db, orderId, body = {}) {
  const order = getProductOrder(db, orderId);
  if (order.status !== "acknowledged") {
    fail(409, "INVALID_ORDER_STATE_TRANSITION", `Cannot transition ProductOrder from ${order.status} to inProgress.`, "status");
  }
  if (order.orderType === "terminate") {
    const inventory = order.subscriptionId ? findInventoryById(db, order.subscriptionId) : findInventoryForOrder(db, order.originalOrderId);
    if (!inventory || inventory.status !== "active") {
      order.failureReasonCode = "SUBSCRIPTION_NOT_ACTIVE";
      order.failureMessage = "Subscription is not active.";
      transitionProductOrder(order, "failed", "SUBSCRIPTION_NOT_ACTIVE");
      fail(409, "SUBSCRIPTION_NOT_ACTIVE", "Subscription is not active.", "status");
    }
    const originalOrder = getProductOrder(db, order.originalOrderId || inventory.productOrderId || inventory.orderId);
    const offering = getProductOffering(db, inventory.productOfferingId);
    const failures = [];
    if (Number(offering.cancellationWindowHours || 0) > 0 && inventory.activatedAt) {
      const elapsedMs = Date.now() - new Date(inventory.activatedAt).getTime();
      if (elapsedMs < Number(offering.cancellationWindowHours) * 60 * 60 * 1000) {
        failures.push("CANCELLATION_WINDOW_NOT_ELAPSED");
      }
    }
    const renewalInProgress = [...db.productOrders.values()].some((candidate) =>
      candidate.id !== order.id &&
      candidate.status === "inProgress" &&
      candidate.orderType === "provision" &&
      candidate.renewalForSubscriptionId === inventory.id
    );
    if (renewalInProgress) failures.push("RENEWAL_IN_PROGRESS");
    const csOfferStatus = body.csOfferStatus || (inventory.csAttachmentId ? "attached" : "notAttached");
    const eligibility = createCancellationEligibilityResult(db, order, inventory, uniqueReasonCodes(failures), csOfferStatus);
    if (!eligibility.eligibilityPassed) {
      order.failureReasonCode = eligibility.failureReasonCodes[0];
      order.failureMessage = `Cancellation eligibility failed: ${eligibility.failureReasonCodes.join(", ")}.`;
      transitionProductOrder(order, "failed", eligibility.failureReasonCodes[0]);
      fail(422, eligibility.failureReasonCodes[0], "Cancellation eligibility failed.", "cancellationEligibility");
    }
    order.subscriptionId = inventory.id;
    order.originalOrderId = originalOrder.id;
    transitionProductOrder(order, "inProgress", "Terminate order validation passed");
    order.validationStatus = "valid";
    order.validatedAt = nowIso();
    return order;
  }
  const failureReasonCodes = [];
  const subscriberAttributes = body.subscriberAttributes || body;
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
    inactiveOfferingItem.status = "failed";
    inactiveOfferingItem.failureReasonCode = "OFFERING_NO_LONGER_AVAILABLE";
    failureReasonCodes.push("OFFERING_NO_LONGER_AVAILABLE");
  }
  let subscriberEligible = body.subscriberEligible !== false;
  let balanceSufficient = body.balanceSufficient !== false;
  let channelValid = true;
  for (const item of order.items) {
    const offering = db.productOfferings.get(item.productOfferingId);
    if (!offering || autoRetireIfSunset(offering).status !== "active") continue;
    if (offering.channelAvailability.length > 0 && !offering.channelAvailability.includes(order.channelId)) {
      channelValid = false;
    }
    const failedRule = offering.eligibilityRules.find((rule) => !ruleMatches(rule, subscriberAttributes, { channelId: order.channelId }));
    if (failedRule) {
      subscriberEligible = false;
    }
    const balance = subscriberAttributes.balance;
    if (balance) {
      const price = selectPrice(offering, order.currency, subscriberAttributes);
      const requiredAmount = Number(item.pricedAmount ?? ((price?.amount || 0) * item.quantity));
      if (price?.chargingSource === "DA") {
        const daBalances = Array.isArray(balance.DA) ? balance.DA : [];
        const matchingDaBalances = price.daId ? daBalances.filter((candidate) => candidate.daId === price.daId) : daBalances;
        const availableDaBalance = matchingDaBalances.reduce((sum, candidate) => sum + Number(candidate.balance || 0), 0);
        if (availableDaBalance < requiredAmount) balanceSufficient = false;
      } else if (Number(balance.MA || 0) < requiredAmount) {
        balanceSufficient = false;
      }
    }
  }
  if (!subscriberEligible) failureReasonCodes.push("SUBSCRIBER_INELIGIBLE");
  if (!balanceSufficient) failureReasonCodes.push("INSUFFICIENT_BALANCE");
  if (!channelValid) failureReasonCodes.push("CHANNEL_NOT_AUTHORIZED");
  const uniqueFailures = uniqueReasonCodes(failureReasonCodes);

  const validation = recordOrderValidationResult(db, order, {
    channelValid,
    subscriberEligible,
    offeringAvailable: !inactiveOfferingItem,
    balanceSufficient,
    overallValid: uniqueFailures.length === 0,
    failureReasonCodes: uniqueFailures
  });
  if (!validation.overallValid) {
    order.validationStatus = "invalid";
    order.validationReasonCode = uniqueFailures[0];
    order.failureReasonCode = uniqueFailures[0];
    order.failureMessage = `Order validation failed: ${uniqueFailures.join(", ")}.`;
    for (const item of order.items) {
      item.status = "failed";
      item.failureReasonCode = item.failureReasonCode || uniqueFailures[0];
    }
    order.updatedAt = validation.validatedAt;
    transitionProductOrder(order, "failed", uniqueFailures[0]);
    fail(422, uniqueFailures[0], "ProductOrder validation failed.", "validationResult");
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

function failFulfillmentOrder(order, stepName, failureReason) {
  order.fulfillment.failureReasonCode = failureReason;
  order.failureReasonCode = "FULFILLMENT_STEP_FAILED";
  order.failureMessage = `${stepName} fulfillment step failed: ${failureReason}.`;
  for (const item of order.items) {
    item.status = "failed";
    item.failureReasonCode = order.failureReasonCode;
    item.fulfillmentStatus = "failed";
  }
  return transitionProductOrder(order, "failed", order.failureReasonCode);
}

function findInventoryForOrder(db, orderId) {
  return [...db.productInventories.values()].find((item) => item.productOrderId === orderId || item.orderId === orderId);
}

function findInventoryById(db, subscriptionId) {
  return db.productInventories.get(subscriptionId);
}

function fulfillmentStatusForStep({ required, failedStep, stepName }) {
  if (!required) return "skipped";
  if (failedStep === stepName) return "failed";
  return "success";
}

export function createTerminateOrderFromSubscription(db, body = {}, auth = {}) {
  assertRequired(body.subscriptionId, "subscriptionId");
  const inventory = findInventoryById(db, body.subscriptionId);
  if (!inventory || inventory.status !== "active") {
    fail(422, "SUBSCRIPTION_ALREADY_INACTIVE", "Subscription is not active.", "subscriptionId");
  }
  if (auth.subscriberId && inventory.subscriberId !== auth.subscriberId) {
    fail(403, "SUBSCRIPTION_NOT_OWNED", "Subscription does not belong to this subscriber.", "subscriptionId");
  }
  const originalOrder = getProductOrder(db, inventory.productOrderId || inventory.orderId);
  const terminate = createTerminateOrder(db, originalOrder.id, {
    subscriberId: inventory.subscriberId,
    channelId: auth.channelId || body.channelId || originalOrder.channelId,
    cancellationReasonCode: body.cancellationReasonCode || body.cancellationReason
  });
  terminate.subscriptionId = inventory.id;
  terminate.cancellationReason = body.cancellationReason || body.cancellationReasonCode || null;
  return terminate;
}

function createCancellationEligibilityResult(db, order, inventory, failureReasonCodes = [], csOfferStatus = "attached") {
  if (!db.cancellationEligibilityResults) db.cancellationEligibilityResults = new Map();
  const result = {
    id: randomUUID(),
    orderId: order.id,
    subscriptionId: inventory.id,
    eligibilityPassed: failureReasonCodes.length === 0,
    failureReasonCodes,
    csOfferStatus,
    checkedAt: nowIso()
  };
  db.cancellationEligibilityResults.set(result.id, result);
  order.cancellationEligibilityResult = result;
  return result;
}

export function getCancellationEligibilityResult(db, orderId) {
  return [...(db.cancellationEligibilityResults || new Map()).values()].find((item) => item.orderId === orderId) || null;
}

function handleProvisionCompensation(db, order) {
  if (order.orderType !== "provision" || order.compensationPolicy === "none") return;
  if (order.compensationPolicy === "creditBack") {
    const debitStep = order.fulfillmentSteps.find((step) => step.stepName === "debit" && step.status === "success");
    if (!debitStep) return;
    recordCompensation(
      db,
      order,
      "creditBack",
      "success",
      {
        subscriberId: order.subscriberId,
        amount: debitStep.requestPayload.amount,
        currency: debitStep.requestPayload.currency,
        chargingSource: debitStep.requestPayload.chargingSource,
        originalTransactionRef: order.id
      },
      { transactionId: randomUUID(), status: "success" }
    );
    recordNotification(db, "COMPENSATION_COMPLETED", order, { compensationType: "creditBack" });
  }
  if (order.compensationPolicy === "retry" && order.retryCount >= Number(order.maxRetries || 0)) {
    recordNotification(db, "COMPENSATION_FAILED", order, { compensationType: "retry" });
  }
}

function completeFailedProvisionOrder(db, order, stepName, failureReason) {
  const failed = failFulfillmentOrder(order, stepName, failureReason);
  handleProvisionCompensation(db, failed);
  recordNotification(db, "ORDER_FAILED", failed, { failureReason });
  return failed;
}

function balanceForAllocation(subscriberAccount, source, daId) {
  if (!subscriberAccount) return Number.POSITIVE_INFINITY;
  if (source === "MA") return Number(subscriberAccount.mainBalance || 0);
  if (source === "DA") {
    return Number((subscriberAccount.daBalances || []).find((da) => da.daId === daId)?.balance || 0);
  }
  if (source === "LOYALTY") return Number(subscriberAccount.loyaltyBalance ?? Number.POSITIVE_INFINITY);
  if (source === "MOBILE_MONEY") return Number(subscriberAccount.mobileMoneyBalance ?? Number.POSITIVE_INFINITY);
  return 0;
}

function priceForOrderItem(db, order, item, subscriberAccount) {
  const offering = getProductOffering(db, item.productOfferingId);
  return selectPrice(offering, order.currency, {
    serviceClass: subscriberAccount?.serviceClass,
    segment: subscriberAccount?.segment,
    customerSegment: subscriberAccount?.resolvedSegmentId,
    resolvedSegmentId: subscriberAccount?.resolvedSegmentId,
    psoFlags: subscriberAccount?.psoFlags,
    offerIds: subscriberAccount?.offerIds || []
  });
}

function resolveChargingForOrder(db, order) {
  if (!db.chargingResolutionRecords) db.chargingResolutionRecords = new Map();
  const subscriberAccount = getSubscriberAccountByOrder(db, order.id);
  const item = order.items[0];
  const price = priceForOrderItem(db, order, item, subscriberAccount);
  if (!price) {
    const reason = db.currencyConfigs?.size > 0 ? "PRICE_NOT_AVAILABLE_IN_CURRENCY" : "NO_PRICE_FOR_CURRENCY";
    fail(422, reason, "No ProductOfferingPrice exists for the order currency.", "currency");
  }
  const effectiveSource = price.chargingSource || price.defaultChargingSource;
  if (!effectiveSource) fail(422, "CHARGING_SOURCE_NOT_CONFIGURED", "No charging source is configured for this price.", "chargingSource");
  const totalAmount = Number(order.items.reduce((sum, candidate) => sum + Number(candidate.originalAmount ?? candidate.pricedAmount ?? 0), 0).toFixed(2));
  const discount = calculatePriceAlteration(price, totalAmount, {
    serviceClass: subscriberAccount?.serviceClass,
    segment: subscriberAccount?.segment,
    psoFlags: subscriberAccount?.psoFlags,
    offerIds: subscriberAccount?.offerIds || [],
    customerSegment: subscriberAccount?.resolvedSegmentId,
    resolvedSegmentId: subscriberAccount?.resolvedSegmentId
  });
  const chargedAmount = Number(Math.max(0, totalAmount - discount.discount).toFixed(2));
  const priority = (price.chargingPriority || []).length > 0
    ? price.chargingPriority
    : [{ priority: 1, source: effectiveSource, daId: price.daId || null }];
  const allocations = [];
  let remaining = chargedAmount;

  if (price.allowPartialCharge) {
    for (const rule of priority) {
      if (remaining <= 0) break;
      const available = balanceForAllocation(subscriberAccount, rule.source, rule.daId);
      if (available <= 0 || ["LOYALTY", "MOBILE_MONEY"].includes(rule.source)) {
        allocations.push({ priority: rule.priority, source: rule.source, daId: rule.daId || null, allocationAmount: 0, status: "skipped", csTransactionRef: `${order.id}-${rule.priority}` });
        continue;
      }
      const amount = Number(Math.min(remaining, available).toFixed(2));
      allocations.push({ priority: rule.priority, source: rule.source, daId: rule.daId || null, allocationAmount: amount, status: "debited", csTransactionRef: `${order.id}-${rule.priority}` });
      remaining = Number((remaining - amount).toFixed(2));
    }
    if (remaining > 0) fail(422, "INSUFFICIENT_BALANCE_PARTIAL_COVERAGE", "Configured sources cannot cover the partial charge.", "chargingPriority");
  } else {
    let debited = false;
    for (const rule of priority) {
      const available = balanceForAllocation(subscriberAccount, rule.source, rule.daId);
      if (available >= chargedAmount) {
        allocations.push({ priority: rule.priority, source: rule.source, daId: rule.daId || null, allocationAmount: chargedAmount, status: "debited", csTransactionRef: `${order.id}-${rule.priority}` });
        debited = true;
        break;
      }
      allocations.push({ priority: rule.priority, source: rule.source, daId: rule.daId || null, allocationAmount: 0, status: "skipped", csTransactionRef: `${order.id}-${rule.priority}` });
    }
    if (!debited) fail(422, "INSUFFICIENT_BALANCE_ALL_SOURCES", "All configured charging sources are insufficient.", "chargingPriority");
  }

  const record = {
    id: randomUUID(),
    orderId: order.id,
    totalAmount,
    currency: order.currency,
    appliedPriceAlterationId: discount.alteration?.id || null,
    appliedDiscount: discount.discount,
    chargedAmount,
    resolvedFromDefault: !price.chargingSource && Boolean(price.defaultChargingSource),
    chargeAllocations: allocations,
    resolvedAt: nowIso()
  };
  db.chargingResolutionRecords.set(order.id, record);
  order.chargingResolutionId = record.id;
  order.totalAmount = chargedAmount;
  return record;
}

export function getChargingResolutionRecord(db, orderId) {
  return db.chargingResolutionRecords?.get(orderId) || null;
}

function executeTerminateOrderFulfillment(db, order, body = {}) {
  const inventory = order.subscriptionId ? findInventoryById(db, order.subscriptionId) : findInventoryForOrder(db, order.originalOrderId);
  if (!inventory || inventory.status !== "active") fail(409, "SUBSCRIPTION_NOT_ACTIVE", "Subscription is not active.", "status");
  const originalOrder = getProductOrder(db, order.originalOrderId);
  const failedStep = body.failedStep;
  const removeStatus = fulfillmentStatusForStep({
    required: Boolean(inventory.csAttachmentId),
    failedStep,
    stepName: "removeOffer"
  });
  const removeResponseStatus = body.removeOfferResult || (body.csOfferStatus === "notFound" ? "notFound" : removeStatus);
  const removeSucceeded = ["success", "skipped", "notFound"].includes(removeResponseStatus);
  const removeResponsePayload = removeStatus === "skipped"
    ? { status: "skipped", reason: "CS_ATTACHMENT_ID_NOT_SET" }
    : { removalId: randomUUID(), status: removeResponseStatus };
  fulfillmentStep(order, "removeOffer", removeStatus, {
    orderId: order.id,
    originalOrderId: order.originalOrderId,
    subscriberId: order.subscriberId,
    productOfferingId: inventory.productOfferingId,
    csAttachmentId: inventory.csAttachmentId || null
  }, removeResponsePayload, removeSucceeded ? null : "CS_OFFER_REMOVE_FAILED");
  if (!removeSucceeded) {
    const failed = failFulfillmentOrder(order, "removeOffer", "CS_OFFER_REMOVE_FAILED");
    recordNotification(db, "ORDER_FAILED", failed, {});
    return failed;
  }
  const neaRequired = originalOrder.items.some((item) => offeringCharacteristicValue(db, item.productOfferingId, "neaActivationRequired")?.value === "true");
  const deactivationStatus = fulfillmentStatusForStep({
    required: neaRequired,
    failedStep,
    stepName: "neaDeactivation"
  });
  const deactivationResponsePayload = deactivationStatus === "skipped"
    ? { status: "skipped", reason: "NEA_DEACTIVATION_NOT_REQUIRED" }
    : { deactivationId: randomUUID(), status: deactivationStatus };
  fulfillmentStep(order, "neaDeactivation", deactivationStatus, {
    orderId: order.id,
    subscriberId: order.subscriberId
  }, deactivationResponsePayload, deactivationStatus === "failed" ? "NEA_DEACTIVATION_FAILED" : null);
  if (deactivationStatus === "failed") {
    inventory.neaDeprovisioningFailed = true;
    inventory.updatedAt = nowIso();
  }
  for (const item of order.items) {
    item.status = "completed";
    item.fulfillmentStatus = "completed";
  }
  order.completedAt = nowIso();
  const completed = transitionProductOrder(order, "completed", "Subscription terminated");
  inventory.status = "terminated";
  inventory.terminatedAt = completed.completedAt;
  inventory.terminationReason = order.cancellationReason || order.cancellationReasonCode || null;
  inventory.updatedAt = completed.completedAt;
  order.cancellationConfirmedAt = completed.completedAt;
  if (inventory.notificationFlags?.onExpiry !== false) {
    recordNotification(db, "ORDER_CANCELLED", completed, { inventoryId: inventory.id, subscriptionId: inventory.id, originalOrderId: order.originalOrderId });
  }
  return completed;
}

export function executeProductOrderFulfillment(db, orderId, body = {}) {
  const order = getProductOrder(db, orderId);
  if (order.status !== "inProgress") fail(409, "INVALID_ORDER_STATE_TRANSITION", `Cannot transition ProductOrder from ${order.status} to completed.`, "status");
  if (order.validationStatus !== "valid" || !order.validatedAt) fail(409, "ORDER_NOT_VALIDATED", "ProductOrder must be validated before fulfillment.", "status");
  if (order.orderType === "terminate") return executeTerminateOrderFulfillment(db, order, body);

  const failedStep = body.failedStep;
  const debitStatus = body.chargingResult === "failed" || failedStep === "debit" ? "failed" : "success";
  const debitFailureReason = body.failureReasonCode || "CHARGING_FAILED";
  let chargingResolution;
  try {
    chargingResolution = getChargingResolutionRecord(db, order.id) || resolveChargingForOrder(db, order);
  } catch (error) {
    return completeFailedProvisionOrder(db, order, "debit", error.reasonCode || "INSUFFICIENT_BALANCE");
  }
  const debitedAllocations = chargingResolution.chargeAllocations.filter((allocation) => allocation.status === "debited");
  for (const allocation of debitedAllocations) {
    fulfillmentStep(
      order,
      "debit",
      debitStatus,
      {
        orderId: order.id,
        subscriberId: order.subscriberId,
        amount: allocation.allocationAmount,
        currency: order.currency,
        chargingSource: allocation.source,
        daId: allocation.daId,
        transactionRef: allocation.csTransactionRef
      },
      { transactionId: randomUUID(), status: debitStatus },
      debitStatus === "failed" ? debitFailureReason : null
    );
  }
  if (debitStatus !== "success") {
    order.fulfillment.chargingStatus = "failed";
    order.fulfillment.provisioningStatus = "pending";
    if (debitedAllocations.length > 1) {
      for (const allocation of debitedAllocations.slice(0, -1).reverse()) {
        recordCompensation(db, order, "creditBack", "success", { orderId: order.id, allocation }, { status: "success" });
      }
    }
    return completeFailedProvisionOrder(db, order, "debit", debitFailureReason);
  }
  order.fulfillment.chargingStatus = "completed";

  const attachStatus = body.attachOfferResult === "failed" || failedStep === "attachOffer" ? "failed" : "success";
  const attachFailureReason = body.failureReasonCode || "ATTACH_OFFER_FAILED";
  fulfillmentStep(
    order,
    "attachOffer",
    attachStatus,
    { orderId: order.id, subscriberId: order.subscriberId, items: order.items.map((item) => item.productOfferingId) },
    { attachmentId: randomUUID(), status: attachStatus },
    attachStatus === "failed" ? attachFailureReason : null
  );
  if (attachStatus !== "success") {
    order.fulfillment.provisioningStatus = "failed";
    return completeFailedProvisionOrder(db, order, "attachOffer", attachFailureReason);
  }

  const neaRequired = order.items.some((item) => offeringCharacteristicValue(db, item.productOfferingId, "neaActivationRequired")?.value === "true");
  const neaStatus = fulfillmentStatusForStep({
    required: neaRequired,
    failedStep: body.provisioningResult === "failed" ? "neaActivation" : failedStep,
    stepName: "neaActivation"
  });
  const neaFailureReason = body.failureReasonCode || "NEA_ACTIVATION_FAILED";
  const neaResponsePayload = neaStatus === "skipped"
    ? { status: "skipped", reason: "NEA_ACTIVATION_NOT_REQUIRED" }
    : { activationId: randomUUID(), status: neaStatus };
  fulfillmentStep(
    order,
    "neaActivation",
    neaStatus,
    { orderId: order.id, subscriberId: order.subscriberId },
    neaResponsePayload,
    neaStatus === "failed" ? neaFailureReason : null
  );
  if (neaStatus !== "success") {
    if (neaStatus === "skipped") {
      order.fulfillment.provisioningStatus = "completed";
    } else {
    order.fulfillment.provisioningStatus = "failed";
      return completeFailedProvisionOrder(db, order, "neaActivation", neaFailureReason);
    }
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
  createProductInventoryRecordsForOrder(db, completed, body.inventory || {});
  const completedInventory = findInventoryForOrder(db, completed.id);
  if (completedInventory?.notificationFlags?.onActivation !== false) {
    recordNotification(db, "ORDER_COMPLETED", completed, { inventoryId: completedInventory?.id });
  }
  return completed;
}

export function cancelProductOrder(db, orderId, body = {}) {
  const order = getProductOrder(db, orderId);
  if (order.status !== "acknowledged") {
    fail(409, "INVALID_ORDER_STATE_TRANSITION", `Cannot transition ProductOrder from ${order.status} to cancelled.`, "status");
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
  if (order.compensationPolicy === "none" && !body.action) fail(409, "COMPENSATION_NOT_CONFIGURED", "Compensation is not configured for this order.", "compensationPolicy");
  const timestamp = nowIso();
  const action = body.action || order.compensationPolicy || "creditBack";
  const record = recordCompensation(db, order, action === "retry" ? "retry" : "creditBack", "success", { orderId }, { status: "success" });
  const compensation = {
    id: record.id,
    action,
    status: "completed",
    reasonCode: body.reasonCode || order.fulfillment.failureReasonCode || "ORDER_FAILED",
    createdAt: timestamp
  };
  order.compensation = compensation;
  order.updatedAt = timestamp;
  order.stateHistory.push({ id: randomUUID(), eventType: "OrderStateChangeEvent", status: order.status, changedAt: timestamp, reason: `Compensation completed: ${compensation.action}` });
  recordNotification(db, "COMPENSATION_COMPLETED", order, { compensationType: record.compensationType });
  return order;
}

export function retryProductOrderFulfillment(db, orderId, body = {}) {
  const order = getProductOrder(db, orderId);
  if (order.status !== "failed") fail(409, "ORDER_NOT_RETRYABLE", "Only failed ProductOrders can be retried.", "status");
  if (order.maxRetries !== null && order.maxRetries !== undefined && order.retryCount >= order.maxRetries) {
    recordNotification(db, "COMPENSATION_FAILED", order, { compensationType: "retry" });
    fail(409, "MAX_RETRIES_EXHAUSTED", "Maximum retry attempts are exhausted.", "retryCount");
  }
  const timestamp = nowIso();
  order.retryCount = Number(order.retryCount || 0) + 1;
  recordCompensation(db, order, "retry", "success", { orderId, attemptNumber: order.retryCount }, { status: "scheduled" });
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

function createProductInventoryRecordsForOrder(db, order, options = {}) {
  if (!["provision", "gift"].includes(order.orderType)) return;
  for (const item of order.items) {
    const exists = [...db.productInventories.values()].some((inventory) => inventory.orderItemId === item.id);
    if (exists) continue;
    const timestamp = nowIso();
    const startDate = (order.completedAt || timestamp).slice(0, 10);
    const endDateIso = inventoryExpiryForOffering(db, item.productOfferingId);
    const debitStep = order.fulfillmentSteps.find((step) => step.stepName === "debit" && step.status === "success");
    const attachStep = order.fulfillmentSteps.find((step) => step.stepName === "attachOffer" && step.status === "success");
    const inventory = {
      id: randomUUID(),
      productOrderId: order.id,
      orderId: order.id,
      orderItemId: item.id,
      subscriberId: item.beneficiaryId || order.subscriberId,
      sponsorId: item.beneficiaryId ? order.subscriberId : undefined,
      channelId: order.channelId,
      productOfferingId: item.productOfferingId,
      quantity: item.quantity,
      status: "active",
      startDate,
      endDate: endDateIso?.slice(0, 10),
      renewalEnabled: item.purchasePolicy === "auto-renewal",
      chargingSource: debitStep?.requestPayload?.chargingSource || "MA",
      daId: debitStep?.requestPayload?.daId || null,
      amountCharged: item.pricedAmount,
      currency: item.pricedCurrency || order.currency,
      beneficiaryId: item.beneficiaryId || null,
      renewalOfferId: options.renewalOfferId || item.renewalOfferId || null,
      refillId: options.refillId || item.refillId || null,
      notificationFlags: {
        onActivation: options.notificationFlags?.onActivation ?? true,
        onRenewal: options.notificationFlags?.onRenewal ?? true,
        onExpiry: options.notificationFlags?.onExpiry ?? true,
        onFailure: options.notificationFlags?.onFailure ?? true,
        notifySponsorOnActivation: options.notificationFlags?.notifySponsorOnActivation ?? true,
        notifySponsorOnFailure: options.notificationFlags?.notifySponsorOnFailure ?? true
      },
      csAttachmentId: options.csAttachmentId || attachStep?.responsePayload?.attachmentId || null,
      activatedAt: timestamp,
      expiresAt: endDateIso,
      terminatedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    db.productInventories.set(inventory.id, inventory);
    order.subscriptionId = order.subscriptionId || inventory.id;
  }
}

export function listProductInventory(db, query = {}) {
  return [...db.productInventories.values()]
    .filter((item) => !query.subscriberId || item.subscriberId === query.subscriberId)
    .filter((item) => !query.status || item.status === query.status)
    .filter((item) => !query.productOfferingId || item.productOfferingId === query.productOfferingId)
    .filter((item) => !query.from || (item.startDate || item.activatedAt?.slice(0, 10)) >= query.from)
    .filter((item) => !query.to || (item.endDate || item.expiresAt?.slice(0, 10) || "") <= query.to)
    .sort((a, b) => String(b.startDate || b.activatedAt || "").localeCompare(String(a.startDate || a.activatedAt || "")));
}

export function updateProductInventoryStatus(db, inventoryId, body = {}) {
  const inventory = getProductInventory(db, inventoryId);
  assertRequired(body.status, "status");
  if (!["active", "suspended", "terminated"].includes(body.status)) fail(422, "INVALID_INVENTORY_STATUS", "Inventory status is invalid.", "status");
  inventory.status = body.status;
  inventory.updatedAt = nowIso();
  if (body.status === "terminated") inventory.terminatedAt = inventory.updatedAt;
  return inventory;
}

export function getProductInventory(db, inventoryId) {
  const inventory = db.productInventories.get(inventoryId);
  if (!inventory) fail(404, "INVENTORY_NOT_FOUND", "ProductInventory record was not found.", "inventoryId");
  return inventory;
}

export function createTerminateOrder(db, originalOrderId, body = {}) {
  const originalOrder = getProductOrder(db, originalOrderId);
  if (originalOrder.orderType !== "provision" || originalOrder.status !== "completed") {
    fail(409, "NO_ACTIVE_SUBSCRIPTION", "The referenced order has no active subscription that can be cancelled.", "status");
  }
  const inventory = findInventoryForOrder(db, originalOrderId);
  if (!inventory || inventory.status !== "active") fail(409, "SUBSCRIPTION_NOT_ACTIVE", "Subscription is not active.", "status");
  const duplicate = [...db.productOrders.values()].find((order) => order.orderType === "terminate" && order.originalOrderId === originalOrderId && ["acknowledged", "inProgress"].includes(order.status));
  if (duplicate) fail(409, "DUPLICATE_TERMINATION_REQUEST", "An in-flight terminate order already exists.", "originalOrderId");
  const timestamp = nowIso();
  const order = {
    id: randomUUID(),
    cartId: originalOrder.cartId,
    subscriberId: body.subscriberId || originalOrder.subscriberId,
    channelId: body.channelId || originalOrder.channelId,
    currency: originalOrder.currency,
    orderType: "terminate",
    originalOrderId,
    cancellationReasonCode: body.cancellationReasonCode,
    compensationPolicy: null,
    retryCount: 0,
    maxRetries: null,
    retryIntervalSeconds: null,
    status: "acknowledged",
    failureReasonCode: null,
    failureMessage: null,
    validationStatus: "pending",
    validationReasonCode: null,
    totalAmount: 0,
    items: originalOrder.items.map((item) => ({
      id: randomUUID(),
      orderId: undefined,
      cartItemId: item.cartItemId,
      productOfferingId: item.productOfferingId,
      quantity: item.quantity,
      purchasePolicy: item.purchasePolicy,
      beneficiaryId: item.beneficiaryId,
      pricedAmount: 0,
      pricedCurrency: originalOrder.currency,
      amount: 0,
      currency: originalOrder.currency,
      status: "acknowledged",
      fulfillmentStatus: "pending",
      failureReasonCode: null
    })),
    stateHistory: [{ id: randomUUID(), eventType: "OrderStateChangeEvent", status: "acknowledged", changedAt: timestamp, reason: "Terminate order created" }],
    fulfillment: {
      chargingStatus: "skipped",
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
  return order;
}

export function createChannel(db, body = {}) {
  assertRequired(body.name, "name");
  const channelType = body.channelType || body.type;
  assertRequired(channelType, "channelType");
  assertEnum(channelType, CHANNEL_TYPES, "channelType");
  const channelId = body.channelId || body.name;
  const duplicateById = [...db.channels.values()].find((channel) => (channel.channelId || channel.name) === channelId);
  if (duplicateById) fail(409, "CHANNEL_ID_ALREADY_EXISTS", "Channel channelId must be unique.", "channelId");
  const duplicate = [...db.channels.values()].find((channel) => channel.name === body.name);
  if (duplicate) fail(409, "DUPLICATE_CHANNEL", "Channel name must be unique.", "name");
  const rawApiKey = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const timestamp = nowIso();
  const channel = {
    id: randomUUID(),
    channelId,
    name: body.name,
    type: channelType,
    channelType,
    status: body.status || "active",
    authMethod: body.authMethod || "none",
    apiKeyHash: hashApiKey(rawApiKey),
    allowedOfferingIds: body.allowedOfferingIds || [],
    contactPoint: body.contactPoint,
    externalId: body.externalId,
    callbackUrl: body.callbackUrl,
    metadata: body.metadata || {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
  assertEnum(channel.status, CHANNEL_STATUSES, "status");
  db.channels.set(channel.id, channel);
  return { ...channel, apiKey: rawApiKey };
}

export function listChannels(db, query = {}) {
  return [...db.channels.values()]
    .filter((channel) => !query.type || channel.type === query.type)
    .filter((channel) => !query.channelType || channel.channelType === query.channelType || channel.type === query.channelType)
    .filter((channel) => !query.status || channel.status === query.status);
}

export function getChannel(db, channelId) {
  const channel = db.channels.get(channelId) || [...db.channels.values()].find((item) => item.name === channelId || item.channelId === channelId);
  if (!channel) fail(404, "CHANNEL_NOT_FOUND", "Channel was not found.", "channelId");
  return channel;
}

export function updateChannel(db, channelId, body = {}) {
  const channel = getChannel(db, channelId);
  for (const field of ["name", "externalId", "callbackUrl", "metadata", "contactPoint", "allowedOfferingIds"]) {
    if (body[field] !== undefined) channel[field] = body[field];
  }
  if (body.type !== undefined || body.channelType !== undefined) {
    const nextType = body.channelType || body.type;
    assertEnum(nextType, CHANNEL_TYPES, "channelType");
    channel.type = nextType;
    channel.channelType = nextType;
  }
  if (body.status !== undefined) {
    assertEnum(body.status, CHANNEL_STATUSES, "status");
    channel.status = body.status;
  }
  channel.updatedAt = nowIso();
  return channel;
}

export function activateChannel(db, channelId) {
  return updateChannel(db, channelId, { status: "active" });
}

export function deactivateChannel(db, channelId) {
  return updateChannel(db, channelId, { status: "inactive" });
}

export function regenerateChannelApiKey(db, channelId) {
  const channel = getChannel(db, channelId);
  const rawApiKey = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  channel.apiKeyHash = hashApiKey(rawApiKey);
  channel.updatedAt = nowIso();
  return { channelId: channel.channelId || channel.name, apiKey: rawApiKey };
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

// ============================================================================
// Sprint 4 — Authentication & CS Integration
// ============================================================================

import { createHmac, createHash } from "node:crypto";

const AUTH_CHANNEL_TYPES_JWT_ONLY = ["CRM", "MOBILE_APP"];
const AUTH_CHANNEL_TYPES_APIKEY_ALLOWED = ["USSD", "API_PARTNER", "THIRD_PARTY"];

/**
 * Simple JWT implementation (stateless, HS256)
 */
function signJwt(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${payloadB64}`).digest("base64url");
  return `${header}.${payloadB64}.${signature}`;
}

function verifyJwt(token, secret) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payloadB64, sig] = parts;
    const expectedSig = createHmac("sha256", secret).update(`${header}.${payloadB64}`).digest("base64url");
    if (sig !== expectedSig) return null;
    return JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function hashApiKey(key) {
  return createHash("sha256").update(key).digest("hex");
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * US-011: Issue a JWT to an authenticated channel
 */
export function issueChannelAuthToken(db, body = {}, config = {}) {
  const jwtSecret = config.jwtSecret || process.env.JWT_SECRET || "change-me-in-production";
  const jwtTtlSeconds = Number(config.jwtTtlSeconds || process.env.JWT_TTL_SECONDS || 3600);
  const rateLimit = Number(config.authTokenRateLimit || process.env.AUTH_TOKEN_RATE_LIMIT || 10);

  assertRequired(body.channelId, "channelId");
  assertRequired(body.apiKey, "apiKey");

  if (!db.authTokenRateLimitBuckets) db.authTokenRateLimitBuckets = new Map();
  const minuteWindow = Math.floor(Date.now() / 60000);
  const bucketKey = `${body.channelId}:${minuteWindow}`;
  const bucketCount = db.authTokenRateLimitBuckets.get(bucketKey) || 0;
  if (bucketCount >= rateLimit) {
    fail(429, "RATE_LIMIT_EXCEEDED", "Token request rate limit exceeded.", "authorization");
  }
  db.authTokenRateLimitBuckets.set(bucketKey, bucketCount + 1);

  // Find channel by channelId short name or channel name
  const channel = [...db.channels.values()].find(
    (ch) => (ch.channelId || ch.name) === body.channelId
  );
  if (!channel) fail(401, "INVALID_CREDENTIALS", "Invalid credentials.", "authorization");
  if (channel.status !== "active") fail(403, "CHANNEL_INACTIVE", "Channel is inactive.", "authorization");

  // Validate API key
  const providedHash = hashApiKey(body.apiKey);
  if (channel.apiKeyHash !== providedHash) {
    fail(401, "INVALID_CREDENTIALS", "Invalid credentials.", "authorization");
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    channelId: channel.channelId || channel.name,
    channelType: channel.type,
    iat: now,
    exp: now + jwtTtlSeconds
  };

  const token = signJwt(payload, jwtSecret);
  const tokenHash = hashToken(token);

  const authTokenRecord = {
    id: randomUUID(),
    channelId: payload.channelId,
    tokenHash,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date((now + jwtTtlSeconds) * 1000).toISOString(),
    revokedAt: null,
    revokedBy: null,
    lastUsedAt: null
  };

  if (!db.channelAuthTokens) db.channelAuthTokens = new Map();
  db.channelAuthTokens.set(authTokenRecord.id, authTokenRecord);

  return {
    accessToken: token,
    tokenType: "Bearer",
    expiresIn: jwtTtlSeconds,
    channelId: payload.channelId
  };
}

/**
 * US-011: Revoke a token
 */
export function revokeChannelAuthToken(db, body = {}) {
  assertRequired(body.token, "token");
  const tokenHash = hashToken(body.token);

  if (!db.channelAuthTokens) db.channelAuthTokens = new Map();
  const record = [...db.channelAuthTokens.values()].find((t) => t.tokenHash === tokenHash);
  if (!record) fail(404, "TOKEN_NOT_FOUND", "Token was not found.", "token");
  if (record.revokedAt) fail(409, "TOKEN_ALREADY_REVOKED", "Token is already revoked.", "token");

  record.revokedAt = nowIso();
  record.revokedBy = body.revokedBy || "system";

  // Add to in-memory revocation set
  if (!db.revokedTokens) db.revokedTokens = new Set();
  db.revokedTokens.add(body.token);

  return { revoked: true, tokenHash };
}

/**
 * US-011: List active tokens for a channel
 */
export function listChannelAuthTokens(db, query = {}) {
  if (!db.channelAuthTokens) return [];
  return [...db.channelAuthTokens.values()]
    .filter((t) => !query.channelId || t.channelId === query.channelId)
    .filter((t) => !t.revokedAt)
    .filter((t) => new Date(t.expiresAt).getTime() > Date.now());
}

/**
 * US-011: Validate Bearer token or API key from request
 * Returns { channelId, channelType } on success
 */
export function validateChannelAuth(db, headers = {}, config = {}) {
  const jwtSecret = config.jwtSecret || process.env.JWT_SECRET || "change-me-in-production";
  const authHeader = headers.authorization || headers.Authorization || "";
  const apiKeyHeader = headers["x-api-key"] || "";

  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);

    // Check revocation
    if (db.revokedTokens?.has(token)) {
      fail(401, "TOKEN_REVOKED", "This token has been revoked.", "authorization");
    }

    // Verify JWT
    const payload = verifyJwt(token, jwtSecret);
    if (!payload) fail(401, "INVALID_TOKEN", "Invalid token signature.", "authorization");

    // Check expiry
    if (payload.exp && Date.now() > payload.exp * 1000) {
      fail(401, "TOKEN_EXPIRED", "The Bearer token has expired. Request a new token from POST /api/v1/auth/token.", "authorization");
    }

    // Verify channel still active
    const channel = [...db.channels.values()].find(
      (ch) => (ch.channelId || ch.name) === payload.channelId
    );
    if (!channel) fail(401, "UNKNOWN_CHANNEL", "Channel not found.", "authorization");
    if (channel.status !== "active") fail(403, "CHANNEL_INACTIVE", "Channel is inactive.", "authorization");

    // Update lastUsedAt async (best-effort)
    if (db.channelAuthTokens) {
      const tokenHash = hashToken(token);
      const record = [...db.channelAuthTokens.values()].find((t) => t.tokenHash === tokenHash);
      if (record) record.lastUsedAt = nowIso();
    }

    return { channelId: payload.channelId, channelType: payload.channelType };
  }

  if (apiKeyHeader) {
    const keyHash = hashApiKey(apiKeyHeader);
    const channel = [...db.channels.values()].find((ch) => ch.apiKeyHash === keyHash);
    if (!channel) fail(401, "INVALID_CREDENTIALS", "Invalid credentials.", "authorization");
    if (channel.status !== "active") fail(403, "CHANNEL_INACTIVE", "Channel is inactive.", "authorization");

    const channelType = channel.type;
    if (AUTH_CHANNEL_TYPES_JWT_ONLY.includes(channelType)) {
      fail(401, "AUTH_METHOD_NOT_ALLOWED", `API key auth not allowed for ${channelType} channels. Use JWT Bearer token.`, "authorization");
    }

    return { channelId: channel.channelId || channel.name, channelType: channel.type };
  }

  fail(401, "MISSING_TOKEN", "Authentication required. Provide Bearer token or X-API-Key header.", "authorization");
}

/**
 * US-012: Store SubscriberAccount snapshot fetched from CS
 */
export function createSubscriberAccountSnapshot(db, orderId, csData) {
  if (!db.subscriberAccounts) db.subscriberAccounts = new Map();
  const snapshot = {
    id: randomUUID(),
    orderId,
    subscriberId: csData.subscriberId,
    serviceClass: csData.serviceClass || "PREPAID",
    segment: csData.segment || "CONSUMER",
    mainBalance: Number(csData.mainBalance || 0),
    currency: csData.currency || "NGN",
    daBalances: (csData.daBalances || []).map((da) => ({
      daId: da.daId,
      balance: Number(da.balance || 0),
      priority: Number(da.priority || 9999)
    })),
    psoFlags: csData.psoFlags || "",
    offerIds: csData.offerIds || [],
    resolvedSegmentId: csData.resolvedSegmentId || null,
    resolvedViaStaffLink: Boolean(csData.resolvedViaStaffLink),
    staffLinkId: csData.staffLinkId || null,
    expiryDate: csData.expiryDate || null,
    fetchedAt: nowIso(),
    csResponseCode: csData.responseCode || csData.csResponseCode || "0",
    csRawResponse: csData.rawResponse || csData.csRawResponse || {}
  };
  db.subscriberAccounts.set(snapshot.id, snapshot);
  return snapshot;
}

/**
 * Get the subscriber account snapshot linked to an order
 */
export function getSubscriberAccountByOrder(db, orderId) {
  if (!db.subscriberAccounts) return null;
  const order = db.productOrders.get(orderId);
  if (order?.subscriberAccountId) return db.subscriberAccounts.get(order.subscriberAccountId) || null;
  return [...db.subscriberAccounts.values()].find((a) => a.orderId === orderId) || null;
}

/**
 * US-013: Validate order using live SubscriberAccount data (Sprint 4 version)
 * This replaces the Sprint 2/3 request-body subscriber attributes approach
 */
export function validateProductOrderWithSubscriberAccount(db, orderId, subscriberAccount) {
  const order = getProductOrder(db, orderId);
  if (order.status !== "acknowledged") {
    fail(409, "ORDER_NOT_VALIDATABLE", "Only acknowledged ProductOrders can be validated.", "status");
  }
  if (!subscriberAccount) {
    fail(422, "CS_SUBSCRIBER_FETCH_FAILED", "Subscriber account data is required for order validation.", "subscriberAccount");
  }
  subscriberAccount.resolvedSegmentId = resolveCustomerSegmentId(db, subscriberAccount);
  for (const item of order.items) {
    applyStaffSegmentOverrideIfEligible(db, subscriberAccount, item.productOfferingId);
  }

  const failureReasonCodes = [];
  let channelValid = true;
  let subscriberEligible = true;
  let offeringAvailable = true;
  let balanceSufficient = true;

  // 1. Cart still valid
  const cart = db.shoppingCarts.get(order.cartId);
  if (!cart || cart.status !== "checkedOut") {
    failureReasonCodes.push("SOURCE_CART_NOT_CHECKED_OUT");
  }

  // 2. Check each item
  for (const item of order.items) {
    const offering = db.productOfferings.get(item.productOfferingId);
    if (!offering || autoRetireIfSunset(offering).status !== "active") {
      offeringAvailable = false;
      failureReasonCodes.push("OFFERING_NO_LONGER_AVAILABLE");
      continue;
    }

    // Channel authorization
    if (offering.channelAvailability.length > 0 && !offering.channelAvailability.includes(order.channelId)) {
      channelValid = false;
      failureReasonCodes.push("CHANNEL_NOT_AUTHORIZED");
    }

    // Eligibility rules against live CS data
    const attributes = {
      serviceClass: subscriberAccount.serviceClass,
      segment: subscriberAccount.segment,
      customerSegment: subscriberAccount.resolvedSegmentId,
      channel: order.channelId
    };

    for (const rule of offering.eligibilityRules) {
      if (rule.ruleType === "multiPurchase") {
        if (order.orderType === "renew" && rule.renewalExemptMultiPurchase) continue;
        // Check if offering already attached on CS
        if (subscriberAccount.offerIds.includes(offering.id) || subscriberAccount.offerIds.includes(item.productOfferingId)) {
          subscriberEligible = false;
          failureReasonCodes.push("MULTI_PURCHASE_NOT_ALLOWED");
        }
      } else if (rule.ruleType === "psoFlag") {
        // PSO flag check
        if (!subscriberAccount.psoFlags.includes(rule.value)) {
          subscriberEligible = false;
          failureReasonCodes.push("PSO_FLAG_INELIGIBLE");
        }
      } else if (rule.ruleType === "customerSegment" && !subscriberAccount.resolvedSegmentId) {
        subscriberEligible = false;
        failureReasonCodes.push("SEGMENT_NOT_RESOLVED");
      } else if (!ruleMatches(rule, attributes, { channelId: order.channelId })) {
        subscriberEligible = false;
        failureReasonCodes.push(rule.failureReasonCode || "SUBSCRIBER_INELIGIBLE");
      }
    }

    try {
      const resolution = resolveChargingForOrder(db, order);
      item.appliedPriceAlterationId = resolution.appliedPriceAlterationId;
      item.discountAmount = resolution.appliedDiscount;
      item.finalChargeAmount = resolution.chargedAmount;
    } catch (error) {
      balanceSufficient = false;
      failureReasonCodes.push(error.reasonCode || "INSUFFICIENT_BALANCE");
    }
  }

  const overallValid = failureReasonCodes.length === 0;

  // Link subscriber account to order
  order.subscriberAccountId = subscriberAccount.id;

  const validation = recordOrderValidationResult(db, order, {
    channelValid,
    subscriberEligible,
    offeringAvailable,
    balanceSufficient,
    overallValid,
    failureReasonCodes,
    appliedPriceAlterationId: order.items[0]?.appliedPriceAlterationId || null,
    discountAmount: order.items.reduce((sum, item) => sum + Number(item.discountAmount || 0), 0),
    finalChargeAmount: order.items.reduce((sum, item) => sum + Number(item.finalChargeAmount ?? item.pricedAmount ?? 0), 0)
  });

  if (!overallValid) {
    order.validationStatus = "invalid";
    order.validationReasonCode = failureReasonCodes[0];
    order.updatedAt = validation.validatedAt;
    // Transition to failed for critical failures
    if (!offeringAvailable) {
      transitionProductOrder(order, "failed", failureReasonCodes[0]);
      order.failureReasonCode = failureReasonCodes[0];
      order.failureMessage = "Order validation failed: offering no longer available.";
      order.completedAt = nowIso();
    }
    fail(422, failureReasonCodes[0], "ProductOrder validation failed.", "validationResult");
  }

  order.validationStatus = "valid";
  order.validationReasonCode = null;
  order.validatedAt = validation.validatedAt;
  for (const item of order.items) item.status = "inProgress";
  transitionProductOrder(order, "inProgress", "Order validation passed with live CS data");
  return order;
}

/**
 * US-017: Create ProductInventory with Sprint 4 extended fields
 */
export function createProductInventoryWithSprint4Fields(db, order, options = {}) {
  for (const item of order.items) {
    const exists = [...db.productInventories.values()].some((inv) => inv.orderItemId === item.id);
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
      // Sprint 4 extended fields (US-017 closure)
      renewalOfferId: options.renewalOfferId || null,
      refillId: options.refillId || null,
      notificationFlags: {
        onActivation: options.notificationFlags?.onActivation ?? true,
        onRenewal: options.notificationFlags?.onRenewal ?? true,
        onExpiry: options.notificationFlags?.onExpiry ?? true,
        onFailure: options.notificationFlags?.onFailure ?? true
      },
      csAttachmentId: options.csAttachmentId || null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    db.productInventories.set(inventory.id, inventory);

    // Link inventory to order as subscriptionId
    order.subscriptionId = inventory.id;
  }
}

/**
 * Create channel with Sprint 4 fields (apiKeyHash, channelId, allowedOfferingIds, authMethod)
 */
export function createChannelWithApiKey(db, body = {}) {
  assertRequired(body.name, "name");
  assertRequired(body.type, "type");
  assertEnum(body.type, CHANNEL_TYPES, "type");

  const shortChannelId = body.channelId || body.name;

  // Check unique channelId (short identifier)
  const duplicateById = [...db.channels.values()].find(
    (ch) => (ch.channelId || ch.name) === shortChannelId && ch.id !== undefined
  );
  if (duplicateById) fail(409, "CHANNEL_ID_ALREADY_EXISTS", "Channel channelId must be unique.", "channelId");

  // Check unique name
  const duplicateName = [...db.channels.values()].find((ch) => ch.name === body.name);
  if (duplicateName) fail(409, "DUPLICATE_CHANNEL", "Channel name must be unique.", "name");

  // Generate API key
  const rawApiKey = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const apiKeyHash = hashApiKey(rawApiKey);

  const timestamp = nowIso();
  const channel = {
    id: randomUUID(),
    channelId: shortChannelId,
    name: body.name,
    type: body.type,
    status: body.status || "active",
    authMethod: body.authMethod || "apiKey",
    apiKeyHash,
    allowedOfferingIds: body.allowedOfferingIds || [],
    contactPoint: body.contactPoint || null,
    metadata: body.metadata || {},
    externalId: body.externalId,
    callbackUrl: body.callbackUrl,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  assertEnum(channel.status, CHANNEL_STATUSES, "status");
  db.channels.set(channel.id, channel);

  // Return with raw API key (shown only once)
  return { ...channel, apiKey: rawApiKey };
}
