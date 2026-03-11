# Backend

Demo Express server with x402plus payment middleware.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Runs on `http://localhost:4000`

## Environment

```bash
PAY_TO=0xYourAddress
FACILITATOR_URL=http://localhost:5555
```

## Endpoints

- `GET /api/premium-image` - EVM payment (exact/intent)
- `GET /api/premium-image-movement` - Movement payment

See main [README](../README.md) for integration details.
