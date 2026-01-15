"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSignerHints = buildSignerHints;
exports.buildIntentHints = buildIntentHints;
function buildSignerHints(reqs) {
    return {
        header: "X-PAYMENT",
        scheme: "exact",
        network: reqs.network,
        eip712: {
            standard: "EIP-3009",
            primaryType: "TransferWithAuthorization",
            types: {
                TransferWithAuthorization: [
                    { name: "from", type: "address" },
                    { name: "to", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "validAfter", type: "uint256" },
                    { name: "validBefore", type: "uint256" },
                    { name: "nonce", type: "bytes32" }
                ]
            },
            domain: {
                name: reqs.extra?.name,
                version: reqs.extra?.version,
                verifyingContract: reqs.asset
            },
            messageTemplate: {
                from: "<payerAddress>",
                to: reqs.payTo,
                value: reqs.maxAmountRequired,
                validAfter: "<now - 600>",
                validBefore: "<now + maxTimeoutSeconds>",
                nonce: "<random 32 bytes hex>"
            }
        }
    };
}
/**
 * x402plus Intent Signing Hints - PaymentAuthorization (EIP-712)
 *
 * Modeled after EIP-3009 (TransferWithAuthorization) for familiarity and security.
 *
 * The signed message contains ONLY payment authorization fields:
 * - from: The payer's address (vault owner)
 * - to: The receiver's address (merchant)
 * - value: Amount in smallest units (e.g., 1000000 = $1 USDC)
 * - validAfter: Unix timestamp - authorization valid after this time
 * - validBefore: Unix timestamp - authorization expires after this time
 * - nonce: Random 32-byte value for replay protection
 *
 * Contextual data (resource URL, network) is passed in the X-PAYMENT header,
 * NOT signed - keeping the authorization minimal and chain-agnostic.
 */
function buildIntentHints(reqs) {
    return {
        header: "X-PAYMENT",
        scheme: "intent",
        network: reqs.network,
        format: "eip712",
        domain: {
            name: "x402plus",
            version: "1"
            // chainId: filled by client based on connected network
        },
        primaryType: "PaymentAuthorization",
        types: {
            PaymentAuthorization: [
                { name: "from", type: "address" },
                { name: "to", type: "address" },
                { name: "value", type: "uint256" },
                { name: "validAfter", type: "uint256" },
                { name: "validBefore", type: "uint256" },
                { name: "nonce", type: "bytes32" }
            ]
        },
        message: {
            from: "<signer-address>",
            to: reqs.payTo,
            value: reqs.maxAmountRequired,
            validAfter: "<now - 60>",
            validBefore: "<now + maxTimeoutSeconds>",
            nonce: "<random-32-bytes-hex>"
        }
    };
}
