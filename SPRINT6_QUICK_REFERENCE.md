# Sprint 6 Quick Reference Guide

## Import All Functions

```javascript
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
  getPartyRelationship,
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
```

---

## 1. Customer Segment Management

### Create a Customer Segment
```javascript
const segment = createCustomerSegment(db, {
  name: "VIP Segment",
  description: "For VIP customers",
  resolutionRules: [
    {
      attributeName: "serviceClass",
      operator: "equals",
      value: "VIP"
    }
  ]
});
// Returns: segment with id, status='draft'
```

### Activate Segment for Resolution
```javascript
updateCustomerSegment(db, segment.id, { status: "active" });
```

### List All Active Segments
```javascript
const activeSegments = listCustomerSegments(db, { status: "active" });
```

### Resolve Segment from Subscriber Attributes
```javascript
const segmentId = resolveSegmentFromRules(db, {
  serviceClass: "VIP",
  segment: "CONSUMER"
});
// Returns: first matching segment ID or null
```

---

## 2. Renewal Schedule Management

### Create Renewal Schedule
```javascript
const schedule = createRenewalSchedule(db, {
  subscriptionId: inventory.id,
  scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  renewalOfferId: offering.id
});
```

### Use RenewalScheduler Class
```javascript
const scheduler = new RenewalScheduler(db, 60); // 60 second poll interval
scheduler.start();  // Start background polling

// Schedule renewal for inventory
const schedule = scheduler.scheduleRenewalForInventory(
  inventoryId,
  scheduledAt,
  renewalOfferId
);

scheduler.stop();   // Stop polling
```

### List Scheduled Renewals
```javascript
const scheduled = listRenewalSchedules(db, {
  subscriptionId: inventory.id,
  status: "scheduled"
});
```

### Update Schedule Status
```javascript
updateRenewalSchedule(db, schedule.id, {
  status: "processed",
  renewalOrderId: order.id,
  attemptCount: 1
});
```

---

## 3. Party Relationship (Gift Orders)

### Validate Gift Order
```javascript
try {
  validateGiftOrder(db, offering, sponsorId, beneficiaryId);
} catch (error) {
  // Error codes:
  // - GIFTING_NOT_ENABLED
  // - SELF_GIFT_NOT_ALLOWED
  // - MAX_GIFT_BENEFICIARIES_EXCEEDED
  // - DUPLICATE_ACTIVE_GIFT
}
```

### Create Party Relationship
```javascript
const relationship = createPartyRelationship(db, {
  relationshipType: "sponsor",
  sponsorId: "sub-123",
  beneficiaryId: "sub-456",
  subscriptionId: inventory.id,
  orderId: order.id
});
```

### List Relationships
```javascript
const sponsorGifts = listPartyRelationships(db, {
  sponsorId: "sub-123",
  status: "active"
});
```

### Terminate Relationship
```javascript
updatePartyRelationship(db, relationship.id, { status: "terminated" });
```

---

## 4. CS Attribute Updates

### Compute Attribute Updates
```javascript
const updates = computeCSAttributeUpdates(db, offering, activationDate);

// Returns array of:
// [
//   {
//     id: UUID,
//     attributeName: "expiryDate",
//     value: "2024-01-31",
//     valueSource: "calculatedFromExpiry",
//     appliedAt: ISO timestamp
//   }
// ]
```

### Three Value Source Types

**Type 1: Fixed Value**
```javascript
offering.csAttributeUpdates = [
  {
    attributeName: "offerType",
    valueSource: "fixed",
    fixedValue: "PROMOTION"
  }
];
```

**Type 2: From Offering Characteristic**
```javascript
offering.csAttributeUpdates = [
  {
    attributeName: "category",
    valueSource: "offeringCharacteristic",
    offeringCharacteristicName: "bundleCategory"
  }
];
```

**Type 3: Calculated from Expiry**
```javascript
offering.csAttributeUpdates = [
  {
    attributeName: "expiryDate",
    valueSource: "calculatedFromExpiry",
    offsetDays: 30
  }
];
```

---

## 5. Compensation Policy Management

### Get Default Policy
```javascript
const defaultPolicy = getDefaultCompensationPolicy();
// {
//   creditBackEnabled: true,
//   retryEnabled: false,
//   retryCount: 3,
//   retryIntervalSeconds: 300
// }
```

### Get Offering-Specific Policy
```javascript
const policy = getCompensationPolicy(db, offering.id);
// Returns: offering.compensationPolicy or defaults
```

### Setting Custom Policy on Offering
```javascript
offering.compensationPolicy = {
  creditBackEnabled: false,
  retryEnabled: true,
  retryCount: 5,
  retryIntervalSeconds: 600
};
```

---

## 6. Renewal Order Management

### Create Renewal Order
```javascript
const renewalOrder = createRenewalOrder(db, inventory, {
  renewalOfferId: renewalOffering.id,
  channelId: inventory.channelId
});
// Returns: order with orderType="renew"
```

### Track Retry Attempts
```javascript
updateOrderRetry(db, order.id, {
  retryCount: 1,
  nextRetryAt: new Date(Date.now() + 300000).toISOString(),
  retryStepName: "attachOffer"
});
```

---

## 7. Notifications with Recipient Context

