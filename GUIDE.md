# x402plus Integration Guide

Technical guide for backend and frontend developers integrating x402plus payments.

---

## Backend Integration

Accept payments on any Express endpoint. The middleware intercepts requests, returns 402 if unpaid, and verifies/settles payments automatically.

### Install

```bash
npm install @stableyard/x402plus
```

### Simplest Setup (EVM only — 2 lines)

```ts
import express from "express";
import { x402plus } from "@stableyard/x402plus";

const app = express();

app.use(x402plus("0xYourWalletAddress", {
  "GET /api/premium": 0.10,             // $0.10 — both exact + intent
  "POST /api/generate": 5.00,           // $5.00
  "GET /api/data/:id": 0.01,            // $0.01
}));

// Your endpoints — only reached after payment
app.get("/api/premium", (req, res) => {
  res.json({ data: "premium content" });
});
```

That's it. No facilitator URL, no USDC addresses, no chain config. Defaults:
- Facilitator: `facilitator.stableyard.fi`
- Chain: Base (mainnet)
- Asset: USDC

### Multi-Chain Setup (EVM + Solana + Movement)

A single endpoint can accept payments from all supported chains:

```ts
app.use(x402plus("0xYourEVMAddress", {
  "GET /api/premium": 0.10,
}, {
  defaultChain: "polygon",

  // Solana support — just set your wallet address
  solana: {
    payTo: "YourSolanaWalletAddress",
    network: "solana-devnet",             // or "solana" for mainnet
  },

  // Movement support — just set your wallet address
  movement: {
    payTo: "0x00...YourMovementAddress",  // 0x-prefixed, 64-char hex
    network: "movement",                  // or "movement-testnet"
  },
}));
```

Everything else is automatic:
- USDC contract addresses resolved from chain name
- Solana fee payer auto-fetched from facilitator
- Movement defaults to USDC.e (bridged via LayerZero)

The 402 response includes accepts for all configured chains:
- EVM exact (MetaMask — EIP-3009 TransferWithAuthorization)
- Solana exact (Phantom — SPL TransferChecked)
- Movement exact (Nightly — primary_fungible_store transfer for USDC.e)
- Intent (GRID ID — EIP-712 Stableyard settlement)

### Custom Facilitator

Use your own facilitator or a third-party x402 facilitator:

```ts
// Custom facilitator URL
app.use(x402plus("0xYourAddress", routes, "https://your-facilitator.com"));

// Or in options
app.use(x402plus("0xYourAddress", routes, {
  facilitatorUrl: "https://your-facilitator.com",
  defaultChain: "polygon",
}));
```

Any standard x402 facilitator works for exact EVM payments — the protocol is backward compatible.

### Per-Route Options

```ts
app.use(x402plus("0xYourAddress", {
  // Default — both schemes, USDC on default chain
  "GET /api/data": 0.10,

  // Exact only — no intent scheme
  "GET /api/fast": { price: 0.01, scheme: "exact" },

  // Prefetch — embeds Stableyard quote in 402 when X-PAYER header present
  "POST /api/expensive": { price: 5.00, prefetch: true },

  // Chain override — default is "base", this route uses polygon
  "GET /api/polygon-only": { price: 1.00, chain: "polygon" },

  // Native token pricing (SOL/MOVE instead of USDC)
  // Price is in the native token, not USD — no conversion needed
  "GET /api/native": { price: 0.10, solanaPrice: 0.001, movementPrice: 1.0 },
}));
```

### Environment Variables

```env
# Required
PAY_TO=0xYourEVMWalletAddress

# Optional — all have sensible defaults
FACILITATOR_URL=https://facilitator.stableyard.fi   # default
NETWORK=base                                          # default chain

# Solana (set SOLANA_PAY_TO to enable)
SOLANA_PAY_TO=YourSolanaAddress
SOLANA_NETWORK=solana-devnet

# Movement (set MOVEMENT_PAY_TO to enable)
MOVEMENT_PAY_TO=0xYourMovementAddress
MOVEMENT_NETWORK=movement
```

