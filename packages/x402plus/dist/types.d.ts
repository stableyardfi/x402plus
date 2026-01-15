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
export declare function toBase64Json(obj: unknown): string;
export declare function fromBase64Json<T>(b64: string): T;
