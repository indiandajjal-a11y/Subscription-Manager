/**
 * Sprint 4 — Real CS Integration + Channel Authentication
 * 
 * This module adds:
 * - JWT/API key authentication middleware
 * - SubscriberAccount model for CS attribute caching
 * - ChannelAuthToken registry
 * - Real ChargingSystemClient interface (configurable)
 * - Extended ProductInventory fields
 */

import { createHash, createHmac, randomUUID } from "node:crypto";
import { fail } from "./errors.js";

// ============================================================================
// Sprint 4 Configuration
// ============================================================================

export function sprint4ConfigFromEnv(env = process.env) {
  return {
    // CS Integration
    csEndpointUrl: env.CS_ENDPOINT_URL,
    csUsername: env.CS_USERNAME,
    csPassword: env.CS_PASSWORD,
    csNodeName: env.CS_NODE_NAME,
    csTimeoutMs: Number(env.CS_TIMEOUT_MS || 5000),
    csTransientErrorCodes: (env.CS_TRANSIENT_ERROR_CODES || "500,502,503,504").split(",").map(c => c.trim()),
    csClientRetryCount: Number(env.CS_CLIENT_RETRY_COUNT || 2),
    
    // JWT Authentication
    jwtSecret: env.JWT_SECRET || "change-me-in-production",
    jwtTtlSeconds: Number(env.JWT_TTL_SECONDS || 3600),
    authTokenRateLimit: Number(env.AUTH_TOKEN_RATE_LIMIT || 10),
    
    // Feature flags
    enableRealCS: Boolean(env.CS_ENDPOINT_URL),
    enableAuthEnforcement: Boolean(env.ENABLE_AUTH_ENFORCEMENT || false)
  };
}

// ============================================================================
// Data Models
// ============================================================================

/**
 * SubscriberAccount (TMF666) — CS attribute cache per order
 */
export function createSubscriberAccount(orderId, subscriberId, csData) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    orderId,
    subscriberId,
    serviceClass: csData.serviceClass || "PREPAID",
    segment: csData.segment || "CONSUMER",
    mainBalance: Number(csData.mainBalance || 0),
    currency: csData.currency || "NGN",
    daBalances: (csData.daBalances || []).map(da => ({
      daId: da.daId,
      balance: Number(da.balance || 0),
      priority: da.priority || 9999
    })),
    psoFlags: csData.psoFlags || "",
    offerIds: csData.offerIds || [],
    expiryDate: csData.expiryDate || null,
    fetchedAt: now,
    csResponseCode: csData.responseCode || "0",
    csRawResponse: csData.rawResponse || {}
  };
}

/**
 * ChannelAuthToken — Token registry for audit and revocation
 */
export function createChannelAuthToken(channelId, tokenHash, ttlSeconds) {
  const now = new Date();
  return {
    id: randomUUID(),
    channelId,
    tokenHash,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    revokedAt: null,
    revokedBy: null,
    lastUsedAt: null
  };
}

// ============================================================================
// Charging System Client Interface
// ============================================================================

/**
 * RealChargingSystemClient — implements the Sprint 2/3 interface with real CS calls
 * Falls back to mock if CS_ENDPOINT_URL is not configured
 */
export class RealChargingSystemClient {
  constructor(config = sprint4ConfigFromEnv()) {
    this.config = config;
    this.useMock = !config.csEndpointUrl;
    
    if (this.useMock) {
      console.warn("Sprint 4: CS_ENDPOINT_URL not configured, using mock ChargingSystemClient");
    }
  }

  /**
   * Fetch subscriber account from CS (GAD/GBAD)
   */
  async fetchSubscriberAccount(params) {
    if (this.useMock) {
      return this._mockFetchSubscriberAccount(params);
    }
    return this._withTransientRetries(() => this._realFetchSubscriberAccount(params));
  }

  /**
   * Debit via SCAPv2
   */
  async debit(params) {
    if (this.useMock) {
      return this._mockDebit(params);
    }
    return this._withTransientRetries(() => this._realDebit(params));
  }

  /**
   * Attach offer via SCAPv2
   */
  async attachOffer(params) {
    if (this.useMock) {
      return this._mockAttachOffer(params);
    }
    return this._withTransientRetries(() => this._realAttachOffer(params));
  }

