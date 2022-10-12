import { AbiCoder, Interface } from '@ethersproject/abi';
import _ from 'lodash';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import erc20ABI from '../../abi/erc20.json';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import {
  AdapterExchangeParam,
  Address,
  ExchangePrices,
  PoolPrices,
  Log,
  Logger,
  PoolLiquidity,
  SimpleExchangeParam,
  Token,
  TxInfo,
  TransferFeeParams,
} from '../../types';
import {
  UniswapData,
  UniswapDataLegacy,
  UniswapParam,
  UniswapPool,
  UniswapV2Data,
  UniswapV2Functions,
  UniswapV2PoolOrderedParams,
} from './types';
import { IDex } from '../idex';
import {
  DEST_TOKEN_PARASWAP_TRANSFERS,
  ETHER_ADDRESS,
  Network,
  NULL_ADDRESS,
  SRC_TOKEN_PARASWAP_TRANSFERS,
  SUBGRAPH_TIMEOUT,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { SimpleExchange } from '../simple-exchange';
import { NumberAsString, SwapSide } from 'paraswap-core';
import { IDexHelper } from '../../dex-helper';
import {
  getDexKeysWithNetwork,
  isETHAddress,
  prependWithOx,
  getBigIntPow,
} from '../../utils';
import uniswapV2ABI from '../../abi/uniswap-v2/uniswap-v2-pool.json';
import uniswapV2factoryABI from '../../abi/uniswap-v2/uniswap-v2-factory.json';
import ParaSwapABI from '../../abi/IParaswap.json';
import UniswapV2ExchangeRouterABI from '../../abi/UniswapV2ExchangeRouter.json';
import { Contract } from 'web3-eth-contract';
import { UniswapV2Config, Adapters } from './config';
import { Uniswapv2ConstantProductPool } from './uniswap-v2-constant-product-pool';
import { applyTransferFee } from '../../lib/token-transfer-fee';

const DefaultUniswapV2PoolGasCost = 90 * 1000;

export const RESERVE_LIMIT = 2n ** 112n - 1n;

const LogCallTopics = [
  '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1', // event Sync(uint112 reserve0, uint112 reserve1) // uni-V2 and most forks
  '0xcf2aa50876cdfbb541206f89af0ee78d44a2abf8d328e37fa4917f982149848a', // event Sync(uint256 reserve0, uint256 reserve1) // commonly seen in solidly & forks
];

interface UniswapV2PoolState {
  reserves0: string;
  reserves1: string;
  feeCode: number;
}

const uniswapV2Iface = new Interface(uniswapV2ABI);
const erc20iface = new Interface(erc20ABI);
const coder = new AbiCoder();

export const directUniswapFunctionName = [
  UniswapV2Functions.swapOnUniswap,
  UniswapV2Functions.buyOnUniswap,
  UniswapV2Functions.swapOnUniswapFork,
  UniswapV2Functions.buyOnUniswapFork,
  UniswapV2Functions.swapOnUniswapV2Fork,
  UniswapV2Functions.buyOnUniswapV2Fork,
];

export interface UniswapV2Pair {
  token0: Token;
  token1: Token;
  exchange?: Address;
  pool?: UniswapV2EventPool;
}

export class UniswapV2EventPool extends StatefulEventSubscriber<UniswapV2PoolState> {
  decoder = (log: Log) => this.iface.parseLog(log);

  constructor(
    protected parentName: string,
    protected dexHelper: IDexHelper,
    private poolAddress: Address,
    private token0: Token,
    private token1: Token,
    // feeCode is ignored if DynamicFees is set to true
    private feeCode: number,
    logger: Logger,
    private dynamicFees = false,
    // feesMultiCallData is only used if dynamicFees is set to true
    private feesMultiCallEntry?: { target: Address; callData: string },
    private feesMultiCallDecoder?: (values: any[]) => number,
    private iface: Interface = uniswapV2Iface,
  ) {
    super(
      parentName +
        ' ' +
        (token0.symbol || token0.address) +
        '-' +
        (token1.symbol || token1.address) +
        ' pool',
      logger,
    );
  }

  protected processLog(
    state: DeepReadonly<UniswapV2PoolState>,
    log: Readonly<Log>,
  ): AsyncOrSync<DeepReadonly<UniswapV2PoolState> | null> {
    if (!LogCallTopics.includes(log.topics[0])) return null;

    const event = this.decoder(log);
    switch (event.name) {
      case 'Sync':
        return {
          reserves0: event.args.reserve0.toString(),
          reserves1: event.args.reserve1.toString(),
          feeCode: state.feeCode,
        };
    }
    return null;
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<UniswapV2PoolState>> {
    let calldata = [
      {
        target: this.poolAddress,
        callData: this.iface.encodeFunctionData('getReserves', []),
      },
    ];

    if (this.dynamicFees) {
      calldata.push(this.feesMultiCallEntry!);
    }

    const data: { returnData: any[] } =
      await this.dexHelper.multiContract.methods
        .aggregate(calldata)
        .call({}, blockNumber);

    const decodedData = coder.decode(
      ['uint112', 'uint112', 'uint32'],
      data.returnData[0],
    );

    return {
      reserves0: decodedData[0].toString(),
      reserves1: decodedData[1].toString(),
      feeCode: this.dynamicFees
        ? this.feesMultiCallDecoder!(data.returnData[1])
        : this.feeCode,
    };
  }
}

function encodePools(
  pools: UniswapPool[],
  feeFactor: number,
): NumberAsString[] {
  return pools.map(({ fee, direction, address }) => {
    return (
      (BigInt(feeFactor - fee) << 161n) +
      ((direction ? 0n : 1n) << 160n) +
      BigInt(address)
    ).toString();
  });
}

export class UniswapV2
  extends SimpleExchange
  implements IDex<UniswapV2Data, UniswapParam>
{
  pairs: { [key: string]: UniswapV2Pair } = {};
  feeFactor = 10000;
  factory: Contract;

  routerInterface: Interface;
  exchangeRouterInterface: Interface;
  static directFunctionName = directUniswapFunctionName;

  logger: Logger;

  readonly hasConstantPriceLargeAmounts = false;
  readonly isFeeOnTransferSupported = true;
  readonly SRC_TOKEN_DEX_TRANSFERS = 1;
  readonly DEST_TOKEN_DEX_TRANSFERS = 1;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(UniswapV2Config);

  constructor(
    protected network: Network,
    public dexKey: string,
    protected dexHelper: IDexHelper,
    protected isDynamicFees = false,
    protected factoryAddress: Address = UniswapV2Config[dexKey][network]
      .factoryAddress,
    protected subgraphURL: string | undefined = UniswapV2Config[dexKey] &&
      UniswapV2Config[dexKey][network].subgraphURL,
    protected initCode: string = UniswapV2Config[dexKey][network].initCode,
    // feeCode is ignored when isDynamicFees is set to true
    protected feeCode: number = UniswapV2Config[dexKey][network].feeCode,
    protected poolGasCost: number = (UniswapV2Config[dexKey] &&
      UniswapV2Config[dexKey][network].poolGasCost) ??
      DefaultUniswapV2PoolGasCost,
    protected decoderIface: Interface = uniswapV2Iface,
    protected adapters = (UniswapV2Config[dexKey] &&
      UniswapV2Config[dexKey][network].adapters) ??
      Adapters[network],
    protected router = (UniswapV2Config[dexKey] &&
      UniswapV2Config[dexKey][network].router) ??
      dexHelper.config.data.uniswapV2ExchangeRouterAddress,
  ) {
    super(dexHelper.config.data.augustusAddress, dexHelper.web3Provider);
    this.logger = dexHelper.getLogger(dexKey);

    this.factory = new dexHelper.web3Provider.eth.Contract(
      uniswapV2factoryABI as any,
      factoryAddress,
    );

    this.routerInterface = new Interface(ParaSwapABI);
    this.exchangeRouterInterface = new Interface(UniswapV2ExchangeRouterABI);
  }

  // getFeesMultiCallData should be override
  // when isDynamicFees is set to true
  protected getFeesMultiCallData(pair: UniswapV2Pair):
    | undefined
    | {
        callEntry: { target: Address; callData: string };
        callDecoder: (values: any[]) => number;
      } {
    return undefined;
  }

  protected async addPool(
    pair: UniswapV2Pair,
    reserves0: string,
    reserves1: string,
    feeCode: number,
    blockNumber: number,
  ) {
    const { callEntry, callDecoder } = this.getFeesMultiCallData(pair) || {};
    pair.pool = new UniswapV2EventPool(
      this.dexKey,
      this.dexHelper,
      pair.exchange!,
      pair.token0,
      pair.token1,
      feeCode,
      this.logger,
      this.isDynamicFees,
      callEntry,
      callDecoder,
      this.decoderIface,
    );

    if (blockNumber)
      pair.pool.setState({ reserves0, reserves1, feeCode }, blockNumber);
    this.dexHelper.blockManager.subscribeToLogs(
      pair.pool,
      pair.exchange!,
      blockNumber,
    );
  }

  async getBuyPrice(
    priceParams: UniswapV2PoolOrderedParams,
    destAmount: bigint,
  ): Promise<bigint> {
    return Uniswapv2ConstantProductPool.getBuyPrice(
      priceParams,
      destAmount,
      this.feeFactor,
    );
  }

  async getSellPrice(
    priceParams: UniswapV2PoolOrderedParams,
    srcAmount: bigint,
  ): Promise<bigint> {
    return Uniswapv2ConstantProductPool.getSellPrice(
      priceParams,
      srcAmount,
      this.feeFactor,
    );
  }

  async getBuyPricePath(
    amount: bigint,
    params: UniswapV2PoolOrderedParams[],
  ): Promise<bigint> {
    let price = amount;
    for (const param of params.reverse()) {
      price = await this.getBuyPrice(param, price);
    }
    return price;
  }

  async getSellPricePath(
    amount: bigint,
    params: UniswapV2PoolOrderedParams[],
  ): Promise<bigint> {
    let price = amount;
    for (const param of params) {
      price = await this.getSellPrice(param, price);
    }
    return price;
  }

  async findPair(from: Token, to: Token) {
    if (from.address.toLowerCase() === to.address.toLowerCase()) return null;
    const [token0, token1] =
      from.address.toLowerCase() < to.address.toLowerCase()
        ? [from, to]
        : [to, from];

    const key = `${token0.address.toLowerCase()}-${token1.address.toLowerCase()}`;
    let pair = this.pairs[key];
    if (pair) return pair;
    const exchange = await this.factory.methods
      .getPair(token0.address, token1.address)
      .call();
    if (exchange === NULL_ADDRESS) {
      pair = { token0, token1 };
    } else {
      pair = { token0, token1, exchange };
    }
    this.pairs[key] = pair;
    return pair;
  }

  async getManyPoolReserves(
    pairs: UniswapV2Pair[],
    blockNumber: number,
  ): Promise<UniswapV2PoolState[]> {
    try {
      const multiCallFeeData = pairs.map(pair =>
        this.getFeesMultiCallData(pair),
      );
      const calldata = pairs
        .map((pair, i) => {
          let calldata = [
            {
              target: pair.token0.address,
              callData: erc20iface.encodeFunctionData('balanceOf', [
                pair.exchange!,
              ]),
            },
            {
              target: pair.token1.address,
              callData: erc20iface.encodeFunctionData('balanceOf', [
                pair.exchange!,
              ]),
            },
          ];
          if (this.isDynamicFees) calldata.push(multiCallFeeData[i]!.callEntry);
          return calldata;
        })
        .flat();

      // const data: { returnData: any[] } =
      //   await this.dexHelper.multiContract.callStatic.aggregate(calldata, {
      //     blockTag: blockNumber,
      //   });

      const data: { returnData: any[] } =
        await this.dexHelper.multiContract.methods
          .aggregate(calldata)
          .call({}, blockNumber);

      const returnData = _.chunk(data.returnData, this.isDynamicFees ? 3 : 2);
      return pairs.map((pair, i) => ({
        reserves0: coder.decode(['uint256'], returnData[i][0])[0].toString(),
        reserves1: coder.decode(['uint256'], returnData[i][1])[0].toString(),
        feeCode: this.isDynamicFees
          ? multiCallFeeData[i]!.callDecoder(returnData[i][2])
          : this.feeCode,
      }));
    } catch (e) {
      this.logger.error(
        `Error_getManyPoolReserves could not get reserves with error:`,
        e,
      );
      return [];
    }
  }

  async batchCatchUpPairs(pairs: [Token, Token][], blockNumber: number) {
    if (!blockNumber) return;
    const pairsToFetch: UniswapV2Pair[] = [];
    for (const _pair of pairs) {
      const pair = await this.findPair(_pair[0], _pair[1]);
      if (!(pair && pair.exchange)) continue;
      if (!pair.pool) {
        pairsToFetch.push(pair);
      } else if (!pair.pool.getState(blockNumber)) {
        pairsToFetch.push(pair);
      }
    }

    if (!pairsToFetch.length) return;

    const reserves = await this.getManyPoolReserves(pairsToFetch, blockNumber);

    if (reserves.length !== pairsToFetch.length) {
      this.logger.error(
        `Error_getManyPoolReserves didn't get any pool reserves`,
      );
    }

    for (let i = 0; i < pairsToFetch.length; i++) {
      const pairState = reserves[i];
      const pair = pairsToFetch[i];
      if (!pair.pool) {
        await this.addPool(
          pair,
          pairState.reserves0,
          pairState.reserves1,
          pairState.feeCode,
          blockNumber,
        );
      } else pair.pool.setState(pairState, blockNumber);
    }
  }

  async getPairOrderedParams(
    from: Token,
    to: Token,
    blockNumber: number,
    tokenDexTransferFee: number,
  ): Promise<UniswapV2PoolOrderedParams | null> {
    const pair = await this.findPair(from, to);
    if (!(pair && pair.pool && pair.exchange)) return null;
    const pairState = pair.pool.getState(blockNumber);
    if (!pairState) {
      this.logger.error(
        `Error_orderPairParams expected reserves, got none (maybe the pool doesn't exist) ${
          from.symbol || from.address
        } ${to.symbol || to.address}`,
      );
      return null;
    }
    const fee = (pairState.feeCode + tokenDexTransferFee).toString();
    const pairReversed =
      pair.token1.address.toLowerCase() === from.address.toLowerCase();
    if (pairReversed) {
      return {
        tokenIn: from.address,
        tokenOut: to.address,
        reservesIn: pairState.reserves1,
        reservesOut: pairState.reserves0,
        fee,
        direction: false,
        exchange: pair.exchange,
      };
    }
    return {
      tokenIn: from.address,
      tokenOut: to.address,
      reservesIn: pairState.reserves0,
      reservesOut: pairState.reserves1,
      fee,
      direction: true,
      exchange: pair.exchange,
    };
  }

  async getPoolIdentifiers(
    _from: Token,
    _to: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const from = this.dexHelper.config.wrapETH(_from);
    const to = this.dexHelper.config.wrapETH(_to);

    if (from.address.toLowerCase() === to.address.toLowerCase()) {
      return [];
    }

    const tokenAddress = [from.address.toLowerCase(), to.address.toLowerCase()]
      .sort((a, b) => (a > b ? 1 : -1))
      .join('_');

    const poolIdentifier = `${this.dexKey}_${tokenAddress}`;
    return [poolIdentifier];
  }

  async getPricesVolume(
    _from: Token,
    _to: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    // list of pool identifiers to use for pricing, if undefined use all pools
    limitPools?: string[],
    transferFees: TransferFeeParams = {
      srcFee: 0,
      destFee: 0,
      srcDexFee: 0,
      destDexFee: 0,
    },
  ): Promise<ExchangePrices<UniswapV2Data> | null> {
    try {
      const from = this.dexHelper.config.wrapETH(_from);
      const to = this.dexHelper.config.wrapETH(_to);

      if (from.address.toLowerCase() === to.address.toLowerCase()) {
        return null;
      }

      const tokenAddress = [
        from.address.toLowerCase(),
        to.address.toLowerCase(),
      ]
        .sort((a, b) => (a > b ? 1 : -1))
        .join('_');

      const poolIdentifier = `${this.dexKey}_${tokenAddress}`;

      if (limitPools && limitPools.every(p => p !== poolIdentifier))
        return null;

      await this.batchCatchUpPairs([[from, to]], blockNumber);
      const isSell = side === SwapSide.SELL;
      const pairParam = await this.getPairOrderedParams(
        from,
        to,
        blockNumber,
        transferFees.srcDexFee,
      );

      if (!pairParam) return null;

      const unitAmount = getBigIntPow(isSell ? from.decimals : to.decimals);

      const [unitWithFee, ...amountsWithFee] = applyTransferFee(
        [unitAmount, ...amounts],
        side,
        transferFees.srcFee,
        SRC_TOKEN_PARASWAP_TRANSFERS,
      );

      const unit = isSell
        ? await this.getSellPricePath(unitWithFee, [pairParam])
        : await this.getBuyPricePath(unitWithFee, [pairParam]);

      const prices = isSell
        ? await Promise.all(
            amountsWithFee.map(amount =>
              this.getSellPricePath(amount, [pairParam]),
            ),
          )
        : await Promise.all(
            amountsWithFee.map(amount =>
              this.getBuyPricePath(amount, [pairParam]),
            ),
          );

      const outputsWithFee = applyTransferFee(
        prices,
        side,
        isSell ? transferFees.destDexFee : 0,
        isSell ? this.DEST_TOKEN_DEX_TRANSFERS : 0,
      );
      // As uniswapv2 just has one pool per token pair
      return [
        {
          prices: outputsWithFee,
          unit: unit,
          data: {
            router: this.router,
            path: [from.address.toLowerCase(), to.address.toLowerCase()],
            factory: this.factoryAddress,
            initCode: this.initCode,
            feeFactor: this.feeFactor,
            pools: [
              {
                address: pairParam.exchange,
                fee: parseInt(pairParam.fee),
                direction: pairParam.direction,
              },
            ],
          },
          exchange: this.dexKey,
          poolIdentifier,
          gasCost: this.poolGasCost,
          poolAddresses: [pairParam.exchange],
        },
      ];
    } catch (e) {
      if (blockNumber === 0)
        this.logger.error(
          `Error_getPricesVolume: Aurelius block manager not yet instantiated`,
        );
      this.logger.error(`Error_getPrices:`, e);
      return null;
    }
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<UniswapV2Data>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // ParentStruct header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> weth
      CALLDATA_GAS_COST.ADDRESS +
      // ParentStruct -> pools[] header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> pools[]
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // ParentStruct -> pools[0]
      CALLDATA_GAS_COST.wordNonZeroBytes(22)
    );
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side];
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    count: number,
  ): Promise<PoolLiquidity[]> {
    if (!this.subgraphURL) return [];
    const query = `
      query ($token: Bytes!, $count: Int) {
        pools0: pairs(first: $count, orderBy: reserveUSD, orderDirection: desc, where: {token0: $token, reserve0_gt: 1, reserve1_gt: 1}) {
        id
        token0 {
          id
          decimals
        }
        token1 {
          id
          decimals
        }
        reserveUSD
      }
      pools1: pairs(first: $count, orderBy: reserveUSD, orderDirection: desc, where: {token1: $token, reserve0_gt: 1, reserve1_gt: 1}) {
        id
        token0 {
          id
          decimals
        }
        token1 {
          id
          decimals
        }
        reserveUSD
      }
    }`;

    const { data } = await this.dexHelper.httpRequest.post(
      this.subgraphURL,
      {
        query,
        variables: { token: tokenAddress.toLowerCase(), count },
      },
      SUBGRAPH_TIMEOUT,
    );

    if (!(data && data.pools0 && data.pools1))
      throw new Error("Couldn't fetch the pools from the subgraph");
    const pools0 = _.map(data.pools0, pool => ({
      exchange: this.dexKey,
      address: pool.id.toLowerCase(),
      connectorTokens: [
        {
          address: pool.token1.id.toLowerCase(),
          decimals: parseInt(pool.token1.decimals),
        },
      ],
      liquidityUSD: parseFloat(pool.reserveUSD),
    }));

    const pools1 = _.map(data.pools1, pool => ({
      exchange: this.dexKey,
      address: pool.id.toLowerCase(),
      connectorTokens: [
        {
          address: pool.token0.id.toLowerCase(),
          decimals: parseInt(pool.token0.decimals),
        },
      ],
      liquidityUSD: parseFloat(pool.reserveUSD),
    }));

    return _.slice(
      _.sortBy(_.concat(pools0, pools1), [pool => -1 * pool.liquidityUSD]),
      0,
      count,
    );
  }

  protected fixPath(path: Address[], srcToken: Address, destToken: Address) {
    return path.map((token: string, i: number) => {
      if (
        (i === 0 && srcToken.toLowerCase() === ETHER_ADDRESS.toLowerCase()) ||
        (i === path.length - 1 &&
          destToken.toLowerCase() === ETHER_ADDRESS.toLowerCase())
      )
        return ETHER_ADDRESS;
      return token;
    });
  }

  getWETHAddress(srcToken: Address, destToken: Address, weth?: Address) {
    if (!isETHAddress(srcToken) && !isETHAddress(destToken))
      return NULL_ADDRESS;
    return weth || this.dexHelper.config.data.wrappedNativeTokenAddress;
  }

  getAdapterParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    toAmount: NumberAsString, // required for buy case
    data: UniswapData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const pools = encodePools(data.pools, this.feeFactor);
    const weth = this.getWETHAddress(srcToken, destToken, data.weth);
    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          weth: 'address',
          pools: 'uint256[]',
        },
      },
      { pools, weth },
    );
    return {
      targetExchange: data.router,
      payload,
      networkFee: '0',
    };
  }

  async getSimpleParam(
    src: Address,
    dest: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: UniswapData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const pools = encodePools(data.pools, this.feeFactor);
    const weth = this.getWETHAddress(src, dest, data.weth);
    const swapData = this.exchangeRouterInterface.encodeFunctionData(
      side === SwapSide.SELL ? UniswapV2Functions.swap : UniswapV2Functions.buy,
      [src, srcAmount, destAmount, weth, pools],
    );
    return this.buildSimpleParamWithoutWETHConversion(
      src,
      srcAmount,
      dest,
      destAmount,
      swapData,
      data.router,
    );
  }

  // TODO: Move to new uniswapv2&forks router interface
  getDirectParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    _data: UniswapData,
    side: SwapSide,
    permit: string,
    contractMethod?: string,
  ): TxInfo<UniswapParam> {
    if (!contractMethod) throw new Error(`contractMethod need to be passed`);
    if (permit !== '0x') contractMethod += 'WithPermit';

    const swapParams = ((): UniswapParam => {
      const data = _data as unknown as UniswapDataLegacy;
      const path = this.fixPath(data.path, srcToken, destToken);

      switch (contractMethod) {
        case UniswapV2Functions.swapOnUniswap:
        case UniswapV2Functions.buyOnUniswap:
          return [srcAmount, destAmount, path];

        case UniswapV2Functions.swapOnUniswapFork:
        case UniswapV2Functions.buyOnUniswapFork:
          return [
            data.factory,
            prependWithOx(data.initCode),
            srcAmount,
            destAmount,
            path,
          ];

        case UniswapV2Functions.swapOnUniswapV2Fork:
        case UniswapV2Functions.buyOnUniswapV2Fork:
          return [
            srcToken,
            srcAmount,
            destAmount,
            this.getWETHAddress(srcToken, destToken, _data.weth),
            encodePools(_data.pools, this.feeFactor),
          ];

        case UniswapV2Functions.swapOnUniswapV2ForkWithPermit:
        case UniswapV2Functions.buyOnUniswapV2ForkWithPermit:
          return [
            srcToken,
            srcAmount,
            destAmount,
            this.getWETHAddress(srcToken, destToken, _data.weth),
            encodePools(_data.pools, this.feeFactor),
            permit,
          ];

        default:
          throw new Error(`contractMethod=${contractMethod} is not supported`);
      }
    })();

    const encoder = (...params: UniswapParam) =>
      this.routerInterface.encodeFunctionData(contractMethod!, params);
    return {
      params: swapParams,
      encoder,
      networkFee: '0',
    };
  }

  static getDirectFunctionName(): string[] {
    return this.directFunctionName;
  }
}
