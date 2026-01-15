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
    extra?: {
        name?: string;
        version?: string;
    } | Record<string, any>;
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
    extra?: Record<string, any>;
};
export type Signer = {
    signExact: (accepts: ExactAccepts) => Promise<string>;
    signIntent: (accepts: IntentAccepts, hint?: any) => Promise<string>;
};
export declare function decodePaymentResponse(header: string | null | undefined): any | null;
export declare function evmInjectedSigner(ethereum: any): Signer;
export type ClientOptions = {
    signer: Signer;
    prefer?: "auto" | "exact" | "intent";
    negotiation?: "query" | "header";
};
export declare function wrapFetchWithPayment(baseFetch: typeof fetch, opts: ClientOptions): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type AptosLikeSignResult = {
    signatureBcsBase64: string;
    transactionBcsBase64: string;
};
export declare function buildAptosLikePaymentHeader(accepts: ExactAccepts, signResult: AptosLikeSignResult): string;
export declare function aptosLikeSigner(signFn: (accepts: ExactAccepts) => Promise<AptosLikeSignResult>): Signer;