### USDC Addresses (Built-In)

The SDK resolves these automatically — you never need to set them.

| Network | USDC Address | Type |
|---------|-------------|------|
| Ethereum | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | ERC-20 |
| Polygon | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | ERC-20 |
| Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | ERC-20 |
| Arbitrum | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | ERC-20 |
| Optimism | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | ERC-20 |
| Solana | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | SPL Token |
| Solana Devnet | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | SPL Token |
| Movement | `0x4d2969d384e440db9f1a51391cfc261d1ec08ee1bdf7b9711a6c05d485a4110a` | USDC.e (LayerZero OFT) |

---

## Frontend / Client Integration

Pay for x402plus protected APIs from a browser or Node.js agent.

### The Payment Flow

```
1. Request protected resource        -> GET /api/premium
2. Receive 402 with payment options  <- { accepts: [{ scheme: "exact", network: "polygon" },
                                                    { scheme: "exact", network: "solana-devnet" },
                                                    { scheme: "exact", network: "movement" },
                                                    { scheme: "intent" }] }
3. Pick a scheme based on wallet/chain
4. Sign the payment (varies by chain)
5. Retry with X-PAYMENT header       -> GET /api/premium + X-PAYMENT: base64(signed) -> 200
```

### Zero-Config Client (Recommended)

```ts
import { withPayments } from "@stableyard/x402plus/client";

// Wraps fetch with automatic 402 handling
const paidFetch = withPayments(window.ethereum);
const res = await paidFetch("https://api.example.com/premium");
const data = await res.json();
```

### GRID ID Client (Intent Payments)

```ts
import { createGridClient } from "@stableyard/x402plus/client";

const grid = createGridClient(window.ethereum, "https://facilitator.stableyard.fi");
const status = await grid.getStatus();
if (status.status !== "ready") await grid.setup();
const res = await grid.fetch("https://api.example.com/premium");
```

### Making EVM Exact Payments (Manual)

Uses standard USDC EIP-3009 `TransferWithAuthorization` — no GRID ID needed:

```ts
async function payExact(apiUrl, walletAddress) {
  const r1 = await fetch(apiUrl);
  if (r1.status !== 402) return r1;

  const { accepts } = await r1.json();
  const exact = accepts.find(a => a.scheme === "exact" && !a.network.startsWith("solana") && !a.network.startsWith("movement"));

  const now = Math.floor(Date.now() / 1000);
  const nonce = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, "0")).join("");

  // Domain info is embedded in the 402 response (extra.payload.eip712.domain)
  const domain = exact.extra?.payload?.eip712?.domain || {
    name: "USD Coin",
    version: "2",
    chainId: /* chain ID for the network */,
    verifyingContract: exact.asset,
  };

  const message = {
    from: walletAddress,
    to: exact.payTo,
    value: exact.maxAmountRequired,
    validAfter: now - 600,
    validBefore: now + 120,
    nonce,
  };

  const signature = await window.ethereum.request({
    method: "eth_signTypedData_v4",
    params: [walletAddress, JSON.stringify({
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ]
      },
      domain,
      primaryType: "TransferWithAuthorization",
      message,
    })]
  });

  const xPayment = btoa(JSON.stringify({
    x402Version: 1,
    scheme: "exact",
    network: exact.network,
    payload: { signature, authorization: message }
  }));

  return fetch(apiUrl, { headers: { "X-PAYMENT": xPayment } });
}
```

### Making Solana Exact Payments (Manual)

Uses SPL Token `TransferChecked` with the facilitator as fee payer:

