import { createStore } from "./store.js";

function iso(value) {
  return value ? new Date(value).toISOString() : value;
}

function dateOnly(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : undefined;
}

function nullableNumber(value, fallback = null) {
  const candidate = value ?? fallback;
  return candidate === null || candidate === undefined ? null : Number(candidate);
}

export async function createPostgresPersistence(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required when PostgreSQL persistence is enabled.");
  }

  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString });

  return {
    pool,
    async load() {
      return loadStore(pool);
    },
    async save(db) {
      return saveStore(pool, db);
    },
    async close() {
      await pool.end();
    }
  };
}

async function loadStore(pool) {
  const db = createStore();
  const client = await pool.connect();
  try {
    const [
      specs,
      characteristics,
      offerings,
      prices,
      rules,
      carts,
      items,
      orders,
      orderItems,
      orderValidationResults,
      fulfillmentSteps,
      inventories,
      channels,
      interactions
    ] = await Promise.all([
      client.query("SELECT * FROM product_specifications ORDER BY created_at"),
      client.query("SELECT * FROM product_specification_characteristics ORDER BY id"),
      client.query("SELECT * FROM product_offerings ORDER BY created_at"),
      client.query("SELECT * FROM product_offering_prices ORDER BY id"),
      client.query("SELECT * FROM eligibility_rules ORDER BY id"),
      client.query("SELECT * FROM shopping_carts ORDER BY created_at"),
      client.query("SELECT * FROM cart_items ORDER BY id"),
      client.query("SELECT * FROM product_orders ORDER BY created_at"),
      client.query("SELECT * FROM product_order_items ORDER BY id"),
      client.query("SELECT * FROM order_validation_results ORDER BY validated_at"),
      client.query("SELECT * FROM fulfillment_step_records ORDER BY executed_at"),
      client.query("SELECT * FROM product_inventories ORDER BY created_at"),
      client.query("SELECT * FROM channels ORDER BY created_at"),
      client.query("SELECT * FROM channel_interactions ORDER BY created_at")
    ]);

    for (const row of specs.rows) {
      db.productSpecifications.set(row.id, {
        id: row.id,
        name: row.name,
        version: row.version,
        description: row.description ?? undefined,
        status: row.status,
        characteristics: [],
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at)
      });
    }
    for (const row of characteristics.rows) {
      db.productSpecifications.get(row.product_specification_id)?.characteristics.push({
        id: row.id,
        name: row.name,
        valueType: row.value_type,
        value: row.value,
        unit: row.unit ?? undefined
      });
    }

    for (const row of offerings.rows) {
      db.productOfferings.set(row.id, {
        id: row.id,
        name: row.name,
        status: row.status,
        productSpecificationId: row.product_specification_id,
        prices: [],
        eligibilityRules: [],
        channelAvailability: row.channel_availability || [],
        sunsetDate: dateOnly(row.sunset_date),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at)
      });
    }
    for (const row of prices.rows) {
      db.productOfferings.get(row.product_offering_id)?.prices.push({
        id: row.id,
        productOfferingId: row.product_offering_id,
        priceType: row.price_type,
        amount: Number(row.amount),
        currency: row.currency,
        chargingSource: row.charging_source,
        daId: row.da_id ?? undefined,
        priority: row.priority ?? undefined,
        parentPriceId: row.parent_price_id ?? undefined,
        discountType: row.discount_type ?? undefined,
        discountValue: row.discount_value === null ? undefined : Number(row.discount_value),
        eligibilityCondition: row.eligibility_condition ?? undefined,
        isDefault: row.is_default
      });
    }
    for (const row of rules.rows) {
      db.productOfferings.get(row.product_offering_id)?.eligibilityRules.push({
        id: row.id,
        ruleType: row.rule_type,
        operator: row.operator,
        value: row.value,
        failureReasonCode: row.failure_reason_code
      });
    }

    for (const row of carts.rows) {
      db.shoppingCarts.set(row.id, {
        id: row.id,
        channelId: row.channel_id,
        subscriberId: row.subscriber_id,
        currency: row.currency,
        status: row.status,
        items: [],
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        expiresAt: iso(row.expires_at)
      });
    }
    for (const row of items.rows) {
      db.shoppingCarts.get(row.cart_id)?.items.push({
        id: row.id,
        cartId: row.cart_id,
        productOfferingId: row.product_offering_id,
        quantity: row.quantity,
        purchasePolicy: row.purchase_policy,
        beneficiaryId: row.beneficiary_id ?? undefined,
        pricedAmount: row.priced_amount === null ? null : Number(row.priced_amount),
        pricedCurrency: row.priced_currency,
        validationStatus: row.validation_status,
        validationReasonCode: row.validation_reason_code
      });
    }

    for (const row of orders.rows) {
      db.productOrders.set(row.id, {
        id: row.id,
        cartId: row.cart_id,
        subscriberId: row.subscriber_id,
        channelId: row.channel_id,
        currency: row.currency,
        orderType: row.order_type ?? "provision",
        status: row.status,
        failureReasonCode: row.failure_reason_code,
        failureMessage: row.failure_message,
        validationStatus: row.validation_status ?? "pending",
        validationReasonCode: row.validation_reason_code,
        totalAmount: row.total_amount === null || row.total_amount === undefined ? 0 : Number(row.total_amount),
        items: [],
        stateHistory: row.state_history || [],
        fulfillment: row.fulfillment || {
          chargingStatus: "pending",
          provisioningStatus: "pending",
          failureReasonCode: null
        },
        fulfillmentSteps: [],
        compensation: row.compensation || undefined,
        validatedAt: iso(row.validated_at),
        completedAt: iso(row.completed_at),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at)
      });
    }
    for (const row of orderItems.rows) {
      db.productOrders.get(row.order_id)?.items.push({
        id: row.id,
        orderId: row.order_id,
        cartItemId: row.cart_item_id,
        productOfferingId: row.product_offering_id,
        quantity: row.quantity,
        purchasePolicy: row.purchase_policy,
        beneficiaryId: row.beneficiary_id ?? undefined,
        pricedAmount: nullableNumber(row.priced_amount, row.amount),
        pricedCurrency: row.priced_currency ?? row.currency,
        amount: nullableNumber(row.amount, row.priced_amount),
        currency: row.currency ?? row.priced_currency,
        status: row.status,
        fulfillmentStatus: row.fulfillment_status,
        failureReasonCode: row.failure_reason_code
      });
    }
    for (const row of orderValidationResults.rows) {
      const validation = {
        id: row.id,
        orderId: row.order_id,
        channelValid: row.channel_valid,
        subscriberEligible: row.subscriber_eligible,
        offeringAvailable: row.offering_available,
        balanceSufficient: row.balance_sufficient,
        overallValid: row.overall_valid,
        failureReasonCodes: row.failure_reason_codes || [],
        validatedAt: iso(row.validated_at)
      };
      db.orderValidationResults.set(row.order_id, validation);
      const order = db.productOrders.get(row.order_id);
      if (order) order.validationResult = validation;
    }
    for (const row of fulfillmentSteps.rows) {
      db.productOrders.get(row.order_id)?.fulfillmentSteps.push({
        id: row.id,
        orderId: row.order_id,
        stepName: row.step_name,
        status: row.status,
        requestPayload: row.request_payload || {},
        responsePayload: row.response_payload || {},
        executedAt: iso(row.executed_at),
        failureReason: row.failure_reason
      });
    }
    for (const row of inventories.rows) {
      db.productInventories.set(row.id, {
        id: row.id,
        productOrderId: row.product_order_id,
        orderItemId: row.order_item_id,
        subscriberId: row.subscriber_id,
        sponsorId: row.sponsor_id ?? undefined,
        channelId: row.channel_id,
        productOfferingId: row.product_offering_id,
        quantity: row.quantity,
        status: row.status,
        activatedAt: iso(row.activated_at),
        expiresAt: iso(row.expires_at),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at)
      });
    }
    for (const row of channels.rows) {
      db.channels.set(row.id, {
        id: row.id,
        name: row.name,
        type: row.type,
        status: row.status,
        externalId: row.external_id ?? undefined,
        callbackUrl: row.callback_url ?? undefined,
        metadata: row.metadata || {},
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at)
      });
    }
    for (const row of interactions.rows) {
      db.channelInteractions.set(row.id, {
        id: row.id,
        channelId: row.channel_id,
        channelType: row.channel_type,
        requestType: row.request_type,
        subscriberId: row.subscriber_id,
        productOfferingId: row.product_offering_id,
        cartId: row.cart_id ?? undefined,
        cartItemId: row.cart_item_id ?? undefined,
        orderId: row.order_id ?? undefined,
        status: row.status,
        reasonCode: row.reason_code ?? undefined,
        metadata: row.metadata || {},
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at)
      });
    }
    return db;
  } finally {
    client.release();
  }
}

