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

Default rule:

- Exactly one default price per offering per currency is enforced by application logic and PostgreSQL partial unique index.

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
