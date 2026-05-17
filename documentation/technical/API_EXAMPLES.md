# Sprint 1 API Examples

Base URL: `http://localhost:3000/api/v1`

All validation failures use this envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable summary",
    "details": [
      {
        "field": "currency",
        "reasonCode": "UNSUPPORTED_CURRENCY",
        "message": "Cart currency is not supported."
      }
    ]
  }
}
```

## ProductSpecification

Create a specification:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/catalog/specifications" -ContentType "application/json" -Body '{
  "name": "Monthly 5GB Data",
  "version": "1.0",
  "description": "Monthly data bundle",
  "characteristics": [
    { "name": "dataVolume", "valueType": "number", "value": "5", "unit": "GB" },
    { "name": "validityPeriod", "valueType": "number", "value": "30", "unit": "days" },
    { "name": "bundleType", "valueType": "string", "value": "monthly" },
    { "name": "neaActivationRequired", "valueType": "boolean", "value": "true" }
  ]
}'
```

Activate a specification:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/catalog/specifications/{specificationId}/activate"
```

## ProductOffering

Create an offering:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/catalog/offerings" -ContentType "application/json" -Body '{
  "name": "Monthly 5GB - USSD",
  "productSpecificationId": "{specificationId}",
  "channelAvailability": ["USSD"]
}'
```

Add a default price:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/catalog/offerings/{offeringId}/prices" -ContentType "application/json" -Body '{
  "priceType": "standard",
  "amount": 1000,
  "currency": "NGN",
  "chargingSource": "MA",
  "isDefault": true
}'
```

Add a Sprint 5 advanced charging price:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/catalog/offerings/{offeringId}/prices" -ContentType "application/json" -Body '{
  "priceType": "standard",
  "amount": 1000,
  "currency": "NGN",
  "chargingSource": "DA",
  "defaultChargingSource": "MA",
  "allowPartialCharge": true,
  "chargingPriority": [
    { "priority": 1, "source": "DA", "daId": "DA1" },
    { "priority": 2, "source": "MA" }
  ],
  "priceAlteration": [
    {
      "name": "VIP discount",
      "alterationType": "DISCOUNT_PERCENTAGE",
      "alterationValue": 50,
      "eligibilityRules": [
        { "attribute": "serviceClass", "operator": "equals", "value": "VIP" }
      ]
    }
  ],
  "isDefault": true
}'
```

Activate an offering:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/catalog/offerings/{offeringId}/activate"
```

List channel-visible offerings:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/catalog/offerings?status=active&channelId=USSD"
```

## ShoppingCart

Create a cart:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/cart" -ContentType "application/json" -Body '{
  "channelId": "USSD",
  "subscriberId": "2348012345678",
  "currency": "NGN"
}'
```

Add an item:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/cart/{cartId}/items" -ContentType "application/json" -Body '{
  "productOfferingId": "{offeringId}",
  "quantity": 1,
  "purchasePolicy": "one-off"
}'
```

Remove an item:

```powershell
Invoke-RestMethod -Method DELETE -Uri "http://localhost:3000/api/v1/cart/{cartId}/items/{itemId}"
```

Successful item removal returns `204 No Content`. If the cart was previously `validated`, removal resets it to `active` and clears stale item validation/pricing.

Validate and price the cart:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/cart/{cartId}/validate" -ContentType "application/json" -Body '{
  "subscriberAttributes": {
    "serviceClass": "PREPAID",
    "segment": "RETAIL"
  }
}'
```

Checkout:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/cart/{cartId}/checkout"
```

## ProductOrder

Get an order:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/product-order/{orderId}"
```

Capture an order from an already validated cart:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/orders" -ContentType "application/json" -Body '{
  "cartId": "{cartId}"
}'
```

List orders:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/product-order?subscriberId=2348012345678"
```

Validate an order before fulfillment:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/orders/{orderId}/validate" -ContentType "application/json" -Body '{
  "subscriberAttributes": {
    "serviceClass": "PREPAID",
    "segment": "CONSUMER",
    "balance": {
      "MA": 1000,
      "DA": []
    }
  }
}'
```

