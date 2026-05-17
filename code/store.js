export function createStore() {
  return {
    productSpecifications: new Map(),
    productOfferings: new Map(),
    shoppingCarts: new Map(),
    productOrders: new Map(),
    orderValidationResults: new Map(),
    productInventories: new Map(),
    channels: new Map(),
    channelInteractions: new Map()
  };
}

export const store = createStore();
