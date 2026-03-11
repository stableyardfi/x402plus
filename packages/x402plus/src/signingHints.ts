import { USDC, type PaymentRequirements } from "./types";

export type Eip712Hints = {
  standard: "EIP-3009";
  primaryType: "TransferWithAuthorization";
  types: Record<string, Array<{ name: string; type: string }>>;
  domain: {
    name?: string;
    version?: string;
    verifyingContract: string;
  };
  messageTemplate: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
};

export function buildSignerHints(reqs: PaymentRequirements) {
  return {
    header: "X-PAYMENT",
    scheme: "exact",
    network: reqs.network,
    eip712: {
      standard: "EIP-3009",
      primaryType: "TransferWithAuthorization",
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" }
        ]
      },
      domain: {
        name: (reqs.extra as any)?.name || USDC[reqs.network]?.name || "USD Coin",
        version: (reqs.extra as any)?.version || USDC[reqs.network]?.version || "2",
        verifyingContract: reqs.asset
      },
      messageTemplate: {
        from: "<payerAddress>",
        to: reqs.payTo,
        value: reqs.maxAmountRequired,
        validAfter: "<now - 600>",
        validBefore: "<now + maxTimeoutSeconds>",
        nonce: "<random 32 bytes hex>"
      }
    }
  };
}

/**
 * Build signing hints for Solana exact payments (SPL TransferChecked).
 */
export function buildSolanaSignerHints(reqs: PaymentRequirements) {
  return {
    header: "X-PAYMENT",
    scheme: "exact",
    network: reqs.network,
    solana: {
      standard: "SPL-TransferChecked",
      mint: reqs.asset,
      decimals: 6,
      feePayer: (reqs.extra as any)?.feePayer || "",
    },
  };
}
