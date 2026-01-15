"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentMiddleware = paymentMiddleware;
exports.paymentMiddlewareSimple = paymentMiddlewareSimple;
const types_1 = require("./types");
const signingHints_1 = require("./signingHints");
function absoluteResourceUrl(req) {
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.get("host");
    return `${proto}://${host}${req.originalUrl.split("?")[0]}`;
}
function toPaymentRequirements(resourceUrl, payTo, cfg) {
    const reqs = {
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
        reqs.outputSchema = cfg.outputSchema;
    }
    return reqs;
}
function paymentMiddleware(init) {
    const debug = (process.env.DEBUG_X402 ?? "").toLowerCase() === "true";
    return async function handler(req, res, next) {
        const routeKey = `${req.method.toUpperCase()} ${req.route?.path ?? req.path}`;
        const cfg = init.routes[routeKey];
        if (debug) {
            console.log(`[x402] Route check: "${routeKey}" -> ${cfg ? "MATCHED" : "NO MATCH"}`);
            console.log(`[x402] Available routes:`, Object.keys(init.routes));
        }
        if (!cfg)
            return next();
        const xPaymentHeader = req.header("x-payment");
        const baseReq = toPaymentRequirements(absoluteResourceUrl(req), init.payTo, cfg);
        const intentReq = {
            ...baseReq,
            scheme: "intent",
            asset: baseReq.asset,
            extra: { ...(baseReq.extra || {}) }
        };
        if (debug) {
            console.log(`[x402] X-PAYMENT header: ${xPaymentHeader ? `present (${xPaymentHeader.length} chars)` : "MISSING"}`);
        }
        if (!xPaymentHeader) {
            const preferred = (req.header("x-x402-plus") || req.query.x402Type || "").toLowerCase();
            if (debug)
                console.log(`[x402] No payment header, returning 402. Preferred scheme: "${preferred || "none"}"`);
            if (preferred === "intent") {
                const withHints = { ...intentReq, extra: { ...(intentReq.extra || {}), payload: (0, signingHints_1.buildIntentHints)(intentReq) } };
                const body = { x402Version: 1, accepts: [withHints] };
                return res.status(402).json(body);
            }
            if (preferred === "exact") {
                const withHints = { ...baseReq, extra: { ...(baseReq.extra || {}), payload: (0, signingHints_1.buildSignerHints)(baseReq) } };
                const body = { x402Version: 1, accepts: [withHints] };
                return res.status(402).json(body);
            }
            const body = { x402Version: 1, accepts: [baseReq] };
            return res.status(402).json(body);
        }
        try {
            console.log(`[x402] Processing payment...`);
            const paymentPayload = (0, types_1.fromBase64Json)(xPaymentHeader);
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
            };
            console.log(`[x402] Calling facilitator /verify...`);
            if (debug)
                console.log(`[x402] Verify request:`, JSON.stringify(verifyReqBody));
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
            };
            console.log(`[x402] Calling facilitator /settle...`);
            if (debug)
                console.log(`[x402] Settle request:`, JSON.stringify(settleReqBody));
            const doSettle = async () => init.facilitator.settle(settleReqBody);
            let settleResp = await doSettle();
            console.log(`[x402] Settle response:`, JSON.stringify(settleResp));
            let isSuccess = settleResp.success === true || (!!settleResp.transaction && settleResp.transaction !== "");
            if (!isSuccess) {
                console.log(`[x402] Settlement failed, retrying in 1s...`);
                await new Promise(r => setTimeout(r, 1000));
                settleResp = await doSettle();
                console.log(`[x402] Settle response (retry):`, JSON.stringify(settleResp));
                isSuccess = settleResp.success === true || (!!settleResp.transaction && settleResp.transaction !== "");
            }
            if (!isSuccess) {
                console.log(`[x402] ❌ Settlement failed: ${settleResp?.errorReason}`);
                const body = { x402Version: 1, accepts: [requirements], error: settleResp?.errorReason ?? "Settlement failed" };
                return res.status(402).json(body);
            }
            console.log(`[x402] ✅ Payment complete! Transaction: ${settleResp?.transaction || settleResp?.txHash}`);
            res.setHeader("X-PAYMENT-RESPONSE", (0, types_1.toBase64Json)(settleResp));
            return next();
        }
        catch (err) {
            console.log(`[x402] ❌ Error during payment flow:`, err?.message || err);
            return res.status(500).json({ error: "Payment verification/settlement error", details: err?.message });
        }
    };
}
function paymentMiddlewareSimple(payTo, routes, facilitator) {
    const { createHttpFacilitatorClient } = require("./facilitator");
    const client = createHttpFacilitatorClient(facilitator);
    return paymentMiddleware({ payTo, routes, facilitator: client });
}
