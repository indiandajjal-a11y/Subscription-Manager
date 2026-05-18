export function createStore() {
  return {
    productSpecifications: new Map(),
    productOfferings: new Map(),
    shoppingCarts: new Map(),
    productOrders: new Map(),
    orderValidationResults: new Map(),
    productInventories: new Map(),
    channels: new Map(),
    channelInteractions: new Map(),
    compensationConfigs: new Map(),
    compensationRecords: new Map(),
    notificationEvents: new Map(),
    // Sprint 4 additions
    subscriberAccounts: new Map(),
    channelAuthTokens: new Map(),
    revokedTokens: new Set(), // In-memory revocation cache (cleared on restart)
    authTokenRateLimitBuckets: new Map(),
    cancellationEligibilityResults: new Map(),
    chargingResolutionRecords: new Map(),
    // Sprint 6 additions
    customerSegments: new Map(),
    renewalSchedules: new Map(),
    partyRelationships: new Map(),
    // Sprint 7 additions
    communicationTemplates: new Map(),
    notificationDispatchRecords: new Map(),
    currencyConfigs: new Map(),
    staffNumberLinks: new Map(),
    // Sprint 8 additions
    parties: new Map(),
    dormantCleanupRequests: new Map(),
    bonusDetectionConfigs: new Map(),
    bonusDetectionRecords: new Map(),
    tickProvisioningRules: new Map(),
    tariffMigrationRequests: new Map(),
    // Sprint 9 additions
    customerPreferences: new Map(),
    simUpgradeRateLimits: new Map(),
    simUpgradeEvents: new Map(),
    simUpgradeConfigs: new Map(),
    subscriberPins: new Map(),
    transferLimits: new Map(),
    creditTransferRequests: new Map(),
    pinAttemptLogs: new Map(),
    idempotencyRecords: new Map()
  };
}

export const store = createStore();
