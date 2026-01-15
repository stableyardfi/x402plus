# x402plus Integration Guide

A practical guide for integrating x402plus payments into your application.

## For Backend Developers

Accept x402plus payments in your API.

### 1. Install

```bash
npm install x402plus
```

### 2. Add Middleware

```typescript
import express from "express";
import { x402Paywall } from "x402plus";

const app = express();

// Your receiving address
const PAY_TO = "0xYourWalletAddress";

// Configure protected endpoints
app.use(
  x402Paywall(PAY_TO, {
    "GET /api/premium": {
      network: "polygon",
      asset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // USDC on Polygon
      maxAmountRequired: "1000000", // $1.00 (6 decimals)
      description: "Premium API access",
      mimeType: "application/json",
      maxTimeoutSeconds: 120
    },
    "POST /api/generate": {
      network: "polygon",
      asset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      maxAmountRequired: "5000000", // $5.00
      description: "AI generation endpoint",
      mimeType: "application/json",
      maxTimeoutSeconds: 120
    }
  }, {
    url: "https://facilitator.stableyard.fi"
  })
);

// Your endpoints (only reached after payment)
app.get("/api/premium", (req, res) => {
  res.json({ data: "Premium content", payer: req.headers["x-payer"] });
});

app.post("/api/generate", (req, res) => {
  res.json({ result: "Generated content" });
});

app.listen(3000);
```

### 3. How It Works

```
Client Request (no payment)
    ↓
Middleware returns 402 + payment requirements
    ↓
Client signs intent + retries with X-PAYMENT header
    ↓
Middleware calls facilitator /verify
    ↓
Middleware calls facilitator /settle
    ↓
Your endpoint receives the request
```

### 4. Accessing Payer Info

After successful payment, the payer's address is available:

```typescript
app.get("/api/premium", (req, res) => {
  const payer = req.headers["x-payer"];
  console.log(`Paid by: ${payer}`);
  res.json({ data: "Premium content" });
});
```

### 5. Network Options

| Network | Asset (USDC) | Chain ID |
|---------|--------------|----------|
| `polygon` | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | 137 |
| `base` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 8453 |
| `polygon-amoy` | `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` | 80002 |
| `base-sepolia` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | 84532 |

---

## For Client/Frontend Developers

Pay for x402plus protected APIs.

### 1. Setup Account

Before making payments, users need a funded account.

```typescript
const FACILITATOR_URL = "https://facilitator.stableyard.fi";

// Create account
async function setupAccount(userAddress: string) {
  const response = await fetch(`${FACILITATOR_URL}/account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userAddress })
  });

  const data = await response.json();

  console.log("Vault Address:", data.accountAddress);     // User's vault on Polygon
  console.log("Deposit Address:", data.depositAddress);   // Send USDC here
  console.log("Activated:", data.activated);

  return data;
}

