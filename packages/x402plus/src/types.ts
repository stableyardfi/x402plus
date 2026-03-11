/**
 * Field definition for outputSchema (x402 standard)
 */
export type FieldDef = {
  type?: string;
  required?: boolean | string[];
  description?: string;
  enum?: string[];
  properties?: Record<string, FieldDef>;
};

/**
 * Output schema describing input/output for the paid endpoint (x402 standard)
 */
export type OutputSchema = {
  input: {
    type: "http";
    method: "GET" | "POST";
    bodyType?: "json" | "form-data" | "multipart-form-data" | "text" | "binary";
    queryParams?: Record<string, FieldDef>;
    bodyFields?: Record<string, FieldDef>;
    headerFields?: Record<string, FieldDef>;
  };
  output?: Record<string, unknown>;
};

/**
 * Payment requirements - extends x402 standard with intent scheme
 *
 * x402 standard fields: scheme, network, maxAmountRequired, resource, description,
 *                       mimeType, payTo, maxTimeoutSeconds, asset, outputSchema, extra
 *
 * x402plus extension: scheme can be "exact" (standard) or "intent" (vault-based)
 */
export type PaymentRequirements = {
  /** Payment scheme: "exact" (x402 standard) or "intent" (x402plus extension) */
  scheme: "exact" | "intent";
  /** Network identifier (e.g., "base", "polygon", "polygon-amoy") */
  network: string;
  /** Maximum amount required in smallest unit (e.g., "1000000" for $1 USDC) */
  maxAmountRequired: string;
  /** Full URL of the protected resource */
  resource: string;
  /** Human-readable description of the payment */
  description: string;
  /** Expected response MIME type */
  mimeType: string;
  /** Merchant's receiving address */
  payTo: string;
  /** Maximum time in seconds for payment completion */
  maxTimeoutSeconds: number;
  /** Token address or symbol */
  asset: string;
  /** Schema describing input/output for the paid endpoint (x402 standard) */
  outputSchema?: OutputSchema;
  /** Optional facilitator URL for intent-based payments */
  facilitatorUrl?: string;
  /** Additional scheme-specific data */
  extra?: Record<string, unknown>;
};

/**
 * 402 Payment Required response - x402 standard format
 */
export type PaymentRequiredResponse = {
  /** Protocol version */
  x402Version: number;
  /** Array of accepted payment options */
  accepts: PaymentRequirements[];
  /** Error message if payment failed */
  error?: string;
  /** Payer address (returned after successful payment) */
  payer?: string;
};

