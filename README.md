# x402plus

Cross-chain API payments via signed intents. No gas per payment.

```
x402:     User signs tx → Facilitator relays → Service on same chain
x402plus: User signs intent → Facilitator debits pre-funded account → Service on ANY chain
```

## Why x402plus

HTTP 402 "Payment Required" has existed since 1999. It was reserved for digital payments but never standardized. Meanwhile, API monetization relies on:

- **API keys + monthly billing** — requires accounts, KYC, invoicing
- **Subscriptions** — pay for access, not usage
- **On-chain payments** — gas costs, single-chain, slow

None of these work for a world where software pays software.

x402plus enables **true pay-per-request**:

```
Any client (human, script, AI agent)
    ↓
Signs intent (one signature, no gas)
    ↓
Pays from pre-funded account
    ↓
Gets the resource
```

No API keys. No accounts. No invoices. Just payment at the protocol layer.

### The Future We're Building

As APIs become the interface between systems, payment needs to be:
- **Programmatic** — machines paying machines without human approval
- **Granular** — pay for what you use, down to single requests
- **Universal** — one account works across any service, any chain
- **Bounded** — set limits, track spend, maintain control

x402plus is infrastructure for this future. An AI agent with a funded account can autonomously pay for compute, data, and services within its budget. A developer can monetize an API with three lines of code. A user can pay once and access services across the ecosystem.

The scheme is open. Build on it.

## The Scheme

x402plus defines a payment flow where users **pre-fund an account once**, then authorize payments by signing intents (no gas). The scheme is agnostic to how the account is implemented.

| Component | What x402plus defines |
|-----------|----------------------|
| Intent format | EIP-712 PaymentAuthorization |
| Facilitator API | `/verify`, `/settle`, `/balance`, `/account` |
| Payment flow | 402 challenge → sign intent → settle |

**Profiles** are implementations of the underlying account:
- `money-account` - Safe-based vaults (this repo uses Stableyard)
- Others can implement their own (custodial, MPC, different vault systems)

## Quick Start

```bash
# Terminal 1: Facilitator
cd facilitator && npm install && npm run dev

# Terminal 2: Backend
cd backend && npm install && npm run dev

# Terminal 3: Frontend
cd frontend && npm install && npm run dev
```

## How It Works

Users fund a Money Account (Safe vault) once, then pay for any service by signing intents:

```
Client                    Server                    Facilitator
  |                         |                            |
  |-- GET /api/resource --->|                            |
  |<-- 402 + requirements --|                            |
  |                         |                            |
  |  [sign intent, no gas]  |                            |
  |                         |                            |
  |-- GET + X-PAYMENT ----->|-- /verify ---------------->|
  |                         |<-- { isValid: true } ------|
  |                         |-- /settle ---------------->|
  |                         |<-- { success: true } ------|
  |<-- 200 + resource ------|                            |
```

## Integration

### Backend

```ts
import { x402Paywall } from "x402plus";

app.use(
  x402Paywall(process.env.PAY_TO, {
    "GET /api/premium": {
      network: "polygon-amoy",
      asset: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
      maxAmountRequired: "1000000",
      description: "Premium API"
    }
  }, { url: process.env.FACILITATOR_URL })
);
```

### Client

```ts
import { createFacilitatorClient } from "x402plus";

const fac = createFacilitatorClient({ url: "http://localhost:5555" });

// Create Money Account
const account = await fac.account({ userAddress: "0x..." });
console.log(account.accountAddress);  // Vault (view on Polygonscan)
console.log(account.depositAddress);  // Send USDC here

// Check balance
const balance = await fac.balance({ userAddress: "0x..." });
```

## Networks

| Network | Scheme |
|---------|--------|
| `ethereum` | exact, intent |
| `polygon` | exact, intent |
| `base` | exact, intent |
| `polygon-amoy` | exact, intent |
| `base-sepolia` | exact, intent |
| `movement` | exact |
| `movement-testnet` | exact |

## Intent Signing

Domain must be `"settlement"` for Stableyard compatibility:

```ts
const domain = { name: "settlement", version: "1", chainId: 137 };

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
```

## Facilitator API

| Endpoint | Purpose |
|----------|---------|
| `POST /verify` | Validate intent, check balance |
| `POST /settle` | Execute payment |
| `POST /balance` | Check user balance |
| `POST /account` | Create Money Account |
| `POST /deploy-module` | Activate vault |

## Project Structure

```
packages/x402plus/   SDK (middleware, client, types)
backend/             Demo backend server
facilitator/         Facilitator implementation (Stableyard)
frontend/            Demo frontend app
SPEC.md              Full specification
```

## Attribution

Projects using x402plus are encouraged to display:

```
Powered by x402plus
```

## License

MIT
