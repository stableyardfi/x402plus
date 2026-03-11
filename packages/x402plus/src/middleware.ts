import type { Request, Response, NextFunction } from "express";
import { fromBase64Json, toBase64Json, USDC, NATIVE_TOKENS, dollarToSmallestUnit, isSolanaNetwork, isMovementNetwork, type PaymentRequirements, type RouteShorthand } from "./types";
import { buildSignerHints, buildSolanaSignerHints } from "./signingHints";
import type { FacilitatorClient } from "./facilitator";

export type RouteConfig = {
  network: string;
  asset: string;
  maxAmountRequired: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  outputSchema?: Record<string, unknown> | undefined;
  extra?: Record<string, unknown> | undefined;
  /** Only offer exact scheme (no intent). Best for high-frequency low-value endpoints. */
  scheme?: "exact";
  /** Pre-fetch Stableyard quote at 402 time when X-PAYER header present. Slower 402 but fewer round trips. */
  prefetch?: boolean;
  /** Native token price for Solana (in SOL, e.g. 0.001). If set, Solana accepts use SOL instead of USDC. */
  solanaPrice?: number;
  /** Native token price for Movement (in MOVE, e.g. 1.0). If set, Movement accepts use MOVE instead of USDC. */
  movementPrice?: number;
};

export type RoutesMap = Record<string, RouteConfig>;

export type SolanaConfig = {
  /** Solana wallet address to receive payments */
  payTo: string;
  /** USDC SPL mint address (auto-detected from facilitator if not set) */
  asset?: string;
  /** Solana network name or array of networks (e.g. "solana", ["solana", "solana-devnet"]) */
  network?: string | string[];
  /** @internal Facilitator's Solana public key — auto-fetched from facilitator /supported */
  feePayer?: string;
};

export type MovementConfig = {
  /** Movement wallet address to receive payments (0x-prefixed, 64-char hex) */
  payTo: string;
  /** Movement asset — undefined = USDC.e (default), "native" = MOVE token */
  asset?: string;
  /** Movement network name or array of networks (e.g. "movement", ["movement", "movement-testnet"]) */
  network?: string | string[];
};

export type MiddlewareInit = {
  payTo: string;
  routes: RoutesMap;
  facilitator: FacilitatorClient;
  facilitatorUrl?: string;
  /** Optional Solana support: adds Solana exact scheme to 402 accepts */
  solana?: SolanaConfig;
  /** Optional Movement support: adds Movement exact scheme to 402 accepts */
  movement?: MovementConfig;
  /** @internal Promise that resolves when facilitator /supported has been fetched */
  _initPromise?: Promise<void> | null;
};

function absoluteResourceUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = req.get("host");
  return `${proto}://${host}${req.originalUrl.split("?")[0]}`;
}

function toPaymentRequirements(resourceUrl: string, payTo: string, cfg: RouteConfig): PaymentRequirements {
  const reqs: PaymentRequirements = {
    scheme: "exact",
    network: cfg.network,
    maxAmountRequired: cfg.maxAmountRequired,
    resource: resourceUrl,
    description: cfg.description ?? "",
    mimeType: cfg.mimeType ?? "application/json",
    payTo,
    maxTimeoutSeconds: cfg.maxTimeoutSeconds ?? 120,
    asset: cfg.asset,
    extra: cfg.extra
  };
  if (cfg.outputSchema) {
    (reqs as any).outputSchema = cfg.outputSchema;
  }
  return reqs;
}

/**
 * Expand route shorthand into full RouteConfig.
 * - `1.00` → { network: "base", asset: USDC_BASE, maxAmountRequired: "1000000" }
 * - `{ price: 5.00, chain: "polygon" }` → uses polygon USDC
 * - `{ price: 0.01, scheme: "exact" }` → exact only
 * - `{ price: 5.00, prefetch: true }` → prefetch quote at 402 time
 */
