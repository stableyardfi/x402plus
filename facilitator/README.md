# Facilitator

Reference facilitator implementation using Stableyard Money Accounts.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Runs on `http://localhost:5555`

## Environment

```bash
STABLEYARD_BASE_URL=https://stableyard-backend.up.railway.app
STABLEYARD_SDK_KEY=your-key
STABLEYARD_ORIGIN=http://localhost:3000
STABLEYARD_PARTNER_ID=your-partner-id
FACILITATOR_PRIVATE_KEY=0x...
MOVE_RPC=https://mainnet.movementnetwork.xyz/v1
```

## Endpoints

- `POST /verify` - Validate payment
- `POST /settle` - Execute payment
- `POST /balance` - Check balance
- `POST /account` - Create Money Account
- `POST /deploy-module` - Activate vault

See [SPEC.md](../SPEC.md) for API details.
