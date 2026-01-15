"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHttpFacilitatorClient = createHttpFacilitatorClient;
const axios_1 = __importDefault(require("axios"));
function createHttpFacilitatorClient(options) {
    const baseUrl = options.url.replace(/\/$/, "");
    const defaultHeaders = { "content-type": "application/json", ...(options.headers ?? {}) };
    const debug = (process.env.DEBUG_X402 ?? "").toLowerCase() === "true";
    console.log(`[FacilitatorClient] Initialized with baseUrl: ${baseUrl}`);
    async function post(path, data) {
        const url = `${baseUrl}${path}`;
        const config = { headers: defaultHeaders };
        // Always log verify/settle calls
        const isImportant = path === "/verify" || path === "/settle";
        if (isImportant || debug) {
            console.log(`[FacilitatorClient] POST ${url}`);
        }
        try {
            const resp = await axios_1.default.post(url, data, config);
            if (isImportant || debug) {
                console.log(`[FacilitatorClient] <- ${resp.status} ${url}`, JSON.stringify(resp.data));
            }
            return resp.data;
        }
        catch (err) {
            console.log(`[FacilitatorClient] ERROR ${url}: ${err?.message || err}`);
            if (err?.response?.data) {
                return err.response.data;
            }
            const status = err?.response?.status;
            const body = err?.response?.data;
            throw new Error(`Facilitator POST ${path} failed${status ? ` (status ${status})` : ""}${body ? `: ${JSON.stringify(body)}` : ""}`);
        }
    }
    return {
        verify: (body) => post("/verify", body),
        settle: (body) => post("/settle", body),
        supported: () => post("/supported", {}),
        balance: (body) => post("/balance", body),
        account: (body) => post("/account", body)
    };
}