export function toBase64Json(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

export function fromBase64Json<T>(b64: string): T {
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as T;
}

// ---------------------------------------------------------------------------
// USDC address map per chain
// ---------------------------------------------------------------------------
export const USDC: Record<string, { address: string; chainId: number; decimals: number; name: string; version: string }> = {
  ethereum: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", chainId: 1, decimals: 6, name: "USD Coin", version: "2" },
  base: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", chainId: 8453, decimals: 6, name: "USD Coin", version: "2" },
  polygon: { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", chainId: 137, decimals: 6, name: "USD Coin", version: "2" },
  arbitrum: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", chainId: 42161, decimals: 6, name: "USD Coin", version: "2" },
  optimism: { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", chainId: 10, decimals: 6, name: "USD Coin", version: "2" },
  // Testnets
  "base-sepolia": { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", chainId: 84532, decimals: 6, name: "USDC", version: "2" },
  "polygon-amoy": { address: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", chainId: 80002, decimals: 6, name: "USDC", version: "2" },
  // Solana
  solana: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", chainId: 0, decimals: 6, name: "USD Coin", version: "" },
  "solana-devnet": { address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", chainId: 0, decimals: 6, name: "USD Coin", version: "" },
  // Movement (USDC.e bridged via LayerZero OFT)
  movement: { address: "0x4d2969d384e440db9f1a51391cfc261d1ec08ee1bdf7b9711a6c05d485a4110a", chainId: 0, decimals: 6, name: "USDC.e", version: "" },
  "movement-mainnet": { address: "0x4d2969d384e440db9f1a51391cfc261d1ec08ee1bdf7b9711a6c05d485a4110a", chainId: 0, decimals: 6, name: "USDC.e", version: "" },
  "movement-testnet": { address: "0x4d2969d384e440db9f1a51391cfc261d1ec08ee1bdf7b9711a6c05d485a4110a", chainId: 0, decimals: 6, name: "USDC.e", version: "" },
};

// ---------------------------------------------------------------------------
// Native token map (for explicit opt-in via asset: "native")
// ---------------------------------------------------------------------------
export const NATIVE_TOKENS: Record<string, { address: string; decimals: number; symbol: string }> = {
  solana:             { address: "So11111111111111111111111111111111111111112", decimals: 9, symbol: "SOL" },
  "solana-devnet":    { address: "So11111111111111111111111111111111111111112", decimals: 9, symbol: "SOL" },
  movement:           { address: "0x1::aptos_coin::AptosCoin", decimals: 8, symbol: "MOVE" },
  "movement-mainnet": { address: "0x1::aptos_coin::AptosCoin", decimals: 8, symbol: "MOVE" },
  "movement-testnet": { address: "0x1::aptos_coin::AptosCoin", decimals: 8, symbol: "MOVE" },
};

export function isNativeAsset(asset: string): boolean {
  return asset === "native" || asset === "0x1::aptos_coin::AptosCoin" || asset === "So11111111111111111111111111111111111111112";
}

// ---------------------------------------------------------------------------
// Chain ID map
// ---------------------------------------------------------------------------
export const CHAIN_IDS: Record<string, number> = {
  ethereum: 1, base: 8453, polygon: 137, arbitrum: 42161, optimism: 10,
  "base-sepolia": 84532, "polygon-amoy": 80002,
  solana: 0, "solana-devnet": 0,
};

// ---------------------------------------------------------------------------
// Solana network helpers
// ---------------------------------------------------------------------------
export function isSolanaNetwork(network: string): boolean {
  return network === "solana" || network === "solana-devnet" || network.startsWith("solana:");
}

export function isMovementNetwork(network: string): boolean {
  return network === "movement" || network === "movement-mainnet" || network === "movement-testnet";
}

// ---------------------------------------------------------------------------
// Dollar conversion helper
// ---------------------------------------------------------------------------
export function dollarToSmallestUnit(dollars: number, decimals: number = 6): string {
  return String(Math.round(dollars * (10 ** decimals)));
}

// ---------------------------------------------------------------------------
// Route shorthand type
// ---------------------------------------------------------------------------
export type RouteShorthand = number | {
  /** Price in USD (converted to USDC smallest unit). Used for all chains by default. */
  price: number;
  chain?: string;
  scheme?: "exact";
  prefetch?: boolean;
  description?: string;
  /**
   * Override asset for Solana/Movement.
   * - "native" → SOL on Solana, MOVE on Movement (price is in native token, not USD)
   * - undefined → USDC (default)
   */
  asset?: "native";
  /** Override price specifically for Solana native (in SOL, e.g. 0.001) */
  solanaPrice?: number;
  /** Override price specifically for Movement native (in MOVE, e.g. 1.0) */
  movementPrice?: number;
};

// ---------------------------------------------------------------------------
// Facilitator request / response types
// ---------------------------------------------------------------------------
export type FacilitatorPrepareRequest = {
  from: string;
  to: string;
  amount: string;
  network: string;
};

export type FacilitatorPrepareResponse = {
  status: "needs_grid_id" | "needs_activation" | "needs_deposit" | "ready";
  gridId?: string;
  quoteId?: string;
  expiresAt?: number;
  eip712?: { domain: any; types: any; message: any; primaryType: string };
  action?: {
    endpoint: string;
    method?: string;
    params?: any;
    sign?: any;
    depositAddress?: string;
    network?: string;
    asset?: string;
  };
  balance?: string;
  required?: string;
};

export type FacilitatorActivateRequest = {
  address: string;
  signature: string;
  txData: any;
};

export type FacilitatorActivateResponse = {
  activated: boolean;
  moduleAddress?: string;
};

export type FacilitatorDepositRequest = {
  address: string;
  amount: string;
  network: string;
};

export type FacilitatorDepositResponse = {
  deposited: boolean;
  balance?: string;
  txHash?: string;
};

export type FacilitatorAccountRequest = {
  address: string;
  chainType?: string;
  username?: string;
};

export type FacilitatorAccountResponse = {
  activated: boolean;
  accountAddress?: string | null;
  depositAddress?: string | null;
  chain?: string | null;
  token?: string | null;
  instructions?: string | null;
  signing?: any | null;
  balance?: any | null;
  gridId?: string | null;
  paymentAddress?: string | null;
  vaultAddress?: string | null;
  activation?: { txData: any } | null;
};

