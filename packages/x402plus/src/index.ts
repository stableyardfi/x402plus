export { paymentMiddleware, paymentMiddlewareSimple } from "./middleware";
export type { RouteConfig, RoutesMap, SimpleFacilitatorConfig } from "./middleware";
export { createHttpFacilitatorClient } from "./facilitator";
export type {
  FacilitatorClient,
  FacilitatorBalanceRequest,
  FacilitatorBalanceResponse,
  FacilitatorAccountRequest,
  FacilitatorAccountResponse
} from "./facilitator";
export type { PaymentRequirements, PaymentRequiredResponse } from "./types";
export { toBase64Json, fromBase64Json } from "./types";

// Friendly alias for production usage
import { paymentMiddlewareSimple as _simple } from "./middleware";
export const x402Paywall = _simple;
export const createPaywall = _simple;

// Client exports
export {
  wrapFetchWithPayment,
  evmInjectedSigner,
  decodePaymentResponse,
  aptosLikeSigner,
  buildAptosLikePaymentHeader
} from "./client";

// Client alias exports (clearer names)
export { wrapFetchWithPayment as withX402Fetch } from "./client";
export { evmInjectedSigner as createEvmSigner } from "./client";
export { aptosLikeSigner as createMovementSigner } from "./client";
export { decodePaymentResponse as parsePaymentResponse } from "./client";

// Facilitator alias export
export { createHttpFacilitatorClient as createFacilitatorClient } from "./facilitator";
