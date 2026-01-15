"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toBase64Json = toBase64Json;
exports.fromBase64Json = fromBase64Json;
function toBase64Json(obj) {
    return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}
function fromBase64Json(b64) {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
}
