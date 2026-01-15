import axios, { AxiosRequestConfig } from "axios";

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
  // Quote info included when cross-chain settlement occurred
  quote?: {
    inputAmount: string;
    outputAmount: string;
  } | null;
};

// Balance check (read-only, does NOT create vault)
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
  accountExists?: boolean; // false if user has no account yet
};

// Account (Money Account) management
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

export function createHttpFacilitatorClient(options: HttpFacilitatorOptions): FacilitatorClient {
  const baseUrl = options.url.replace(/\/$/, "");
  const defaultHeaders = { "content-type": "application/json", ...(options.headers ?? {}) };
  const debug = (process.env.DEBUG_X402 ?? "").toLowerCase() === "true";

  console.log(`[FacilitatorClient] Initialized with baseUrl: ${baseUrl}`);

  async function post<T>(path: string, data: any): Promise<T> {
    const url = `${baseUrl}${path}`;
    const config: AxiosRequestConfig = { headers: defaultHeaders };

    // Always log verify/settle calls
    const isImportant = path === "/verify" || path === "/settle";
    if (isImportant || debug) {
      console.log(`[FacilitatorClient] POST ${url}`);
    }

    try {
      const resp = await axios.post(url, data, config);
      if (isImportant || debug) {
        console.log(`[FacilitatorClient] <- ${resp.status} ${url}`, JSON.stringify(resp.data));
      }
      return resp.data as T;
    } catch (err: any) {
      console.log(`[FacilitatorClient] ERROR ${url}: ${err?.message || err}`);
      if (err?.response?.data) {
        return err.response.data as T;
      }
      const status = err?.response?.status;
      const body = err?.response?.data;
      throw new Error(`Facilitator POST ${path} failed${status ? ` (status ${status})` : ""}${body ? `: ${JSON.stringify(body)}` : ""}`);
    }
  }

  return {
    verify: (body) => post<FacilitatorVerifyResponse>("/verify", body),
    settle: (body) => post<FacilitatorSettleResponse>("/settle", body),
    supported: () => post<any>("/supported", {}),
    balance: (body) => post<FacilitatorBalanceResponse>("/balance", body),
    account: (body) => post<FacilitatorAccountResponse>("/account", body)
  };
}