```ts
import { Connection, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, SystemProgram } from "@solana/web3.js";
import { createTransferCheckedInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";

async function paySolana(apiUrl) {
  const phantom = window.phantom?.solana;
  await phantom.connect();

  const r1 = await fetch(apiUrl);
  if (r1.status !== 402) return r1;

  const { accepts } = await r1.json();
  const solAccept = accepts.find(a => a.scheme === "exact" && a.network.startsWith("solana"));

  const feePayer = new PublicKey(solAccept.extra.feePayer);
  const recipient = new PublicKey(solAccept.payTo);
  const sender = phantom.publicKey;
  const amount = BigInt(solAccept.maxAmountRequired);

  // Detect native SOL vs USDC
  const isNative = solAccept.extra?.assetType === "native";
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  let instructions;
  if (isNative) {
    // Native SOL transfer
    instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 20000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
      SystemProgram.transfer({ fromPubkey: sender, toPubkey: recipient, lamports: amount }),
    ];
  } else {
    // USDC SPL transfer
    const mint = new PublicKey(solAccept.asset);
    const senderAta = await getAssociatedTokenAddress(mint, sender);
    const recipientAta = await getAssociatedTokenAddress(mint, recipient);
    instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 20000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
      createTransferCheckedInstruction(senderAta, mint, recipientAta, sender, amount, 6, [], TOKEN_PROGRAM_ID),
    ];
  }

  const { blockhash } = await connection.getLatestBlockhash("finalized");
  const messageV0 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  const signedTx = await phantom.signTransaction(tx);
  const base64Tx = btoa(String.fromCharCode(...signedTx.serialize()));

  const xPayment = btoa(JSON.stringify({
    x402Version: 1,
    scheme: "exact",
    network: solAccept.network,
    payload: { transaction: base64Tx },
  }));

  return fetch(apiUrl, { headers: { "X-PAYMENT": xPayment } });
}
```

### Making Movement Exact Payments (Manual)

Uses Aptos BCS transaction signing. Default asset is USDC.e; native MOVE when `assetType: "native"`:

```ts
import { Aptos, AptosConfig } from "@aptos-labs/ts-sdk";
import { NightlyConnectAptosAdapter } from "@nightlylabs/wallet-selector-aptos";

async function payMovement(apiUrl) {
  const adapter = await NightlyConnectAptosAdapter.build(
    { appMetadata: { name: "MyApp", description: "My App", icon: "https://..." } },
    {}, undefined,
    { networkDataOverride: { name: "Movement", icon: "https://registry.nightly.app/networks/movement.svg" } }
  );
  await adapter.connect();

  const r1 = await fetch(apiUrl);
  if (r1.status !== 402) return r1;

  const { accepts } = await r1.json();
  const movAccept = accepts.find(a => a.scheme === "exact" && a.network.startsWith("movement"));

  const accountInfo = await adapter.account();
  const config = new AptosConfig({ fullnode: "https://full.mainnet.movementinfra.xyz/v1" });
  const aptos = new Aptos(config);

  const isNativeMove = movAccept.asset === "0x1::aptos_coin::AptosCoin" || movAccept.extra?.assetType === "native";
  let transaction;

  if (isNativeMove) {
    // Native MOVE transfer
    transaction = await aptos.transaction.build.simple({
      sender: accountInfo.address.toString(),
      data: {
        function: "0x1::aptos_account::transfer",
        functionArguments: [movAccept.payTo, movAccept.maxAmountRequired],
      },
    });
  } else {
    // USDC.e fungible asset transfer
    transaction = await aptos.transaction.build.simple({
      sender: accountInfo.address.toString(),
      data: {
        function: "0x1::primary_fungible_store::transfer",
        typeArguments: ["0x1::fungible_asset::Metadata"],
        functionArguments: [movAccept.asset, movAccept.payTo, movAccept.maxAmountRequired],
      },
    });
  }

  const signResult = await adapter.signTransaction(transaction);
  if (signResult?.status === "rejected") throw new Error("Rejected");
  const authenticator = signResult?.args ?? signResult;

  function u8ToBase64(u8) {
    let binary = "";
    for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
    return btoa(binary);
  }

  const xPayment = btoa(JSON.stringify({
    x402Version: 1,
    scheme: "exact",
    network: movAccept.network,
    payload: {
      signature: u8ToBase64(authenticator.bcsToBytes()),
      transaction: u8ToBase64(transaction.bcsToBytes()),
    },
  }));

  return fetch(apiUrl, { headers: { "X-PAYMENT": xPayment } });
}
```

