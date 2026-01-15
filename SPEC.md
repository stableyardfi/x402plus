# x402plus Scheme Specification

> **Version 1.0**

x402plus is an open payment scheme that extends HTTP 402 to enable cross-chain, gasless API payments. Users pre-fund an account once, then authorize payments by signing intents.

## Overview

The scheme defines:

1. **Intent format** - EIP-712 PaymentAuthorization structure
2. **Facilitator API** - Standard endpoints (`/verify`, `/settle`, `/balance`, `/account`)
3. **402 challenge format** - How merchants request payment
4. **X-PAYMENT header** - How clients send signed intents

The scheme is **account-agnostic**. How user funds are held is an implementation detail.

### Profiles

A "profile" defines how the underlying account works:

| Profile | Description |
|---------|-------------|
| `money-account` | Safe-based vaults (reference implementation uses Stableyard) |
| `custodial` | Centralized balance tracking |
| `mpc` | Multi-party computation wallets |
| Custom | Any system that can verify balance and execute transfers |

This specification describes the scheme. The reference implementation in this repo uses the `money-account` profile via Stableyard.

## Core Concepts

### Participants

| Role | Description |
|------|-------------|
| **User** | Entity making payments. Has a wallet and a pre-funded account. |
| **Merchant** | API provider requiring payment. Sends 402 challenges. |
| **Facilitator** | Verifies intents, checks balance, executes settlement. |
| **Account** | User's pre-funded balance (implementation varies by profile). |

### Payment Flow

```
1. Client requests protected resource
   GET /api/resource

2. Server returns 402 Payment Required
   { x402Version: 1, accepts: [PaymentRequirements] }

3. Client signs intent (EIP-712, gasless)

4. Client retries with X-PAYMENT header

5. Facilitator verifies intent + checks balance
   Returns { isValid: true, payer }

6. Facilitator settles payment
   Returns { success: true, transaction }

7. Server returns resource
```

## 402 Response Format

When payment is required, servers MUST return:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact" | "intent",
      "network": "<network-id>",
      "asset": "<token-address-or-symbol>",
      "maxAmountRequired": "<amount-in-smallest-unit>",
      "payTo": "<merchant-address>",
      "resource": "<resource-url>",
      "description": "<human-readable-description>",
      "mimeType": "<expected-response-mime-type>",
      "maxTimeoutSeconds": <timeout>,
      "outputSchema": { ... },
      "extra": { ... }
    }
  ],
  "error": "<optional-error-message>",
  "payer": "<payer-address-after-payment>"
}
```

### PaymentRequirements Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scheme` | string | Yes | `"exact"` (x402 standard) or `"intent"` (x402plus) |
| `network` | string | Yes | Network identifier (e.g., `"polygon"`, `"polygon-amoy"`, `"movement"`) |
| `asset` | string | Yes | Token contract address |
| `maxAmountRequired` | string | Yes | Amount in smallest unit (e.g., `"1000000"` for $1 USDC) |
| `payTo` | string | Yes | Merchant's receiving address |
| `resource` | string | Yes | Full URL of the protected resource |
| `description` | string | Yes | Human-readable description |
| `mimeType` | string | Yes | Expected response MIME type |
| `maxTimeoutSeconds` | number | Yes | Maximum time for payment completion |
| `outputSchema` | object | No | Input/output schema for the endpoint |
| `extra` | object | No | Additional scheme-specific data |

---

## X-PAYMENT Header Format

Clients send payment via the `X-PAYMENT` header as base64-encoded JSON:

```
X-PAYMENT: <base64(JSON.stringify(PaymentPayload))>
```

### PaymentPayload Structure (Intent Scheme)

```typescript
{
  x402Version: 1,
  scheme: "intent",
  network: string,
  resource: string,
  payload: {
    signature: string,           // EIP-712 signature
    format: "eip712",
    authorization: {
      from: string,              // payer address
      to: string,                // merchant address (must match payTo)
      value: string,             // amount in smallest unit
      validAfter: number,        // unix timestamp
      validBefore: number,       // unix timestamp
      nonce: string,             // 32-byte hex for replay protection
      destinationChainID: number, // destination chain for settlement
      destinationToken: string   // token symbol (e.g., "USDC")
    },
    domain: {
      name: "settlement",        // MUST be "settlement" for Stableyard
      version: "1",
      chainId: number
    },
    types: {
      PaymentAuthorization: [...]
    },
    primaryType: "PaymentAuthorization"
  }
}
```

### PaymentPayload Structure (Exact Scheme - EVM)

