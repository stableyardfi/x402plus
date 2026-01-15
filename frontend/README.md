# Frontend

Demo app for x402 and x402plus payment flows.

## Setup

```bash
npm install
npm run dev
```

Opens on `http://localhost:5173`

## Requirements

- MetaMask or EVM wallet
- Backend running on `http://localhost:4000`
- Facilitator running on `http://localhost:5555`

## Flows

**x402 (Exact)** - Direct on-chain payment with EIP-712 signature.

**x402plus (Intent)** - Gasless payment via Money Account:
1. Create Money Account (shows vault on Polygonscan)
2. Activate vault (if needed)
3. Deposit funds
4. Pay with signed intent