### Making Intent Payments (Manual)

Once your GRID ID is funded:

```ts
async function payWithIntent(apiUrl, walletAddress, facilitatorUrl = "https://facilitator.stableyard.fi") {
  const r1 = await fetch(apiUrl);
  if (r1.status !== 402) return r1;

  const { accepts } = await r1.json();
  const intent = accepts.find(a => a.scheme === "intent");
  const facUrl = intent.facilitatorUrl || facilitatorUrl;

  // Get quote from facilitator
  const prepare = await fetch(`${facUrl}/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: walletAddress,
      to: intent.payTo,
      amount: intent.maxAmountRequired,
      network: intent.network,
    })
  }).then(r => r.json());

  if (prepare.status !== "ready") {
    throw new Error(`GRID ID not ready: ${prepare.status}`);
  }

  // Sign the EIP-712 data from Stableyard quote
  const { domain, types, message, primaryType } = prepare.eip712;

  const domainType = [];
  if (domain.name !== undefined) domainType.push({ name: "name", type: "string" });
  if (domain.version !== undefined) domainType.push({ name: "version", type: "string" });
  if (domain.chainId !== undefined) domainType.push({ name: "chainId", type: "uint256" });
  if (domain.verifyingContract !== undefined) domainType.push({ name: "verifyingContract", type: "address" });

  const signature = await window.ethereum.request({
    method: "eth_signTypedData_v4",
    params: [walletAddress, JSON.stringify({
      types: { EIP712Domain: domainType, ...types },
      domain,
      primaryType,
      message,
    })]
  });

  const xPayment = btoa(JSON.stringify({
    x402Version: 1,
    scheme: "intent",
    network: intent.network,
    payload: {
      signature,
      from: walletAddress,
      quoteId: prepare.quoteId,
      eip712: { domain, types, message, primaryType },
    }
  }));

  return fetch(apiUrl, { headers: { "X-PAYMENT": xPayment } });
}
```

---

## GRID ID Setup (One-Time)

Before using intent payments, users need a GRID ID:

```
Create -> Activate -> Deposit -> Ready
```

#### Step 1: Create GRID ID

```ts
const facilitatorUrl = "https://facilitator.stableyard.fi";

const account = await fetch(`${facilitatorUrl}/account`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userAddress: walletAddress })
}).then(r => r.json());

// account.accountAddress  — Safe vault address
// account.depositAddress  — Send USDC here to fund your GRID ID
// account.activated       — Whether vault module is deployed
```

#### Step 2: Activate (if needed)

If `account.activated` is `false`:

```ts
import Safe from "@safe-global/protocol-kit";

const protocolKit = await Safe.init({
  provider: window.ethereum,
  signer: walletAddress,
  safeAddress: account.accountAddress,
});

const safeTx = await protocolKit.createTransaction({
  transactions: [{
    to: account.signing.txData.to,
    value: account.signing.txData.value || "0",
    data: account.signing.txData.data,
    operation: account.signing.txData.operation || 0,
  }]
});

const safeTxHash = await protocolKit.getTransactionHash(safeTx);
const signature = await protocolKit.signHash(safeTxHash);