### Create Notification for Sponsor
```javascript
const notification = createNotificationEventWithRecipient(
  db,
  "RENEWAL_COMPLETED",
  order,
  {
    recipientType: "sponsor",
    recipientId: sponsorId,
    payload: {
      subscriptionId: inventory.id,
      renewalAmount: 100,
      nextRenewalDate: "2024-02-15"
    }
  }
);
```

### Create Notification for Beneficiary
```javascript
const notification = createNotificationEventWithRecipient(
  db,
  "RENEWAL_COMPLETED",
  order,
  {
    recipientType: "beneficiary",
    recipientId: beneficiaryId,
    payload: {
      subscriptionId: inventory.id
    }
  }
);
```

---

## Common Workflows

### Gift Order Complete Flow
```javascript
// 1. Validate gift
validateGiftOrder(db, offering, sponsor, beneficiary);

// 2. Create order and complete it (from domain.js)
const { order } = acknowledgedOrder(db);
validateProductOrderWithSubscriberAccount(db, order.id, account);
const completed = executeProductOrderFulfillment(db, order.id, {});
const inventory = listProductInventory(db, { subscriberId: beneficiary })[0];

// 3. Create party relationship
const relationship = createPartyRelationship(db, {
  relationshipType: "sponsor",
  sponsorId: sponsor,
  beneficiaryId: beneficiary,
  subscriptionId: inventory.id,
  orderId: order.id
});

// 4. Notify both parties
createNotificationEventWithRecipient(db, "GIFT_COMPLETED", order, {
  recipientType: "sponsor",
  recipientId: sponsor
});

createNotificationEventWithRecipient(db, "GIFT_RECEIVED", order, {
  recipientType: "beneficiary",
  recipientId: beneficiary
});
```

### Renewal Flow with Scheduler
```javascript
// 1. Create renewal schedule
const schedule = createRenewalSchedule(db, {
  subscriptionId: inventory.id,
  scheduledAt: expiryDate,
  renewalOfferId: renewalOffering.id
});

// 2. Start scheduler (runs in background)
const scheduler = new RenewalScheduler(db);
scheduler.start();

// When scheduled time arrives:
// 3. Scheduler creates renewal order (can be done manually too)
const renewal = createRenewalOrder(db, inventory, {
  renewalOfferId: renewalOffering.id
});

// 4. Update schedule status
updateRenewalSchedule(db, schedule.id, {
  status: "processed",
  renewalOrderId: renewal.id,
  attemptCount: 1
});

// 5. Send notification
createNotificationEventWithRecipient(db, "RENEWAL_INITIATED", renewal, {
  recipientType: "subscriber",
  recipientId: inventory.subscriberId
});
```

---

## Segment Resolution Examples

### Single Rule
```javascript
const segment = createCustomerSegment(db, {
  name: "VIP",
  description: "VIP customers",
  resolutionRules: [
    { attributeName: "serviceClass", operator: "equals", value: "VIP" }
  ]
});
updateCustomerSegment(db, segment.id, { status: "active" });

const result = resolveSegmentFromRules(db, { serviceClass: "VIP" });
// Returns: segment.id
```

### Multiple Rules (AND logic)
```javascript
const segment = createCustomerSegment(db, {
  name: "VIP Consumer",
  description: "VIP consumers only",
  resolutionRules: [
    { attributeName: "serviceClass", operator: "equals", value: "VIP" },
    { attributeName: "segment", operator: "equals", value: "CONSUMER" }
  ]
});
updateCustomerSegment(db, segment.id, { status: "active" });

// Matches only if BOTH rules match
const result = resolveSegmentFromRules(db, {
  serviceClass: "VIP",
  segment: "CONSUMER"
});
```

### IN Operator (Multiple Values)
```javascript
const segment = createCustomerSegment(db, {
  name: "Premium Tiers",
  description: "VIP or PREMIUM customers",
  resolutionRules: [
    { attributeName: "serviceClass", operator: "in", value: ["VIP", "PREMIUM"] }
  ]
});
updateCustomerSegment(db, segment.id, { status: "active" });

const result = resolveSegmentFromRules(db, { serviceClass: "VIP" });
// Returns: segment.id (matches)
```

---

## Error Handling Example

```javascript
try {
  validateGiftOrder(db, offering, sponsor, beneficiary);
} catch (error) {
  console.log(error.status);      // HTTP status code
  console.log(error.reasonCode);  // Machine-readable code
  console.log(error.message);     // Human-readable message
  console.log(error.field);       // Field that caused error

  switch (error.reasonCode) {
    case "GIFTING_NOT_ENABLED":
      // Show user: Gifting not available for this product
      break;
    case "SELF_GIFT_NOT_ALLOWED":
      // Show user: Cannot gift to your own account
      break;
    case "MAX_GIFT_BENEFICIARIES_EXCEEDED":
      // Show user: You have reached maximum gift recipients
      break;
    case "DUPLICATE_ACTIVE_GIFT":
      // Show user: Active gift already exists for this recipient
      break;
  }
}
```

---

## Testing Examples

See `testing/sprint6.test.js` for 31 comprehensive test scenarios covering:
- Segment resolution (5 tests)
- CS attribute updates (5 tests)
- Renewal schedules (8 tests)
- Gift orders (8 tests)
- Compensation policies (5 tests)

Run tests with:
```bash
npm test testing/sprint6.test.js
```
