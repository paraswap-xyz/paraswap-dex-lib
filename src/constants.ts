import { Address } from './types';
export { SwapSide, ContractMethod } from 'paraswap-core';

export const ETHER_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
export const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

export const MAX_UINT =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

export const MAX_INT =
  '57896044618658097711785492504343953926634992332820282019728792003956564819967';
export const MIN_INT =
  '-57896044618658097711785492504343953926634992332820282019728792003956564819967';

// BIs - BigIntegers
export const BIs = {
  '-1': BigInt(-1),
  '0': BigInt(0),
  '2': BigInt(2),
  '3': BigInt(3),
  '4': BigInt(4),
  '5': BigInt(5),
  '6': BigInt(6),
  '7': BigInt(7),
  '8': BigInt(8),
  '9': BigInt(9),
  '11': BigInt(11),
  '12': BigInt(12),
  '13': BigInt(13),
  '14': BigInt(14),
  '15': BigInt(15),
  '20': BigInt(20),
  '30': BigInt(30),
  '93': BigInt(93),
  '99': BigInt(99),
  '101': BigInt(101),
  '107': BigInt(107),
  '160': BigInt(160),
  '161': BigInt(161),
  '248': BigInt(248),
  POWS: {
    0: BigInt(10 ** 0),
    1: BigInt(10 ** 1),
    2: BigInt(10 ** 2),
    3: BigInt(10 ** 3),
    4: BigInt(10 ** 4),
    5: BigInt(10 ** 5),
    6: BigInt(10 ** 6),
    7: BigInt(10 ** 7),
    8: BigInt(10 ** 8),
    9: BigInt(10 ** 9),
    10: BigInt(10 ** 10),
    11: BigInt(10 ** 11),
    12: BigInt(10 ** 12),
    13: BigInt(10 ** 13),
    14: BigInt(10 ** 14),
    15: BigInt(10 ** 15),
    16: BigInt(10 ** 16),
    17: BigInt(10 ** 17),
    18: BigInt(10 ** 18),

    // The last two are used in the BalancerV2 math
    19: BigInt(10 ** 19),
    20: BigInt(10 ** 20),
    36: BigInt('1' + '0000000000' + '0000000000' + '0000000000' + '000000'),
  },
  MAX_INT: BigInt(MAX_INT),
  MAX_UINT: BigInt(2) ** BigInt(256) - BigInt(1),
};

export const MAX_BLOCKS_HISTORY = 7;

export const SETUP_RETRY_TIMEOUT = 20 * 1000; // 20s

export const FETCH_POOL_INDENTIFIER_TIMEOUT = 1 * 1000; // 1s
export const FETCH_POOL_PRICES_TIMEOUT = 3 * 1000; // 3s

export enum Network {
  MAINNET = 1,
  ROPSTEN = 3,
  RINKEBY = 4,
  BSC = 56,
  POLYGON = 137,
  AVALANCHE = 43114,
  FANTOM = 250,
  ZK_SYNC_MAINNET = 271,
  ZK_SYNC_ROPSTEN = 273,
}

export const MULTI_V2: { [network: number]: Address } = {
  [Network.MAINNET]: '0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696',
  [Network.ROPSTEN]: '0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696',
  [Network.BSC]: '0xC50F4c1E81c873B2204D7eFf7069Ffec6Fbe136D',
  [Network.POLYGON]: '0x275617327c958bD06b5D6b871E7f491D76113dd8',
  [Network.AVALANCHE]: '0xd7Fc8aD069f95B6e2835f4DEff03eF84241cF0E1',
  [Network.FANTOM]: '0xdC6E2b14260F972ad4e5a31c68294Fba7E720701',
};

export const ProviderURL: { [network: number]: string } = {
  [Network.MAINNET]: process.env.HTTP_PROVIDER || '',
  [Network.ROPSTEN]: process.env.HTTP_PROVIDER_3 || '',
  [Network.BSC]: process.env.HTTP_PROVIDER_56 || '',
  [Network.POLYGON]: process.env.HTTP_PROVIDER_137 || '',
  [Network.FANTOM]: process.env.HTTP_PROVIDER_250 || '',
  [Network.AVALANCHE]: process.env.HTTP_PROVIDER_43114 || '',
};

export const TokenTransferProxyAddress: { [nid: number]: Address } = {
  [Network.MAINNET]: '0x216b4b4ba9f3e719726886d34a177484278bfcae',
  [Network.ROPSTEN]: '0x216b4b4ba9f3e719726886d34a177484278bfcae',
  [Network.BSC]: '0x216b4b4ba9f3e719726886d34a177484278bfcae',
  [Network.POLYGON]: '0x216b4b4ba9f3e719726886d34a177484278bfcae',
  [Network.AVALANCHE]: '0x216b4b4ba9f3e719726886d34a177484278bfcae',
  [Network.FANTOM]: '0x216b4b4ba9f3e719726886d34a177484278bfcae',
};

export const AugustusAddress: { [nid: number]: Address } = {
  [Network.MAINNET]: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',
  [Network.ROPSTEN]: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',
  [Network.BSC]: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',
  [Network.POLYGON]: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',
  [Network.AVALANCHE]: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',
  [Network.FANTOM]: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',
};