await fetch(`${facilitatorUrl}/activate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    address: walletAddress,
    signature: signature.data,
    txData: account.signing.txData,
  })
}).then(r => r.json());
```

#### Step 3: Deposit

Send USDC to the `depositAddress` on any supported chain (Polygon, Base, Ethereum, etc.).

#### Step 4: Check Balance

```ts
const balance = await fetch(`${facilitatorUrl}/balance`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userAddress: walletAddress })
}).then(r => r.json());
```

---

## X-PAYMENT Header Format

The `X-PAYMENT` header is always a base64-encoded JSON object:

### EVM Exact

```json
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "polygon",
  "payload": {
    "signature": "0x...",
    "authorization": { "from": "0x...", "to": "0x...", "value": "100000", "validAfter": "...", "validBefore": "...", "nonce": "0x..." }
  }
}
```

### Solana Exact

```json
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "solana-devnet",
  "payload": {
    "transaction": "<base64-encoded partially-signed VersionedTransaction>"
  }
}
```

### Movement Exact

```json
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "movement",
  "payload": {
    "signature": "<base64-encoded BCS AccountAuthenticator>",
    "transaction": "<base64-encoded BCS SimpleTransaction>"
  }
}
```

### Intent

```json
{
  "x402Version": 1,
  "scheme": "intent",
  "network": "polygon",
  "payload": {
    "signature": "0x...",
    "from": "0xPayerAddress",
    "quoteId": "0x...",
    "eip712": { "domain": {}, "types": {}, "message": {}, "primaryType": "..." }
  }
}
```

---

## Facilitator

The facilitator is the bridge between x402plus middleware and the settlement layer.

### Single Facilitator, All Chains

All verify/settle requests go to one URL. The facilitator routes internally per chain:

```
                  facilitator.stableyard.fi
                           |
    /verify & /settle
      |-- Solana?    -> native or SOLANA_PROXY_URL
      |-- Movement?  -> native or MOVEMENT_PROXY_URL
      |-- EVM exact? -> native or EVM_PROXY_URL
      '-- Intent?    -> Stableyard vault settlement
```

### Using an External Facilitator

x402plus is backward compatible with any standard x402 facilitator for exact EVM payments:

```ts
// Use Coinbase's x402 facilitator for EVM exact payments
app.use(x402plus("0xYourAddress", routes, "https://x402.org/facilitator"));
```

The facilitator just needs to implement `/verify` and `/settle` per the x402 spec.

### API Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/supported` | POST | Advertise capabilities (networks, tokens, schemes) |
| `/verify` | POST | Validate payment (called by middleware) |
| `/settle` | POST | Execute settlement (called by middleware) |
| `/account` | POST | Create GRID ID (register + vault) |
| `/activate` | POST | Deploy vault Zodiac module |
| `/balance` | POST | Check GRID ID balance |
| `/prepare` | POST | Get Stableyard quote + EIP-712 signing data |
| `/deposit` | POST | Get deposit address for GRID ID vault |

### Running Your Own Facilitator

```bash
cd facilitator
cp .env.example .env    # Configure credentials
npm install
npm run dev             # Starts on port 5555
```

Then point your backend to it:

```ts
app.use(x402plus("0x...", routes, { facilitatorUrl: "http://localhost:5555" }));
```

---

## Troubleshooting

**402 not appearing** — Ensure the middleware route pattern matches exactly (e.g. `"GET /api/premium"` must match your Express route).

**"Insufficient balance"** — For intent: check GRID ID balance via `/balance`, deposit USDC. For exact: ensure wallet has enough USDC.

**"GRID ID not ready"** — Complete the setup: create account -> activate -> deposit.

**"Quote expired"** — Call `/prepare` again for a fresh quote.

**"Blockhash not found"** (Solana) — Transaction expired. Retry the payment.

**"chainId should be same as current chainId"** — Switch wallet to the correct chain. For intent, switch to the chain in the EIP-712 domain (typically Polygon).

**Solana: "insufficient SOL"** — The facilitator pays gas, but you need SOL for the transfer amount if paying with native SOL. For USDC payments, ensure you have USDC in your wallet.

**Movement: wallet connect slow** — The Nightly adapter is built lazily on first use. Subsequent connections are fast.