function expandRoute(route: RouteShorthand, defaultChain: string = "base"): RouteConfig {
  if (typeof route === "number") {
    const chain = defaultChain;
    const chainInfo = USDC[chain];
    if (!chainInfo) throw new Error(`[x402plus] Unknown chain "${chain}". Supported: ${Object.keys(USDC).join(", ")}`);
    return {
      network: chain,
      asset: chainInfo.address,
      maxAmountRequired: dollarToSmallestUnit(route, chainInfo.decimals),
    };
  }

  const chain = route.chain || defaultChain;
  const chainInfo = USDC[chain];
  if (!chainInfo) throw new Error(`[x402plus] Unknown chain "${chain}". Supported: ${Object.keys(USDC).join(", ")}`);
  return {
    network: chain,
    asset: chainInfo.address,
    maxAmountRequired: dollarToSmallestUnit(route.price, chainInfo.decimals),
    description: route.description,
    scheme: route.scheme,
    prefetch: route.prefetch,
    solanaPrice: route.solanaPrice,
    movementPrice: route.movementPrice,
  };
}

/**
 * x402plus — Simplified payment middleware.
 *
 * Backend (minimal — 2 args, uses Stableyard facilitator):
 * ```ts
 * app.use(x402plus("0xYourAddress", {
 *   "GET /api/premium": 1.00,
 *   "POST /api/generate": { price: 5.00, chain: "polygon" },
 * }));
 * ```
 *
 * With options:
 * ```ts
 * app.use(x402plus("0xYourAddress", routes, {
 *   defaultChain: "polygon",
 *   solana: { payTo: "YourSolanaAddress" },
 *   movement: { payTo: "0x00...YourMovementAddress" },
 * }));
 * ```
 *
 * Custom facilitator:
 * ```ts
 * app.use(x402plus("0xYourAddress", routes, "https://custom-facilitator.com"));
 * ```
 */
export function x402plus(
  payTo: string,
  routes: Record<string, RouteShorthand>,
  optionsOrUrl?: string | {
    facilitatorUrl?: string;
    defaultChain?: string;
    solana?: SolanaConfig;
    movement?: MovementConfig;
  },
  /** @deprecated Use options object instead. Kept for backward compatibility. */
  legacyOptions?: { defaultChain?: string; solana?: SolanaConfig; movement?: MovementConfig }
) {
  // Parse flexible 3rd argument: string = facilitator URL, object = full options
  const DEFAULT_FACILITATOR = "https://facilitator.stableyard.fi";
  let facilitatorUrl: string;
  let options: { defaultChain?: string; solana?: SolanaConfig; movement?: MovementConfig } | undefined;

  if (typeof optionsOrUrl === "string") {
    // x402plus(payTo, routes, "https://...") or x402plus(payTo, routes, "https://...", { solana })
    facilitatorUrl = optionsOrUrl;
    options = legacyOptions;
  } else if (optionsOrUrl && typeof optionsOrUrl === "object") {
    // x402plus(payTo, routes, { facilitatorUrl, solana, movement })
    facilitatorUrl = optionsOrUrl.facilitatorUrl || DEFAULT_FACILITATOR;
    options = optionsOrUrl;
  } else {
    // x402plus(payTo, routes) — bare minimum
    facilitatorUrl = DEFAULT_FACILITATOR;
    options = undefined;
  }

  const debug = (process.env.DEBUG_X402 ?? "").toLowerCase() === "true";
  const defaultChain = options?.defaultChain ?? "base";
  const expandedRoutes: RoutesMap = {};
  for (const [key, val] of Object.entries(routes)) {
    expandedRoutes[key] = expandRoute(val, defaultChain);
  }
  const { createHttpFacilitatorClient } = require("./facilitator") as {
    createHttpFacilitatorClient: (cfg: { url: string }) => FacilitatorClient;
  };
  const client = createHttpFacilitatorClient({ url: facilitatorUrl });

  // Auto-fetch facilitator capabilities (feePayer, assets) at startup.
  // The middleware blocks on first request until this resolves, so backends
  // don't need to configure SOLANA_FEE_PAYER etc.
  let initPromise: Promise<void> | null = null;
  if (client.supported && (options?.solana || options?.movement)) {
    initPromise = client.supported().then((resp: any) => {
      const kinds: Array<{ scheme: string; network: string; asset?: string; extra?: any }> = resp?.kinds || [];

      // Auto-populate Solana feePayer from facilitator
      if (options?.solana && !options.solana.feePayer) {
        const solKind = kinds.find(k => k.scheme === "exact" && (k.network === "solana" || k.network === "solana-devnet"));
        if (solKind?.extra?.feePayer) {
          options.solana.feePayer = solKind.extra.feePayer;
          if (debug) console.log(`[x402plus] Auto-configured Solana feePayer from facilitator: ${options.solana.feePayer}`);
        }
      }
    }).catch((err: any) => {
      if (debug) console.log(`[x402plus] Warning: could not fetch facilitator /supported: ${err?.message}`);
    });
  }

  return paymentMiddleware({
    payTo, routes: expandedRoutes, facilitator: client, facilitatorUrl,
    solana: options?.solana,
    movement: options?.movement,
    _initPromise: initPromise,
  });
}

