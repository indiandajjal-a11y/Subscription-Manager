# Data Model

## ProductSpecification

Defines what a sellable product can technically represent.

Required characteristics:

- `dataVolume`
- `validityPeriod`
- `bundleType`
- `neaActivationRequired`

Statuses:

- `draft`
- `active`
- `retired`

## ProductOffering

Defines what can be sold to subscribers through channels.

Key relationships:

- References one `ProductSpecification`
- Owns zero or more `ProductOfferingPrice` records
- Owns zero or more `EligibilityRule` records
- May define `cancellationWindowHours` for Sprint 5 cancellation eligibility

Statuses:

- `draft`
- `active`
- `retired`

## ProductOfferingPrice

Defines commercial pricing for a product offering.

Supported price types:

- `standard`
- `discount`

Supported charging sources:

- `MA`
- `DA`
- `LOYALTY`
- `MOBILE_MONEY`

Sprint 5 charging fields:

- `defaultChargingSource`
- `allowPartialCharge`
- `chargingPriority`
- `priceAlteration`

Default rule:

- Exactly one default price per offering per currency is enforced by application logic and PostgreSQL partial unique index.
- Sprint 7 accepts `currencyCode` as an alias for `currency` and validates it against active `CurrencyConfig` records when the currency catalog is enabled.

## ShoppingCart

Captures purchase intent from a subscriber and channel.

Statuses:

- `active`
- `validated`
- `checkedOut`
- `abandoned`

## CartItem

Represents a selected `ProductOffering` inside a cart.

Purchase policies:

- `one-off`
- `auto-renewal`
- `gift`
- Sprint 7 also accepts channel-facing aliases `SELF_ONE_OFF`, `SELF_AUTO_RENEWAL`, and `GIFT`.

## ProductOrder

Sprint 2 expands the checkout stub into an order lifecycle aggregate.

Statuses:

- `acknowledged`
- `inProgress`
- `completed`
- `failed`
- `cancelled`

Key fields:

- `cartId`
- `subscriberId`
- `channelId`
- `currency`
- `orderType`
- `validationStatus`
- `validationReasonCode`
- `failureReasonCode`
- `failureMessage`
- `totalAmount`
- `items`
- `fulfillmentSteps`
- `validatedAt`
- `completedAt`
- `stateHistory`
- `fulfillment`
- `originalOrderId`
- `cancellationReasonCode`
- `compensationPolicy`
- `retryCount`
- `maxRetries`
- `retryIntervalSeconds`
- `subscriberAccountId`
- `subscriptionId`

## ProductOrderItem

ProductOrder items are immutable checkout snapshots of cart items.

Key fields:

- `cartItemId`
- `productOfferingId`
- `quantity`
- `purchasePolicy`
- `beneficiaryId`
- `pricedAmount`
- `pricedCurrency`
- `status`
- `fulfillmentStatus`
- `failureReasonCode`

## OrderValidationResult

Stored when ProductOrder validation is attempted.

Any failed validation attempt transitions the related `ProductOrder` to `failed`, sets `completedAt`, and stores all unique failure reason codes.

Key fields:

- `orderId`
- `channelValid`
- `subscriberEligible`
- `offeringAvailable`
- `balanceSufficient`
- `overallValid`
- `failureReasonCodes`
- `validatedAt`

## FulfillmentStepRecord

Audit record for each mocked fulfillment step.

Steps:

- `debit`
- `attachOffer`
- `csAttributeUpdate`
- `neaActivation`

Statuses:

- `pending`
- `success`
- `failed`
- `skipped`

`neaActivation` is recorded as `skipped` when the related ProductSpecification has `neaActivationRequired = false`.

## ProductInventory

Created when a ProductOrder completes successfully.

Key fields:

- `productOrderId`
- `orderItemId`
- `subscriberId`
- `sponsorId`
- `channelId`
- `productOfferingId`
- `quantity`
- `status`
- `activatedAt`
- `expiresAt`
- `startDate`
- `endDate`
- `renewalEnabled`
- `chargingSource`
- `daId`
- `amountCharged`
- `currency`
- `beneficiaryId`
- `terminatedAt`
- `terminationReason`
- `neaDeprovisioningFailed`
- `renewalOfferId`
- `refillId`
- `notificationFlags`
- `csAttachmentId`

Statuses:

- `active`
- `suspended`
- `terminated`
- `expired`

## Channel

Represents a channel or partner that can initiate subscription requests.

Supported types:

- `USSD`
- `SMS`
- `WEB`
- `CRM`
- `MOBILE_APP`
- `THIRD_PARTY`
- `SELF_CARE`
- `API_PARTNER`

Statuses:

- `active`
- `inactive`

## ChannelInteraction

Audit record for channel-originated subscription attempts.

Key fields:

- `channelId`
- `channelType`
- `requestType`
- `subscriberId`
- `productOfferingId`
- `cartId`
- `orderId`
- `status`
- `reasonCode`