```typescript
{
  x402Version: 1,
  scheme: "exact",
  network: string,
  payload: {
    signature: string,           // EIP-712 signature
    authorization: {
      from: string,
      to: string,
      value: string,
      validAfter: string,
      validBefore: string,
      nonce: string
    }
  }
}
```

### PaymentPayload Structure (Exact Scheme - Movement)

```typescript
{
  x402Version: 1,
  scheme: "exact",
  network: "movement" | "movement-mainnet" | "movement-testnet",
  payload: {
    signature: string,           // Base64 BCS-encoded authenticator
    transaction: string          // Base64 BCS-encoded transaction
  }
}
```

---

## Facilitator API Specification

Facilitators MUST implement these endpoints:

### POST /verify

Validates payment intent structure and checks user has sufficient balance.

**Request:**
```json
{
  "x402Version": 1,
  "paymentPayload": {
    "scheme": "intent",
    "payload": {
      "signature": "0x...",
      "authorization": {
        "from": "0x...",
        "to": "0x...",
        "value": "1000000",
        "validAfter": 0,
        "validBefore": 9999999999,
        "nonce": "0x...",
        "destinationChainID": 2,
        "destinationToken": "USDC"
      },
      "domain": { "name": "settlement", "version": "1", "chainId": 137 },
      "types": { ... }
    }
  },
  "paymentRequirements": {
    "payTo": "0x...",
    "maxAmountRequired": "1000000",
    "network": "polygon-amoy"
  }
}
```

**Verification Steps:**
1. Check `paymentPayload` exists
2. Check `paymentRequirements` exists with `payTo` and `maxAmountRequired`
3. Extract `authorization` and `signature` from payload
4. Validate required fields: `from`, `to`, `value`, `nonce`
5. Check time bounds: `validAfter <= now <= validBefore`
6. Check recipient: `authorization.to == paymentRequirements.payTo`
7. Check amount: `authorization.value >= paymentRequirements.maxAmountRequired`
8. **Get user from Stableyard**: `GET /sdk/v1/get-user-byaddress?address={from}`
9. **Fetch balance from Stableyard**: `POST /sdk/v1/get-balance { userId }`
10. Check balance: `userBalance >= paymentAmount` (1 USDC = 1 USD)

**Response:**
```json
{
  "isValid": true,
  "payer": "0x..."
}
```

Or on failure:
```json
{
  "isValid": false,
  "invalidReason": "Insufficient balance. Required: $1.00, Available: $0.50"
}
```

### POST /settle

Executes payment by forwarding to Stableyard.

**Request:**
```json
{
  "x402Version": 1,
  "paymentPayload": { ... },
  "paymentRequirements": { ... }
}
```

**Settlement Steps (Intent Scheme):**
1. Validate payload structure (same as verify)
2. Extract `authorization`, `signature`, `domain`, `types`
3. **Forward to Stableyard**: `POST /sdk/v1/settle`
   ```json
   {
     "payload": {
       "signature": "0x...",
       "format": "eip712",
       "authorization": {
         "from": "0x...",
         "to": "0x...",
         "value": "1000000",
         "validAfter": 0,
         "validBefore": 9999999999,
         "nonce": "0x...",
         "destinationChainID": 2,
         "destinationToken": "USDC"
       },
       "domain": {
         "name": "settlement",
         "version": "1",
         "chainId": 137
       },
       "types": {
         "PaymentAuthorization": [
           { "name": "from", "type": "address" },
           { "name": "to", "type": "address" },
           { "name": "value", "type": "uint256" },
           { "name": "validAfter", "type": "uint256" },
           { "name": "validBefore", "type": "uint256" },
           { "name": "nonce", "type": "bytes32" },
           { "name": "destinationChainID", "type": "uint256" },
           { "name": "destinationToken", "type": "string" }
         ]
       }
     }
   }
   ```
4. Return result from Stableyard

**Stableyard Response:**
```json
{
  "success": true,
  "data": "Transaction sent successfully",
  "requestId": "uuid-request-id"
}
```

**Facilitator Response:**
```json
{
  "success": true,
  "transaction": "uuid-request-id",
  "network": "polygon"
}
```

**Settlement Steps (Exact Scheme - Movement):**
1. Detect Movement network (`movement`, `movement-mainnet`, `movement-testnet`)
2. Extract `transaction` and `signature` from payload (Base64 BCS-encoded)
3. Deserialize and submit to Movement RPC
4. Return transaction hash

### POST /balance

Checks user's Money Account balance. Read-only.

**Request:**
```json
{
  "userAddress": "0x...",
  "chain": "polygon",
  "tokens": ["USDC"]
}
```

