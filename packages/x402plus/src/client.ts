import { USDC, CHAIN_IDS } from "./types";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type ExactAccepts = {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: { name?: string; version?: string; payload?: any } | Record<string, any>;
};

export type IntentAccepts = {
  scheme: "intent";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  facilitatorUrl?: string;
  extra?: {
    status?: string;
    quoteId?: string;
    expiresAt?: number;
    eip712?: { domain: any; types: any; message: any; primaryType: string };
    action?: any;
    balance?: string;
    required?: string;
    facilitatorUrl?: string;
  } | Record<string, any>;
};

export type Signer = {
  signExact: (accepts: ExactAccepts) => Promise<string>;
  signIntent: (accepts: IntentAccepts) => Promise<string>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function decodePaymentResponse(header: string | null | undefined): any | null {
  if (!header) return null;
  try {
    const json = atob(header);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function toBase64(obj: any): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}

// ---------------------------------------------------------------------------
// Network switching — supports all 5 EVM mainnets + testnets
// ---------------------------------------------------------------------------

const CHAIN_CONFIGS: Record<string, { chainId: string; chainName: string; rpcUrls: string[]; blockExplorerUrls: string[] }> = {
  ethereum: { chainId: "0x1", chainName: "Ethereum", rpcUrls: ["https://eth.llamarpc.com"], blockExplorerUrls: ["https://etherscan.io"] },
  base: { chainId: "0x2105", chainName: "Base", rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] },
  polygon: { chainId: "0x89", chainName: "Polygon", rpcUrls: ["https://polygon-rpc.com"], blockExplorerUrls: ["https://polygonscan.com"] },
  arbitrum: { chainId: "0xA4B1", chainName: "Arbitrum One", rpcUrls: ["https://arb1.arbitrum.io/rpc"], blockExplorerUrls: ["https://arbiscan.io"] },
  optimism: { chainId: "0xA", chainName: "OP Mainnet", rpcUrls: ["https://mainnet.optimism.io"], blockExplorerUrls: ["https://optimistic.etherscan.io"] },
  "base-sepolia": { chainId: "0x14A34", chainName: "Base Sepolia", rpcUrls: ["https://base-sepolia-rpc.publicnode.com"], blockExplorerUrls: ["https://sepolia.basescan.org"] },
  "polygon-amoy": { chainId: "0x13882", chainName: "Polygon Amoy", rpcUrls: ["https://rpc-amoy.polygon.technology"], blockExplorerUrls: ["https://amoy.polygonscan.com"] },
};

async function ensureNetwork(network: string, ethereum: any): Promise<void> {
  const config = CHAIN_CONFIGS[network];
  if (!config) return;
  try {
    const current = await ethereum.request({ method: "eth_chainId" });
    if (current?.toLowerCase() === config.chainId.toLowerCase()) return;
    try {
      await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: config.chainId }] });
    } catch {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: config.chainId,
          chainName: config.chainName,
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: config.rpcUrls,
          blockExplorerUrls: config.blockExplorerUrls,
        }]
      });
    }
  } catch {
    // ignore — user may reject
  }
}

// ---------------------------------------------------------------------------
// EVM Injected Signer
// ---------------------------------------------------------------------------