## CompensationConfig

Configures the compensation policy for a ProductOffering.

Supported policies:

- `none`
- `creditBack`
- `retry`

## CompensationRecord

Audit record for credit-back or retry compensation attempts.

Key fields:

- `orderId`
- `compensationType`
- `attemptNumber`
- `status`
- `requestPayload`
- `responsePayload`
- `executedAt`
- `failureReason`

## NotificationEvent

Placeholder event written by order and compensation flows for Sprint 7 dispatch.

Event types:

- `ORDER_COMPLETED`
- `ORDER_FAILED`
- `ORDER_CANCELLED`
- `COMPENSATION_COMPLETED`
- `COMPENSATION_FAILED`

## SubscriberAccount

Sprint 4 stores CS-derived subscriber attributes per order.

Key fields:

- `orderId`
- `subscriberId`
- `serviceClass`
- `segment`
- `mainBalance`
- `currency`
- `daBalances`
- `psoFlags`
- `offerIds`
- `expiryDate`
- `csResponseCode`
- `csRawResponse`

## ChannelAuthToken

Stores issued channel token metadata for audit and revocation.

Key fields:

- `channelId`
- `tokenHash`
- `issuedAt`
- `expiresAt`
- `revokedAt`
- `lastUsedAt`

## Auth Rate Limit Buckets

In-memory token endpoint counters are kept per channel and minute window. They enforce `AUTH_TOKEN_RATE_LIMIT` for Sprint 4 local/runtime behavior and are intentionally not persistent.

## CancellationEligibilityResult

Sprint 5 stores one immutable cancellation eligibility snapshot per terminate-order validation.

Key fields:

- `orderId`
- `subscriptionId`
- `eligibilityPassed`
- `failureReasonCodes`
- `csOfferStatus`
- `checkedAt`

## ChargingResolutionRecord

Sprint 5 records the resolved charge plan before fulfillment debits.

Key fields:

- `orderId`
- `totalAmount`
- `currency`
- `appliedPriceAlterationId`
- `appliedDiscount`
- `chargedAmount`
- `resolvedFromDefault`
- `chargeAllocations`
- `resolvedAt`

Each `chargeAllocation` stores `priority`, `source`, optional `daId`, `allocationAmount`, `status`, and `csTransactionRef`.

## CustomerSegment

Sprint 6 stores catalog-managed subscriber segments for validation and pricing.

Key fields:

- `id`
- `name`
- `description`
- `resolutionRules`
- `status`
- `createdAt`
- `updatedAt`

Resolution rules support `equals`, `in`, `notIn`, and `contains`. Active segments are evaluated before eligibility and price alteration checks.

## RenewalSchedule

Sprint 6 tracks auto-renewal scheduling.

Key fields:

- `subscriptionId`
- `scheduledAt`
- `renewalOfferId`
- `attemptCount`
- `lastAttemptAt`
- `status`
- `renewalOrderId`

Valid stable statuses are `pending`, `inProgress`, `completed`, `failed`, and `cancelled`.

## PartyRelationship

Sprint 6 records sponsor/beneficiary relationships for gift subscriptions.

Key fields:

- `relationshipType`
- `sponsorId`
- `beneficiaryId`
- `subscriptionId`
- `orderId`
- `status`

## Sprint 6 Catalog Extensions

`ProductSpecification` now supports `csAttributeUpdates` and `bundleCategory`.

`ProductOffering` now supports `compensationPolicy`, `giftingEnabled`, `maxGiftBeneficiaries`, `csAttributeUpdates`, and `bundleCategory`.

`SubscriberAccount` now supports `resolvedSegmentId`.

`NotificationEvent` helper records support `recipientType` and `recipientId`.

## CommunicationTemplate

Sprint 7 stores TMF681-style notification templates.

Key fields:

- `name`
- `version`
- `eventType`
- `channelType`
- `locale`
- `offeringId`
- `bodyTemplate`
- `maxLength`
- `appendPromo`
- `promoText`
- `status`

Selection prefers offering-specific channel templates, then channel defaults, then `ALL` channel fallbacks.

## NotificationDispatchRecord

Sprint 7 records each attempted notification dispatch.

Key fields:

- `notificationEventId`
- `templateId`
- `recipientId`
- `channelType`
- `renderedBody`
- `status`
- `dispatchedAt`
- `failureReason`
- `gatewayRef`

Statuses are `pending`, `sent`, `failed`, and `skipped`.

## CurrencyConfig

Sprint 7 stores operator currency configuration.

Key fields:

- `currencyCode`
- `symbol`
- `minorUnit`
- `isDefault`
- `status`

The default active currency may be used when a channel creates a cart without a currency.

## StaffNumberLink

Sprint 7 links staff primary numbers to secondary subscriber numbers.

Key fields:

- `primaryNumber`
- `secondaryNumber`
- `offeringId`
- `status`
- `linkedBy`

An active link can apply a STAFF segment override during order validation for the linked offering only.