Validation uses prompt-standard failure reason codes, including `OFFERING_NO_LONGER_AVAILABLE`, `CHANNEL_NOT_AUTHORIZED`, `SUBSCRIBER_INELIGIBLE`, and `INSUFFICIENT_BALANCE`.
Any validation failure moves the order to `failed` and records all unique failure reason codes on `OrderValidationResult.failureReasonCodes`.

Move an order to `inProgress`:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/product-order/{orderId}/state" -ContentType "application/json" -Body '{
  "status": "inProgress",
  "reason": "Accepted for fulfillment"
}'
```

Execute successful fulfillment:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/orders/{orderId}/fulfill" -ContentType "application/json" -Body '{}'
```

Simulate charging failure:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/product-order/{orderId}/fulfill" -ContentType "application/json" -Body '{
  "chargingResult": "failed",
  "failureReasonCode": "INSUFFICIENT_BALANCE"
}'
```

Fulfillment failures return HTTP `422`, stop before subsequent steps, set `failureReasonCode` to `FULFILLMENT_STEP_FAILED`, and keep the step-specific reason in `fulfillment.failureReasonCode`.

When `neaActivationRequired` is `false` on the ProductSpecification, fulfillment still records the `neaActivation` step but marks it `skipped`.

Cancel an order:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/product-order/{orderId}/cancel" -ContentType "application/json" -Body '{
  "reason": "Customer request"
}'
```

Compensate a failed order:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/product-order/{orderId}/compensate" -ContentType "application/json" -Body '{
  "action": "creditBack",
  "reasonCode": "PROVISIONING_FAILED"
}'
```

Retry a failed order:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/product-order/{orderId}/retry" -ContentType "application/json" -Body '{
  "reason": "Retry after compensation"
}'
```

Create or update compensation config for an offering:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/catalog/offerings/{offeringId}/compensation-config" -ContentType "application/json" -Body '{
  "compensationType": "creditBack"
}'
```

Create a terminate order for a completed provision order:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/orders/{orderId}/cancel-request" -ContentType "application/json" -Body '{
  "subscriberId": "2348012345678",
  "channelId": "CRM",
  "cancellationReasonCode": "SUBSCRIBER_REQUEST"
}'
```

Validate and fulfill the returned `terminateOrderId` through the same `/orders/{orderId}/validate` and `/orders/{orderId}/fulfill` endpoints. Completion updates the linked inventory record to `terminated` and writes an `ORDER_CANCELLED` notification event.

Create a Sprint 5 terminate order directly from a subscription:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/orders" -ContentType "application/json" -Body '{
  "orderType": "terminate",
  "subscriptionId": "{inventoryId}",
  "subscriberId": "2348012345678",
  "cancellationReason": "Subscriber requested"
}'
```

Get charging resolution audit for an order:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/orders/{orderId}/charging-resolution"
```

## ProductInventory

Query inventory by subscriber:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/inventory?subscriberId=2348012345678"
```

Filter inventory by status and date:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/inventory?subscriberId=2348012345678&status=active&from=2026-01-01&to=2026-12-31"
```

Get one inventory record:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/inventory/{inventoryId}"
```

Get one subscription record:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/subscriptions/{inventoryId}"
```

## Channels

Create a USSD channel:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/channels" -ContentType "application/json" -Body '{
  "channelId": "USSD",
  "name": "USSD",
  "channelType": "USSD",
  "authMethod": "apiKey",
  "contactPoint": "*123#",
  "metadata": {
    "shortCode": "123"
  }
}'
```

The response includes a plaintext `apiKey` once. Subsequent cart creation validates `channelId` against registered active channels when any channels are configured.

Capture a USSD pull subscription request:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/channels/{channelId}/ussd/pull" -ContentType "application/json" -Body '{
  "subscriberId": "2348012345678",
  "productOfferingId": "{offeringId}",
  "currency": "NGN",
  "subscriberAttributes": {
    "serviceClass": "PREPAID"
  },
  "autoCheckout": true
}'
```

Capture an SMS subscription request:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/v1/channels/{channelId}/sms/messages" -ContentType "application/json" -Body '{
  "subscriberId": "2348012345678",
  "productOfferingId": "{offeringId}",
  "currency": "NGN",
  "autoCheckout": true
}'
```

List channel interactions:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/channel-interactions?subscriberId=2348012345678"
```
