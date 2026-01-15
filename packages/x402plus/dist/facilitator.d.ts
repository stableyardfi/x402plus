export type FacilitatorVerifyRequest = {
    x402Version: number;
    paymentPayload: any;
    paymentRequirements: any;
};
export type FacilitatorVerifyResponse = {
    isValid: boolean;
    invalidReason?: string | null;
    payer?: string | null;
};
export type FacilitatorSettleRequest = FacilitatorVerifyRequest;
export type FacilitatorSettleResponse = {
    success: boolean;
    error?: string | null;
    errorReason?: string | null;
    txHash?: string | null;
    transaction?: string | null;
    network?: string | null;
    networkId?: string | null;
    quote?: {
        inputAmount: string;
        outputAmount: string;
    } | null;
};
export type FacilitatorBalanceRequest = {
    userAddress: string;
    chain?: string;
    tokens?: string[];
};
export type FacilitatorBalanceResponse = {
    totalUsd: string;
    perToken?: Array<{
        token: string;
        chain: string;
        amount: string;
        usdValue?: string;
    }>;
    updatedAt?: string;
    accountExists?: boolean;
};
export type FacilitatorAccountRequest = {
    userAddress: string;
    chain?: string;
    token?: string;
};
export type FacilitatorAccountResponse = {
    activated: boolean;
    accountAddress?: string | null;
    depositAddress?: string | null;
    chain?: string | null;
    token?: string | null;
    instructions?: string | null;
    signing?: any | null;
    balance?: FacilitatorBalanceResponse | null;
};
export interface FacilitatorClient {
    verify: (body: FacilitatorVerifyRequest) => Promise<FacilitatorVerifyResponse>;
    settle: (body: FacilitatorSettleRequest) => Promise<FacilitatorSettleResponse>;
    supported?: () => Promise<any>;
    balance?: (body: FacilitatorBalanceRequest) => Promise<FacilitatorBalanceResponse>;
    account?: (body: FacilitatorAccountRequest) => Promise<FacilitatorAccountResponse>;
}
export type HttpFacilitatorOptions = {
    url: string;
    headers?: Record<string, string>;
};
export declare function createHttpFacilitatorClient(options: HttpFacilitatorOptions): FacilitatorClient;
