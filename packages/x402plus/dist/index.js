"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFacilitatorClient = exports.parsePaymentResponse = exports.createMovementSigner = exports.createEvmSigner = exports.withX402Fetch = exports.buildAptosLikePaymentHeader = exports.aptosLikeSigner = exports.decodePaymentResponse = exports.evmInjectedSigner = exports.wrapFetchWithPayment = exports.createPaywall = exports.x402Paywall = exports.fromBase64Json = exports.toBase64Json = exports.createHttpFacilitatorClient = exports.paymentMiddlewareSimple = exports.paymentMiddleware = void 0;
var middleware_1 = require("./middleware");
Object.defineProperty(exports, "paymentMiddleware", { enumerable: true, get: function () { return middleware_1.paymentMiddleware; } });
Object.defineProperty(exports, "paymentMiddlewareSimple", { enumerable: true, get: function () { return middleware_1.paymentMiddlewareSimple; } });
var facilitator_1 = require("./facilitator");
Object.defineProperty(exports, "createHttpFacilitatorClient", { enumerable: true, get: function () { return facilitator_1.createHttpFacilitatorClient; } });
var types_1 = require("./types");
Object.defineProperty(exports, "toBase64Json", { enumerable: true, get: function () { return types_1.toBase64Json; } });
Object.defineProperty(exports, "fromBase64Json", { enumerable: true, get: function () { return types_1.fromBase64Json; } });
// Friendly alias for production usage
const middleware_2 = require("./middleware");
exports.x402Paywall = middleware_2.paymentMiddlewareSimple;
exports.createPaywall = middleware_2.paymentMiddlewareSimple;
// Client exports
var client_1 = require("./client");
Object.defineProperty(exports, "wrapFetchWithPayment", { enumerable: true, get: function () { return client_1.wrapFetchWithPayment; } });
Object.defineProperty(exports, "evmInjectedSigner", { enumerable: true, get: function () { return client_1.evmInjectedSigner; } });
Object.defineProperty(exports, "decodePaymentResponse", { enumerable: true, get: function () { return client_1.decodePaymentResponse; } });
Object.defineProperty(exports, "aptosLikeSigner", { enumerable: true, get: function () { return client_1.aptosLikeSigner; } });
Object.defineProperty(exports, "buildAptosLikePaymentHeader", { enumerable: true, get: function () { return client_1.buildAptosLikePaymentHeader; } });
// Client alias exports (clearer names)
var client_2 = require("./client");
Object.defineProperty(exports, "withX402Fetch", { enumerable: true, get: function () { return client_2.wrapFetchWithPayment; } });
var client_3 = require("./client");
Object.defineProperty(exports, "createEvmSigner", { enumerable: true, get: function () { return client_3.evmInjectedSigner; } });
var client_4 = require("./client");
Object.defineProperty(exports, "createMovementSigner", { enumerable: true, get: function () { return client_4.aptosLikeSigner; } });
var client_5 = require("./client");
Object.defineProperty(exports, "parsePaymentResponse", { enumerable: true, get: function () { return client_5.decodePaymentResponse; } });
// Facilitator alias export
var facilitator_2 = require("./facilitator");
Object.defineProperty(exports, "createFacilitatorClient", { enumerable: true, get: function () { return facilitator_2.createHttpFacilitatorClient; } });
