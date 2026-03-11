# x402plus

### Pay for any API, from any chain, with one signature.

x402plus extends the [x402](https://www.x402.org/) protocol with multi-chain support (EVM, Solana, Movement) and intent-based gasless payments via Stableyard GRID ID.

```
x402       GET /api -> 402 -> sign USDC transfer -> pay on-chain -> 200
x402plus   GET /api -> 402 -> sign intent        -> settle off-chain -> 200
```

## Install

```bash
npm install @stableyard/x402plus
```

## Backend — monetize an API in 2 lines

```ts
import { x402plus } from "@stableyard/x402plus";

app.use(x402plus("0xYourAddress", {
  "GET /api/premium":    0.10,   // $0.10 per request
  "POST /api/generate":  5.00,   // $5.00 per generation
}));
```

No facilitator URL needed. No USDC addresses. No chain config. Just a wallet address and dollar amounts.

### Multi-chain support

```ts
app.use(x402plus("0xYourAddress", {
  "GET /api/premium": 0.10,
}, {
  defaultChain: "polygon",
  solana: { payTo: "YourSolanaAddress" },
  movement: { payTo: "0x00...YourMovementAddress" },
}));
```

### Custom facilitator

```ts
app.use(x402plus("0xYourAddress", routes, "https://your-facilitator.com"));
```

## Client — pay for an API

```ts
import { withPayments } from "@stableyard/x402plus/client";

const paidFetch = withPayments(window.ethereum);
const res = await paidFetch("https://api.example.com/premium");
```

## Payment schemes

Every 402 response offers multiple schemes. Clients choose based on what they have:

| | `exact` EVM | `exact` Solana | `exact` Movement | `intent` (GRID ID) |
|---|---|---|---|---|
| **Signs** | EIP-3009 | Solana Transaction | Aptos BCS | EIP-712 intent |
| **Settlement** | On-chain | On-chain | On-chain | Off-chain |
| **Gas** | Facilitator pays | Facilitator pays | Payer pays | Zero |

## Networks

| Network | Exact | Intent | Asset |
|---------|-------|--------|-------|
| Ethereum, Base, Polygon, Arbitrum, Optimism | Yes | Yes | USDC |
| Solana, Solana Devnet | Yes | -- | USDC / SOL |
| Movement, Movement Testnet | Yes | -- | USDC.e / MOVE |

## Exports

```ts
// Middleware (backend)
import { x402plus } from "@stableyard/x402plus";

// Client (frontend)
import { withPayments, createGridClient } from "@stableyard/x402plus/client";

// Types
import type { PaymentRequirements, Signer } from "@stableyard/x402plus/types";

// Facilitator client
import { createHttpFacilitatorClient } from "@stableyard/x402plus/facilitator";
```

## Debug

Set `DEBUG_X402=true` to enable verbose logging.

## Links

- [x402.org](https://www.x402.org/) — The base x402 protocol
- [Stableyard](https://stableyard.fi) — GRID ID infrastructure
- [Integration Guide](https://github.com/stableyardfi/x402plus/blob/main/GUIDE.md)

## License

Apache-2.0