export function evmInjectedSigner(ethereum: any): Signer {
  return {
    /**
     * Sign exact scheme: standard EIP-3009 TransferWithAuthorization on USDC
     */
    async signExact(accepts: ExactAccepts): Promise<string> {
      if (!ethereum) throw new Error("No injected wallet");
      const accounts = await ethereum.request({ method: "eth_requestAccounts" });
      const from = accounts[0];
      await ensureNetwork(accepts.network, ethereum);
      const chainIdHex = await ethereum.request({ method: "eth_chainId" });

      const domain = {
        name: (accepts.extra as any)?.name || (accepts.extra as any)?.payload?.eip712?.domain?.name || "USD Coin",
        version: (accepts.extra as any)?.version || (accepts.extra as any)?.payload?.eip712?.domain?.version || "2",
        chainId: parseInt(chainIdHex, 16),
        verifyingContract: accepts.asset,
      };
      const types = {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      };
      const validBefore = nowSeconds() + (parseInt(String(accepts.maxTimeoutSeconds ?? 120), 10));
      const validAfter = nowSeconds() - 600;
      const nonce = (() => {
        const arr = crypto.getRandomValues(new Uint8Array(32));
        return "0x" + Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
      })();

      const message = { from, to: accepts.payTo, value: accepts.maxAmountRequired, validAfter, validBefore, nonce };
      const data = {
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          ...types,
        },
        domain,
        primaryType: "TransferWithAuthorization",
        message,
      };

      const signature = await ethereum.request({
        method: "eth_signTypedData_v4",
        params: [from, JSON.stringify(data)],
      });

      return toBase64({
        x402Version: 1,
        scheme: "exact",
        network: accepts.network,
        payload: {
          signature,
          authorization: {
            from, to: accepts.payTo,
            value: String(accepts.maxAmountRequired),
            validAfter: String(validAfter),
            validBefore: String(validBefore),
            nonce,
          },
        },
      });
    },

    /**
     * Sign intent scheme: signs Stableyard's EIP-712 typed data from the 402 response.
     *
     * The 402 response's `extra.eip712` contains the exact domain, types, message,
     * and primaryType that Stableyard expects (e.g., Settlement { quoteId, nonce, deadline }).
     * We sign exactly that — no custom PaymentAuthorization format.
     */
    async signIntent(accepts: IntentAccepts): Promise<string> {
      if (!ethereum) throw new Error("No injected wallet");
      const accounts = await ethereum.request({ method: "eth_requestAccounts" });
      const from = accounts[0];

      const extra = accepts.extra || {};
      const eip712 = (extra as any).eip712;

      if (!eip712) {
        throw new Error(
          "Intent scheme requires extra.eip712 from 402 response. " +
          "Call facilitator /prepare first to get a quote with EIP-712 typed data."
        );
      }

      // Check quote expiry before signing
      const expiresAt = (extra as any).expiresAt;
      if (expiresAt && nowSeconds() >= expiresAt) {
        throw new Error("Quote expired. Re-fetch from facilitator /prepare.");
      }

      // Switch to the right network if needed
      await ensureNetwork(accepts.network, ethereum);

      // Sign the exact EIP-712 data from Stableyard
      const { domain, types, message, primaryType } = eip712;

      // Build EIP712Domain type from domain fields
      const domainType: Array<{ name: string; type: string }> = [];
      if (domain.name !== undefined) domainType.push({ name: "name", type: "string" });
      if (domain.version !== undefined) domainType.push({ name: "version", type: "string" });
      if (domain.chainId !== undefined) domainType.push({ name: "chainId", type: "uint256" });
      if (domain.verifyingContract !== undefined) domainType.push({ name: "verifyingContract", type: "address" });
      if (domain.salt !== undefined) domainType.push({ name: "salt", type: "bytes32" });

      const fullData = {
        types: { EIP712Domain: domainType, ...types },
        domain,
        primaryType,
        message,
      };

      const signature = await ethereum.request({
        method: "eth_signTypedData_v4",
        params: [from, JSON.stringify(fullData)],
      });

      return toBase64({
        x402Version: 1,
        scheme: "intent",
        network: accepts.network,
        payload: {
          signature,
          from,
          quoteId: (extra as any).quoteId,
          eip712: { domain, types, message, primaryType },
        },
      });
    },
  };
}

// ---------------------------------------------------------------------------
// withPayments — zero-config fetch wrapper
// ---------------------------------------------------------------------------

