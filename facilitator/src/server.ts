import "dotenv/config";
import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import {
  Aptos,
  AptosConfig,
  Network,
  Deserializer,
  SimpleTransaction,
  AccountAuthenticator,
} from "@aptos-labs/ts-sdk";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const erc20abi = require("./erc20abi.json");

// ─────────────────────────────────────────────────────────────────────────────
// Chain Configuration for EVM Networks (exact scheme)
// ─────────────────────────────────────────────────────────────────────────────
const chainConfig: Record<string, { rpcUrl: string; contractAddress: string }> = {
  "base-sepolia": {
    rpcUrl: process.env.BASE_RPC || "https://sepolia.base.org",
    contractAddress: process.env.BASE_USDC_CONTRACT || "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
  },
  "polygon-amoy": {
    rpcUrl: process.env.POLYGON_RPC || "https://rpc-amoy.polygon.technology",
    contractAddress: process.env.POLYGON_USDC_CONTRACT || "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582"
  },
  "base": {
    rpcUrl: process.env.BASE_MAINNET_RPC || "https://mainnet.base.org",
    contractAddress: process.env.BASE_MAINNET_USDC_CONTRACT || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  },
  "polygon": {
    rpcUrl: process.env.POLYGON_MAINNET_RPC || "https://polygon-rpc.com",
    contractAddress: process.env.POLYGON_MAINNET_USDC_CONTRACT || "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Chain Configuration for Movement Networks (Aptos-like)
// ─────────────────────────────────────────────────────────────────────────────
const movementConfig: Record<string, { rpcUrl: string; indexerUrl?: string; contractAddress: string }> = {
  "movement": {
    rpcUrl: process.env.MOVE_RPC || "https://mainnet.movementnetwork.xyz/v1",
    indexerUrl: process.env.MOVE_INDEXER,
    contractAddress: process.env.MOVE_USDC_CONTRACT || "0x1::aptos_coin::AptosCoin"
  },
  "movement-mainnet": {
    rpcUrl: process.env.MOVE_RPC || "https://mainnet.movementnetwork.xyz/v1",
    indexerUrl: process.env.MOVE_INDEXER,
    contractAddress: process.env.MOVE_USDC_CONTRACT || "0x1::aptos_coin::AptosCoin"
  },
  "movement-testnet": {
    rpcUrl: process.env.MOVE_TESTNET_RPC || "https://aptos.testnet.porto.movementlabs.xyz/v1",
    indexerUrl: process.env.MOVE_TESTNET_INDEXER,
    contractAddress: process.env.MOVE_TESTNET_USDC_CONTRACT || "0x1::aptos_coin::AptosCoin"
  }
};

function isMovementNetwork(network: string): boolean {
  return network === "movement" || network === "movement-mainnet" || network === "movement-testnet";
}

type StableyardUser = {
  id: string;
  username?: string | null;
  addresses?: Array<{ address: string; chainType: string }>;
  vaultAddress?: string | null;
};

type AccountResult = {
  activated: boolean;
  accountAddress?: string | null;
  signing?: any | null;
};

/**
 * Sample facilitator for x402plus.
 *
 * x402plus = intent-based payment scheme using pre-funded vaults (Money Accounts).
 *
 * Endpoints:
 *  - POST /supported  -> advertise capabilities
 *  - POST /account    -> get/create user's Money Account + balance
 *  - POST /balance    -> check user balance
 *  - POST /verify     -> validate intent signature
 *  - POST /settle     -> debit user vault, credit merchant
 */

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
  })
);

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`\n[${new Date().toISOString()}] → ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    const bodyLog = { ...req.body };
    // Truncate long fields for readability
    if (bodyLog.paymentPayload?.signature) bodyLog.paymentPayload.signature = bodyLog.paymentPayload.signature.slice(0, 20) + "...";
    console.log(`  └─ Body:`, JSON.stringify(bodyLog, null, 2).split("\n").map(l => "     " + l).join("\n").trim());
  }
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ← ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`);
  });
  next();
});

app.post("/supported", (_req, res) => {
  const result = {
    x402plus: true,
    networks: (process.env.SUPPORTED_NETWORKS || "polygon-amoy,base-sepolia,movement,movement-mainnet,movement-testnet").split(",").map(s => s.trim()),
    tokens: (process.env.SUPPORTED_TOKENS || "USDC,USDT,MOVE").split(",").map(s => s.trim()),
    schemes: ["exact", "intent"],
    profiles: ["money-account"]
  };
  console.log(`[/supported] Returning:`, result);
  res.json(result);
});

// ─────────────────────────────────────────────────────────────────────────────
// Stableyard Integration Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getStableyardHeaders() {
  const sdkKey = process.env.STABLEYARD_SDK_KEY || "";
  const origin = process.env.STABLEYARD_ORIGIN || "";
  return {
    "x-sdk-key": sdkKey,
    "Origin": origin,
    "Content-Type": "application/json"
  } as Record<string, string>;
}

