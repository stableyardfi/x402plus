# x402plus

### The missing piece of x402. Pay for any API, from any chain, with one signature.

---

HTTP 402 "Payment Required" has existed since 1999. [x402](https://www.x402.org/) finally made it real — sign a USDC transfer, attach it to your request, get the resource. No API keys. No billing. Just `GET -> 402 -> sign -> 200`.

**x402plus takes it further.** Same protocol. Same 402 flow. But now: multi-chain (EVM + Solana + Movement), gasless, with identity.

```
x402       GET /api -> 402 -> sign USDC transfer -> pay on-chain -> 200
x402plus   GET /api -> 402 -> sign intent        -> settle off-chain -> 200
```

x402plus introduces the **intent** scheme — a new payment method that complements x402's existing `exact` scheme. Both live inside the same 402 response. The client picks. The backend doesn't care.

---

## What's wrong with x402 today

x402 works. But it hits walls fast:

| Problem | What happens |
|---------|-------------|
| **Single-chain** | API wants USDC on Base. You have USDC on Polygon. Payment fails. |
| **EVM-only** | No support for Solana, Movement, or other non-EVM chains. |
| **Gas every time** | Every payment is an on-chain tx. Someone always pays gas. |
| **No identity** | You're `0x7a3b...` — no history, no reputation, no spending controls. |
| **Dead money** | USDC sits idle in your wallet between payments. Zero yield. |
| **Not agent-friendly** | AI agents can't manage budgets or pay autonomously across services. |

---

## How x402plus solves it

x402plus adds one concept: the **GRID ID**.

A GRID ID is a non-custodial smart account ([Safe](https://safe.global) vault) powered by [Stableyard](https://stableyard.fi). You deposit once. Then you sign intents — gasless, cross-chain, off-chain settled.

### The scheme in 30 seconds

```
1. Deposit USDC to your GRID ID (any chain, one time)
2. Request a paid API
   GET /api/premium -> 402 Payment Required
3. Sign an intent (one signature, zero gas)
   Facilitator gets a quote -> you sign it -> done
4. Get the resource
   GET /api/premium + X-PAYMENT -> 200 OK

Your GRID ID balance decreases. Merchant gets paid.
No gas. No bridging. No chain switching.
```

### What GRID ID unlocks

| Capability | How |
|-----------|-----|
| **Cross-chain payments** | Deposit on Polygon, pay on Base, Ethereum, Arbitrum — one balance works everywhere |
| **Zero gas** | Sign an EIP-712 intent. Stableyard settles off-chain. 10,000 payments, zero wei spent |
| **Yield on idle funds** | Deposits earn Aave APY inside the vault. Your money works between payments |
| **On-chain identity** | `yourname@stableyard` — not `0x7a3b...`. Payment history. Reputation. Limits |
| **Non-custodial** | Safe vault. Your keys. Withdraw anytime. Only signed intents can debit |
| **Agent budgets** | Fund a GRID ID -> set limits -> let your AI agent pay autonomously |

---

## Three payment schemes, one 402

Every x402plus 402 response offers **multiple** schemes and networks. Clients choose based on what they have:

```json
{
  "x402Version": 1,
  "accepts": [
    { "scheme": "exact",  "network": "polygon",   "payTo": "0x...",  "asset": "0x3c49..." },
    { "scheme": "exact",  "network": "solana-devnet", "payTo": "So1...", "asset": "4zMM...", "extra": { "feePayer": "..." } },
    { "scheme": "exact",  "network": "movement",  "payTo": "0x00...", "asset": "0x4d29..." },
    { "scheme": "intent", "network": "polygon",   "payTo": "0x...",  "facilitatorUrl": "https://..." }
  ]
}
```

| | `exact` EVM | `exact` Solana | `exact` Movement | `intent` (x402plus) |
|---|---|---|---|---|
| **Payer needs** | USDC in EVM wallet | USDC SPL in Phantom | USDC.e in Movement wallet | Funded GRID ID |
| **Signs** | EIP-3009 TransferWithAuthorization | Solana VersionedTransaction | Aptos BCS transaction | EIP-712 Stableyard intent |
| **Settlement** | On-chain (facilitator relays) | On-chain (facilitator co-signs) | On-chain (facilitator relays) | Off-chain (Stableyard) |
| **Gas** | Facilitator pays | Facilitator pays (fee payer) | Payer pays | Zero |
| **Wallet** | MetaMask, etc. | Phantom | Nightly (Movement) | MetaMask, etc. |

**Backward compatible.** Any x402 client that supports `exact` works out of the box. Solana, Movement, and `intent` schemes are additive.

---

## Get started

### Backend — monetize an API in 2 lines

```ts
import { x402plus } from "@stableyard/x402plus";

app.use(x402plus("0xYourAddress", {
  "GET /api/premium":    0.10,   // $0.10 per request
  "POST /api/generate":  5.00,   // $5.00 per generation
}));

// Your endpoint — unchanged. Only reached after payment.
app.get("/api/premium", (req, res) => {
  res.json({ data: "premium content" });
});
```

No facilitator URL. No USDC addresses. No chain config. Just a wallet address and dollar amounts.

### Multi-chain support

Add Solana and/or Movement alongside EVM:

```ts
app.use(x402plus("0xYourEVMAddress", {
  "GET /api/premium": 0.10,
}, {
  defaultChain: "polygon",
  solana: { payTo: "YourSolanaAddress" },
  movement: { payTo: "0x00...YourMovementAddress" },
}));
```

One facilitator. One endpoint. Payments from MetaMask, Phantom, and Nightly all work.

### Custom facilitator

Use any standard x402 facilitator for exact EVM payments:

```ts
app.use(x402plus("0xYourAddress", routes, "https://x402.org/facilitator"));
```

Or run your own — see [GUIDE.md](./GUIDE.md).

### Client — pay for an API

```ts
import { withPayments } from "@stableyard/x402plus/client";

const paidFetch = withPayments(window.ethereum);
const res = await paidFetch("https://api.example.com/premium");
```

See **[GUIDE.md](./GUIDE.md)** for complete integration with EVM, Solana, Movement, and Intent examples.

### Run the demo

```bash
git clone https://github.com/stableyardfi/x402plus
cd x402plus

# Terminal 1 — Facilitator
cd facilitator && npm install && npm run dev

# Terminal 2 — API server
cd backend && npm install && npm run dev

# Terminal 3 — Frontend
cd frontend && npm install && npm run dev
```

---

## GRID ID lifecycle

One-time setup. Then every payment is just sign and go.

```
 Create      ->  Activate   ->  Deposit    ->  Pay
 GRID ID         Vault          USDC           Intent
 POST            Sign Safe      Send USDC      Sign EIP-712
 /account        module tx      to deposit     per request
                                address

<--- one-time setup ---------------------->    <-- every payment
```

---

## Networks

| Network | Exact | Asset | Intent | Wallet |
|---------|-------|-------|--------|--------|
| Ethereum | Yes | USDC | Yes | MetaMask |
| Polygon | Yes | USDC | Yes | MetaMask |
| Base | Yes | USDC | Yes | MetaMask |
| Arbitrum | Yes | USDC | Yes | MetaMask |
| Optimism | Yes | USDC | Yes | MetaMask |
| Solana | Yes | USDC | -- | Phantom |
| Solana Devnet | Yes | USDC | -- | Phantom |
| Movement | Yes | USDC.e | -- | Nightly |
| Movement Testnet | Yes | USDC.e | -- | Nightly |

Native tokens (SOL, MOVE) supported via explicit opt-in: `{ solanaPrice: 0.001, movementPrice: 1.0 }`.

---

## How x402plus compares

| | x402 | **x402plus** |
|---|---|---|
| **Protocol** | HTTP 402 | **HTTP 402 (extends x402)** |
| **Cross-chain** | No | **Yes — any chain** |
| **Multi-VM** | EVM only | **EVM + Solana + Movement** |
| **Gas** | Per payment | **Zero (intent) / Facilitator pays (exact)** |
| **Yield** | No | **Aave APY** |
| **Identity** | `0x...` | **GRID ID** |
| **Custody** | Self (wallet) | **Self (Safe vault)** |
| **Backend setup** | Complex | **2 lines** |
| **x402 compatible** | -- | **Yes** |

---

## Architecture

```
                      x402plus (scheme)

  exact (EVM)     exact (Solana)     exact (Movement)
  EIP-3009        TransferChecked    USDC.e / MOVE
       |                |                 |
       +--------+-------+---------+-------+
                |
         intent (x402plus)
         EIP-712 Stableyard settlement
                |
   facilitator.stableyard.fi
   (single URL — all chains)

   Internally routes per chain:
     EVM      -> native or proxy
     Solana   -> native or proxy
     Movement -> native or proxy

     Stableyard
     GRID ID - Settlement - Yield - Identity
```

**x402plus** is the scheme — open, composable, anyone can implement it.

**Stableyard** is the infrastructure — GRID ID vaults, cross-chain settlement, yield, identity.

---

## Project structure

```
packages/x402plus/   SDK — middleware, types, facilitator client, multi-chain support
facilitator/         Reference facilitator (single URL, routes all chains)
backend/             Demo API server
frontend/            Demo UI with EVM + Solana + Movement wallets + GRID ID flow
```

## Environment Variables

### Backend

```env
PAY_TO=0xYourEVMAddress

# Optional
NETWORK=base                    # default chain (default: base)
SOLANA_PAY_TO=YourSolanaAddress  # enables Solana support
MOVEMENT_PAY_TO=0xYourMoveAddr   # enables Movement support
```

### Facilitator

```env
STABLEYARD_BASE_URL=https://api.stableyard.fi
STABLEYARD_APP_ID=your-app-id
STABLEYARD_APP_SECRET=your-app-secret
FACILITATOR_PRIVATE_KEY=0x...

# Optional chain proxies
SOLANA_PROXY_URL=https://x402.org/facilitator
EVM_PROXY_URL=https://x402.org/facilitator
```

## Learn more

- **[GUIDE.md](./GUIDE.md)** — Integration guide for backend and frontend developers
- **[x402.org](https://www.x402.org/)** — The base x402 protocol
- **[Stableyard](https://stableyard.fi)** — GRID ID infrastructure
- **[Safe](https://safe.global)** — Smart account standard

## License

Apache-2.0

---

<p align="center">
  <strong>x402plus</strong> — extending x402 with cross-chain intents<br/>
  Settlement infrastructure by <a href="https://stableyard.fi">Stableyard</a>
</p>