export type WithPaymentsOptions = {
  /** Preferred scheme: "auto" tries intent first, falls back to exact */
  prefer?: "auto" | "exact" | "intent";
  /** Auto-deposit into GRID ID vault when balance insufficient (default: true) */
  autoDeposit?: boolean;
  /** Minimum deposit amount in dollars (deposits at least this much for buffer) */
  minDeposit?: number;
};

/**
 * Zero-config payment-aware fetch wrapper.
 *
 * ```ts
 * const fetch = withPayments(window.ethereum);
 * const res = await fetch("https://api.example.com/premium");
 * const data = await res.json();
 * ```
 *
 * Handles:
 * - 402 detection and automatic payment signing
 * - Scheme selection (exact vs intent)
 * - GRID ID lifecycle via /prepare state machine
 * - Auto-deposit when balance is insufficient
 * - Quote expiry detection and re-fetch
 * - X-PAYER header for prefetch optimization
 */
export function withPayments(
  ethereum: any,
  options?: WithPaymentsOptions
) {
  const prefer = options?.prefer ?? "auto";
  const autoDeposit = options?.autoDeposit ?? true;
  const minDeposit = options?.minDeposit;
  const signer = evmInjectedSigner(ethereum);

  let cachedAddress: string | null = null;

  async function getAddress(): Promise<string> {
    if (cachedAddress) return cachedAddress;
    const accounts = await ethereum.request({ method: "eth_requestAccounts" });
    cachedAddress = accounts[0];
    return cachedAddress!;
  }

  return async function paymentFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const address = await getAddress();

    // First request — include X-PAYER for prefetch optimization
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string> || {}),
      "X-PAYER": address,
    };

    const r1 = await fetch(url, { ...init, headers });
    if (r1.status !== 402) return r1;

    const pr = await r1.json();
    const accepts: any[] = Array.isArray(pr.accepts) ? pr.accepts : [];
    if (accepts.length === 0) return r1;

    // Pick scheme based on preference
    let chosen: any = null;
    if (prefer === "exact") {
      chosen = accepts.find((a: any) => a.scheme === "exact") || accepts[0];
    } else if (prefer === "intent") {
      chosen = accepts.find((a: any) => a.scheme === "intent") || accepts[0];
    } else {
      // Auto: prefer intent if available, else exact
      chosen = accepts.find((a: any) => a.scheme === "intent") || accepts[0];
    }

    let xPayment: string;

    if (chosen.scheme === "intent") {
      // Intent flow: may need to call /prepare if no eip712 in response
      const facilitatorUrl = chosen.facilitatorUrl || chosen.extra?.facilitatorUrl || "";
      let intentData = chosen;

      if (!chosen.extra?.eip712 && facilitatorUrl) {
        // No prefetched quote — call /prepare
        intentData = await handlePrepareFlow(
          facilitatorUrl, address, chosen, autoDeposit, minDeposit, signer
        );
      }

      xPayment = await signer.signIntent(intentData);
    } else {
      xPayment = await signer.signExact(chosen);
    }

    // Retry with payment
    return fetch(url, {
      ...init,
      headers: { ...(init?.headers as Record<string, string> || {}), "X-PAYMENT": xPayment },
    });
  };
}

/**
 * Handle the /prepare state machine for intent payments.
 * Walks through: needs_grid_id → needs_activation → needs_deposit → ready
 */