export function paymentMiddleware(init: MiddlewareInit) {
  const debug = (process.env.DEBUG_X402 ?? "").toLowerCase() === "true";
  const facilitatorUrl = init.facilitatorUrl || "";
  const solana = init.solana;
  const movement = init.movement;
  let initDone = !init._initPromise;

  return async function handler(req: Request, res: Response, next: NextFunction) {
    // Wait for facilitator /supported to resolve before handling first request
    if (!initDone && init._initPromise) {
      await init._initPromise;
      initDone = true;
    }

    const routeKey = `${req.method.toUpperCase()} ${req.route?.path ?? req.path}`;
    const cfg = init.routes[routeKey];

    if (debug) {
      console.log(`[x402plus] Route check: "${routeKey}" -> ${cfg ? "MATCHED" : "NO MATCH"}`);
      console.log(`[x402plus] Available routes:`, Object.keys(init.routes));
    }

    if (!cfg) return next();

    // Support both x402 v1 (X-PAYMENT) and v2 (PAYMENT-SIGNATURE) headers
    const xPaymentHeader = req.header("x-payment") || req.header("payment-signature");
    const isV2Client = !!req.header("payment-signature");
    const resourceUrl = absoluteResourceUrl(req);
    const baseReq = toPaymentRequirements(resourceUrl, init.payTo, cfg);

    if (debug) {
      console.log(`[x402plus] Payment header: ${xPaymentHeader ? `present (${xPaymentHeader.length} chars, ${isV2Client ? "v2" : "v1"})` : "MISSING"}`);
    }

    // --- No payment header: return 402 ---
    if (!xPaymentHeader) {
      const accepts: any[] = [];

      // Always offer exact scheme (with signing hints)
      const signerHints = isSolanaNetwork(cfg.network)
        ? buildSolanaSignerHints(baseReq)
        : buildSignerHints(baseReq);
      const exactAccept: any = {
        ...baseReq,
        scheme: "exact",
        extra: { ...(baseReq.extra || {}), payload: signerHints }
      };
      accepts.push(exactAccept);

      // Offer Solana exact scheme if configured (one accept per network)
      if (solana) {
        const solNetworks = Array.isArray(solana.network) ? solana.network
          : [solana.network || "solana-devnet"];
        for (const solNetwork of solNetworks) {
          // Default: USDC. If solanaPrice is set, offer native SOL instead.
          const useNativeSol = cfg.solanaPrice !== undefined;
          const nativeInfo = NATIVE_TOKENS[solNetwork];
          const solAsset = useNativeSol && nativeInfo
            ? nativeInfo.address
            : (solana.asset || USDC[solNetwork]?.address || "");
          const solAmount = useNativeSol && nativeInfo
            ? dollarToSmallestUnit(cfg.solanaPrice!, nativeInfo.decimals)
            : baseReq.maxAmountRequired;
          const solReq: PaymentRequirements = {
            ...baseReq,
            scheme: "exact",
            network: solNetwork,
            payTo: solana.payTo,
            asset: solAsset,
            maxAmountRequired: solAmount,
            extra: { feePayer: solana.feePayer || "" },
          };
          const solAccept: any = {
            ...solReq,
            extra: {
              feePayer: solana.feePayer || "",
              assetType: useNativeSol ? "native" : "token",
              payload: buildSolanaSignerHints(solReq),
            },
          };
          accepts.push(solAccept);
        }
      }

      // Offer Movement exact scheme if configured (one accept per network)
      if (movement) {
        const movNetworks = Array.isArray(movement.network) ? movement.network
          : [movement.network || "movement-testnet"];
        for (const movNetwork of movNetworks) {
          // Default: USDC.e. If movementPrice is set, offer native MOVE instead.
          const useNativeMove = cfg.movementPrice !== undefined;
          const nativeInfo = NATIVE_TOKENS[movNetwork];
          const movAsset = useNativeMove && nativeInfo
            ? nativeInfo.address
            : (movement.asset || USDC[movNetwork]?.address || "0x1::aptos_coin::AptosCoin");
          const movAmount = useNativeMove && nativeInfo
            ? dollarToSmallestUnit(cfg.movementPrice!, nativeInfo.decimals)
            : baseReq.maxAmountRequired;
          const movAccept: any = {
            ...baseReq,
            scheme: "exact",
            network: movNetwork,
            payTo: movement.payTo,
            asset: movAsset,
            maxAmountRequired: useNativeMove ? movAmount : baseReq.maxAmountRequired,
            maxTimeoutSeconds: 600,
            extra: { assetType: useNativeMove ? "native" : "token" },
          };
          accepts.push(movAccept);
        }
      }

      // Offer intent scheme unless route is exact-only
      if (cfg.scheme !== "exact") {
        const intentAccept: any = {
          ...baseReq,
          scheme: "intent",
          facilitatorUrl,
          extra: {} as any
        };

        // Prefetch: embed quote in 402 when X-PAYER present
        const payerAddress = req.header("x-payer");
        if (cfg.prefetch && payerAddress && init.facilitator.prepare) {
          try {
            if (debug) console.log(`[x402plus] Prefetching quote for payer ${payerAddress}`);
            const prepareResp = await init.facilitator.prepare({
              from: payerAddress,
              to: init.payTo,
              amount: cfg.maxAmountRequired,
              network: cfg.network,
            });
            intentAccept.extra = prepareResp;
          } catch (err: any) {
            if (debug) console.log(`[x402plus] Prefetch failed: ${err?.message}`);
            // Fall back to no-prefetch: agent calls /prepare themselves
            intentAccept.extra = { facilitatorUrl };
          }
        }

        accepts.push(intentAccept);
      }

      if (debug) console.log(`[x402plus] Returning 402 with ${accepts.length} scheme(s)`);
      return res.status(402).json({ x402Version: 1, accepts });
    }

    // --- X-PAYMENT present: verify + settle ---
    try {
      if (debug) console.log(`[x402plus] Processing payment...`);
      const paymentPayload = fromBase64Json<any>(xPaymentHeader);
      const scheme = (paymentPayload?.scheme || "exact").toLowerCase();

      // For exact, use the network from the payment payload (client chose the chain).
      // For intent, use the backend's configured network.
      const paymentNetwork = paymentPayload?.network;
      let exactPayReq = baseReq;
      if (scheme === "exact" && paymentNetwork) {
        if (isSolanaNetwork(paymentNetwork)) {
          exactPayReq = { ...baseReq, network: paymentNetwork };
        } else if (isMovementNetwork(paymentNetwork)) {
          exactPayReq = { ...baseReq, network: paymentNetwork };
        } else {
          const chainInfo = (USDC as any)[paymentNetwork];
          if (chainInfo) {
            exactPayReq = { ...baseReq, network: paymentNetwork, asset: chainInfo.address };
          }
        }
      }
      const intentReq: PaymentRequirements = { ...baseReq, scheme: "intent" };
      const requirements = scheme === "intent" ? intentReq : exactPayReq;

      if (debug) {
        console.log(`[x402plus] Payment scheme: ${scheme}`);
        console.log(`[x402plus] Payment payload:`, JSON.stringify(paymentPayload, null, 2));
      }

      // Single facilitator handles all chains — routing happens server-side
      const activeFacilitator = init.facilitator;

      // For Solana payments, use the Solana payTo address and correct USDC mint for the payment's network
      if (isSolanaNetwork(requirements.network) && solana) {
        requirements.payTo = solana.payTo;
        requirements.asset = solana.asset || USDC[requirements.network]?.address || requirements.asset;
      }

      // For Movement payments, use the Movement payTo address
      // Asset comes from the payment payload (client picked USDC.e or MOVE from accepts)
      if (isMovementNetwork(requirements.network) && movement) {
        requirements.payTo = movement.payTo;
        if (!paymentPayload?.payload?.asset) {
          requirements.asset = movement.asset || USDC[requirements.network]?.address || "0x1::aptos_coin::AptosCoin";
        }
      }

      const verifyReqBody = {
        x402Version: 1,
        paymentPayload,
        paymentRequirements: requirements
      } as any;

      if (debug) {
        const facilitatorLabel = isSolanaNetwork(requirements.network) ? "Solana" : isMovementNetwork(requirements.network) ? "Movement" : "EVM";
        console.log(`[x402plus] Calling facilitator /verify... (${facilitatorLabel})`);
      }
      const verifyResp = await activeFacilitator.verify(verifyReqBody);
      if (debug) console.log(`[x402plus] Verify response:`, JSON.stringify(verifyResp));

      if (!verifyResp.isValid) {
        if (debug) console.log(`[x402plus] Verification failed: ${verifyResp.invalidReason}`);
        return res.status(402).json({
          x402Version: 1,
          accepts: [requirements],
          error: verifyResp.invalidReason ?? "Invalid payment"
        });
      }

      if (debug) console.log(`[x402plus] Verification passed for payer: ${verifyResp.payer}`);

      const settleReqBody = {
        x402Version: 1,
        paymentPayload,
        paymentRequirements: requirements
      } as any;

      if (debug) console.log(`[x402plus] Calling facilitator /settle...`);
      let settleResp = await activeFacilitator.settle(settleReqBody);
      if (debug) console.log(`[x402plus] Settle response:`, JSON.stringify(settleResp));

      let isSuccess = (settleResp as any).success === true ||
        (!!(settleResp as any).transaction && (settleResp as any).transaction !== "");

      if (!isSuccess) {
        if (debug) console.log(`[x402plus] Settlement failed, retrying in 1s...`);
        await new Promise(r => setTimeout(r, 1000));
        settleResp = await activeFacilitator.settle(settleReqBody);
        if (debug) console.log(`[x402plus] Settle response (retry):`, JSON.stringify(settleResp));
        isSuccess = (settleResp as any).success === true ||
          (!!(settleResp as any).transaction && (settleResp as any).transaction !== "");
      }

      if (!isSuccess) {
        if (debug) console.log(`[x402plus] Settlement failed: ${(settleResp as any)?.errorReason}`);
        return res.status(402).json({
          x402Version: 1,
          accepts: [requirements],
          error: (settleResp as any)?.errorReason ?? "Settlement failed"
        });
      }

      if (debug) console.log(`[x402plus] Payment complete! Transaction: ${(settleResp as any)?.transaction || (settleResp as any)?.txHash}`);
      res.setHeader("X-PAYMENT-RESPONSE", toBase64Json(settleResp));
      return next();
    } catch (err: any) {
      if (debug) console.log(`[x402plus] Error during payment flow:`, err?.message || err);
      return res.status(500).json({ error: "Payment verification/settlement error", details: err?.message });
    }
  };
}