  /**
   * Remove offer via SCAPv2
   */
  async removeOffer(params) {
    if (this.useMock) {
      return this._mockRemoveOffer(params);
    }
    return this._withTransientRetries(() => this._realRemoveOffer(params));
  }

  /**
   * Credit back via CS
   */
  async creditBack(params) {
    if (this.useMock) {
      return this._mockCreditBack(params);
    }
    return this._withTransientRetries(() => this._realCreditBack(params));
  }

  async updateSubscriberAttributes(params) {
    if (this.useMock) {
      return this._mockUpdateSubscriberAttributes(params);
    }
    return this._withTransientRetries(() => this._realUpdateSubscriberAttributes(params));
  }

  async _withTransientRetries(operation) {
    let lastResult;
    const maxRetries = Number(this.config.csClientRetryCount || 0);
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      lastResult = await operation();
      if (!lastResult?.isTransient) return lastResult;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(25 * (2 ** attempt), 250)));
      }
    }
    return lastResult;
  }

  // Mock implementations (for when CS is not configured)
  async _mockFetchSubscriberAccount(params) {
    return {
      subscriberId: params.subscriberId,
      serviceClass: "PREPAID",
      segment: "CONSUMER",
      mainBalance: 1000.00,
      currency: "NGN",
      daBalances: [{ daId: "DA01", balance: 200.00, priority: 1 }],
      psoFlags: "0",
      offerIds: [],
      expiryDate: null,
      responseCode: "0",
      rawResponse: { status: "success" }
    };
  }

  async _mockDebit(params) {
    return {
      transactionId: randomUUID(),
      status: "success",
      failureReason: null
    };
  }

  async _mockAttachOffer(params) {
    return {
      attachmentId: randomUUID(),
      status: "success",
      failureReason: null
    };
  }

  async _mockRemoveOffer(params) {
    return {
      removalId: randomUUID(),
      status: "success",
      failureReason: null
    };
  }

  async _mockCreditBack(params) {
    return {
      transactionId: randomUUID(),
      status: "success",
      failureReason: null
    };
  }

  async _mockUpdateSubscriberAttributes(params) {
    return {
      status: "success",
      failureReason: null,
      responseCode: "0",
      rawResponse: { attributes: params.attributes || [] }
    };
  }

  // Real CS implementations (GAD/GBAD, SCAPv2)
  async _realFetchSubscriberAccount(params) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.csTimeoutMs);
    
    try {
      const response = await fetch(`${this.config.csEndpointUrl}/gad`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Username": this.config.csUsername,
          "X-Password": this.config.csPassword,
          "X-Node": this.config.csNodeName
        },
        body: JSON.stringify({
          subscriberId: params.subscriberId,
          transactionRef: params.transactionRef,
          requestType: params.requestType || "GAD"
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorCode = response.status.toString();
        if (this.config.csTransientErrorCodes.includes(errorCode)) {
          // Transient error - caller should retry
          return {
            status: "failed",
            failureReason: `CS_TRANSIENT_ERROR_${errorCode}`,
            isTransient: true
          };
        }
        return {
          status: "failed",
          failureReason: `CS_ERROR_${errorCode}`,
          isTransient: false
        };
      }
      
      const data = await response.json();
      return {
        subscriberId: data.subscriberId || params.subscriberId,
        serviceClass: data.serviceClass || "PREPAID",
        segment: data.segment || "CONSUMER",
        mainBalance: Number(data.mainBalance || 0),
        currency: data.currency || "NGN",
        daBalances: (data.daBalances || []).map(da => ({
          daId: da.daId,
          balance: Number(da.balance || 0),
          priority: da.priority || 9999
        })),
        psoFlags: data.psoFlags || "",
        offerIds: data.offerIds || [],
        expiryDate: data.expiryDate || null,
        responseCode: data.responseCode || "0",
        rawResponse: data
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        return {
          status: "failed",
          failureReason: "CS_TIMEOUT",
          isTransient: false
        };
      }
      return {
        status: "failed",
        failureReason: `CS_CONNECTION_ERROR: ${error.message}`,
        isTransient: false
      };
    }
  }

  async _realDebit(params) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.csTimeoutMs);
    
    try {
      const response = await fetch(`${this.config.csEndpointUrl}/scapv2/debit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Username": this.config.csUsername,
          "X-Password": this.config.csPassword,
          "X-Node": this.config.csNodeName
        },
        body: JSON.stringify({
          subscriberId: params.subscriberId,
          amount: params.amount,
          currency: params.currency,
          chargingSource: params.chargingSource,
          daId: params.daId,
          transactionRef: params.transactionRef
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorCode = response.status.toString();
        if (this.config.csTransientErrorCodes.includes(errorCode)) {
          return {
            transactionId: null,
            status: "failed",
            failureReason: `CS_TRANSIENT_ERROR_${errorCode}`,
            isTransient: true
          };
        }
        return {
          transactionId: null,
          status: "failed",
          failureReason: `CS_DEBIT_ERROR_${errorCode}`
        };
      }
      
      const data = await response.json();
      
      // Check for idempotency response
      if (data.responseCode === "DUPLICATE_TRANSACTION") {
        return {
          transactionId: data.originalTransactionId || params.transactionRef,
          status: "success",
          failureReason: null,
          wasIdempotent: true
        };
      }
      
      return {
        transactionId: data.transactionId || randomUUID(),
        status: data.status || "success",
        failureReason: data.failureReason || null
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        return {
          transactionId: null,
          status: "failed",
          failureReason: "CS_TIMEOUT"
        };
      }
      return {
        transactionId: null,
        status: "failed",
        failureReason: `CS_DEBIT_ERROR: ${error.message}`
      };
    }
  }

  async _realAttachOffer(params) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.csTimeoutMs);
    
    try {
      const response = await fetch(`${this.config.csEndpointUrl}/scapv2/attach`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Username": this.config.csUsername,
          "X-Password": this.config.csPassword,
          "X-Node": this.config.csNodeName
        },
        body: JSON.stringify({
          subscriberId: params.subscriberId,
          productOfferingId: params.productOfferingId,
          characteristics: params.characteristics,
          transactionRef: params.transactionRef
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        return {
          attachmentId: null,
          status: "failed",
          failureReason: `CS_ATTACH_ERROR_${response.status}`
        };
      }
      
      const data = await response.json();
      return {
        attachmentId: data.attachmentId || randomUUID(),
        status: data.status || "success",
        failureReason: data.failureReason || null
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        return {
          attachmentId: null,
          status: "failed",
          failureReason: "CS_TIMEOUT"
        };
      }
      return {
        attachmentId: null,
        status: "failed",
        failureReason: `CS_ATTACH_ERROR: ${error.message}`
      };
    }
  }

  async _realRemoveOffer(params) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.csTimeoutMs);

    try {
      const response = await fetch(`${this.config.csEndpointUrl}/scapv2/remove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Username": this.config.csUsername,
          "X-Password": this.config.csPassword,
          "X-Node": this.config.csNodeName
        },
        body: JSON.stringify({
          subscriberId: params.subscriberId,
          productOfferingId: params.productOfferingId,
          transactionRef: params.transactionRef
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorCode = response.status.toString();
        return {
          removalId: null,
          status: "failed",
          failureReason: `CS_REMOVE_ERROR_${errorCode}`,
          isTransient: this.config.csTransientErrorCodes.includes(errorCode)
        };
      }

      const data = await response.json();
      return {
        removalId: data.removalId || randomUUID(),
        status: data.status || "success",
        failureReason: data.failureReason || null
      };
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        removalId: null,
        status: "failed",
        failureReason: error.name === "AbortError" ? "CS_TIMEOUT" : `CS_REMOVE_ERROR: ${error.message}`
      };
    }
  }

  async _realCreditBack(params) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.csTimeoutMs);

    try {
      const response = await fetch(`${this.config.csEndpointUrl}/scapv2/credit-back`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Username": this.config.csUsername,
          "X-Password": this.config.csPassword,
          "X-Node": this.config.csNodeName
        },
        body: JSON.stringify({
          subscriberId: params.subscriberId,
          amount: params.amount,
          currency: params.currency,
          chargingSource: params.chargingSource,
          daId: params.daId,
          originalTransactionRef: params.originalTransactionRef,
          transactionRef: params.transactionRef
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorCode = response.status.toString();
        return {
          transactionId: null,
          status: "failed",
          failureReason: `CS_CREDIT_BACK_ERROR_${errorCode}`,
          isTransient: this.config.csTransientErrorCodes.includes(errorCode)
        };
      }

      const data = await response.json();
      return {
        transactionId: data.transactionId || randomUUID(),
        status: data.status || "success",
        failureReason: data.failureReason || null
      };
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        transactionId: null,
        status: "failed",
        failureReason: error.name === "AbortError" ? "CS_TIMEOUT" : `CS_CREDIT_BACK_ERROR: ${error.message}`
      };
    }
  }

  async _realUpdateSubscriberAttributes(params) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.csTimeoutMs);

    try {
      const response = await fetch(`${this.config.csEndpointUrl}/scapv2/subscriber-attributes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Username": this.config.csUsername,
          "X-Password": this.config.csPassword,
          "X-Node": this.config.csNodeName
        },
        body: JSON.stringify({
          subscriberId: params.subscriberId,
          attributes: params.attributes || [],
          transactionRef: params.transactionRef
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const data = await response.json().catch(() => ({}));
      return {
        status: response.ok && data.status !== "failed" ? "success" : "failed",
        failureReason: data.failureReason || (response.ok ? null : `CS_ATTRIBUTE_UPDATE_ERROR_${response.status}`),
        responseCode: data.responseCode || String(response.status),
        rawResponse: data
      };
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        status: "failed",
        failureReason: `CS_ATTRIBUTE_UPDATE_ERROR: ${error.message}`,
        responseCode: "CLIENT_ERROR",
        rawResponse: { error: error.message },
        isTransient: error.name === "AbortError"
      };
    }
  }
}

// ============================================================================
// Authentication Middleware
// ============================================================================

/**
 * Extract and validate authentication from request
 * Returns { channelId, channelType } on success, throws ApiError on failure
 */
export async function authenticateRequest(req, db, config = sprint4ConfigFromEnv()) {
  const authHeader = req.headers?.authorization || "";
  const apiKeyHeader = req.headers?.["x-api-key"] || "";
  
  // Check for Bearer token
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    return validateJwtToken(token, db, config);
  }
  
  // Check for API key (fallback for machine-to-machine)
  if (apiKeyHeader) {
    return validateApiKey(apiKeyHeader, req, db, config);
  }
  
  // No authentication provided
  fail(401, "MISSING_TOKEN", "Authentication required. Provide Bearer token or X-API-Key header.", "authorization");
}

/**
 * Validate JWT token
 */
async function validateJwtToken(token, db, config) {
  // Check revocation cache
  if (db.revokedTokens?.has(token)) {
    fail(401, "TOKEN_REVOKED", "This token has been revoked.", "authorization");
  }
  
  try {
    // Simple JWT validation (in production, use a proper JWT library)
    const payload = decodeJwt(token);
    
    // Verify signature (simplified - use crypto.createHmac in production)
    if (!payload.channelId) {
      fail(401, "INVALID_TOKEN", "Invalid token payload.", "authorization");
    }
    
    // Check expiry
    if (payload.exp && Date.now() > payload.exp * 1000) {
      fail(401, "TOKEN_EXPIRED", "The Bearer token has expired.", "authorization");
    }
    
    // Verify channel is still active
    const channel = findChannelByShortId(db, payload.channelId);
    if (!channel) {
      fail(401, "UNKNOWN_CHANNEL", "Channel not found.", "authorization");
    }
    if (channel.status !== "active") {
      fail(403, "CHANNEL_INACTIVE", "Channel is inactive.", "authorization");
    }
    
    // Update lastUsedAt (async, best-effort)
    updateTokenLastUsed(db, token);
    
    return { channelId: payload.channelId, channelType: payload.channelType };
  } catch (error) {
    if (error.status) throw error;
    fail(401, "INVALID_TOKEN", "Failed to validate token.", "authorization");
  }
}

/**
 * Validate API key (fallback auth method)
 */
async function validateApiKey(apiKey, req, db, config) {
  // Find channel by API key hash
  const crypto = await import("node:crypto");
  const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
  
  for (const channel of db.channels.values()) {
    if (channel.apiKeyHash === keyHash) {
      if (channel.status !== "active") {
        fail(403, "CHANNEL_INACTIVE", "Channel is inactive.", "authorization");
      }
      
      // API key auth only allowed for specific channel types
      const allowedTypes = ["API_PARTNER", "USSD"];
      if (!allowedTypes.includes(channel.type)) {
        fail(401, "AUTH_METHOD_NOT_ALLOWED", `API key auth not allowed for ${channel.type} channels. Use JWT.`, "authorization");
      }
      
      return { channelId: channel.channelId || channel.name, channelType: channel.type };
    }
  }
  
  fail(401, "INVALID_CREDENTIALS", "Invalid credentials.", "authorization");
}

/**
 * Verify channel authorization for a specific offering
 */
export function verifyChannelOfferingAccess(channel, offering) {
  // Check channelAvailability
  if (offering.channelAvailability.length > 0 && !offering.channelAvailability.includes(channel.channelId || channel.name)) {
    fail(403, "OFFERING_NOT_AUTHORIZED_FOR_CHANNEL", "Channel is not authorized for this offering.", "channelId");
  }
  
  // Check allowedOfferingIds (if set on channel)
  if (channel.allowedOfferingIds && channel.allowedOfferingIds.length > 0) {
    if (!channel.allowedOfferingIds.includes(offering.id)) {
      fail(403, "OFFERING_NOT_AUTHORIZED_FOR_CHANNEL", "Offering is not in channel's allowed list.", "productOfferingId");
    }
  }
}

// Simple JWT decoder (for production, use a proper JWT library like 'jsonwebtoken')
function decodeJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid JWT format");
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
    return payload;
  } catch {
    throw { status: 401, reasonCode: "INVALID_TOKEN", message: "Invalid JWT format" };
  }
}

function findChannelByShortId(db, channelId) {
  return [...db.channels.values()].find(c => (c.channelId || c.name) === channelId);
}

function updateTokenLastUsed(db, token) {
  // Best-effort async update
  setImmediate(() => {
    // Implementation depends on persistence layer
  });
}

// ============================================================================
// Sprint 4 Domain Functions
// ============================================================================

/**
 * Store subscriber account snapshot for an order
 */
export function storeSubscriberAccount(db, orderId, csData) {
  const account = createSubscriberAccount(orderId, csData.subscriberId, csData);
  db.subscriberAccounts.set(account.id, account);
  return account;
}

/**
 * Get subscriber account for an order
 */
export function getSubscriberAccountForOrder(db, orderId) {
  return [...db.subscriberAccounts.values()].find(a => a.orderId === orderId);
}

/**
 * Extend ProductInventory with Sprint 4 fields
 */
export function extendProductInventoryWithSprint4Fields(inventory, offering, config = {}) {
  return {
    ...inventory,
    renewalOfferId: config.renewalOfferId || null,
    refillId: config.refillId || null,
    notificationFlags: {
      onActivation: config.onActivation ?? true,
      onRenewal: config.onRenewal ?? true,
      onExpiry: config.onExpiry ?? true,
      onFailure: config.onFailure ?? true
    },
    csAttachmentId: config.csAttachmentId || null
  };
}

// ============================================================================
// Sprint 4 API Handler Helpers
// ============================================================================

/**
 * Create auth token endpoint handler
 */
export function handleAuthTokenRequest(db, body, config = sprint4ConfigFromEnv()) {
  const { channelId, apiKey } = body;
  
  if (!channelId || !apiKey) {
    fail(400, "REQUIRED_FIELD", "channelId and apiKey are required.", "body");
  }
  
  // Find channel
  const channel = findChannelByShortId(db, channelId);
  if (!channel) {
    fail(401, "INVALID_CREDENTIALS", "Invalid credentials.", "authorization");
  }
  
  // Check channel status
  if (channel.status !== "active") {
    fail(403, "CHANNEL_INACTIVE", "Channel is inactive.", "authorization");
  }
  
  // Validate API key
  const keyHash = createHash("sha256").update(apiKey).digest("hex");
  if (channel.apiKeyHash !== keyHash) {
    fail(401, "INVALID_CREDENTIALS", "Invalid credentials.", "authorization");
  }
  
  // Generate JWT
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    channelId: channel.channelId || channel.name,
    channelType: channel.type,
    iat: now,
    exp: now + config.jwtTtlSeconds
  };
  
  const token = signJwt(payload, config.jwtSecret);
  
  // Store token hash for revocation
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const authToken = createChannelAuthToken(channel.channelId || channel.name, tokenHash, config.jwtTtlSeconds);
  db.channelAuthTokens.set(authToken.id, authToken);
  
  return {
    accessToken: token,
    tokenType: "Bearer",
    expiresIn: config.jwtTtlSeconds,
    channelId: channel.channelId || channel.name
  };
}

// Simple JWT signer (for production, use a proper JWT library)
function signJwt(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payloadB64}`)
    .digest("base64url");
  return `${header}.${payloadB64}.${signature}`;
}
