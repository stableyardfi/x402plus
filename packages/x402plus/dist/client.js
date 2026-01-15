"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodePaymentResponse = decodePaymentResponse;
exports.evmInjectedSigner = evmInjectedSigner;
exports.wrapFetchWithPayment = wrapFetchWithPayment;
exports.buildAptosLikePaymentHeader = buildAptosLikePaymentHeader;
exports.aptosLikeSigner = aptosLikeSigner;
function decodePaymentResponse(header) {
    if (!header)
        return null;
    try {
        const json = atob(header);
        return JSON.parse(json);
    }
    catch {
        return null;
    }
}
function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}
async function ensureNetwork(network, ethereum) {
    // Only mapping we need for the demo
    if (network === "base-sepolia") {
        const chainId = "0x14A34";
        try {
            const current = await ethereum.request({ method: "eth_chainId" });
            if (current?.toLowerCase() === chainId.toLowerCase())
                return;
            try {
                await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
            }
            catch {
                await ethereum.request({
                    method: "wallet_addEthereumChain",
                    params: [{
                            chainId, chainName: "Base Sepolia",
                            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
                            rpcUrls: ["https://base-sepolia-rpc.publicnode.com"],
                            blockExplorerUrls: ["https://sepolia.basescan.org"]
                        }]
                });
            }
        }
        catch {
            // ignore
        }
    }
}
function evmInjectedSigner(ethereum) {
    return {
        async signExact(accepts) {
            if (!ethereum)
                throw new Error("No injected wallet");
            const accounts = await ethereum.request({ method: "eth_requestAccounts" });
            const from = accounts[0];
            await ensureNetwork(accepts.network, ethereum);
            const chainIdHex = await ethereum.request({ method: "eth_chainId" });
            // USDC EIP-712 domain: Testnet uses "USDC", mainnet Circle USDC uses "USD Coin"
            const domain = {
                name: accepts.extra?.name || "USDC",
                version: accepts.extra?.version || "2",
                chainId: parseInt(chainIdHex, 16),
                verifyingContract: accepts.asset
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
            const validBefore = nowSeconds() + (parseInt(String(accepts.maxTimeoutSeconds ?? 120), 10));
            const validAfter = nowSeconds() - 600;
            const nonce = (() => {
                const arr = crypto.getRandomValues(new Uint8Array(32));
                return "0x" + Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
            })();
            const value = accepts.maxAmountRequired;
            const message = { from, to: accepts.payTo, value, validAfter, validBefore, nonce };
            const data = {
                types: { EIP712Domain: [
                        { name: "name", type: "string" },
                        { name: "version", type: "string" },
                        { name: "chainId", type: "uint256" },
                        { name: "verifyingContract", type: "address" }
                    ], ...types },
                domain, primaryType: "TransferWithAuthorization", message
            };
            const signature = await ethereum.request({
                method: "eth_signTypedData_v4",
                params: [from, JSON.stringify(data)]
            });
            const header = {
                x402Version: 1,
                scheme: "exact",
                network: accepts.network,
                payload: {
                    signature,
                    authorization: {
                        from, to: accepts.payTo,
                        value: String(value),
                        validAfter: String(validAfter),
                        validBefore: String(validBefore),
                        nonce
                    }
                }
            };
            return btoa(unescape(encodeURIComponent(JSON.stringify(header))));
        },
        /**
         * Sign an intent-based payment authorization (EIP-712 PaymentAuthorization)
         *
         * This creates a clean payment authorization similar to EIP-3009, containing only:
         * - from: payer address
         * - to: receiver address
         * - value: amount
         * - validAfter/validBefore: time bounds
         * - nonce: replay protection
         *
         * Contextual data (resource, network) is passed in the header but NOT signed,
         * keeping the authorization clean and standard.
         */
        async signIntent(accepts, hint) {
            if (!ethereum)
                throw new Error("No injected wallet");
            const accounts = await ethereum.request({ method: "eth_requestAccounts" });
            const from = accounts[0];
            await ensureNetwork(accepts.network, ethereum);
            // Time bounds: valid from 60s ago (clock skew grace) to timeout
            const validAfter = nowSeconds() - 60;
            const validBefore = nowSeconds() + (parseInt(String(accepts.maxTimeoutSeconds ?? 120), 10));
            // Generate random 32-byte nonce (as hex string with 0x prefix)
            const nonceBytes = new Uint8Array(32);
            crypto.getRandomValues(nonceBytes);
            const nonce = "0x" + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, "0")).join("");
            const value = accepts.maxAmountRequired;
            const format = hint?.format || hint?.intent?.format || "eip712";
            if (format.toLowerCase() === "eip712") {
                const chainIdHex = await ethereum.request({ method: "eth_chainId" });
                const chainId = parseInt(chainIdHex, 16);
                // EIP-712 Domain - x402plus standard
                const hintDomain = hint?.domain || hint?.intent?.domain || {};
                const domain = {
                    name: hintDomain.name || "x402plus",
                    version: hintDomain.version || "1",
                    chainId,
                    ...(hintDomain.verifyingContract && { verifyingContract: hintDomain.verifyingContract })
                };
                // PaymentAuthorization type - modeled after EIP-3009 TransferWithAuthorization
                const types = hint?.types || hint?.intent?.types || {
                    PaymentAuthorization: [
                        { name: "from", type: "address" },
                        { name: "to", type: "address" },
                        { name: "value", type: "uint256" },
                        { name: "validAfter", type: "uint256" },
                        { name: "validBefore", type: "uint256" },
                        { name: "nonce", type: "bytes32" }
                    ]
                };
                const primaryType = hint?.primaryType || hint?.intent?.primaryType || "PaymentAuthorization";
                // The signed message - clean payment authorization only
                const authorization = {
                    from,
                    to: accepts.payTo,
                    value: String(value),
                    validAfter,
                    validBefore,
                    nonce
                };
                // Build EIP712Domain type based on what's in domain
                const domainType = [
                    { name: "name", type: "string" },
                    { name: "version", type: "string" },
                    { name: "chainId", type: "uint256" }
                ];
                if (domain.verifyingContract) {
                    domainType.push({ name: "verifyingContract", type: "address" });
                }
                const data = {
                    types: { EIP712Domain: domainType, ...types },
                    domain,
                    primaryType,
                    message: authorization
                };
                const signature = await ethereum.request({
                    method: "eth_signTypedData_v4",
                    params: [from, JSON.stringify(data)]
                });
                // X-PAYMENT header: contains signature + typed data for verification
                const header = {
                    x402Version: 1,
                    scheme: "intent",
                    network: accepts.network,
                    resource: accepts.resource, // Context only, not part of signed message
                    payload: {
                        signature,
                        format: "eip712",
                        authorization, // The signed PaymentAuthorization message
                        domain,
                        types,
                        primaryType
                    }
                };
                return btoa(unescape(encodeURIComponent(JSON.stringify(header))));
            }
            else {
                // Fallback: raw JSON personal_sign (legacy/deprecated)
                // Note: EIP-712 is preferred for security
                const legacyAuth = { from, to: accepts.payTo, value: String(value), validAfter, validBefore, nonce };
                const message = JSON.stringify(legacyAuth);
                const signature = await ethereum.request({
                    method: "personal_sign",
                    params: [message, from]
                });
                const header = {
                    x402Version: 1,
                    scheme: "intent",
                    network: accepts.network,
                    resource: accepts.resource,
                    payload: {
                        signature,
                        format: "raw-json",
                        message,
                        authorization: legacyAuth
                    }
                };
                return btoa(unescape(encodeURIComponent(JSON.stringify(header))));
            }
        }
    };
}
function wrapFetchWithPayment(baseFetch, opts) {
    const prefer = opts.prefer ?? "auto";
    const negotiation = opts.negotiation ?? "query";
    return async function fetchWithPayment(input, init) {
        const url = typeof input === "string" ? input : input.toString();
        // Initial request (optionally negotiate intent)
        const negotiatedUrl = (prefer === "intent" && negotiation === "query")
            ? (url.includes("?") ? `${url}&x402Type=intent` : `${url}?x402Type=intent`)
            : url;
        const r1 = await baseFetch(negotiation === "header" ? url : negotiatedUrl, {
            ...init,
            headers: {
                ...(init?.headers || {}),
                ...(prefer === "intent" && negotiation === "header" ? { "X-X402-PLUS": "intent" } : {})
            }
        });
        if (r1.status !== 402)
            return r1;
        const pr = await r1.json();
        const accepts = Array.isArray(pr.accepts) ? pr.accepts[0] : undefined;
        if (!accepts)
            return r1;
        const scheme = (prefer === "auto") ? accepts.scheme : prefer;
        const xPayment = (scheme === "intent")
            ? await opts.signer.signIntent(accepts, accepts?.extra?.payload)
            : await opts.signer.signExact(accepts);
        // Retry with X-PAYMENT
        return baseFetch(url, {
            ...init,
            headers: { ...(init?.headers || {}), "X-PAYMENT": xPayment }
        });
    };
}
function buildAptosLikePaymentHeader(accepts, signResult) {
    const header = {
        x402Version: 1,
        scheme: accepts.scheme,
        network: accepts.network,
        payload: {
            signature: signResult.signatureBcsBase64,
            transaction: signResult.transactionBcsBase64
        }
    };
    return btoa(unescape(encodeURIComponent(JSON.stringify(header))));
}
// Factory to create a Signer compatible with Aptos/Movement-style payments.
// Provide a function that, given the server's accepts, returns the BCS-encoded
// signature and transaction as base64 strings.
function aptosLikeSigner(signFn) {
    return {
        async signExact(accepts) {
            const res = await signFn(accepts);
            return buildAptosLikePaymentHeader(accepts, res);
        },
        async signIntent(_accepts) {
            throw new Error("Intent scheme is not supported for Aptos-like payments.");
        }
    };
}