async function handlePrepareFlow(
  facilitatorUrl: string,
  fromAddress: string,
  accepts: any,
  autoDeposit: boolean,
  minDeposit: number | undefined,
  signer: Signer,
): Promise<IntentAccepts> {
  const baseUrl = facilitatorUrl.replace(/\/$/, "");

  async function callPrepare(): Promise<any> {
    const resp = await fetch(`${baseUrl}/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromAddress,
        to: accepts.payTo,
        amount: accepts.maxAmountRequired,
        network: accepts.network,
      }),
    });
    return resp.json();
  }

  let prepare = await callPrepare();

  // State machine: walk through GRID ID lifecycle
  if (prepare.status === "needs_grid_id") {
    // Create GRID ID via /account
    const accountResp = await fetch(`${baseUrl}/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: fromAddress }),
    });
    await accountResp.json();
    prepare = await callPrepare();
  }

  if (prepare.status === "needs_activation") {
    // Activate vault — sign the activation transaction
    if (prepare.action?.sign) {
      const ethereum = (globalThis as any).ethereum;
      if (!ethereum) throw new Error("No wallet for vault activation");

      const accounts = await ethereum.request({ method: "eth_requestAccounts" });
      const from = accounts[0];
      const signature = await ethereum.request({
        method: "eth_signTypedData_v4",
        params: [from, JSON.stringify(prepare.action.sign)],
      });

      await fetch(`${baseUrl}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: fromAddress,
          signature,
          txData: prepare.action.sign,
        }),
      });
    }
    prepare = await callPrepare();
  }

  if (prepare.status === "needs_deposit" && autoDeposit) {
    // Deposit into vault — use exact scheme payment to deposit address
    const depositAddr = prepare.action?.depositAddress;
    const depositNetwork = prepare.action?.network || accepts.network;
    const required = prepare.required || accepts.maxAmountRequired;
    const depositAmount = minDeposit
      ? String(Math.max(Number(required), Math.round(minDeposit * 1e6)))
      : required;

    if (depositAddr) {
      // Build a synthetic exact accepts for the deposit
      const depositAccepts: ExactAccepts = {
        scheme: "exact",
        network: depositNetwork,
        maxAmountRequired: depositAmount,
        resource: "",
        description: "GRID ID vault deposit",
        mimeType: "application/json",
        payTo: depositAddr,
        maxTimeoutSeconds: 120,
        asset: accepts.asset,
        extra: accepts.extra,
      };

      const depositPayment = await signer.signExact(depositAccepts);
      await fetch(`${baseUrl}/deposit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PAYMENT": depositPayment,
        },
        body: JSON.stringify({
          address: fromAddress,
          amount: depositAmount,
          network: depositNetwork,
        }),
      });
    }
    prepare = await callPrepare();
  }

  if (prepare.status !== "ready") {
    throw new Error(`GRID ID setup incomplete. Status: ${prepare.status}`);
  }

  // Return updated accepts with quote eip712 data
  return {
    ...accepts,
    extra: {
      ...prepare,
      facilitatorUrl,
    },
  } as IntentAccepts;
}

// ---------------------------------------------------------------------------
// createGridClient — intermediate-level client
// ---------------------------------------------------------------------------

export type GridClientOptions = {
  prefer?: "auto" | "exact" | "intent";
  autoDeposit?: boolean;
  minDeposit?: number;
};

export type GridClient = {
  /** Get the connected wallet address */
  getAddress: () => Promise<string>;
  /** Check GRID ID status and balance */
  getStatus: () => Promise<any>;
  /** Setup GRID ID (create + activate) */
  setup: () => Promise<any>;
  /** Deposit into GRID ID vault */
  deposit: (amount: number) => Promise<any>;
  /** Payment-aware fetch */
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Get the underlying signer */
  signer: Signer;
};

/**
 * Intermediate client with explicit GRID ID lifecycle control.
 *
 * ```ts
 * const grid = createGridClient(window.ethereum, "https://facilitator.example.com");
 * const status = await grid.getStatus();
 * if (status.status !== "ready") await grid.setup();
 * const res = await grid.fetch("https://api.example.com/premium");
 * ```
 */
