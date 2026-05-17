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
    authTokenRateLimitBuckets: new Map()
  };
}

export const store = createStore();
