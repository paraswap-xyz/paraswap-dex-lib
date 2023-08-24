import { RequestHeaders } from '../../dex-helper';
import { Token } from '../../types';

type RFQOrder = {
  nonceAndMeta: string;
  expiry: number;
  makerAsset: string;
  takerAsset: string;
  maker: string;
  taker: string;
  makerAmount: string;
  takerAmount: string;
  signature: string;
};

export type RFQResponse = {
  order: RFQOrder;
};

export type RFQResponseError = {
  Reason: string;
  ReasonCode: string;
  Success: boolean;
  RetryAfter?: number;
};

export type DexalotData = {
  quoteData?: RFQOrder;
};

export type DexParams = {
  mainnetRFQAddress: string;
};

export enum ClobSide {
  BID = 'BID',
  ASK = 'ASK',
}

export class RfqError extends Error {}

export class SlippageCheckError extends Error {}

export type PairData = {
  base: string;
  quote: string;
  liquidityUSD: number;
  isSrcBase?: boolean;
};

export type PairDataMap = {
  [pair: string]: PairData;
};

export type DexalotPairsResponse = {
  pairs: PairDataMap;
};

type PriceData = {
  bids: string[][];
  asks: string[][];
};

export type PriceDataMap = {
  [pair: string]: PriceData;
};

export type DexalotPricesResponse = {
  prices: PriceDataMap;
};

export type TokenAddrDataMap = {
  [symbol: string]: string;
};

type TokenData = {
  symbol: string;
  name: string;
  description: string;
  address: any;
  decimals: number;
  type: string;
};

export type TokenDataMap = {
  [address: string]: Token;
};

export type DexalotTokensResponse = {
  tokens: {
    [token: string]: TokenData;
  };
};

export type DexalotBlacklistResponse = {
  blacklist: string[];
};

export type DexalotRateFetcherConfig = {
  rateConfig: {
    pairsReqParams: {
      url: string;
      headers?: RequestHeaders;
      params?: any;
    };
    pricesReqParams: {
      url: string;
      headers?: RequestHeaders;
      params?: any;
    };
    tokensReqParams: {
      url: string;
      headers?: RequestHeaders;
      params?: any;
    };
    blacklistReqParams: {
      url: string;
      headers?: RequestHeaders;
      params?: any;
    };
    pairsIntervalMs: number;
    pricesIntervalMs: number;
    tokensIntervalMs: number;
    blacklistIntervalMs: number;
    pairsCacheKey: string;
    pricesCacheKey: string;
    tokensAddrCacheKey: string;
    tokensCacheKey: string;
    blacklistCacheKey: string;
    pairsCacheTTLSecs: number;
    pricesCacheTTLSecs: number;
    tokensCacheTTLSecs: number;
  };
};
