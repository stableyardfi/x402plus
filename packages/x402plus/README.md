# x402plus

Cross-chain API payments via signed intents. Pre-fund once, pay anywhere, no gas per payment.

The x402plus scheme defines a payment flow where users deposit funds into an account, then authorize payments by signing intents. The scheme is account-agnostic - this SDK works with any compliant facilitator.

## Install

```bash
npm install x402plus
```

## Backend

```ts
import { x402Paywall } from "x402plus";

app.use(
  x402Paywall(process.env.PAY_TO, {
    "GET /api/premium": {
      network: "polygon",
      asset: "USDC",
      maxAmountRequired: "1000000",
      description: "Premium API"
    }
  }, { url: "https://your-facilitator.com" })
);
```

## Client

```ts
import { withX402Fetch, createEvmSigner, createFacilitatorClient } from "x402plus";

// Auto-handle 402 responses
const signer = createEvmSigner(window.ethereum);
const fetchWithPayment = withX402Fetch(fetch, { signer });
const res = await fetchWithPayment("/api/premium");

// Account management
const fac = createFacilitatorClient({ url: "https://your-facilitator.com" });
const account = await fac.account({ userAddress: "0x..." });
const balance = await fac.balance({ userAddress: "0x..." });
```

## Intent Signing

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

## Networks

`ethereum` `polygon` `base` `polygon-amoy` `base-sepolia` `movement` `movement-testnet`

## Exports

```ts
// Middleware
import { x402Paywall, createPaywall } from "x402plus";

// Client
import { withX402Fetch, createEvmSigner, createMovementSigner } from "x402plus";

// Facilitator
import { createFacilitatorClient } from "x402plus";
```

## License

MIT
