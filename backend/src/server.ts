import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import axios from "axios";
import { x402Paywall } from "../../packages/x402plus/dist";

const app = express();

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] → ${req.method} ${req.path}`);
  if (req.headers["x-payment"]) {
    console.log(`  └─ X-PAYMENT header present (${String(req.headers["x-payment"]).length} chars)`);
  }
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ← ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`);
  });
  next();
});

function normalizeMoveAddress(addr: string): string {
  const s = String(addr || "").toLowerCase();
  const no0x = s.startsWith("0x") ? s.slice(2) : s;
  const padded = no0x.padStart(64, "0");
  return "0x" + padded;
}

app.use(
  cors({
    origin: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-PAYMENT", "X-X402-PLUS"],
    exposedHeaders: ["X-PAYMENT-RESPONSE"]
  })
);

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

// Startup ping to facilitators to aid debugging
(async () => {
  const evmFac = process.env.FACILITATOR_URL || "https://facilitator.stableyard.fi";
  const movFac = process.env.MOVEMENT_FACILITATOR_URL || process.env.FACILITATOR_URL || "https://facilitator.stableyard.fi";
  try {
    const r1 = await axios.post(`${evmFac.replace(/\/$/, "")}/supported`, {}, { timeout: 5000 });
    console.log(`[facilitator] EVM supported OK @ ${evmFac}`, r1.data);
  } catch (e: any) {
    console.log(`[facilitator] EVM supported FAIL @ ${evmFac}:`, e?.message || e);
  }
  try {
    const r2 = await axios.post(`${movFac.replace(/\/$/, "")}/supported`, {}, { timeout: 5000 });
    console.log(`[facilitator] Movement supported OK @ ${movFac}`, r2.data);
  } catch (e: any) {
    console.log(`[facilitator] Movement supported FAIL @ ${movFac}:`, e?.message || e);
  }
})();

// Apply payment middleware (EVM demo)
// Consistent USDC contract addresses - use same env vars as facilitator
const USDC_CONTRACTS: Record<string, string> = {
  "base-sepolia": process.env.BASE_USDC_CONTRACT || "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "polygon-amoy": process.env.POLYGON_USDC_CONTRACT || "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
  "base": process.env.BASE_MAINNET_USDC_CONTRACT || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "polygon": process.env.POLYGON_MAINNET_USDC_CONTRACT || "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
};

const networkId = process.env.NETWORK || "base-sepolia";
const usdcContract = process.env.ASSET || USDC_CONTRACTS[networkId] || USDC_CONTRACTS["base-sepolia"];

console.log(`[config] Network: ${networkId}`);
console.log(`[config] USDC Contract: ${usdcContract}`);
// IMPORTANT: Testnet USDC uses "USDC", mainnet Circle USDC uses "USD Coin"
console.log(`[config] EIP-712 Name: ${process.env.ASSET_EIP712_NAME || "USDC"}`);
console.log(`[config] EIP-712 Version: ${process.env.ASSET_EIP712_VERSION || "2"}`);

app.use(
  x402Paywall(
    process.env.PAY_TO as string,
    {
      "GET /api/premium-image": {
        network: networkId,
        // Use consistent contract address that matches facilitator config
        asset: usdcContract,
        maxAmountRequired: process.env.MAX_AMOUNT_REQUIRED || "1000000",
        description: "Premium image",
        mimeType: "image/jpeg",
        maxTimeoutSeconds: Number(process.env.MAX_TIMEOUT_SECONDS || 600),
        // USDC EIP-712 domain: Testnet USDC uses "USDC", mainnet Circle USDC uses "USD Coin"
        extra: { name: process.env.ASSET_EIP712_NAME || "USDC", version: process.env.ASSET_EIP712_VERSION || "2" }
      }
    },
    {
      url: process.env.FACILITATOR_URL || "https://facilitator.stableyard.fi",
      headers: (() => {
        const h: Record<string, string> = {};
        if (process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET) {
          h["CDP-API-KEY-ID"] = process.env.CDP_API_KEY_ID;
          h["CDP-API-KEY-SECRET"] = process.env.CDP_API_KEY_SECRET;
        }
        return h;
      })()
    }
  )
);

// Apply payment middleware (Movement demo - Aptos-like x402)
// Uses a separate facilitator endpoint so you can run a Movement-specific service.
app.use(
  x402Paywall(
    normalizeMoveAddress(process.env.MOVEMENT_PAY_TO || (process.env.PAY_TO as string)),
    {
      "GET /api/premium-image-movement": {
        network: process.env.MOVEMENT_NETWORK || "movement-testnet",
        // For demo, use Aptos coin type id or your Move coin type. Your facilitator will interpret this.
        asset: process.env.MOVEMENT_ASSET || "0x1::aptos_coin::AptosCoin",
        maxAmountRequired: process.env.MOVEMENT_MAX_AMOUNT_REQUIRED || "1000000",
        description: "Premium image (Movement)",
        mimeType: "image/jpeg",
        maxTimeoutSeconds: Number(process.env.MOVEMENT_MAX_TIMEOUT_SECONDS || process.env.MAX_TIMEOUT_SECONDS || 600)
      }
    },
    {
      url: process.env.MOVEMENT_FACILITATOR_URL || process.env.FACILITATOR_URL || "https://facilitator.stableyard.fi"
    }
  )
);

// Premium content (executes only after successful payment)
app.get("/api/premium-image", (_req, res) => {
  console.log(`[api/premium-image] ✅ Payment verified - serving content`);
  res.sendFile(path.resolve(process.cwd(), "premiumcontent.jpg"));
});

// Premium content (Movement-protected)
app.get("/api/premium-image-movement", (_req, res) => {
  console.log(`[api/premium-image-movement] ✅ Payment verified - serving content`);
  res.sendFile(path.resolve(process.cwd(), "premiumcontent.jpg"));
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`\n╔════════════════════════════════════════════════════════════════╗`);
  console.log(`║  x402plus Backend Demo                                         ║`);
  console.log(`╠════════════════════════════════════════════════════════════════╣`);
  console.log(`║  URL: http://localhost:${port}                                   ║`);
  console.log(`║  PAY_TO: ${(process.env.PAY_TO || "NOT SET").slice(0, 42).padEnd(50)}  ║`);
  console.log(`║  Facilitator: ${(process.env.FACILITATOR_URL || "https://facilitator.stableyard.fi").slice(0, 45).padEnd(45)}  ║`);
  console.log(`╚════════════════════════════════════════════════════════════════╝\n`);
});
