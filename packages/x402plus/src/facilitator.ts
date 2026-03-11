import axios, { AxiosRequestConfig } from "axios";
import type {
  FacilitatorPrepareRequest,
  FacilitatorPrepareResponse,
  FacilitatorActivateRequest,
  FacilitatorActivateResponse,
  FacilitatorDepositRequest,
  FacilitatorDepositResponse,
  FacilitatorAccountRequest,
  FacilitatorAccountResponse,
} from "./types";

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

export interface FacilitatorClient {
  verify: (body: FacilitatorVerifyRequest) => Promise<FacilitatorVerifyResponse>;
  settle: (body: FacilitatorSettleRequest) => Promise<FacilitatorSettleResponse>;
  supported?: () => Promise<any>;
  balance?: (body: FacilitatorBalanceRequest) => Promise<FacilitatorBalanceResponse>;
  account?: (body: FacilitatorAccountRequest) => Promise<FacilitatorAccountResponse>;
  prepare?: (body: FacilitatorPrepareRequest) => Promise<FacilitatorPrepareResponse>;
  activate?: (body: FacilitatorActivateRequest) => Promise<FacilitatorActivateResponse>;
  deposit?: (body: FacilitatorDepositRequest) => Promise<FacilitatorDepositResponse>;
  resolve?: (paymentAddress: string) => Promise<any>;
}

export type HttpFacilitatorOptions = {
  url: string;
  headers?: Record<string, string>;
};

export function createHttpFacilitatorClient(options: HttpFacilitatorOptions): FacilitatorClient {
  const baseUrl = options.url.replace(/\/$/, "");
  const defaultHeaders = { "content-type": "application/json", ...(options.headers ?? {}) };
  const debug = (process.env.DEBUG_X402 ?? "").toLowerCase() === "true";

  if (debug) console.log(`[FacilitatorClient] Initialized with baseUrl: ${baseUrl}`);

  async function post<T>(path: string, data: any): Promise<T> {
    const url = `${baseUrl}${path}`;
    const config: AxiosRequestConfig = { headers: defaultHeaders };

    if (debug) console.log(`[FacilitatorClient] POST ${url}`);

    try {
      const resp = await axios.post(url, data, config);
      if (debug) console.log(`[FacilitatorClient] <- ${resp.status} ${url}`);
      return resp.data as T;
    } catch (err: any) {
      if (debug) console.log(`[FacilitatorClient] ERROR ${url}: ${err?.message || err}`);
      if (err?.response?.data) {
        return err.response.data as T;
      }
      const status = err?.response?.status;
      const body = err?.response?.data;
      throw new Error(`Facilitator POST ${path} failed${status ? ` (status ${status})` : ""}${body ? `: ${JSON.stringify(body)}` : ""}`);
    }
  }

  async function get<T>(path: string): Promise<T> {
    const url = `${baseUrl}${path}`;
    if (debug) console.log(`[FacilitatorClient] GET ${url}`);
    try {
      const resp = await axios.get(url, { headers: defaultHeaders });
      if (debug) console.log(`[FacilitatorClient] <- ${resp.status} ${url}`);
      return resp.data as T;
    } catch (err: any) {
      if (err?.response?.data) return err.response.data as T;
      throw new Error(`Facilitator GET ${path} failed`);
    }
  }

  return {
    verify: (body) => post<FacilitatorVerifyResponse>("/verify", body),
    settle: (body) => post<FacilitatorSettleResponse>("/settle", body),
    supported: () => post<any>("/supported", {}),
    balance: (body) => post<FacilitatorBalanceResponse>("/balance", body),
    account: (body) => post<FacilitatorAccountResponse>("/account", body),
    prepare: (body) => post<FacilitatorPrepareResponse>("/prepare", body),
    activate: (body) => post<FacilitatorActivateResponse>("/activate", body),
    deposit: (body) => post<FacilitatorDepositResponse>("/deposit", body),
    resolve: (addr) => get<any>("/resolve?paymentAddress=" + encodeURIComponent(addr)),
  };
}