function stableyardBase(): string {
  const base = (process.env.STABLEYARD_BASE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("STABLEYARD_BASE_URL is not configured");
  return base;
}

function toChainId(chain?: string): number | undefined {
  const map: Record<string, number> = {
    "polygon": 137,
    "polygon-amoy": 80002,
    "base": 8453,
    "base-sepolia": 84532,
    "arbitrum": 42161,
    "arbitrum-sepolia": 421614,
    "ethereum": 1,
    "sepolia": 11155111
  };
  return chain ? map[chain.toLowerCase()] : undefined;
}

// In-memory cache (production: use Redis/DB)
const memoryStore: {
  addressToUserId: Map<string, string>;
  userIdToAccount: Map<string, string>;
} = {
  addressToUserId: new Map(),
  userIdToAccount: new Map()
};

async function syGetUserByAddress(address: string): Promise<StableyardUser | null> {
  const url = `${stableyardBase()}/sdk/v1/get-user-byaddress?address=${encodeURIComponent(address)}`;
  console.log(`  [Stableyard] GET ${url}`);
  const resp = await fetch(url, { method: "GET", headers: getStableyardHeaders() });
  console.log(`  [Stableyard] Response: ${resp.status}`);
  if (resp.status === 404) return null;
  if (!resp.ok) return null;
  const json = await resp.json().catch(() => null);
  // Stableyard wraps responses: { success: true, data: { userId, ... } }
  const data = json?.data || json;
  const userId = data?.userId || data?.id || null;
  console.log(`  [Stableyard] User found: userId=${userId}`);
  if (!userId) return null;
  return { id: userId, ...data } as StableyardUser;
}

async function syRegisterUser(address: string, chain?: string, token?: string): Promise<StableyardUser> {
  const chainId = toChainId(chain);
  const body: any = {
    partnerId: process.env.STABLEYARD_PARTNER_ID || "partner-demo",
    username: address.toLowerCase(),
    addresses: [{ address, chainType: "evm" }],
    ...(chainId ? { preferredSettlementChain: chainId } : {}),
    ...(token ? { preferredSettlementToken: token } : {})
  };
  console.log(`  [Stableyard] POST /sdk/v1/register`, JSON.stringify(body));
  const resp = await fetch(`${stableyardBase()}/sdk/v1/register`, {
    method: "POST",
    headers: getStableyardHeaders(),
    body: JSON.stringify(body)
  });
  console.log(`  [Stableyard] Response: ${resp.status}`);
  if (!resp.ok) {
    const err = await resp.text();
    console.log(`  [Stableyard] ❌ Register failed:`, err);
    throw new Error(`Stableyard register failed: ${resp.status} ${err}`);
  }
  const json = await resp.json();
  // Stableyard wraps responses: { success: true, data: { userId, ... } }
  const data = json?.data || json;
  const userId = data?.userId || data?.id || null;
  console.log(`  [Stableyard] ✅ User registered: userId=${userId}`);
  return { id: userId, ...data } as StableyardUser;
}

async function syCreateVault(userId: string): Promise<AccountResult> {
  console.log(`  [Stableyard] POST /sdk/v1/create-vault { userId: "${userId}" }`);
  const resp = await fetch(`${stableyardBase()}/sdk/v1/create-vault`, {
    method: "POST",
    headers: getStableyardHeaders(),
    body: JSON.stringify({ userId })
  });
  console.log(`  [Stableyard] Response: ${resp.status}`);
  if (!resp.ok) {
    const err = await resp.text();
    console.log(`  [Stableyard] ❌ Create vault failed:`, err);
    throw new Error(`Stableyard create-vault failed: ${resp.status} ${err}`);
  }
  const json = await resp.json().catch(() => ({}));
  // Stableyard wraps responses: { success: true, data: { vaultAddress, ... } }
  const data = json?.data || json;
  console.log(`  [Stableyard] Vault response data:`, JSON.stringify(data));
  
  const accountAddress = (data?.vaultAddress || data?.safeAddress || null) as (string | null);
  const proxyModuleAddress = data?.proxyModuleAddress || null;
  
  // If txData is present, vault needs activation (proxy not deployed)
  // If proxyModuleAddress is present, vault is fully activated
  const hasTxData = !!(data?.txData);
  const isFullyDeployed = !!proxyModuleAddress || data?.message?.includes("ready for deposits");
  
  const signing = hasTxData ? data : null;
  const activated = !!accountAddress && !hasTxData && isFullyDeployed;
  
  console.log(`  [Stableyard] ✅ Vault:`, { accountAddress, proxyModuleAddress, needsSigning: !!signing, activated });
  return {
    activated,
    accountAddress: accountAddress ?? null,
    signing
  };
}

async function syGetBalance(userId: string): Promise<{ totalUsd: string; perToken: Array<{ token: string; chain: string; amount: string; usdValue?: string }>; updatedAt: string; }> {
  console.log(`  [Stableyard] POST /sdk/v1/get-balance { userId: "${userId}" }`);
  const resp = await fetch(`${stableyardBase()}/sdk/v1/get-balance`, {
    method: "POST",
    headers: getStableyardHeaders(),
    body: JSON.stringify({ userId })
  });
  console.log(`  [Stableyard] Response: ${resp.status}`);
  if (!resp.ok) {
    const err = await resp.text();
    console.log(`  [Stableyard] ❌ Get balance failed:`, err);
    throw new Error(`Stableyard get-balance failed: ${resp.status} ${err}`);
  }
  const json = await resp.json().catch(() => ({}));
  // Stableyard wraps responses: { success: true, data: { balance, balanceRaw, decimals } }
  const data = json?.data || json;
  console.log(`  [Stableyard] Balance response data:`, JSON.stringify(data));

  // Stableyard returns: { balance: "2.2", balanceRaw: "2200000", decimals: 6 }
  // We treat balance as USD value for simplicity
  const totalUsd = String(data?.balance ?? data?.totalUsd ?? data?.totalUSD ?? "0.00");
  const perToken = Array.isArray(data?.perToken) ? data.perToken : [];

  // If no perToken but we have balance, create a synthetic entry
  if (perToken.length === 0 && parseFloat(totalUsd) > 0) {
    perToken.push({
      token: "USDC",
      chain: "polygon",
      amount: data?.balanceRaw || totalUsd,
      usdValue: totalUsd
    });
  }

  console.log(`  [Stableyard] ✅ Balance: $${totalUsd}`);
  return { totalUsd, perToken, updatedAt: new Date().toISOString() };
}

async function syGenerateDepositAddress(userId: string, chainId: number): Promise<{ depositAddress: string; chainType: string; chainId: number }> {
  console.log(`  [Stableyard] POST /sdk/v1/generate { userId: "${userId}", chainId: ${chainId} }`);
  const resp = await fetch(`${stableyardBase()}/sdk/v1/generate`, {
    method: "POST",
    headers: getStableyardHeaders(),
    body: JSON.stringify({ userId, chainId })
  });
  console.log(`  [Stableyard] Response: ${resp.status}`);
  if (!resp.ok) {
    const err = await resp.text();
    console.log(`  [Stableyard] ❌ Generate deposit address failed:`, err);
    throw new Error(`Stableyard generate failed: ${resp.status} ${err}`);
  }
  const json = await resp.json().catch(() => ({}));
  console.log(`  [Stableyard] Raw response:`, JSON.stringify(json));

  // Try different response formats - Stableyard might return data in various structures
  const depositAddress = json?.data?.depositAddress || json?.depositAddress || json?.address || "";
  const chainType = json?.data?.chainType || json?.chainType || "evm";
  const returnedChainId = json?.data?.chainId || json?.chainId || chainId;

  console.log(`  [Stableyard] ✅ Deposit address extracted:`, depositAddress);
  return {
    depositAddress,
    chainType,
    chainId: returnedChainId
  };
}

async function syGetQuote(userId: string, partnerId: string, amount: string, destinationChainId?: number, destinationToken?: string): Promise<{ inputAmount: string; outputAmount: string; outputAmountRaw: string; rate?: string }> {
  const body: any = { userId, partnerId, amount };
  if (destinationChainId) body.destinationChainId = destinationChainId;
  if (destinationToken) body.destinationToken = destinationToken;

  console.log(`  [Stableyard] POST /sdk/v1/quote`, JSON.stringify(body));
  const resp = await fetch(`${stableyardBase()}/sdk/v1/quote`, {
    method: "POST",
    headers: getStableyardHeaders(),
    body: JSON.stringify(body)
  });
  console.log(`  [Stableyard] Response: ${resp.status}`);
  if (!resp.ok) {
    const err = await resp.text();
    console.log(`  [Stableyard] ❌ Quote failed:`, err);
    throw new Error(`Stableyard quote failed: ${resp.status} ${err}`);
  }
  const json = await resp.json().catch(() => ({}));
  const data = json?.data || json;
  console.log(`  [Stableyard] ✅ Quote:`, JSON.stringify(data));
  return {
    inputAmount: data?.inputAmount || amount,
    outputAmount: data?.outputAmount || amount,
    outputAmountRaw: data?.outputAmountRaw || amount,
    rate: data?.rate
  };
}

async function sySettle(payload: {
  authorization: any;
  signature: string;
  domain: any;
  types: any;
  destinationChainID?: number;
  destinationToken?: string;
}): Promise<{ success: boolean; transactionHash?: string; redeemTxHash?: string; requestId?: string; offchainOrderID?: string; error?: string }> {
  console.log(`  [Stableyard] POST /sdk/v1/settle`);

  // Build the Stableyard-specific payload format
  const stableyardPayload = {
    payload: {
      signature: payload.signature,
      format: "eip712",
      authorization: {
        ...payload.authorization,
        destinationChainID: payload.destinationChainID || 2,  // Default to chainId 2
        destinationToken: payload.destinationToken || "USDC"
      },
      domain: {
        name: "settlement",
        version: "1",
        chainId: payload.domain?.chainId || 137
      },
      types: {
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
      }
    }
  };

  console.log(`  [Stableyard] Payload:`, JSON.stringify(stableyardPayload, null, 2));

  const resp = await fetch(`${stableyardBase()}/sdk/v1/settle`, {
    method: "POST",
    headers: getStableyardHeaders(),
    body: JSON.stringify(stableyardPayload)
  });
  console.log(`  [Stableyard] Response: ${resp.status}`);
  if (!resp.ok) {
    const err = await resp.text();
    console.log(`  [Stableyard] ❌ Settle failed:`, err);
    return { success: false, error: `Stableyard settle failed: ${resp.status} ${err}` };
  }
  const json = await resp.json().catch(() => ({}));
  console.log(`  [Stableyard] ✅ Settle response:`, JSON.stringify(json));

  // Response format: {"success": true, "data": "Transaction sent successfully", "requestId": "..."}
  // Use requestId as transaction hash for x402/x402plus compatibility
  const requestId = json?.requestId;
  const isSuccess = json?.success === true;

  if (!isSuccess) {
    return { success: false, error: json?.data || json?.error || "Settlement failed" };
  }

  return {
    success: true,
    transactionHash: requestId,
    redeemTxHash: requestId,
    requestId: requestId,
    offchainOrderID: requestId
  };
}

async function ensureUserAndAccount(address: string, chain?: string, token?: string): Promise<{ userId: string; account: AccountResult }> {
  const addrKey = address.toLowerCase();
  let userId = memoryStore.addressToUserId.get(addrKey) || "";
  let user: StableyardUser | null = null;
  if (!userId) {
    user = await syGetUserByAddress(address);
    if (!user) {
      user = await syRegisterUser(address, chain, token);
    }
    userId = user?.id || "";
    if (userId) memoryStore.addressToUserId.set(addrKey, userId);
  }
  let accountAddress = memoryStore.userIdToAccount.get(userId) || "";
  let account: AccountResult = { activated: false, accountAddress: null, signing: null };
  if (!accountAddress) {
    account = await syCreateVault(userId);
    if (account.activated && account.accountAddress) {
      memoryStore.userIdToAccount.set(userId, account.accountAddress);
    }
  } else {
    account = { activated: true, accountAddress, signing: null };
  }
  return { userId, account };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /account - Get or create user's Money Account
// ─────────────────────────────────────────────────────────────────────────────
app.post("/account", async (req, res) => {
  const { userAddress, chain, token } = req.body || {};
  console.log(`[/account] userAddress=${userAddress}, chain=${chain}, token=${token}`);

  if (!userAddress) {
    console.log(`[/account] ❌ Missing userAddress`);
    return res.status(400).json({ error: "userAddress is required" });
  }

  try {
    console.log(`[/account] Ensuring user and account...`);
    const { userId, account } = await ensureUserAndAccount(userAddress, chain, token);
    console.log(`[/account] userId=${userId}, activated=${account.activated}`);

    // Generate deposit address (default chainId=1 for Stableyard)
    const chainId = toChainId(chain) || 1; // Default to chainId 1
    let depositAddress: string | null = null;
    console.log(`[/account] === Calling syGenerateDepositAddress(${userId}, ${chainId}) ===`);
    try {
      const depositResult = await syGenerateDepositAddress(userId, chainId);
      console.log(`[/account] syGenerateDepositAddress returned:`, JSON.stringify(depositResult));
      depositAddress = depositResult.depositAddress || null;
      console.log(`[/account] Deposit address for chainId ${chainId}:`, depositAddress);
      if (!depositAddress) {
        console.log(`[/account] ⚠️ Stableyard returned empty deposit address`);
      }
    } catch (depositErr: any) {
      console.log(`[/account] ⚠️ Deposit address generation failed:`, depositErr?.message);
      console.log(`[/account] ⚠️ Full error:`, depositErr);
      // Don't fallback to vault address - keep it null so frontend knows there's an issue
    }
    console.log(`[/account] === Final depositAddress: ${depositAddress} ===`);

    let balance = null as any;
    try {
      balance = await syGetBalance(userId);
      console.log(`[/account] Balance fetched:`, JSON.stringify(balance));
    } catch (balErr: any) {
      console.log(`[/account] ⚠️ Balance fetch failed:`, balErr?.message);
      balance = { totalUsd: "0.00", perToken: [], updatedAt: new Date().toISOString() };
    }

    const result = {
      activated: account.activated,
      accountAddress: account.accountAddress ?? null,
      depositAddress: depositAddress ?? null,
      chain: chain || null,
      token: token || null,
      signing: account.signing || null,
      balance
    };
    console.log(`[/account] ✅ Response:`, {
      activated: result.activated,
      accountAddress: result.accountAddress,
      depositAddress: result.depositAddress,
      hasSigning: !!result.signing,
      balanceUsd: result.balance?.totalUsd || 'null'
    });
    res.json(result);
  } catch (e: any) {
    console.log(`[/account] ❌ Error:`, e?.message);
    res.status(500).json({ error: e?.message || "Account provisioning error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /deploy-module - Deploy vault role module with user signature
// ─────────────────────────────────────────────────────────────────────────────
app.post("/deploy-module", async (req, res) => {
  const { userAddress, signature, txData } = req.body || {};
  console.log(`[/deploy-module] userAddress=${userAddress}`);
  
  if (!userAddress || !signature || !txData) {
    return res.status(400).json({ error: "userAddress, signature, and txData are required" });
  }

  try {
    // Get userId from address
    const addrKey = userAddress.toLowerCase();
    let userId = memoryStore.addressToUserId.get(addrKey) || "";
    if (!userId) {
      const user = await syGetUserByAddress(userAddress);
      if (!user) {
        return res.status(400).json({ error: "User not found. Call /account first." });
      }
      userId = user.id;
      memoryStore.addressToUserId.set(addrKey, userId);
    }

    // Call Stableyard deploy-role-module
    console.log(`  [Stableyard] POST /sdk/v1/deploy-role-module`);
    const resp = await fetch(`${stableyardBase()}/sdk/v1/deploy-role-module`, {
      method: "POST",
      headers: getStableyardHeaders(),
      body: JSON.stringify({ userId, txData, signature })
    });
    console.log(`  [Stableyard] Response: ${resp.status}`);
    
    if (!resp.ok) {
      const err = await resp.text();
      console.log(`  [Stableyard] ❌ Deploy failed:`, err);
      return res.status(resp.status).json({ error: err });
    }

    const json = await resp.json().catch(() => ({}));
    const data = json?.data || json;
    console.log(`  [Stableyard] ✅ Deploy success:`, JSON.stringify(data));
    
    // Clear cached account so next /account call fetches fresh state
    memoryStore.userIdToAccount.delete(userId);
    
    res.json({ success: true, data });
  } catch (e: any) {
    console.log(`[/deploy-module] ❌ Error:`, e?.message);
    res.status(500).json({ error: e?.message || "Deploy error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /balance - Check user balance (does NOT create vault)
// ─────────────────────────────────────────────────────────────────────────────
app.post("/balance", async (req, res) => {
  const { userAddress, chain, tokens } = req.body || {};
  console.log(`[/balance] userAddress=${userAddress}, chain=${chain}, tokens=${tokens}`);
  
  if (!userAddress) {
    console.log(`[/balance] ❌ Missing userAddress`);
    return res.status(400).json({ error: "userAddress is required" });
  }

  try {
    const addrKey = userAddress.toLowerCase();
    let userId = memoryStore.addressToUserId.get(addrKey) || "";
    console.log(`[/balance] Cache lookup: userId=${userId || "(not in cache)"}`);
    
    // Check if user exists (don't create)
    if (!userId) {
      const user = await syGetUserByAddress(userAddress);
      if (!user) {
        console.log(`[/balance] User not found - returning accountExists=false`);
        return res.json({
          totalUsd: "0.00",
          perToken: [],
          updatedAt: new Date().toISOString(),
          accountExists: false
        });
      }
      userId = user.id;
      memoryStore.addressToUserId.set(addrKey, userId);
    }
    
    const bal = await syGetBalance(userId);
    let perToken = bal.perToken || [];
    if (tokens && tokens.length) {
      perToken = perToken.filter(p => tokens.includes(p.token));
    }
    if (chain) {
      perToken = perToken.filter(p => (p.chain || "").toLowerCase() === chain.toLowerCase());
    }
    
    console.log(`[/balance] ✅ totalUsd=$${bal.totalUsd}, accountExists=true`);
    res.json({ 
      totalUsd: bal.totalUsd, 
      perToken, 
      updatedAt: bal.updatedAt,
      accountExists: true
    });
  } catch (e: any) {
    console.log(`[/balance] ❌ Error:`, e?.message);
    res.status(500).json({ error: e?.message || "Balance fetch error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /verify - Validate payment authorization (supports exact & intent schemes)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /verify - Verify PaymentAuthorization
 *
 * For EXACT scheme (x402 standard):
 *   - Validates authorization structure
 *   - Checks time bounds, recipient, amount
 *   - Does NOT check balance (user's wallet is source)
 *
 * For INTENT scheme (x402plus):
 *   - Validates authorization structure
 *   - Checks time bounds, recipient, amount
 *   - Checks user balance in Money Account via Stableyard
 *
 * For MOVEMENT networks:
 *   - Validates transaction and signature are present
 *   - Actual signature verification happens on-chain
 */
app.post("/verify", async (req, res) => {
  const { paymentPayload, paymentRequirements } = req.body || {};
  const scheme = (paymentPayload?.scheme || "exact").toLowerCase();
  const network = paymentRequirements?.network || "";

  console.log(`[/verify] Received request`);
  console.log(`[/verify] scheme=${scheme}, network=${network}`);
  console.log(`[/verify] payTo=${paymentRequirements?.payTo}, amount=${paymentRequirements?.maxAmountRequired}`);

  // 1. Check payload structure
  if (!paymentPayload) {
    console.log(`[/verify] ❌ Missing paymentPayload`);
    return res.json({ isValid: false, invalidReason: "Missing paymentPayload" });
  }

  if (!paymentRequirements) {
    console.log(`[/verify] ❌ Missing paymentRequirements`);
    return res.json({ isValid: false, invalidReason: "Missing paymentRequirements" });
  }

  if (!paymentRequirements?.payTo) {
    console.log(`[/verify] ❌ Missing payTo in requirements`);
    return res.json({ isValid: false, invalidReason: "Missing payTo in requirements" });
  }

  if (!paymentRequirements?.maxAmountRequired) {
    console.log(`[/verify] ❌ Missing maxAmountRequired in requirements`);
    return res.json({ isValid: false, invalidReason: "Missing maxAmountRequired in requirements" });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MOVEMENT NETWORK: Validate transaction and signature exist
  // Per Aptos x402 spec: structural validation without touching blockchain
  // ═══════════════════════════════════════════════════════════════════════════
  if (isMovementNetwork(network)) {
    console.log(`[/verify] MOVEMENT network - validating transaction payload`);
    const payload = paymentPayload?.payload || paymentPayload;
    const transactionB64 = payload?.transaction;
    const signatureB64 = payload?.signature;
    const payloadScheme = paymentPayload?.scheme || "exact";
    const payloadNetwork = paymentPayload?.network;

    // Validate scheme matches (per Aptos x402 spec)
    if (payloadScheme !== scheme) {
      console.log(`[/verify] ❌ Scheme mismatch: payload=${payloadScheme}, requirements=${scheme}`);
      return res.json({ isValid: false, invalidReason: `Scheme mismatch: expected ${scheme}, got ${payloadScheme}` });
    }

    // Validate network matches (per Aptos x402 spec)
    if (payloadNetwork && payloadNetwork !== network) {
      console.log(`[/verify] ❌ Network mismatch: payload=${payloadNetwork}, requirements=${network}`);
      return res.json({ isValid: false, invalidReason: `Network mismatch: expected ${network}, got ${payloadNetwork}` });
    }

    if (!transactionB64) {
      console.log(`[/verify] ❌ Missing transaction in payload for Movement`);
      return res.json({ isValid: false, invalidReason: "Missing transaction in payload for Movement network" });
    }

    if (!signatureB64) {
      console.log(`[/verify] ❌ Missing signature in payload for Movement`);
      return res.json({ isValid: false, invalidReason: "Missing signature in payload for Movement network" });
    }

    // Validate base64 decoding works and data is non-empty
    try {
      const txBytes = Buffer.from(transactionB64, "base64");
      const sigBytes = Buffer.from(signatureB64, "base64");

      if (txBytes.length === 0) {
        console.log(`[/verify] ❌ Invalid transaction (empty after decoding)`);
        return res.json({ isValid: false, invalidReason: "Invalid transaction data" });
      }

      if (sigBytes.length === 0) {
        console.log(`[/verify] ❌ Invalid signature (empty after decoding)`);
        return res.json({ isValid: false, invalidReason: "Invalid signature data" });
      }

      console.log(`[/verify] ✅ Valid (Movement) - transaction=${txBytes.length} bytes, signature=${sigBytes.length} bytes`);
      // Response format per Aptos x402 spec
      return res.json({ isValid: true, invalidReason: null, payer: payload?.senderAddress || "movement-payer" });
    } catch (decodeErr: any) {
      console.log(`[/verify] ❌ Failed to decode Movement payload:`, decodeErr?.message);
      return res.json({ isValid: false, invalidReason: "Invalid base64 encoding in payload" });
    }
  }

  try {
    // 2. Extract PaymentAuthorization from payload (EVM networks)
    const payload = paymentPayload?.payload || paymentPayload;
    const authorization = payload?.authorization || payload?.data?.message;
    const signature = payload?.signature;

    if (!authorization) {
      console.log(`[/verify] ❌ Missing authorization in payload`);
      return res.json({ isValid: false, invalidReason: "Missing authorization in payload" });
    }

    if (!signature) {
      console.log(`[/verify] ❌ Missing signature in payload`);
      return res.json({ isValid: false, invalidReason: "Missing signature in payload" });
    }

    // Extract authorization fields
    const payer = authorization?.from || authorization?.fromAddress;
    const to = authorization?.to || authorization?.toAddress;
    const value = authorization?.value || authorization?.amount;
    const validAfter = authorization?.validAfter || authorization?.validFrom;
    const validBefore = authorization?.validBefore || authorization?.validTo;
    const nonce = authorization?.nonce;

    if (!payer) {
      console.log(`[/verify] ❌ Missing payer (from) in authorization`);
      return res.json({ isValid: false, invalidReason: "Missing payer address in authorization" });
    }

    if (!to) {
      console.log(`[/verify] ❌ Missing recipient (to) in authorization`);
      return res.json({ isValid: false, invalidReason: "Missing recipient address in authorization" });
    }

    if (!value) {
      console.log(`[/verify] ❌ Missing value in authorization`);
      return res.json({ isValid: false, invalidReason: "Missing value in authorization" });
    }

    if (!nonce) {
      console.log(`[/verify] ❌ Missing nonce in authorization`);
      return res.json({ isValid: false, invalidReason: "Missing nonce in authorization" });
    }

    console.log(`[/verify] Authorization:`, {
      scheme,
      payer,
      to,
      value,
      validAfter,
      validBefore,
      nonce: typeof nonce === 'string' ? nonce.slice(0, 20) + '...' : nonce
    });

    // 3. Check time bounds
    const nowSec = Math.floor(Date.now() / 1000);

    if (validAfter && nowSec < Number(validAfter)) {
      console.log(`[/verify] ❌ Authorization not yet valid (now=${nowSec}, validAfter=${validAfter})`);
      return res.json({ isValid: false, invalidReason: "Authorization not yet valid" });
    }

    if (validBefore && nowSec > Number(validBefore)) {
      console.log(`[/verify] ❌ Authorization expired (now=${nowSec}, validBefore=${validBefore})`);
      return res.json({ isValid: false, invalidReason: "Authorization expired" });
    }

    // 4. Check recipient matches payTo
    if (to.toLowerCase() !== paymentRequirements.payTo.toLowerCase()) {
      console.log(`[/verify] ❌ Recipient mismatch: ${to} vs ${paymentRequirements.payTo}`);
      return res.json({ isValid: false, invalidReason: "Recipient mismatch" });
    }

    // 5. Check authorized amount >= required amount
    if (BigInt(value) < BigInt(paymentRequirements.maxAmountRequired)) {
      console.log(`[/verify] ❌ Insufficient amount authorized: ${value} < ${paymentRequirements.maxAmountRequired}`);
      return res.json({ isValid: false, invalidReason: "Insufficient amount authorized" });
    }

    // 6. Scheme-specific verification
    if (scheme === "exact") {
      // EXACT scheme: Direct on-chain transfer via transferWithAuthorization
      // The USDC contract will verify the signature during settlement
      // We just validate structure here - no balance check needed
      console.log(`[/verify] ✅ Valid (exact scheme) - structure validated`);
      return res.json({ isValid: true, payer });
    }

    // INTENT scheme: Check balance in Money Account
    console.log(`[/verify] Intent scheme - checking Money Account balance for: ${payer}`);

    // Get userId from address
    const addrKey = payer.toLowerCase();
    let userId = memoryStore.addressToUserId.get(addrKey) || "";

    if (!userId) {
      // Try to find user by address
      const user = await syGetUserByAddress(payer);
      if (!user) {
        console.log(`[/verify] ❌ User not found - no Money Account exists`);
        return res.json({ isValid: false, invalidReason: "User has no Money Account. Create one first." });
      }
      userId = user.id;
      memoryStore.addressToUserId.set(addrKey, userId);
    }

    // Get balance from Stableyard
    let balance;
    try {
      balance = await syGetBalance(userId);
      console.log(`[/verify] User balance: $${balance.totalUsd}`);
    } catch (balErr: any) {
      console.log(`[/verify] ❌ Failed to fetch balance:`, balErr?.message);
      return res.json({ isValid: false, invalidReason: "Failed to fetch user balance" });
    }

    // Convert value to USD (assuming 1 USDC = 1 USD, 6 decimals)
    const valueInUsd = Number(value) / 1_000_000;
    const userBalanceUsd = parseFloat(balance.totalUsd);

    console.log(`[/verify] Payment amount: $${valueInUsd}, User balance: $${userBalanceUsd}`);

    if (userBalanceUsd < valueInUsd) {
      console.log(`[/verify] ❌ Insufficient balance: $${userBalanceUsd} < $${valueInUsd}`);
      return res.json({
        isValid: false,
        invalidReason: `Insufficient balance. Required: $${valueInUsd.toFixed(2)}, Available: $${userBalanceUsd.toFixed(2)}`
      });
    }

    // All checks passed
    console.log(`[/verify] ✅ Valid (intent scheme) - user has sufficient balance`);
    return res.json({ isValid: true, payer });

  } catch (e: any) {
    console.log(`[/verify] ❌ Error:`, e?.message);
    return res.json({ isValid: false, invalidReason: e?.message || "Verification error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /settle - Execute payment (supports exact & intent schemes)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /settle - Execute payment
 *
 * For EXACT scheme (x402 standard):
 *   - Calls USDC's transferWithAuthorization directly on-chain
 *   - Uses facilitator's private key to relay the pre-signed authorization
 *
 * For INTENT scheme (x402plus):
 *   - Forwards to Stableyard's /sdk/v1/settle
 *   - Debits user's Money Account
 */
app.post("/settle", async (req, res) => {
  console.log(`[/settle] Received request`);
  const { paymentPayload, paymentRequirements } = req.body || {};
  const scheme = (paymentPayload?.scheme || "exact").toLowerCase();
  const network = paymentRequirements?.network || "base-sepolia";

  console.log(`[/settle] scheme=${scheme}, network=${network}`);

  // 1. Check structure
  if (!paymentPayload) {
    console.log(`[/settle] ❌ Missing paymentPayload`);
    return res.json({ success: false, errorReason: "Missing paymentPayload" });
  }

  if (!paymentRequirements) {
    console.log(`[/settle] ❌ Missing paymentRequirements`);
    return res.json({ success: false, errorReason: "Missing paymentRequirements" });
  }

  // Extract payload
  const payload = paymentPayload?.payload || paymentPayload;

  try {
    // ═══════════════════════════════════════════════════════════════════════════
    // MOVEMENT NETWORK: Execute via Aptos SDK (check FIRST before EVM validation)
    // Movement uses transaction + signature, NOT authorization
    // ═══════════════════════════════════════════════════════════════════════════
    if (isMovementNetwork(network)) {
      console.log(`[/settle] MOVEMENT network detected - executing via Aptos SDK`);

      const moveConfig = movementConfig[network.toLowerCase()];
      if (!moveConfig) {
        console.log(`[/settle] ❌ Unsupported Movement network: ${network}`);
        return res.json({ success: false, errorReason: `Unsupported Movement network: ${network}` });
      }

      // Movement payments use a pre-signed transaction payload
      // The client sends transaction (base64) and signature (base64)
      const transactionB64 = payload?.transaction;
      const signatureB64 = payload?.signature;
      const movementPayer = payload?.senderAddress || "movement-payer";

      if (!transactionB64) {
        console.log(`[/settle] ❌ Missing transaction in payload for Movement`);
        return res.json({ success: false, errorReason: "Missing transaction in payload for Movement network" });
      }

      if (!signatureB64) {
        console.log(`[/settle] ❌ Missing signature in payload for Movement`);
        return res.json({ success: false, errorReason: "Missing signature in payload for Movement network" });
      }

      try {
        console.log(`[/settle] Deserializing Movement transaction...`);

        // Determine network type for Aptos SDK
        const aptosNetwork = network === "movement" ? Network.CUSTOM : Network.CUSTOM;
        const aptosConfig = new AptosConfig({
          network: aptosNetwork,
          fullnode: moveConfig.rpcUrl,
          indexer: moveConfig.indexerUrl,
        });
        const aptos = new Aptos(aptosConfig);

        // Deserialize transaction and authenticator from base64
        const txBytes = Buffer.from(transactionB64, "base64");
        const sigBytes = Buffer.from(signatureB64, "base64");

        console.log(`[/settle] Transaction bytes length: ${txBytes.length}`);
        console.log(`[/settle] Signature bytes length: ${sigBytes.length}`);

        const transaction = SimpleTransaction.deserialize(new Deserializer(txBytes));
        const authenticator = AccountAuthenticator.deserialize(new Deserializer(sigBytes));

        console.log(`[/settle] Submitting to Movement network: ${moveConfig.rpcUrl}`);

        // Submit the pre-signed transaction
        const result = await aptos.transaction.submit.simple({
          transaction,
          senderAuthenticator: authenticator,
        });

        console.log(`[/settle] ✅ Movement transaction submitted: ${result.hash}`);

        // Wait for transaction confirmation
        const txResult = await aptos.waitForTransaction({
          transactionHash: result.hash,
        });

        console.log(`[/settle] ✅ Movement transaction confirmed: ${txResult.hash}`);

        // Response format per Aptos x402 spec
        return res.json({
          success: true,
          txHash: txResult.hash,
          transaction: txResult.hash,  // Alias for compatibility
          networkId: network,
          network,  // Alias for compatibility
          payer: movementPayer,
          error: null
        });
      } catch (moveErr: any) {
        console.log(`[/settle] ❌ Movement transaction failed:`, moveErr?.message);
        if (moveErr?.data) {
          console.log(`[/settle] ❌ Movement error data:`, JSON.stringify(moveErr.data));
        }

        // Detailed error handling for common Aptos errors
        let errorMessage = moveErr?.message || "Movement transaction failed";
        if (errorMessage.includes("INSUFFICIENT_BALANCE")) {
          errorMessage = "Insufficient balance for transaction";
        } else if (errorMessage.includes("SEQUENCE_NUMBER")) {
          errorMessage = "Transaction sequence number conflict - please retry";
        } else if (errorMessage.includes("INVALID_SIGNATURE")) {
          errorMessage = "Invalid transaction signature";
        }

        // Response format per Aptos x402 spec
        return res.json({
          success: false,
          txHash: null,
          networkId: network,
          error: errorMessage,
          errorReason: errorMessage  // Alias for compatibility
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXACT SCHEME (EVM): Execute on-chain via transferWithAuthorization
    // ═══════════════════════════════════════════════════════════════════════════
    if (scheme === "exact") {
      console.log(`[/settle] EXACT scheme - executing on-chain transferWithAuthorization`);

      // Extract EVM PaymentAuthorization and EIP-712 data
      const authorization = payload?.authorization || payload?.data?.message;
      const signature = payload?.signature;
      const domain = payload?.domain;
      const types = payload?.types;

      if (!authorization) {
        console.log(`[/settle] ❌ Missing authorization in payload`);
        return res.json({ success: false, errorReason: "Missing authorization in payload" });
      }

      if (!signature) {
        console.log(`[/settle] ❌ Missing signature in payload`);
        return res.json({ success: false, errorReason: "Missing signature in payload" });
      }

      const payer = authorization?.from || authorization?.fromAddress;
      const merchant = authorization?.to || authorization?.toAddress;
      const value = authorization?.value || authorization?.amount;
      const validAfter = authorization?.validAfter || 0;
      const validBefore = authorization?.validBefore || 9999999999;
      const nonce = authorization?.nonce;

      if (!payer || !merchant || !value || !nonce) {
        console.log(`[/settle] ❌ Missing required fields in authorization`);
        return res.json({ success: false, errorReason: "Missing required fields in authorization (from, to, value, nonce)" });
      }

      console.log(`[/settle] Payer: ${payer}`);
      console.log(`[/settle] Merchant: ${merchant}`);
      console.log(`[/settle] Amount: ${value}`);
      console.log(`[/settle] Network: ${network}`);
      console.log(`[/settle] Nonce: ${typeof nonce === 'string' ? nonce.slice(0, 20) + '...' : nonce}`);

      // Get chain config for RPC URL
      const config = chainConfig[network.toLowerCase()];
      if (!config) {
        console.log(`[/settle] ❌ Unsupported network: ${network}`);
        return res.json({ success: false, errorReason: `Unsupported network: ${network}` });
      }

      // CRITICAL: Use the contract address from paymentRequirements (what user signed for)
      // NOT the chainConfig address - they must match or signature verification fails!
      const contractAddress = paymentRequirements?.asset || config.contractAddress;

      console.log(`[/settle] Contract from requirements: ${paymentRequirements?.asset}`);
      console.log(`[/settle] Contract from config: ${config.contractAddress}`);

      if (paymentRequirements?.asset && paymentRequirements.asset.toLowerCase() !== config.contractAddress.toLowerCase()) {
        console.log(`[/settle] ⚠️ WARNING: Asset mismatch! Using paymentRequirements.asset`);
      }

      // Check for private key
      const privateKey = process.env.FACILITATOR_PRIVATE_KEY || process.env.PRIVATE_KEY;
      if (!privateKey) {
        console.log(`[/settle] ❌ Missing FACILITATOR_PRIVATE_KEY`);
        return res.json({ success: false, errorReason: "Facilitator not configured for on-chain settlement" });
      }

      // Setup provider and wallet
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const wallet = new ethers.Wallet(privateKey, provider);
      const contract = new ethers.Contract(contractAddress, erc20abi, wallet);

      console.log(`[/settle] Using RPC: ${config.rpcUrl}`);
      console.log(`[/settle] Contract: ${contractAddress}`);
      console.log(`[/settle] Relayer: ${wallet.address}`);

      // Parse signature into v, r, s components
      const sig = ethers.Signature.from(signature);
      console.log(`[/settle] Signature parsed: v=${sig.v}, r=${sig.r.slice(0, 20)}...`);

      // Verify the signer locally before calling contract (for debugging)
      try {
        const domain = {
          name: paymentRequirements?.extra?.name || "USDC",  // Testnet USDC uses "USDC"
          version: paymentRequirements?.extra?.version || "2",
          chainId: toChainId(network) || 84532,
          verifyingContract: contractAddress
        };
        const types = {
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" }
          ]
        };
        const message = {
          from: payer,
          to: merchant,
          value: BigInt(value),
          validAfter: BigInt(validAfter),
          validBefore: BigInt(validBefore),
          nonce: nonce
        };

        console.log(`[/settle] EIP-712 Domain for verification:`, JSON.stringify(domain, (_, v) => typeof v === 'bigint' ? v.toString() : v));
        console.log(`[/settle] EIP-712 Message:`, JSON.stringify(message, (_, v) => typeof v === 'bigint' ? v.toString() : v));

        const recoveredAddress = ethers.verifyTypedData(domain, types, message, signature);
        console.log(`[/settle] Recovered signer: ${recoveredAddress}`);
        console.log(`[/settle] Expected signer (from): ${payer}`);

        if (recoveredAddress.toLowerCase() !== payer.toLowerCase()) {
          console.log(`[/settle] ❌ SIGNATURE MISMATCH! Recovered ${recoveredAddress} != ${payer}`);
          console.log(`[/settle] This means the EIP-712 domain or message doesn't match what was signed.`);
          console.log(`[/settle] Check: domain.name="${domain.name}", domain.version="${domain.version}", chainId=${domain.chainId}`);
        } else {
          console.log(`[/settle] ✅ Signature verified locally - signer matches!`);
        }
      } catch (verifyErr: any) {
        console.log(`[/settle] ⚠️ Local signature verification failed:`, verifyErr?.message);
      }

      // Pass values directly as received from the client (like reference implementation)
      // ethers.js v6 handles type coercion automatically
      console.log(`[/settle] Contract call params:`);
      console.log(`  from: ${payer}`);
      console.log(`  to: ${merchant}`);
      console.log(`  value: ${value}`);
      console.log(`  validAfter: ${validAfter}`);
      console.log(`  validBefore: ${validBefore}`);
      console.log(`  nonce: ${typeof nonce === 'string' ? nonce.slice(0, 20) + '...' : nonce}`);
      console.log(`  v: ${sig.v}, r: ${sig.r.slice(0, 10)}..., s: ${sig.s.slice(0, 10)}...`);

      // Call transferWithAuthorization on USDC contract
      // Pass values directly without conversion (matching reference implementation)
      console.log(`[/settle] Calling transferWithAuthorization...`);
      try {
        const tx = await contract.transferWithAuthorization(
          payer,       // from (address)
          merchant,    // to (address)
          value,       // value (passed directly as string/number)
          validAfter,  // validAfter (passed directly)
          validBefore, // validBefore (passed directly)
          nonce,       // nonce (bytes32 as hex string)
          sig.v,       // v
          sig.r,       // r
          sig.s        // s
        );

        console.log(`[/settle] Transaction submitted: ${tx.hash}`);
        console.log(`[/settle] Waiting for confirmation...`);

        const receipt = await tx.wait();
        const txHash = receipt?.hash || tx.hash;

        console.log(`[/settle] ✅ Success (exact): txHash=${txHash}`);
        return res.json({
          success: true,
          txHash,
          transaction: txHash,
          network,
          payer
        });
      } catch (txError: any) {
        // Extract more details from contract revert
        console.log(`[/settle] ❌ Contract call failed:`, txError?.message);
        if (txError?.data) {
          console.log(`[/settle] ❌ Revert data:`, txError.data);
        }
        if (txError?.reason) {
          console.log(`[/settle] ❌ Revert reason:`, txError.reason);
        }
        if (txError?.code) {
          console.log(`[/settle] ❌ Error code:`, txError.code);
        }
        if (txError?.info) {
          console.log(`[/settle] ❌ Error info:`, JSON.stringify(txError.info));
        }

        // Try to get more info from the error
        let errorReason = txError?.reason || txError?.message || "Contract execution reverted";

        // Check for specific error patterns
        if (errorReason.includes("execution reverted") || errorReason.includes("invalid signature")) {
          // Log authorization details for debugging
          console.log(`[/settle] ❌ DEBUG - Authorization details:`);
          console.log(`   from: ${payer} (type: ${typeof payer})`);
          console.log(`   to: ${merchant} (type: ${typeof merchant})`);
          console.log(`   value: ${value} (type: ${typeof value})`);
          console.log(`   validAfter: ${validAfter} (type: ${typeof validAfter})`);
          console.log(`   validBefore: ${validBefore} (type: ${typeof validBefore})`);
          console.log(`   nonce: ${nonce} (type: ${typeof nonce})`);
          console.log(`   signature: ${signature?.slice(0, 40)}...`);

          errorReason += ". Possible causes: (1) EIP-712 domain mismatch - verify domain name/version matches USDC contract, (2) Nonce already used, (3) Authorization expired (validBefore < now), (4) Insufficient balance in payer wallet, (5) Signature signed with wrong account.";
        }

        return res.json({ success: false, errorReason });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTENT SCHEME: Forward to Stableyard Money Account
    // ═══════════════════════════════════════════════════════════════════════════
    console.log(`[/settle] INTENT scheme - forwarding to Stableyard /sdk/v1/settle`);

    // Extract intent authorization data
    const intentAuthorization = payload?.authorization || payload?.data?.message;
    const intentSignature = payload?.signature;
    const intentDomain = payload?.domain;
    const intentTypes = payload?.types;
    const intentPayer = intentAuthorization?.from || intentAuthorization?.fromAddress;

    const settleResult = await sySettle({
      authorization: intentAuthorization,
      signature: intentSignature,
      domain: intentDomain || { name: "x402plus", version: "1", chainId: toChainId(network) || 137 },
      types: intentTypes || {
        PaymentAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" }
        ]
      }
    });

    if (!settleResult.success) {
      console.log(`[/settle] ❌ Stableyard settle failed:`, settleResult.error);
      return res.json({
        success: false,
        errorReason: settleResult.error || "Settlement failed"
      });
    }

    console.log(`[/settle] ✅ Success (intent): requestId=${settleResult.requestId}`);
    return res.json({
      success: true,
      txHash: settleResult.requestId,
      transaction: settleResult.requestId,
      requestId: settleResult.requestId,
      network,
      payer: intentPayer
    });

  } catch (e: any) {
    console.log(`[/settle] ❌ Error:`, e?.message);
    return res.json({ success: false, errorReason: e?.message || "Settlement error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /debug/usdc-domain - Query USDC contract for actual EIP-712 domain
// ─────────────────────────────────────────────────────────────────────────────
app.get("/debug/usdc-domain", async (req, res) => {
  const network = (req.query.network as string) || "base-sepolia";
  console.log(`[/debug/usdc-domain] Querying USDC domain for network: ${network}`);

  const config = chainConfig[network.toLowerCase()];
  if (!config) {
    return res.status(400).json({ error: `Unsupported network: ${network}` });
  }

  try {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const contract = new ethers.Contract(config.contractAddress, erc20abi, provider);

    // Query contract for domain values
    const [name, version, domainSeparator] = await Promise.all([
      contract.name().catch(() => "UNKNOWN"),
      contract.version().catch(() => "UNKNOWN"),
      contract.DOMAIN_SEPARATOR().catch(() => "UNKNOWN")
    ]);

    const chainId = toChainId(network);

    // Calculate expected domain separator
    const expectedDomain = {
      name,
      version,
      chainId,
      verifyingContract: config.contractAddress
    };

    const calculatedSeparator = ethers.TypedDataEncoder.hashDomain(expectedDomain);

    const result = {
      network,
      contractAddress: config.contractAddress,
      rpcUrl: config.rpcUrl,
      contractDomain: {
        name,
        version,
        chainId,
        verifyingContract: config.contractAddress
      },
      domainSeparatorFromContract: domainSeparator,
      calculatedDomainSeparator: calculatedSeparator,
      domainMatch: domainSeparator === calculatedSeparator,
      recommendation: domainSeparator === calculatedSeparator
        ? "Domain matches! Use these values for signing."
        : `MISMATCH! Contract expects different domain. Check chainId or other fields.`
    };

    console.log(`[/debug/usdc-domain] Result:`, JSON.stringify(result, null, 2));
    res.json(result);
  } catch (e: any) {
    console.log(`[/debug/usdc-domain] Error:`, e?.message);
    res.status(500).json({ error: e?.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /debug/verify-signature - Verify a signature locally
// ─────────────────────────────────────────────────────────────────────────────
app.post("/debug/verify-signature", async (req, res) => {
  const { authorization, signature, domain, network } = req.body;
  console.log(`[/debug/verify-signature] Verifying signature...`);

  try {
    const config = chainConfig[(network || "base-sepolia").toLowerCase()];
    const contractAddress = config?.contractAddress || domain?.verifyingContract;

    const fullDomain = {
      name: domain?.name || "USDC",  // Testnet USDC uses "USDC"
      version: domain?.version || "2",
      chainId: domain?.chainId || toChainId(network) || 84532,
      verifyingContract: contractAddress
    };

    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" }
      ]
    };

    const message = {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce
    };

    console.log(`[/debug/verify-signature] Domain:`, JSON.stringify(fullDomain));
    console.log(`[/debug/verify-signature] Message:`, JSON.stringify(message, (_, v) => typeof v === 'bigint' ? v.toString() : v));

    const recoveredAddress = ethers.verifyTypedData(fullDomain, types, message, signature);

    const result = {
      expectedSigner: authorization.from,
      recoveredSigner: recoveredAddress,
      match: recoveredAddress.toLowerCase() === authorization.from.toLowerCase(),
      domain: fullDomain,
      message: {
        ...message,
        value: message.value.toString(),
        validAfter: message.validAfter.toString(),
        validBefore: message.validBefore.toString()
      }
    };

    console.log(`[/debug/verify-signature] Result:`, JSON.stringify(result, null, 2));
    res.json(result);
  } catch (e: any) {
    console.log(`[/debug/verify-signature] Error:`, e?.message);
    res.status(500).json({ error: e?.message });
  }
});

const port = Number(process.env.PORT || 5555);
app.listen(port, () => {
  console.log(`\n╔════════════════════════════════════════════════════════════════╗`);
  console.log(`║  x402plus Facilitator                                          ║`);
  console.log(`╠════════════════════════════════════════════════════════════════╣`);
  console.log(`║  URL: http://localhost:${port}                                   ║`);
  console.log(`║  Stableyard: ${(process.env.STABLEYARD_BASE_URL || "NOT CONFIGURED").slice(0, 45).padEnd(45)}  ║`);
  console.log(`║                                                                 ║`);
  console.log(`║  Debug endpoints:                                               ║`);
  console.log(`║    GET  /debug/usdc-domain?network=base-sepolia                 ║`);
  console.log(`║    POST /debug/verify-signature                                 ║`);
  console.log(`╚════════════════════════════════════════════════════════════════╝\n`);
});