export function createGridClient(
  ethereum: any,
  facilitatorUrl: string,
  options?: GridClientOptions
): GridClient {
  const baseUrl = facilitatorUrl.replace(/\/$/, "");
  const signer = evmInjectedSigner(ethereum);
  const paymentFetch = withPayments(ethereum, options);
  let cachedAddress: string | null = null;

  async function getAddress(): Promise<string> {
    if (cachedAddress) return cachedAddress;
    const accounts = await ethereum.request({ method: "eth_requestAccounts" });
    cachedAddress = accounts[0];
    return cachedAddress!;
  }

  return {
    getAddress,
    signer,

    async getStatus() {
      const address = await getAddress();
      const resp = await fetch(`${baseUrl}/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: address, to: "0x0000000000000000000000000000000000000000", amount: "0", network: "base" }),
      });
      return resp.json();
    },

    async setup() {
      const address = await getAddress();
      // Create account
      const accountResp = await fetch(`${baseUrl}/account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const account = await accountResp.json();

      // If activation needed, sign and activate
      if (account.activation?.txData) {
        const accounts = await ethereum.request({ method: "eth_requestAccounts" });
        const signature = await ethereum.request({
          method: "eth_signTypedData_v4",
          params: [accounts[0], JSON.stringify(account.activation.txData)],
        });
        await fetch(`${baseUrl}/activate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, signature, txData: account.activation.txData }),
        });
      }
      return account;
    },

    async deposit(amountDollars: number) {
      const address = await getAddress();
      const amount = String(Math.round(amountDollars * 1e6));
      const resp = await fetch(`${baseUrl}/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, amount, network: "base" }),
      });
      return resp.json();
    },

    fetch: paymentFetch,
  };
}

// ---------------------------------------------------------------------------
// Legacy: wrapFetchWithPayment (backward compatible)
// ---------------------------------------------------------------------------

export type ClientOptions = {
  signer: Signer;
  prefer?: "auto" | "exact" | "intent";
  negotiation?: "query" | "header";
};

export function wrapFetchWithPayment(baseFetch: typeof fetch, opts: ClientOptions) {
  const prefer = opts.prefer ?? "auto";
  const negotiation = opts.negotiation ?? "query";
  return async function fetchWithPayment(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const negotiatedUrl = (prefer === "intent" && negotiation === "query")
      ? (url.includes("?") ? `${url}&x402Type=intent` : `${url}?x402Type=intent`)
      : url;
    const r1 = await baseFetch(negotiation === "header" ? url : negotiatedUrl, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        ...(prefer === "intent" && negotiation === "header" ? { "X-X402-PLUS": "intent" } : {}),
      },
    });
    if (r1.status !== 402) return r1;
    const pr = await r1.json();
    const accepts = Array.isArray(pr.accepts) ? pr.accepts[0] : undefined;
    if (!accepts) return r1;
    const scheme = (prefer === "auto") ? accepts.scheme : prefer;
    const xPayment = (scheme === "intent")
      ? await opts.signer.signIntent(accepts)
      : await opts.signer.signExact(accepts);
    return baseFetch(url, {
      ...init,
      headers: { ...(init?.headers || {}), "X-PAYMENT": xPayment },
    });
  };
}

// ---------------------------------------------------------------------------
// Aptos/Movement signer helpers (exact-only, no intent support)
// ---------------------------------------------------------------------------

export type AptosLikeSignResult = {
  signatureBcsBase64: string;
  transactionBcsBase64: string;
};

export function buildAptosLikePaymentHeader(
  accepts: ExactAccepts,
  signResult: AptosLikeSignResult
): string {
  return toBase64({
    x402Version: 1,
    scheme: accepts.scheme,
    network: accepts.network,
    payload: {
      signature: signResult.signatureBcsBase64,
      transaction: signResult.transactionBcsBase64,
    },
  });
}

export function aptosLikeSigner(signFn: (accepts: ExactAccepts) => Promise<AptosLikeSignResult>): Signer {
  return {
    async signExact(accepts: ExactAccepts): Promise<string> {
      const res = await signFn(accepts);
      return buildAptosLikePaymentHeader(accepts, res);
    },
    async signIntent(_accepts: IntentAccepts): Promise<string> {
      throw new Error("Intent scheme is not supported for Aptos-like payments.");
    },
  };
}