**Implementation:**
1. Get user from Stableyard by address
2. If not found, return `accountExists: false`
3. Fetch balance from Stableyard

**Response:**
```json
{
  "accountExists": true,
  "totalUsd": "10.50",
  "perToken": [
    {
      "token": "USDC",
      "chain": "polygon",
      "amount": "10500000",
      "usdValue": "10.50"
    }
  ],
  "updatedAt": "2024-01-09T12:00:00Z"
}
```

### POST /account

Creates or retrieves user's Money Account.

**Request:**
```json
{
  "userAddress": "0x...",
  "chain": "polygon",
  "token": "USDC"
}
```

**Implementation:**
1. Check if user exists via Stableyard `GET /sdk/v1/get-user-byaddress`
2. If not, create user via `POST /sdk/v1/register`
3. Create vault via `POST /sdk/v1/create-vault`
4. Generate deposit address via `POST /sdk/v1/generate` (chainId: 1 for Ethereum mainnet)
5. Fetch balance

**Response (Vault Needs Activation):**
```json
{
  "activated": false,
  "accountAddress": "0x...",
  "depositAddress": "0x...",
  "signing": {
    "vaultAddress": "0x...",
    "txData": {
      "to": "0x...",
      "data": "0x...",
      "value": "0",
      "operation": 0
    },
    "message": "Sign to activate spending module"
  },
  "balance": { ... }
}
```

**Response (Vault Activated):**
```json
{
  "activated": true,
  "accountAddress": "0x...",
  "depositAddress": "0x...",
  "chain": "polygon",
  "token": "USDC",
  "balance": {
    "totalUsd": "0.00",
    "perToken": []
  }
}
```

### POST /deploy-module

Activates the vault spending module after user signature.

**Request:**
```json
{
  "userAddress": "0x...",
  "signature": "0x...",
  "txData": {
    "to": "0x...",
    "data": "0x...",
    "value": "0",
    "operation": 0
  }
}
```

**Response:**
```json
{
  "success": true,
  "txHash": "0x..."
}
```

### POST /supported

Returns facilitator capabilities.

**Response:**
```json
{
  "x402plus": true,
  "networks": ["polygon", "polygon-amoy", "base", "base-sepolia", "movement", "movement-testnet"],
  "tokens": ["USDC"],
  "schemes": ["exact", "intent"],
  "profiles": ["money-account"]
}
```

---

## Stableyard SDK Integration

The facilitator integrates with Stableyard's Money Account SDK:

### SDK Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/sdk/v1/get-user-byaddress` | GET | Find user by wallet address |
| `/sdk/v1/register` | POST | Create new user account |
| `/sdk/v1/create-vault` | POST | Deploy Safe vault for user |
| `/sdk/v1/generate` | POST | Generate deposit address for chain |
| `/sdk/v1/get-balance` | POST | Get vault USDC balance |
| `/sdk/v1/settle` | POST | Execute EIP-712 signed payment |

### Authentication

All Stableyard requests require:

```http
x-sdk-key: <your-sdk-key>
Origin: <your-origin>
Content-Type: application/json
```

### Response Format

Stableyard wraps responses:

```json
{
  "success": true,
  "data": { ... },
  "requestId": "uuid"
}
```

### Generate Deposit Address

```bash
POST /sdk/v1/generate
{
  "userId": "user-uuid",
  "chainId": 1  # Use 1 for Ethereum mainnet deposit address
}
```

---

## Intent Signing (EIP-712)

### Domain

```typescript
{
  name: "settlement",    // MUST be "settlement" for Stableyard
  version: "1",
  chainId: 137           // Chain where signature is verified
}
```

### Types

```typescript
{
  PaymentAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "destinationChainID", type: "uint256" },
    { name: "destinationToken", type: "string" }
  ]
}
```

### Message Fields

| Field | Type | Description |
|-------|------|-------------|
| `from` | address | Payer's wallet address (signer) |
| `to` | address | Merchant's receiving address (must match `payTo`) |
| `value` | uint256 | Amount in smallest unit (e.g., 1000000 = $1 USDC) |
| `validAfter` | uint256 | Unix timestamp - authorization valid after this time |
| `validBefore` | uint256 | Unix timestamp - authorization expires after this time |
| `nonce` | bytes32 | Random 32-byte value for replay protection |
| `destinationChainID` | uint256 | Destination chain ID for cross-chain settlement |
| `destinationToken` | string | Token symbol for settlement (e.g., "USDC") |

### Signing Example

