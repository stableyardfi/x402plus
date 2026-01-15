import type { PaymentRequirements } from "./types";
export type Eip712Hints = {
    standard: "EIP-3009";
    primaryType: "TransferWithAuthorization";
    types: Record<string, Array<{
        name: string;
        type: string;
    }>>;
    domain: {
        name?: string;
        version?: string;
        verifyingContract: string;
    };
    messageTemplate: {
        from: string;
        to: string;
        value: string;
        validAfter: string;
        validBefore: string;
        nonce: string;
    };
};
export declare function buildSignerHints(reqs: PaymentRequirements): {
    header: string;
    scheme: string;
    network: string;
    eip712: {
        standard: string;
        primaryType: string;
        types: {
            TransferWithAuthorization: {
                name: string;
                type: string;
            }[];
        };
        domain: {
            name: string | undefined;
            version: string | undefined;
            verifyingContract: string;
        };
        messageTemplate: {
            from: string;
            to: string;
            value: string;
            validAfter: string;
            validBefore: string;
            nonce: string;
        };
    };
};
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
export declare function buildIntentHints(reqs: PaymentRequirements): {
    header: string;
    scheme: string;
    network: string;
    format: string;
    domain: {
        name: string;
        version: string;
    };
    primaryType: string;
    types: {
        PaymentAuthorization: {
            name: string;
            type: string;
        }[];
    };
    message: {
        from: string;
        to: string;
        value: string;
        validAfter: string;
        validBefore: string;
        nonce: string;
    };
};
