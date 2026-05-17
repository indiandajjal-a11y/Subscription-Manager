# Subscription Manager

A backend system for managing ISP subscriptions, product catalogs,
shopping carts, and orders using TMF Open APIs.

This project implements foundational TMF APIs for telecom subscription
lifecycle management, supporting extensible integration with channels
like USSD, SMS, CRM, partners, and self-care platforms.

------------------------------------------------------------------------

## Features

-   TMF620 Product Catalog (ProductSpecification, ProductOffering,
    Pricing)
-   TMF663 Shopping Cart management
-   TMF622 Product Order lifecycle
-   TMF637-style Product Inventory
-   In-memory and PostgreSQL storage support
-   Modular architecture for multi-channel integration

------------------------------------------------------------------------

## Installation

``` powershell
npm.cmd install
```

------------------------------------------------------------------------

## Run

``` powershell
cd "C:\Subscription Manager"
npm.cmd start
```

The API runs on:

    http://localhost:3000

To change port:

``` powershell
$env:PORT=3001
```

------------------------------------------------------------------------

## PostgreSQL Setup

### 1. Create database and apply schema

``` powershell
psql "$env:DATABASE_URL" -f database/001_sprint1_tmf_foundation.sql
```

### 2. Run with PostgreSQL

``` powershell
$env:DATABASE_URL = "postgres://user:password@localhost:5432/subscription_manager"
$env:STORAGE_PROVIDER = "postgres"
npm.cmd start
```

------------------------------------------------------------------------

## Test

``` powershell
cd "C:\Subscription Manager"
npm.cmd test
```

------------------------------------------------------------------------

## Configuration

-   SUPPORTED_CURRENCIES → default: USD,INR,NGN,JPY
-   CART_TTL_MINUTES → default: 30

------------------------------------------------------------------------

## Persistence

Supports: - In-memory storage (default) - PostgreSQL persistence

------------------------------------------------------------------------

## API Examples

### Base URL

    http://localhost:3000

### Create Product Offering

POST /productOffering

``` json
{
  "name": "Basic Internet Plan",
  "description": "Unlimited data plan",
  "productSpecification": {
    "id": "spec-001"
  },
  "productOfferingPrice": [
    {
      "priceType": "recurring",
      "price": {
        "amount": 499,
        "currency": "INR"
      }
    }
  ]
}
```

------------------------------------------------------------------------

### Create Shopping Cart

POST /shoppingCart

``` json
{
  "relatedParty": [
    {
      "id": "cust-001",
      "role": "customer"
    }
  ]
}
```

------------------------------------------------------------------------

### Create Product Order

POST /productOrder

``` json
{
  "relatedParty": [
    {
      "id": "cust-001",
      "role": "customer"
    }
  ],
  "orderItem": [
    {
      "productOffering": {
        "id": "off-123"
      },
      "quantity": 1
    }
  ]
}
```

------------------------------------------------------------------------

## Project Structure

    code/           
    database/       
    documentation/  
    testing/        

------------------------------------------------------------------------

## License

This project is for educational purposes.
