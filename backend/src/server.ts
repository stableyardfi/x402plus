import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { x402plus } from "@stableyard/x402plus";

const app = express();

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] → ${req.method} ${req.path}`);
  if (req.headers["x-payment"]) {
    console.log(`  └─ X-PAYMENT header present (${String(req.headers["x-payment"]).length} chars)`);
  }
  if (req.headers["x-payer"]) {
    console.log(`  └─ X-PAYER: ${req.headers["x-payer"]}`);
  }
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ← ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`);
  });
  next();
});

app.use(
  cors({
    origin: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-PAYMENT", "X-PAYER", "Authorization"],
    exposedHeaders: ["X-PAYMENT-RESPONSE"],
  })
);

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

// ─────────────────────────────────────────────────────────────────────────────
// Payment middleware — x402plus()
// ─────────────────────────────────────────────────────────────────────────────

const payTo = process.env.PAY_TO as string;

function normalizeMoveAddress(addr: string): string {
  const s = String(addr || "").toLowerCase();
  const no0x = s.startsWith("0x") ? s.slice(2) : s;
  return "0x" + no0x.padStart(64, "0");
}

function parseNetworks(env: string | undefined, fallback: string): string | string[] {
  if (!env) return fallback;
  const parts = env.split(",").map(s => s.trim()).filter(Boolean);
  return parts.length === 1 ? parts[0] : parts;
}

app.use(
  x402plus(payTo, {
    "GET /api/premium-image": 0.1,
  }, {
    facilitatorUrl: process.env.FACILITATOR_URL,  // optional — defaults to facilitator.stableyard.fi
    defaultChain: process.env.NETWORK || "base",

    // Solana (optional — set SOLANA_PAY_TO to enable)
    solana: process.env.SOLANA_PAY_TO ? {
      payTo: process.env.SOLANA_PAY_TO,
      network: parseNetworks(process.env.SOLANA_NETWORK, "solana-devnet"),
    } : undefined,

    // Movement (optional — set MOVEMENT_PAY_TO to enable)
    movement: process.env.MOVEMENT_PAY_TO ? {
      payTo: normalizeMoveAddress(process.env.MOVEMENT_PAY_TO),
      network: parseNetworks(process.env.MOVEMENT_NETWORK, "movement"),
    } : undefined,
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Protected endpoint
// ─────────────────────────────────────────────────────────────────────────────

app.get("/api/premium-image", (_req, res) => {
  console.log(`[api/premium-image] ✅ Payment verified - serving content`);
  res.sendFile(path.resolve(process.cwd(), "premiumcontent.jpg"));
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`\n╔════════════════════════════════════════════════════════════════╗`);
  console.log(`║  x402plus Backend Demo                                         ║`);
  console.log(`╠════════════════════════════════════════════════════════════════╣`);
  console.log(`║  URL: http://localhost:${port}                                   ║`);
  console.log(`║  PAY_TO: ${(payTo || "NOT SET").slice(0, 42).padEnd(50)}  ║`);
  console.log(`║  Chain: ${(process.env.NETWORK || "base").padEnd(51)}  ║`);
  console.log(`║                                                                 ║`);
  console.log(`║  Routes:                                                        ║`);
  console.log(`║    GET  /api/premium-image     $0.10                            ║`);
  console.log(`╚════════════════════════════════════════════════════════════════╝\n`);
});
