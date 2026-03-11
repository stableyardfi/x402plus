// --- Primary API ---
export { x402plus } from "./middleware";

// --- Middleware exports ---
export { paymentMiddleware } from "./middleware";
export type { RouteConfig, RoutesMap, SolanaConfig, MovementConfig } from "./middleware";

// --- Facilitator client ---
export { createHttpFacilitatorClient } from "./facilitator";
export type {
  FacilitatorClient,
  FacilitatorVerifyRequest,
  FacilitatorVerifyResponse,
  FacilitatorSettleRequest,
  FacilitatorSettleResponse,
  FacilitatorBalanceRequest,
  FacilitatorBalanceResponse,
} from "./facilitator";

// --- Types ---
export type {
  PaymentRequirements,
  PaymentRequiredResponse,
  RouteShorthand,
  FacilitatorAccountRequest,
  FacilitatorAccountResponse,
  FacilitatorPrepareRequest,
  FacilitatorPrepareResponse,
  FacilitatorActivateRequest,
  FacilitatorActivateResponse,
  FacilitatorDepositRequest,
  FacilitatorDepositResponse,
} from "./types";
export { toBase64Json, fromBase64Json, USDC, NATIVE_TOKENS, CHAIN_IDS, dollarToSmallestUnit, isSolanaNetwork, isMovementNetwork, isNativeAsset } from "./types";

// --- Client exports ---
export {
  withPayments,
  createGridClient,
  evmInjectedSigner,
  wrapFetchWithPayment,
  decodePaymentResponse,
  aptosLikeSigner,
  buildAptosLikePaymentHeader,
} from "./client";
export type { Signer, GridClient, WithPaymentsOptions, GridClientOptions } from "./client";

// --- Signing hints ---
export { buildSignerHints, buildSolanaSignerHints } from "./signingHints";

// --- Backward-compatible aliases ---
// x402() still works for anyone migrating from standard x402
export { x402plus as x402 } from "./middleware";
export { createHttpFacilitatorClient as createFacilitatorClient } from "./facilitator";