// Check balance
async function checkBalance(userAddress: string) {
  const response = await fetch(`${FACILITATOR_URL}/balance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userAddress })
  });

  const data = await response.json();
  console.log("Balance:", data.totalUsd);
  return data;
}
```

### 2. Fund Account

Send USDC to the `depositAddress` returned from `/account`. Supported chains:
- Ethereum Mainnet
- Polygon
- Base
- Other EVM chains

Funds are automatically bridged to the user's vault.

### 3. Make Payments

#### Option A: Manual Flow

```typescript
async function payForAPI(userAddress: string, apiUrl: string) {
  // Step 1: Get payment requirements
  const initialResponse = await fetch(apiUrl);

  if (initialResponse.status !== 402) {
    return initialResponse; // No payment needed
  }

  const requirements = await initialResponse.json();
  const accepts = requirements.accepts[0];

  // Step 2: Build and sign intent
  const authorization = {
    from: userAddress,
    to: accepts.payTo,
    value: accepts.maxAmountRequired,
    validAfter: Math.floor(Date.now() / 1000) - 60,
    validBefore: Math.floor(Date.now() / 1000) + 120,
    nonce: "0x" + crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""),
    destinationChainID: 2,
    destinationToken: "USDC"
  };

  const domain = {
    name: "settlement",
    version: "1",
    chainId: 137 // Polygon
  };

  const types = {
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
  };

  // Sign with wallet (e.g., MetaMask)
  const signature = await window.ethereum.request({
    method: "eth_signTypedData_v4",
    params: [userAddress, JSON.stringify({
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" }
        ],
        ...types
      },
      domain,
      primaryType: "PaymentAuthorization",
      message: authorization
    })]
  });

  // Step 3: Build X-PAYMENT header
  const payload = {
    x402Version: 1,
    scheme: "intent",
    network: accepts.network,
    payload: {
      signature,
      authorization,
      domain,
      types
    }
  };

  const xPayment = btoa(JSON.stringify(payload));

  // Step 4: Retry with payment
  const paidResponse = await fetch(apiUrl, {
    headers: { "X-PAYMENT": xPayment }
  });

  return paidResponse;
}
```

#### Option B: Using SDK Helper

```typescript
import { createFacilitatorClient } from "x402plus";

const facilitator = createFacilitatorClient({
  url: "https://facilitator.stableyard.fi"
});

// Check balance
const balance = await facilitator.balance({ userAddress: "0x..." });

// Create account if needed
if (!balance.accountExists) {
  const account = await facilitator.account({ userAddress: "0x..." });
  console.log("Deposit to:", account.depositAddress);
}
```

### 4. React Example

```tsx
import { useState } from "react";

const FACILITATOR = "https://facilitator.stableyard.fi";

function PaymentButton({ apiUrl }: { apiUrl: string }) {
  const [status, setStatus] = useState<string>("idle");

  async function handlePay() {
    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts"
    });
    const userAddress = accounts[0];

    setStatus("checking");

    // Check balance
    const balanceRes = await fetch(`${FACILITATOR}/balance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userAddress })
    });
    const balance = await balanceRes.json();

    if (parseFloat(balance.totalUsd) < 1) {
      setStatus("insufficient");
      return;
    }

    setStatus("paying");

    // Get requirements
    const req = await fetch(apiUrl);
    if (req.status !== 402) {
      setStatus("done");
      return;
    }

    const { accepts } = await req.json();
    const accept = accepts[0];

    // Sign intent
    const authorization = {
      from: userAddress,
      to: accept.payTo,
      value: accept.maxAmountRequired,
      validAfter: Math.floor(Date.now() / 1000) - 60,
      validBefore: Math.floor(Date.now() / 1000) + 120,
      nonce: "0x" + [...Array(64)].map(() => Math.floor(Math.random() * 16).toString(16)).join(""),
      destinationChainID: 2,
      destinationToken: "USDC"
    };

    const signature = await window.ethereum.request({
      method: "eth_signTypedData_v4",
      params: [userAddress, JSON.stringify({
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
        domain: { name: "settlement", version: "1", chainId: 137 },
        primaryType: "PaymentAuthorization",
        message: authorization
      })]
    });

    // Send payment
    const xPayment = btoa(JSON.stringify({
      x402Version: 1,
      scheme: "intent",
      network: accept.network,
      payload: { signature, authorization, domain: { name: "settlement", version: "1", chainId: 137 }, types: {} }
    }));

    const result = await fetch(apiUrl, {
      headers: { "X-PAYMENT": xPayment }
    });

    setStatus(result.ok ? "done" : "failed");
  }

  return (
    <button onClick={handlePay} disabled={status === "paying"}>
      {status === "idle" && "Pay & Access"}
      {status === "checking" && "Checking balance..."}
      {status === "insufficient" && "Insufficient balance"}
      {status === "paying" && "Processing..."}
      {status === "done" && "Paid!"}
      {status === "failed" && "Failed - Retry"}
    </button>
  );
}
```

---

## Facilitator API Reference

Base URL: `https://facilitator.stableyard.fi`

### POST /account

Create or retrieve user's Money Account.

```bash
curl -X POST https://facilitator.stableyard.fi/account \
  -H "Content-Type: application/json" \
  -d '{"userAddress": "0x..."}'
```

Response:
```json
{
  "activated": true,
  "accountAddress": "0x...",
  "depositAddress": "0x...",
  "balance": { "totalUsd": "10.00" }
}
```

### POST /balance

Check user balance.

```bash
curl -X POST https://facilitator.stableyard.fi/balance \
  -H "Content-Type: application/json" \
  -d '{"userAddress": "0x..."}'
```

Response:
```json
{
  "accountExists": true,
  "totalUsd": "10.00"
}
```

### POST /verify

Validate payment intent (called by middleware).

### POST /settle

Execute payment (called by middleware).

---

## Testing

Use testnet for development:

```typescript
// Backend - use testnet network
app.use(
  x402Paywall(PAY_TO, {
    "GET /api/test": {
      network: "polygon-amoy",  // Testnet
      asset: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
      maxAmountRequired: "1000000",
      description: "Test endpoint"
    }
  }, {
    url: "https://facilitator.stableyard.fi"
  })
);
```

Get testnet USDC from faucets:
- Polygon Amoy: https://faucet.polygon.technology/
- Base Sepolia: https://www.alchemy.com/faucets/base-sepolia

---

## Troubleshooting

**"Insufficient balance"**
- Check balance via `/balance` endpoint
- Ensure funds are deposited to `depositAddress`
- Wait for deposit confirmation (~2-5 minutes)

**"Invalid signature"**
- Ensure domain name is `"settlement"`
- Check chainId matches network
- Verify nonce is 32 bytes hex

**"Payment expired"**
- `validBefore` timestamp has passed
- Increase timeout or sign again

**402 not returning**
- Middleware not applied to route
- Check route pattern matches exactly

---

## Support

- Specification: [SPEC.md](./SPEC.md)
- GitHub: https://github.com/stableyardfi/x402plus
