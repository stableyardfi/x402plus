import type { Request, Response, NextFunction } from "express";
import type { FacilitatorClient } from "./facilitator";
export type RouteConfig = {
    network: string;
    asset: string;
    maxAmountRequired: string;
    description?: string;
    mimeType?: string;
    maxTimeoutSeconds?: number;
    outputSchema?: Record<string, unknown> | undefined;
    extra?: Record<string, unknown> | undefined;
};
export type RoutesMap = Record<string, RouteConfig>;
export type MiddlewareInit = {
    payTo: string;
    routes: RoutesMap;
    facilitator: FacilitatorClient;
};
export declare function paymentMiddleware(init: MiddlewareInit): (req: Request, res: Response, next: NextFunction) => Promise<void | Response<any, Record<string, any>>>;
export type SimpleFacilitatorConfig = {
    url: string;
    headers?: Record<string, string>;
};
export declare function paymentMiddlewareSimple(payTo: string, routes: RoutesMap, facilitator: SimpleFacilitatorConfig): (req: Request, res: Response, next: NextFunction) => Promise<void | Response<any, Record<string, any>>>;