async function saveStore(pool, db) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM product_inventories");
    await client.query("DELETE FROM fulfillment_step_records");
    await client.query("DELETE FROM order_validation_results");
    await client.query("DELETE FROM product_order_items");
    await client.query("DELETE FROM product_orders");
    await client.query("DELETE FROM channel_interactions");
    await client.query("DELETE FROM channels");
    await client.query("DELETE FROM cart_items");
    await client.query("DELETE FROM shopping_carts");
    await client.query("DELETE FROM eligibility_rules");
    await client.query("DELETE FROM product_offering_prices");
    await client.query("DELETE FROM product_offerings");
    await client.query("DELETE FROM product_specification_characteristics");
    await client.query("DELETE FROM product_specifications");

    for (const spec of db.productSpecifications.values()) {
      await client.query(
        `INSERT INTO product_specifications (id, name, version, description, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [spec.id, spec.name, spec.version, spec.description ?? null, spec.status, spec.createdAt, spec.updatedAt]
      );
      for (const characteristic of spec.characteristics) {
        await client.query(
          `INSERT INTO product_specification_characteristics (id, product_specification_id, name, value_type, value, unit)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [characteristic.id, spec.id, characteristic.name, characteristic.valueType, characteristic.value, characteristic.unit ?? null]
        );
      }
    }

    for (const offering of db.productOfferings.values()) {
      await client.query(
        `INSERT INTO product_offerings (id, name, status, product_specification_id, channel_availability, sunset_date, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [offering.id, offering.name, offering.status, offering.productSpecificationId, offering.channelAvailability, offering.sunsetDate ?? null, offering.createdAt, offering.updatedAt]
      );
      for (const price of offering.prices) {
        await client.query(
          `INSERT INTO product_offering_prices (
            id, product_offering_id, price_type, amount, currency, charging_source, da_id, priority,
            parent_price_id, discount_type, discount_value, eligibility_condition, is_default
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            price.id,
            offering.id,
            price.priceType,
            price.amount,
            price.currency,
            price.chargingSource,
            price.daId ?? null,
            price.priority ?? null,
            price.parentPriceId ?? null,
            price.discountType ?? null,
            price.discountValue ?? null,
            price.eligibilityCondition ?? null,
            price.isDefault
          ]
        );
      }
      for (const rule of offering.eligibilityRules) {
        await client.query(
          `INSERT INTO eligibility_rules (id, product_offering_id, rule_type, operator, value, failure_reason_code)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [rule.id, offering.id, rule.ruleType, rule.operator, rule.value, rule.failureReasonCode]
        );
      }
    }

    for (const cart of db.shoppingCarts.values()) {
      await client.query(
        `INSERT INTO shopping_carts (id, channel_id, subscriber_id, currency, status, created_at, updated_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [cart.id, cart.channelId, cart.subscriberId, cart.currency, cart.status, cart.createdAt, cart.updatedAt, cart.expiresAt]
      );
      for (const item of cart.items) {
        await client.query(
          `INSERT INTO cart_items (
            id, cart_id, product_offering_id, quantity, purchase_policy, beneficiary_id,
            priced_amount, priced_currency, validation_status, validation_reason_code
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            item.id,
            cart.id,
            item.productOfferingId,
            item.quantity,
            item.purchasePolicy,
            item.beneficiaryId ?? null,
            item.pricedAmount,
            item.pricedCurrency,
            item.validationStatus,
            item.validationReasonCode
          ]
        );
      }
    }

    for (const order of db.productOrders.values()) {
      await client.query(
        `INSERT INTO product_orders (
          id, cart_id, subscriber_id, channel_id, currency, order_type, status, failure_reason_code, failure_message,
          validation_status, validation_reason_code, total_amount, state_history, fulfillment, compensation,
          validated_at, completed_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          order.id,
          order.cartId,
          order.subscriberId,
          order.channelId,
          order.currency,
          order.orderType || "provision",
          order.status,
          order.failureReasonCode,
          order.failureMessage,
          order.validationStatus,
          order.validationReasonCode,
          order.totalAmount,
          JSON.stringify(order.stateHistory || []),
          JSON.stringify(order.fulfillment || {}),
          JSON.stringify(order.compensation || null),
          order.validatedAt,
          order.completedAt,
          order.createdAt,
          order.updatedAt
        ]
      );
      if (order.validationResult) {
        await client.query(
          `INSERT INTO order_validation_results (
            id, order_id, channel_valid, subscriber_eligible, offering_available,
            balance_sufficient, overall_valid, failure_reason_codes, validated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            order.validationResult.id,
            order.id,
            order.validationResult.channelValid,
            order.validationResult.subscriberEligible,
            order.validationResult.offeringAvailable,
            order.validationResult.balanceSufficient,
            order.validationResult.overallValid,
            order.validationResult.failureReasonCodes,
            order.validationResult.validatedAt
          ]
        );
      }
      for (const step of order.fulfillmentSteps || []) {
        await client.query(
          `INSERT INTO fulfillment_step_records (
            id, order_id, step_name, status, request_payload, response_payload, executed_at, failure_reason
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            step.id,
            order.id,
            step.stepName,
            step.status,
            JSON.stringify(step.requestPayload || {}),
            JSON.stringify(step.responsePayload || {}),
            step.executedAt,
            step.failureReason
          ]
        );
      }
      for (const item of order.items || []) {
        await client.query(
          `INSERT INTO product_order_items (
            id, order_id, cart_item_id, product_offering_id, quantity, purchase_policy, beneficiary_id,
            priced_amount, priced_currency, amount, currency, status, fulfillment_status, failure_reason_code
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            item.id,
            order.id,
            item.cartItemId,
            item.productOfferingId,
            item.quantity,
            item.purchasePolicy,
            item.beneficiaryId ?? null,
            item.pricedAmount,
            item.pricedCurrency,
            item.amount,
            item.currency,
            item.status,
            item.fulfillmentStatus,
            item.failureReasonCode
          ]
        );
      }
    }

    for (const inventory of db.productInventories.values()) {
      await client.query(
        `INSERT INTO product_inventories (
          id, product_order_id, order_item_id, subscriber_id, sponsor_id, channel_id,
          product_offering_id, quantity, status, activated_at, expires_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          inventory.id,
          inventory.productOrderId,
          inventory.orderItemId,
          inventory.subscriberId,
          inventory.sponsorId ?? null,
          inventory.channelId,
          inventory.productOfferingId,
          inventory.quantity,
          inventory.status,
          inventory.activatedAt,
          inventory.expiresAt ?? null,
          inventory.createdAt,
          inventory.updatedAt
        ]
      );
    }

    for (const channel of db.channels.values()) {
      await client.query(
        `INSERT INTO channels (id, name, type, status, external_id, callback_url, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          channel.id,
          channel.name,
          channel.type,
          channel.status,
          channel.externalId ?? null,
          channel.callbackUrl ?? null,
          JSON.stringify(channel.metadata || {}),
          channel.createdAt,
          channel.updatedAt
        ]
      );
    }

    for (const interaction of db.channelInteractions.values()) {
      await client.query(
        `INSERT INTO channel_interactions (
          id, channel_id, channel_type, request_type, subscriber_id, product_offering_id,
          cart_id, cart_item_id, order_id, status, reason_code, metadata, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          interaction.id,
          interaction.channelId,
          interaction.channelType,
          interaction.requestType,
          interaction.subscriberId,
          interaction.productOfferingId,
          interaction.cartId ?? null,
          interaction.cartItemId ?? null,
          interaction.orderId ?? null,
          interaction.status,
          interaction.reasonCode ?? null,
          JSON.stringify(interaction.metadata || {}),
          interaction.createdAt,
          interaction.updatedAt
        ]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
