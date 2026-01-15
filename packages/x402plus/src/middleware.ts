import type { Request, Response, NextFunction } from "express";
import { fromBase64Json, toBase64Json, type PaymentRequirements } from "./types";
import { buildIntentHints, buildSignerHints } from "./signingHints";
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
};

export type RoutesMap = Record<string, RouteConfig>;

export type MiddlewareInit = {
  payTo: string;
  routes: RoutesMap;
  facilitator: FacilitatorClient;
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

export function paymentMiddleware(init: MiddlewareInit) {
  const debug = (process.env.DEBUG_X402 ?? "").toLowerCase() === "true";

  return async function handler(req: Request, res: Response, next: NextFunction) {
    const routeKey = `${req.method.toUpperCase()} ${req.route?.path ?? req.path}`;
    const cfg = init.routes[routeKey];

    if (debug) {
      console.log(`[x402] Route check: "${routeKey}" -> ${cfg ? "MATCHED" : "NO MATCH"}`);
      console.log(`[x402] Available routes:`, Object.keys(init.routes));
    }

    if (!cfg) return next();

    const xPaymentHeader = req.header("x-payment");
    const baseReq = toPaymentRequirements(absoluteResourceUrl(req), init.payTo, cfg);
    const intentReq: PaymentRequirements = {
      ...baseReq,
      scheme: "intent",
      asset: baseReq.asset,
      extra: { ...(baseReq.extra || {}) }
    };

    if (debug) {
      console.log(`[x402] X-PAYMENT header: ${xPaymentHeader ? `present (${xPaymentHeader.length} chars)` : "MISSING"}`);
    }

    if (!xPaymentHeader) {
      const preferred = ((req.header("x-x402-plus") as string) || (req.query.x402Type as string) || "").toLowerCase();
      if (debug) console.log(`[x402] No payment header, returning 402. Preferred scheme: "${preferred || "none"}"`);
      if (preferred === "intent") {
        const withHints: any = { ...intentReq, extra: { ...(intentReq.extra || {}), payload: buildIntentHints(intentReq) } };
        const body = { x402Version: 1, accepts: [withHints] };
        return res.status(402).json(body);
      }
      if (preferred === "exact") {
        const withHints: any = { ...baseReq, extra: { ...(baseReq.extra || {}), payload: buildSignerHints(baseReq) } };
        const body = { x402Version: 1, accepts: [withHints] };
        return res.status(402).json(body);
      }
      const body = { x402Version: 1, accepts: [baseReq] };
      return res.status(402).json(body);
    }

    try {
      console.log(`[x402] Processing payment...`);
      const paymentPayload = fromBase64Json<any>(xPaymentHeader);
      const scheme = (paymentPayload?.scheme || "exact").toLowerCase();
      const requirements = scheme === "intent" ? intentReq : baseReq;

      if (debug) {
        console.log(`[x402] Payment scheme: ${scheme}`);
        console.log(`[x402] Payment payload:`, JSON.stringify(paymentPayload, null, 2));
      }

      const verifyReqBody = {
        x402Version: 1,
        paymentPayload,
        paymentRequirements: requirements
      } as any;

      console.log(`[x402] Calling facilitator /verify...`);
      if (debug) console.log(`[x402] Verify request:`, JSON.stringify(verifyReqBody));

      const verifyResp = await init.facilitator.verify(verifyReqBody);

      console.log(`[x402] Verify response:`, JSON.stringify(verifyResp));

      if (!verifyResp.isValid) {
        console.log(`[x402] ❌ Verification failed: ${verifyResp.invalidReason}`);
        const body = { x402Version: 1, accepts: [requirements], error: verifyResp.invalidReason ?? "Invalid payment" };
        return res.status(402).json(body);
      }

      console.log(`[x402] ✅ Verification passed for payer: ${verifyResp.payer}`);

      const settleReqBody = {
        x402Version: 1,
        paymentPayload,
        paymentRequirements: requirements
      } as any;

      console.log(`[x402] Calling facilitator /settle...`);
      if (debug) console.log(`[x402] Settle request:`, JSON.stringify(settleReqBody));

      const doSettle = async () => init.facilitator.settle(settleReqBody);
      let settleResp = await doSettle();

      console.log(`[x402] Settle response:`, JSON.stringify(settleResp));

      let isSuccess = (settleResp as any).success === true || (!!(settleResp as any).transaction && (settleResp as any).transaction !== "");
      if (!isSuccess) {
        console.log(`[x402] Settlement failed, retrying in 1s...`);
        await new Promise(r => setTimeout(r, 1000));
        settleResp = await doSettle();
        console.log(`[x402] Settle response (retry):`, JSON.stringify(settleResp));
        isSuccess = (settleResp as any).success === true || (!!(settleResp as any).transaction && (settleResp as any).transaction !== "");
      }
      if (!isSuccess) {
        console.log(`[x402] ❌ Settlement failed: ${(settleResp as any)?.errorReason}`);
        const body = { x402Version: 1, accepts: [requirements], error: (settleResp as any)?.errorReason ?? "Settlement failed" };
        return res.status(402).json(body);
      }

      console.log(`[x402] ✅ Payment complete! Transaction: ${(settleResp as any)?.transaction || (settleResp as any)?.txHash}`);
      res.setHeader("X-PAYMENT-RESPONSE", toBase64Json(settleResp));
      return next();
    } catch (err: any) {
      console.log(`[x402] ❌ Error during payment flow:`, err?.message || err);
      return res.status(500).json({ error: "Payment verification/settlement error", details: err?.message });
    }
  };
}

export type SimpleFacilitatorConfig = {
  url: string;
  headers?: Record<string, string>;
};

export function paymentMiddlewareSimple(
  payTo: string,
  routes: RoutesMap,
  facilitator: SimpleFacilitatorConfig
) {
  const { createHttpFacilitatorClient } = require("./facilitator") as {
    createHttpFacilitatorClient: (cfg: SimpleFacilitatorConfig) => FacilitatorClient;
  };
  const client = createHttpFacilitatorClient(facilitator);
  return paymentMiddleware({ payTo, routes, facilitator: client });
}