```typescript
const typedData = {
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" }
    ],
    PaymentAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "destinationChainID", type: "uint256" },
      { name: "destinationToken", type: "string" }
    ]
  },
  domain: {
    name: "settlement",
    version: "1",
    chainId: 137
  },
  primaryType: "PaymentAuthorization",
  message: {
    from: userAddress,
    to: merchantAddress,
    value: "1000000",
    validAfter: Math.floor(Date.now() / 1000) - 60,
    validBefore: Math.floor(Date.now() / 1000) + 120,
    nonce: "0x" + crypto.randomBytes(32).toString("hex"),
    destinationChainID: 2,
    destinationToken: "USDC"
  }
};

const signature = await ethereum.request({
  method: "eth_signTypedData_v4",
  params: [userAddress, JSON.stringify(typedData)]
});
```

---

## Movement Network Support

For Movement networks (`movement`, `movement-mainnet`, `movement-testnet`), the exact scheme uses Aptos-style transactions:

### Transaction Building

```typescript
import { Aptos, AptosConfig, Account } from '@aptos-labs/ts-sdk';

const isMainnet = network === 'movement' || network === 'movement-mainnet';
const rpcUrl = isMainnet
  ? 'https://mainnet.movementnetwork.xyz/v1'
  : 'https://aptos.testnet.porto.movementlabs.xyz/v1';

const config = new AptosConfig({ fullnode: rpcUrl });
const aptos = new Aptos(config);

const transaction = await aptos.transaction.build.simple({
  sender: account.accountAddress,
  data: {
    function: '0x1::aptos_account::transfer',
    functionArguments: [payTo, amount]
  }
});

const authenticator = aptos.transaction.sign({ signer: account, transaction });
```

### Payload Format

```typescript
{
  signature: base64(authenticator.bcsToBytes()),
  transaction: base64(transaction.bcsToBytes())
}
```

---

## Security Considerations

### Balance Verification

- Facilitators MUST check user balance before returning `isValid: true`
- Balance check prevents settlement failures
- Assumes 1 USDC = 1 USD for simplicity

### Replay Protection

- Nonces MUST be unique per payment
- Stableyard tracks used nonces and rejects replays
- `validAfter` and `validBefore` provide time bounds

### Signature Verification

- Stableyard verifies EIP-712 signature during `/sdk/v1/settle`
- Signer MUST match `authorization.from`
- Invalid signatures are rejected

### Amount Validation

- `authorization.value` MUST be >= `paymentRequirements.maxAmountRequired`
- `authorization.to` MUST match `paymentRequirements.payTo`

### Domain Name

- Domain name MUST be `"settlement"` for Stableyard compatibility
- Using incorrect domain name will cause signature verification to fail

---

## Implementation Checklist

For a compliant x402plus facilitator with Stableyard:

- [x] Implement `/verify` endpoint
  - [x] Validate payload structure
  - [x] Check time bounds
  - [x] Check recipient matches
  - [x] Check amount sufficient
  - [x] Fetch user from Stableyard
  - [x] Fetch balance from Stableyard
  - [x] Verify balance >= payment amount
- [x] Implement `/settle` endpoint
  - [x] Validate payload structure
  - [x] Forward to Stableyard `/sdk/v1/settle` with correct format
  - [x] Use domain name `"settlement"`
  - [x] Include `destinationChainID` and `destinationToken`
  - [x] Return `requestId` as transaction reference
- [x] Implement `/settle` for Movement networks
  - [x] Detect Movement network before EVM validation
  - [x] Deserialize BCS transaction and authenticator
  - [x] Submit to Movement RPC
- [x] Implement `/balance` endpoint
  - [x] Get user by address
  - [x] Fetch balance from Stableyard
- [x] Implement `/account` endpoint
  - [x] Register user if needed
  - [x] Create vault
  - [x] Generate deposit address (chainId: 1)
  - [x] Return vault address and deposit address
- [x] Implement `/deploy-module` endpoint
  - [x] Execute Safe transaction with user signature
- [x] Implement `/supported` endpoint
- [x] Configure Stableyard SDK credentials

---

## Environment Variables

```bash
# Facilitator
PORT=5555

# Stableyard SDK
STABLEYARD_BASE_URL=https://stableyard-backend.up.railway.app
STABLEYARD_SDK_KEY=your-sdk-key
STABLEYARD_ORIGIN=http://localhost:3000
STABLEYARD_PARTNER_ID=your-partner-id

# Movement RPC
MOVE_RPC=https://mainnet.movementnetwork.xyz/v1
```

---

## Versioning

The `x402Version` field indicates protocol version:
- **Version 1**: Current specification with Stableyard integration

---

## License

This specification is released under MIT License. Anyone can implement x402plus.
