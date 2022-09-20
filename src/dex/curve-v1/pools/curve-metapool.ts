import _ from 'lodash';
import { Interface } from '@ethersproject/abi';
import BigNumber from 'bignumber.js';
import { Logger } from 'log4js';
import { Address, Log } from '../../../types';
import { StatefulEventSubscriber } from '../../../stateful-event-subscriber';
import { DeepReadonly } from 'ts-essentials';
import { PoolState as BasepoolState } from './curve-pool';
import { ThreePool } from './3pool';
import { BlockHeader } from 'web3-eth';
// import { getManyPoolStates } from './getstate-multicall';

import { BN_0, BN_600, BN_POWS } from '../../../bignumber-constants';
import { IDexHelper } from '../../../dex-helper';
import { erc20Iface } from '../../../lib/utils-interfaces';
import { bignumberify } from '../../../utils';
import { stringify } from 'querystring';
import { getManyPoolStates } from './getstate-multicall';

export interface MetapoolState {
  A: BigNumber;
  fee: BigNumber;
  admin_fee: BigNumber;
  supply: BigNumber;
  balances: BigNumber[];
  basepool: BasepoolState;
  base_virtual_price: BigNumber;
  base_cache_updated: BigNumber;
}

export abstract class CurveMetapool extends StatefulEventSubscriber<MetapoolState> {
  // Common constants across all the pools
  protected FEE_DENOMINATOR = BN_POWS[10];
  protected LENDING_PRECISION: BigNumber = BN_POWS[18];
  protected PRECISION: BigNumber = BN_POWS[18];
  protected BASE_CACHE_EXPIRES = BN_600;
  protected MAX_COIN: number;

  // contract: Contract;
  // multi: Contract;

  metapoolAddressesSubscribed: Address[];
  // addressesSubscribed: Address[];

  // token: any;
  protected handlers: {
    [event: string]: (
      event: any,
      state: MetapoolState,
      log: Log,
      blockHeader: BlockHeader,
    ) => MetapoolState;
  } = {};

  public poolIface: Interface;

  decoder: (log: Log) => any;

  // The lastTransferredCoin is not stored in the state as
  // the value itself doesn't effect the pricing but it only
  // affects the function call RemoveLiquidityOne for that
  // particular block.
  lastTransferredCoin?: Address;

  // The basepool is ThreePool instead of the base CurvePool
  // as the base curve pool doesn't support the RemoveLiquidityOnes
  basepool: ThreePool;

  addressesSubscribed: Address[] = [];

  constructor(
    public parentName: string,
    protected dexHelper: IDexHelper,
    logger: Logger,
    public pool: string,
    public address: Address,
    public tokenAddress: Address,
    protected trackCoins: boolean,
    protected abi: any,
    // Constants specific for a particular pool
    public N_COINS: number,
    public PRECISION_MUL: BigNumber[],
    public USE_LENDING: boolean[],
    public COINS: Address[],
    Basepool: new (name: string, dexHelper: IDexHelper) => ThreePool,
  ) {
    super(`${parentName}_${pool}_${address}`, logger);
    this.MAX_COIN = N_COINS - 1;

    this.basepool = new Basepool(this.name, dexHelper);

    this.metapoolAddressesSubscribed = [this.address];
    if (trackCoins) {
      this.metapoolAddressesSubscribed = _.concat(
        this.COINS,
        this.metapoolAddressesSubscribed,
      );
    }

    this.addressesSubscribed = _.concat(
      this.metapoolAddressesSubscribed,
      this.basepool.addressesSubscribed,
    );

    // Add default handlers
    this.handlers['AddLiquidity'] = this.handleAddLiquidity.bind(this);
    this.handlers['RemoveLiquidity'] = this.handleRemoveLiquidity.bind(this);
    this.handlers['TokenExchange'] = this.handleTokenExchange.bind(this);
    this.handlers['RemoveLiquidityImbalance'] =
      this.handleRemoveLiquidityImbalances.bind(this);
    this.handlers['TokenExchangeUnderlying'] =
      this.handleTokenExchangeUnderlying.bind(this);
    this.handlers['NewParameters'] = this.handleNewParameters.bind(this);
    this.handlers['RemoveLiquidityOne'] =
      this.handleRemoveLiquidityOne.bind(this);
    this.handlers['NewFee'] = this.handleNewFee.bind(this);
    this.handlers['Transfer'] = this.handleCoinTransfer.bind(this);

    // Overload the basepool handlers to ignore the events generated by the metapool
    this.basepool.handlers['AddLiquidity'] =
      this.handleBasepoolAddLiquidity.bind(this);
    this.basepool.handlers['RemoveLiquidityOne'] =
      this.handleBasepoolRemoveLiquidityOne.bind(this);
    this.basepool.handlers['TokenExchange'] =
      this.handleBasepoolTokenExchange.bind(this);

    this.poolIface = new Interface(this.abi);
    this.decoder = (log: Log) => {
      if (
        this.trackCoins &&
        _.findIndex(
          this.COINS,
          c => c.toLowerCase() === log.address.toLowerCase(),
        ) != -1
      )
        return erc20Iface.parseLog(log);

      return this.poolIface.parseLog(log);
    };
  }

  protected processLog(
    state: DeepReadonly<MetapoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<MetapoolState> | null {
    // To handle logs of metapool and the base pool the following architecture is followed
    // If the logs are for base pool, look out if the msg.sender of the function that generated
    // the log is the metapool if so ignore the log. This is done by overloading the
    // event handler map in the base pool. If the msg.sender is not the meta pool handle it
    // normally and save the state in the metapoolState. If the log is for metapool then
    // just handle it directly, make sure to call the appropriate state changing function
    // of the base pool in the handler of the metapool.
    // Warning: Make sure to look out for operations in metapool which do read-write-read on
    // base pool. The sequence of state changes based on logs could be tricky, and also to
    // avoid double state change on the base pool.
    try {
      const _basepool =
        _.findIndex(
          this.basepool.addressesSubscribed,
          c => c.toLowerCase() === log.address.toLowerCase(),
        ) != -1
          ? this.basepool.processLog(state.basepool, log) || state.basepool
          : state.basepool;
      let _state: MetapoolState = {
        A: bignumberify(state.A),
        fee: bignumberify(state.fee),
        admin_fee: bignumberify(state.admin_fee),
        supply: bignumberify(state.supply),
        balances: state.balances.map(bignumberify),
        base_virtual_price: bignumberify(state.base_virtual_price),
        base_cache_updated: bignumberify(state.base_cache_updated),
        basepool: {
          A: bignumberify(_basepool.A),
          fee: bignumberify(_basepool.fee),
          admin_fee: bignumberify(_basepool.admin_fee),
          supply: bignumberify(_basepool.supply),
          balances: _basepool.balances.map(bignumberify),
        },
      };

      // We assume that there is no common subscribed address between the basepool and metapool
      if (
        _.findIndex(
          this.metapoolAddressesSubscribed,
          c => c.toLowerCase() === log.address.toLowerCase(),
        ) != -1
      ) {
        const event = this.decoder(log);
        if (event.name in this.handlers)
          return this.handlers[event.name](event, _state, log, blockHeader);
        return _state;
      }
      return _state;
    } catch (e) {
      this.logger.error(`Error: unexpected error handling log:`, e);
    }
    return state;
  }

  async setup(blockNumber: number, poolState: MetapoolState | null = null) {
    if (!poolState) poolState = await this.generateState(blockNumber);
    if (blockNumber) this.setState(poolState, blockNumber);
  }

  protected getRates() {
    const result = _.cloneDeep(this.PRECISION_MUL);
    return result.map(r => r.times(this.LENDING_PRECISION));
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<Readonly<MetapoolState>> {
    return (
      await getManyPoolStates([this], this.dexHelper.multiContract, blockNumber)
    )[0] as MetapoolState;
    // const getBalancesCalls = _.range(0, this.N_COINS).map<MultiCallParams<BigNumber>>(n => ({
    //   target: this.address,
    //   callData: this.poolIface.encodeFunctionData('balances', [n]),
    //   decodeFunction: uin256DecodeToBigNumber,
    // }));
    //
    // const resultsPromises = this.dexHelper.multiWrapper!.tryAggregate<BigNumber>(
    //   true,
    //   [
    //     { // index 0
    //       target: this.address,
    //       callData: this.poolIface.encodeFunctionData('admin_fee'),
    //       decodeFunction: uin256DecodeToBigNumber,
    //     },
    //     { // index 1
    //       target: this.address,
    //       callData: this.poolIface.encodeFunctionData('fee'),
    //       decodeFunction: uin256DecodeToBigNumber,
    //     },
    //     { // index 2
    //       target: this.address,
    //       callData: this.poolIface.encodeFunctionData('A'),
    //       decodeFunction: uin256DecodeToBigNumber,
    //     },
    //     { // index 3
    //       target: this.tokenAddress,
    //       callData: erc20Iface.encodeFunctionData('totalSupply'),
    //       decodeFunction: uin256DecodeToBigNumber,
    //     },
    //     { // index 4
    //       target: this.address,
    //       callData: this.poolIface.encodeFunctionData('base_virtual_price'),
    //       decodeFunction: uin256DecodeToBigNumber,
    //     },
    //     { // index 5
    //       target: this.address,
    //       callData: this.poolIface.encodeFunctionData('base_cache_updated'),
    //       decodeFunction: uin256DecodeToBigNumber,
    //     },
    //
    //     ...getBalancesCalls,
    //   ],
    //   blockNumber,
    // );
    //
    // const [results, basepool] = await Promise.all([resultsPromises, this.basepool.generateState()]);
    //
    // return {
    //   admin_fee: results[0].returnData,
    //   fee: results[1].returnData,
    //   A: results[2].returnData,
    //   supply: results[3].returnData,
    //   base_virtual_price: results[4].returnData,
    //   base_cache_updated: results[5].returnData,
    //   balances: results.slice(3, results.length).map(r => r.returnData),
    //   basepool,
    // }
  }

  handleBasepoolAddLiquidity(
    event: any,
    state: BasepoolState,
    log: Log,
  ): BasepoolState {
    return event.args.provider.toLowerCase() === this.address.toLowerCase()
      ? state
      : this.basepool.handleAddLiquidity(event, state, log);
  }

  handleBasepoolRemoveLiquidityOne(
    event: any,
    state: BasepoolState,
    log: Log,
  ): BasepoolState {
    return event.args.provider.toLowerCase() === this.address.toLowerCase()
      ? state
      : this.basepool.handleRemoveLiquidityOne(event, state, log);
  }

  handleBasepoolTokenExchange(
    event: any,
    state: BasepoolState,
    log: Log,
  ): BasepoolState {
    return event.args.buyer.toLowerCase() === this.address.toLowerCase()
      ? state
      : this.basepool.handleTokenExchange(event, state, log);
  }

  handleNewParameters(
    event: any,
    state: MetapoolState,
    log: Log,
  ): MetapoolState {
    const A = bignumberify(stringify(event.args.A));
    const fee = bignumberify(stringify(event.args.fee));
    const admin_fee = bignumberify(stringify(event.args.admin_fee));

    state.A = A;
    state.fee = fee;
    state.admin_fee = admin_fee;
    return state;
  }

  handleRemoveLiquidity(
    event: any,
    state: MetapoolState,
    log: Log,
  ): MetapoolState {
    const token_amounts = event.args.token_amounts
      .map(stringify)
      .map(bignumberify);
    const token_supply = bignumberify(stringify(event.args.token_supply));

    for (let i = 0; i < this.N_COINS; i++) {
      state.balances[i] = state.balances[i].minus(token_amounts[i]);
    }
    state.supply = token_supply;
    return state;
  }

  handleRemoveLiquidityImbalances(
    event: any,
    state: MetapoolState,
    log: Log,
    blockHeader: BlockHeader,
  ): MetapoolState {
    const amounts = event.args.token_amounts.map(stringify).map(bignumberify);
    const blockTimestamp = bignumberify(blockHeader.timestamp);
    const rates = this.getRates();

    const [vp_rate, base_cache_updated] = this._vp_rate(
      state.basepool,
      state.base_virtual_price,
      state.base_cache_updated,
      blockTimestamp,
    );
    state.base_virtual_price = vp_rate;
    state.base_cache_updated = base_cache_updated;

    const token_supply: BigNumber = state.supply;
    // assert token_supply != 0  # dev: zero total supply
    const _fee: BigNumber = state.fee
      .times(this.N_COINS)
      .idiv(4 * (this.N_COINS - 1));
    const _admin_fee: BigNumber = state.admin_fee;
    const amp: BigNumber = state.A;

    const old_balances: BigNumber[] = state.balances;
    let new_balances: BigNumber[] = _.clone(old_balances);
    const D0: BigNumber = this.get_D_mem(vp_rate, rates, old_balances, amp);
    for (let i = 0; i < this.N_COINS; i++) {
      new_balances[i] = new_balances[i].minus(amounts[i]);
    }
    const D1: BigNumber = this.get_D_mem(vp_rate, rates, new_balances, amp);
    const fees: BigNumber[] = new Array<BigNumber>(this.N_COINS);
    for (let i = 0; i < this.N_COINS; i++) {
      const ideal_balance: BigNumber = D1.times(old_balances[i]).idiv(D0);
      let difference: BigNumber = BN_0;
      if (ideal_balance.gt(new_balances[i])) {
        difference = ideal_balance.minus(new_balances[i]);
      } else {
        difference = new_balances[i].minus(ideal_balance);
      }
      fees[i] = _fee.times(difference).idiv(this.FEE_DENOMINATOR);
      state.balances[i] = new_balances[i].minus(
        fees[i].times(_admin_fee).idiv(this.FEE_DENOMINATOR),
      );
      new_balances[i] = new_balances[i].minus(fees[i]);
    }
    const D2: BigNumber = this.get_D_mem(vp_rate, rates, new_balances, amp);

    let token_amount: BigNumber = D0.minus(D2).times(token_supply).idiv(D0);
    // assert token_amount != 0  # dev: zero tokens burned
    token_amount = token_amount.plus(1); // In case of rounding errors - make it unfavorable for the "attacker"
    // assert token_amount <= max_burn_amount, "Slippage screwed you"

    // state.token.burnFrom(msg.sender, token_amount)  # dev: insufficient funds
    // TODO: token supply should be handled by token subscriptions
    state.supply = state.supply.minus(token_amount);
    return state;
  }

  handleTokenExchange(
    event: any,
    state: MetapoolState,
    log: Log,
    blockHeader: BlockHeader,
  ): MetapoolState {
    const i = event.args.sold_id.toNumber();
    const j = event.args.bought_id.toNumber();
    const dx = bignumberify(stringify(event.args.tokens_sold));
    const blockTimestamp = bignumberify(blockHeader.timestamp);

    const [vp_rate, base_cache_updated] = this._vp_rate(
      state.basepool,
      state.base_virtual_price,
      state.base_cache_updated,
      blockTimestamp,
    );
    state.base_virtual_price = vp_rate;
    state.base_cache_updated = base_cache_updated;

    const rates = this.getRates();
    rates[this.MAX_COIN] = vp_rate;

    const old_balances: BigNumber[] = state.balances;
    const xp: BigNumber[] = this._xp_mem(vp_rate, rates, old_balances);

    const dx_w_fee: BigNumber = dx;
    // TODO: Handling an unexpected charge of a fee on transfer (USDT, PAXG)
    /* Original contract does the actual transfer from sender to contract here*/

    const x: BigNumber = xp[i].plus(
      dx_w_fee.times(rates[i]).idiv(this.PRECISION),
    );
    const y: BigNumber = this.get_y(i, j, x, xp, state.A);

    let dy: BigNumber = xp[j].minus(y).minus(1); // -1 just in case there were some rounding errors
    const dy_fee: BigNumber = dy.times(state.fee).idiv(this.FEE_DENOMINATOR);

    // Convert all to real units
    dy = dy.minus(dy_fee).times(this.PRECISION).idiv(rates[j]);

    let dy_admin_fee: BigNumber = dy_fee
      .times(state.admin_fee)
      .idiv(this.FEE_DENOMINATOR);
    dy_admin_fee = dy_admin_fee.times(this.PRECISION).idiv(rates[j]);

    // Change balances exactly in same way as we change actual ERC20 coin amounts
    state.balances[i] = old_balances[i].plus(dx_w_fee);
    // When rounding errors happen, we undercharge admin fee in favor of LP
    state.balances[j] = old_balances[j].minus(dy).minus(dy_admin_fee);

    /* Original contract does the actual transfer from contract to sender here*/
    return state;
  }

  handleTokenExchangeUnderlying(
    event: any,
    state: MetapoolState,
    log: Log,
    blockHeader: BlockHeader,
  ): MetapoolState {
    const i = event.args.sold_id.toNumber();
    const j = event.args.bought_id.toNumber();
    const blockTimestamp = bignumberify(blockHeader.timestamp);
    const dx = bignumberify(stringify(event.args.tokens_sold));
    const rates = this.getRates();

    const [vp_rate, base_cache_updated] = this._vp_rate(
      state.basepool,
      state.base_virtual_price,
      state.base_cache_updated,
      blockTimestamp,
    );
    state.base_virtual_price = vp_rate;
    state.base_cache_updated = base_cache_updated;

    rates[this.MAX_COIN] = vp_rate;

    // Use base_i or base_j if they are >= 0
    const base_i = i - this.MAX_COIN;
    const base_j = j - this.MAX_COIN;
    let meta_i = this.MAX_COIN;
    let meta_j = this.MAX_COIN;
    if (base_i < 0) meta_i = i;
    if (base_j < 0) meta_j = j;
    let dy = 0;

    // Addresses for input and output coins
    let input_coin = '';
    if (base_i < 0) input_coin = this.COINS[i];
    else input_coin = this.basepool.COINS[base_i];

    let output_coin = '';
    if (base_j < 0) output_coin = this.COINS[j];
    else output_coin = this.basepool.COINS[base_j];

    let dx_w_fee: BigNumber = dx;
    // We assume here that there is not fees associated with the token
    if (base_i < 0 || base_j < 0) {
      const old_balances = _.clone(state.balances);
      const xp = this._xp_mem(rates[this.MAX_COIN], rates, old_balances);

      let x: BigNumber;
      if (base_i < 0) {
        x = xp[i].plus(dx_w_fee.times(rates[i]).idiv(this.PRECISION));
      } else {
        // i is from BasePool
        // At first, get the amount of pool tokens
        let base_inputs = [0, 0, 0].map(bignumberify);
        base_inputs[base_i] = dx_w_fee;
        const coin_i = this.COINS[this.MAX_COIN];
        // Deposit and measure delta

        dx_w_fee = this.basepool.add_liquidity(base_inputs, state.basepool);
        // Need to convert pool token to "virtual" units using rates

        x = dx_w_fee.times(rates[this.MAX_COIN]).idiv(this.PRECISION);
        // Adding number of pool tokens
        x = x.plus(xp[this.MAX_COIN]);
      }

      const y = this.get_y(meta_i, meta_j, x, xp, state.A);

      // Either a real coin or token
      let dy = xp[meta_j].minus(y).minus(1); // -1 just in case there were some rounding errors
      const dy_fee = dy.times(state.fee).idiv(this.FEE_DENOMINATOR);

      // Convert all to real units
      // Works for both pool coins and real coins
      dy = dy.minus(dy_fee).times(this.PRECISION).idiv(rates[meta_j]);

      let dy_admin_fee = dy_fee
        .times(state.admin_fee)
        .idiv(this.FEE_DENOMINATOR);
      dy_admin_fee = dy_admin_fee.times(this.PRECISION).idiv(rates[meta_j]);

      // Change balances exactly in same way as we change actual ERC20 coin amounts
      state.balances[meta_i] = old_balances[meta_i].plus(dx_w_fee);
      // When rounding errors happen, we undercharge admin fee in favor of LP
      state.balances[meta_j] = old_balances[meta_j]
        .minus(dy)
        .minus(dy_admin_fee);

      // Withdraw from the base pool if needed
      if (base_j >= 0) {
        dy = this.basepool.remove_liquidity_one_coin(
          dy,
          base_j,
          state.basepool,
        );
      }

      // assert dy >= min_dy, "Too few coins in result"
    } else {
      let dy: BigNumber;
      dy = this.basepool.exchange(base_i, base_j, dx_w_fee, state.basepool);
    }

    return state;
  }

  handleAddLiquidity(
    event: any,
    state: MetapoolState,
    log: Log,
    blockHeader: BlockHeader,
  ): MetapoolState {
    const amounts = event.args.token_amounts.map(stringify).map(bignumberify);
    const supply = bignumberify(stringify(event.args.token_supply));
    const blockTimestamp = bignumberify(blockHeader.timestamp);
    const rates = this.getRates();

    const [vp_rate, base_cache_updated] = this._vp_rate(
      state.basepool,
      state.base_virtual_price,
      state.base_cache_updated,
      blockTimestamp,
    );
    state.base_virtual_price = vp_rate;
    state.base_cache_updated = base_cache_updated;

    let fees: BigNumber[] = new Array<BigNumber>(this.N_COINS);
    const _fee: BigNumber = state.fee
      .times(this.N_COINS)
      .idiv(4 * (this.N_COINS - 1));
    const _admin_fee: BigNumber = state.admin_fee;
    // TODO: This might be incorrect as the original contract uses amplification factor
    const amp: BigNumber = state.A;

    // TODO: This can be incorrect as the contract always uses the token contract to get the supply
    const token_supply: BigNumber = state.supply;
    // Initial invariant
    let D0: BigNumber = BN_0;
    const old_balances: BigNumber[] = state.balances;
    if (token_supply.gt(0)) {
      D0 = this.get_D_mem(vp_rate, rates, old_balances, amp);
    }
    const new_balances: BigNumber[] = _.clone(old_balances);

    for (let i = 0; i < this.N_COINS; i++) {
      const in_amount: BigNumber = amounts[i];
      /* Original contract does the actual transfer here*/
      // TODO: This can be incorrect because of the fees charged which might differ the actual value
      new_balances[i] = old_balances[i].plus(in_amount);
    }

    // Invariant after change
    const D1: BigNumber = this.get_D_mem(vp_rate, rates, new_balances, amp);

    // We need to recalculate the invariant accounting for fees
    // to calculate fair user's share
    let D2: BigNumber = D1;
    if (token_supply.gt(BN_0)) {
      // Only account for fees if we are not the first to deposit
      for (let i = 0; i < this.N_COINS; i++) {
        const ideal_balance: BigNumber = D1.times(old_balances[i]).idiv(D0);
        let difference: BigNumber = BN_0;
        if (ideal_balance.gt(new_balances[i])) {
          difference = ideal_balance.minus(new_balances[i]);
        } else {
          difference = new_balances[i].minus(ideal_balance);
        }
        fees[i] = _fee.times(difference).idiv(this.FEE_DENOMINATOR);
        state.balances[i] = new_balances[i].minus(
          fees[i].times(_admin_fee).idiv(this.FEE_DENOMINATOR),
        );
        new_balances[i] = new_balances[i].minus(fees[i]);
      }
      D2 = this.get_D_mem(vp_rate, rates, new_balances, amp);
    } else {
      state.balances = new_balances;
    }

    // Calculate, how much pool tokens to mint
    /* Original contract does the minting of the token here*/
    state.supply = supply;

    // log AddLiquidity(msg.sender, amounts, fees, D1, token_supply + mint_amount)
    return state;
  }

  protected _vp_rate(
    basepool: BasepoolState,
    base_virtual_price: BigNumber,
    base_cache_updated: BigNumber,
    blockTimestamp: BigNumber,
  ): [BigNumber, BigNumber] {
    if (blockTimestamp.gt(base_cache_updated.plus(this.BASE_CACHE_EXPIRES)))
      return [this.basepool.get_virtual_price(basepool), blockTimestamp];
    else return [base_virtual_price, base_cache_updated];
  }

  protected _vp_rate_ro(
    basepool: BasepoolState,
    base_virtual_price: BigNumber,
    base_cache_updated: BigNumber,
    blockTimestamp: BigNumber,
  ): BigNumber {
    return this._vp_rate(
      basepool,
      base_virtual_price,
      base_cache_updated,
      blockTimestamp,
    )[0];
  }

  public _get_dy_underlying(
    i: number,
    j: number,
    dx: BigNumber,
    A: BigNumber,
    fee: BigNumber,
    balances: BigNumber[],
    rates: BigNumber[],
    base_virtual_price: BigNumber,
    base_cache_updated: BigNumber,
    blockTimestamp: BigNumber,
    basepool: BasepoolState,
  ): BigNumber {
    const vp_rate = this._vp_rate_ro(
      basepool,
      base_virtual_price,
      base_cache_updated,
      blockTimestamp,
    );

    const xp = this._xp(vp_rate, rates, balances);
    // dx and dy in underlying units
    const precisions = _.clone(this.PRECISION_MUL);

    // Use base_i or base_j if they are >= 0
    const base_i = i - this.MAX_COIN;
    const base_j = j - this.MAX_COIN;
    let meta_i = this.MAX_COIN;
    let meta_j = this.MAX_COIN;
    if (base_i < 0) meta_i = i;
    if (base_j < 0) meta_j = j;

    let x: BigNumber;
    if (base_i < 0) {
      x = xp[i].plus(dx.times(precisions[i]));
    } else {
      if (base_j < 0) {
        // i is from BasePool
        // At first, get the amount of pool tokens
        let base_inputs = new Array<BigNumber>(this.basepool.N_COINS).fill(
          BN_0,
        );
        base_inputs[base_i] = dx;
        // Token amount transformed to underlying "dollars"
        x = this.basepool
          .calc_token_amount(base_inputs, true, basepool)
          .times(vp_rate)
          .idiv(this.PRECISION);

        // Accounting for deposit/withdraw fees approximately
        x = x.minus(x.times(basepool.fee).idiv(this.FEE_DENOMINATOR.times(2)));
        // Adding number of pool tokens
        x = x.plus(xp[this.MAX_COIN]);
      } else {
        // If both are from the base pool
        return this.basepool.get_dy(base_i, base_j, dx, basepool);
      }
    }

    // This pool is involved only when in-pool assets are used
    const y = this.get_y(meta_i, meta_j, x, xp, A);
    let dy = xp[meta_j].minus(y).minus(1);
    dy = dy.minus(fee.times(dy).idiv(this.FEE_DENOMINATOR));
    // If output is going via the metapool
    if (base_j < 0) dy = dy.idiv(precisions[meta_j]);
    // j is from BasePool
    //  The fee is already accounted for
    else
      dy = this.basepool.calc_withdraw_one_coin(
        dy.times(this.PRECISION).idiv(vp_rate),
        base_j,
        basepool,
      );

    return dy;
  }

  public get_dy_underlying(
    i: number,
    j: number,
    dx: BigNumber,
    state: Readonly<MetapoolState>,
  ): BigNumber {
    const rates = this.getRates();
    let _basepool = {
      A: bignumberify(state.basepool.A),
      fee: bignumberify(state.basepool.fee),
      admin_fee: bignumberify(state.basepool.admin_fee),
      supply: bignumberify(state.basepool.supply),
      balances: state.basepool.balances.map(bignumberify),
    };
    // TODO: fix to add an extra latency as users will not do the transactions immediately
    const blockTimestamp = bignumberify(Date.now());
    return this._get_dy_underlying(
      i,
      j,
      dx,
      bignumberify(state.A),
      bignumberify(state.fee),
      state.balances.map(bignumberify),
      rates,
      bignumberify(state.base_virtual_price),
      bignumberify(state.base_cache_updated),
      blockTimestamp,
      _basepool,
    );
  }

  public _get_dy(
    i: number,
    j: number,
    dx: BigNumber,
    A: BigNumber,
    fee: BigNumber,
    balances: BigNumber[],
    rates: BigNumber[],
    base_virtual_price: BigNumber,
    base_cache_updated: BigNumber,
    blockTimestamp: BigNumber,
    basepool: BasepoolState,
    usefee = true,
  ): BigNumber {
    const vp_rate = this._vp_rate_ro(
      basepool,
      base_virtual_price,
      base_cache_updated,
      blockTimestamp,
    );
    const xp = this._xp(vp_rate, rates, balances);
    rates[this.MAX_COIN] = vp_rate;
    const x = xp[i].plus(dx.times(rates[i]).idiv(this.PRECISION));
    const y = this.get_y(i, j, x, xp, A);
    const dy = xp[j].minus(y).minus(1);
    let _fee = fee.times(dy).idiv(this.FEE_DENOMINATOR);
    if (!usefee) _fee = BN_0;
    return dy.minus(_fee).times(this.PRECISION).idiv(rates[j]);
  }

  public get_dy(
    i: number,
    j: number,
    dx: BigNumber,
    state: Readonly<MetapoolState>,
  ): BigNumber {
    const rates = this.getRates();
    // TODO: fix to add an extra latency as users will not do the transactions immediately
    const blockTimestamp = bignumberify(Date.now());
    let _basepool = {
      A: bignumberify(state.basepool.A),
      fee: bignumberify(state.basepool.fee),
      admin_fee: bignumberify(state.basepool.admin_fee),
      supply: bignumberify(state.basepool.supply),
      balances: state.basepool.balances.map(bignumberify),
    };
    return this._get_dy(
      i,
      j,
      dx,
      bignumberify(state.A),
      bignumberify(state.fee),
      state.balances.map(bignumberify),
      rates,
      bignumberify(state.base_virtual_price),
      bignumberify(state.base_cache_updated),
      blockTimestamp,
      _basepool,
    );
  }

  get_D(xp: BigNumber[], amp: BigNumber): BigNumber {
    let S = BN_0;
    for (const _x of xp) S = S.plus(_x);
    if (S.eq(0)) return BN_0;

    let Dprev = BN_0;
    let D = bignumberify(S);
    const Ann = amp.times(this.N_COINS);
    for (let _i = 0; _i < 255; _i++) {
      let D_P = bignumberify(D);
      for (const _x of xp) {
        D_P = D_P.times(D).idiv(_x.times(this.N_COINS));
      }
      Dprev = bignumberify(D);
      D = Ann.times(S)
        .plus(D_P.times(this.N_COINS))
        .times(D)
        .idiv(
          Ann.minus(1)
            .times(D)
            .plus(bignumberify(this.N_COINS + 1).times(D_P)),
        );
      if (D.gt(Dprev)) {
        if (D.minus(Dprev).lte(1)) break;
      } else {
        if (Dprev.minus(D).lte(1)) break;
      }
    }
    return D;
  }

  get_y(
    i: number,
    j: number,
    x: BigNumber,
    xp: BigNumber[],
    A: BigNumber,
  ): BigNumber {
    // if(! ((i != j) && (i >= 0) && (j >= 0) && (i < this.N_COINS) && (j < this.N_COINS))) throw new Error('get y assert failed')
    const D = this.get_D(xp, A);

    let c = bignumberify(D);
    let S_ = BN_0;
    const Ann = A.times(this.N_COINS);

    let _x = BN_0;
    for (let _i = 0; _i < this.N_COINS; _i++) {
      if (_i === i) _x = x;
      else if (_i !== j) _x = xp[_i];
      else continue;
      S_ = S_.plus(_x);
      c = c.times(D).idiv(_x.times(this.N_COINS));
    }
    c = c.times(D).idiv(Ann.times(this.N_COINS));
    const b = S_.plus(D.idiv(Ann));
    let yPrev = BN_0;
    let y = bignumberify(D);
    for (let o = 0; o < 255; o++) {
      yPrev = bignumberify(y);
      const y1 = y.times(y);
      const y2 = y1.plus(c);

      const y3 = bignumberify(2).times(y);
      const y4 = y3.plus(b).minus(D);

      y = y2.idiv(y4);

      if (y.gt(yPrev)) {
        if (y.minus(yPrev).lte(1)) break;
      } else {
        if (yPrev.minus(y).lte(1)) break;
      }
    }
    return y;
  }

  get_D_mem(
    vp_rate: BigNumber,
    rates: BigNumber[],
    balances: BigNumber[],
    amp: BigNumber,
  ) {
    return this.get_D(this._xp_mem(vp_rate, rates, balances), amp);
  }

  protected _xp(
    vp_rate: BigNumber,
    rates: BigNumber[],
    balances: BigNumber[],
  ): BigNumber[] {
    return this._xp_mem(vp_rate, rates, balances);
  }

  protected _xp_mem(
    vp_rate: BigNumber,
    rates: BigNumber[],
    balances: BigNumber[],
  ): BigNumber[] {
    const result = [...rates];
    result[this.MAX_COIN] = vp_rate;
    for (let i = 0; i < this.N_COINS; i++) {
      result[i] = result[i].times(balances[i]).idiv(this.PRECISION);
    }
    return result;
  }

  handleCoinTransfer(
    event: any,
    state: MetapoolState,
    log: Log,
  ): MetapoolState {
    const from = event.args.from;
    const coin = log.address;

    if (from.toLowerCase() == this.address.toLowerCase())
      this.lastTransferredCoin = coin.toLowerCase();
    return state;
  }

  handleNewFee(event: any, state: MetapoolState, log: Log): MetapoolState {
    const fee = bignumberify(stringify(event.args.fee));
    const admin_fee = bignumberify(stringify(event.args.admin_fee));

    state.fee = fee;
    state.admin_fee = admin_fee;
    return state;
  }

  handleRemoveLiquidityOne(
    event: any,
    state: MetapoolState,
    log: Log,
    blockHeader: BlockHeader,
  ): MetapoolState {
    const _token_amount = bignumberify(stringify(event.args.token_amount));
    const blockTimestamp = bignumberify(blockHeader.timestamp);
    // TODO: fix the correct blockTimestamp in the below call
    const [vp_rate, base_cache_updated] = this._vp_rate(
      state.basepool,
      state.base_virtual_price,
      state.base_cache_updated,
      blockTimestamp,
    );
    state.base_virtual_price = vp_rate;
    state.base_cache_updated = base_cache_updated;

    const i = _.findIndex(
      this.COINS,
      c => c.toLowerCase() === this.lastTransferredCoin!.toLowerCase(),
    );
    if (i === -1) {
      this.logger.error(
        `Error: expected coin to have a transfer event before RemoveLiquidityOne event`,
      );
      return state;
    }
    // let dy: BigNumber = BN_0
    // let dy_fee: BigNumber = BN_0

    let { dy, dy_fee } = this._calc_withdraw_one_coin(
      _token_amount,
      i,
      state.A,
      state.fee,
      state.supply,
      vp_rate,
      state.balances,
    );
    // assert dy >= min_amount, "Not enough coins removed"
    state.balances[i] = state.balances[i].minus(
      dy.plus(dy_fee.times(state.admin_fee).idiv(this.FEE_DENOMINATOR)),
    );
    // self.token.burnFrom(msg.sender, _token_amount)  # dev: insufficient funds
    state.supply = state.supply.minus(_token_amount);
    /* Original contract does the actual transfer here*/

    return state;
  }

  private get_y_D(
    A_: BigNumber,
    i: number,
    xp: BigNumber[],
    D: BigNumber,
  ): BigNumber {
    // Calculate x[i] if one reduces D from being calculated for xp to D
    // Done by solving quadratic equation iteratively.
    // x_1**2 + x1 * (sum' - (A*n**n - 1) * D / (A * n**n)) = D ** (n + 1) / (n ** (2 * n) * prod' * A)
    // x_1**2 + b*x_1 = c
    // x_1 = (x_1**2 + c) / (2*x_1 + b)

    // x in the input is converted to the same price/precision

    // assert i >= 0  # dev: i below zero
    // assert i < N_COINS  # dev: i above N_COINS

    let c: BigNumber = D;
    let S_: BigNumber = BN_0;
    const Ann: BigNumber = A_.times(this.N_COINS);

    let _x: BigNumber = BN_0;
    for (let _i = 0; _i < this.N_COINS; _i++) {
      if (_i != i) {
        _x = xp[_i];
      } else {
        continue;
      }
      S_ = S_.plus(_x);
      c = c.times(D).idiv(_x.times(this.N_COINS));
    }
    c = c.times(D).idiv(Ann.times(this.N_COINS));
    const b: BigNumber = S_.plus(D.idiv(Ann));
    let y_prev: BigNumber = BN_0;
    let y: BigNumber = D;
    for (let _i = 0; _i < 255; _i++) {
      y_prev = y;
      y = y.times(y).plus(c).idiv(y.times(2).plus(b).minus(D));
      // Equality with the precision of 1
      if (y.gt(y_prev)) {
        if (y.minus(y_prev).lte(1)) {
          break;
        }
      } else {
        if (y_prev.minus(y).lte(1)) {
          break;
        }
      }
    }
    return y;
  }

  private _calc_withdraw_one_coin(
    _token_amount: BigNumber,
    i: number,
    amp: BigNumber,
    fee: BigNumber,
    supply: BigNumber,
    vp_rate: BigNumber,
    balances: BigNumber[],
  ) {
    // First, need to calculate
    // * Get current D
    // * Solve Eqn against y_i for D - _token_amount
    const _fee: BigNumber = fee
      .times(this.N_COINS)
      .idiv(4 * (this.N_COINS - 1));
    const rates = this.getRates();
    const xp: BigNumber[] = this._xp(vp_rate, rates, balances);
    const D0: BigNumber = this.get_D(xp, amp);

    const total_supply: BigNumber = supply;
    const D1: BigNumber = D0.minus(_token_amount.times(D0).idiv(total_supply));
    const new_y: BigNumber = this.get_y_D(amp, i, xp, D1);

    rates[this.MAX_COIN] = vp_rate;

    const xp_reduced: BigNumber[] = _.clone(xp);
    const dy_0: BigNumber = xp[i]
      .minus(new_y)
      .times(this.PRECISION)
      .idiv(rates[i]); // w/o fees

    for (let j = 0; j < this.N_COINS; j++) {
      let dx_expected: BigNumber = BN_0;
      if (j == i) {
        dx_expected = xp[j].times(D1).idiv(D0).minus(new_y);
      } else {
        dx_expected = xp[j].minus(xp[j].times(D1).idiv(D0));
      }
      xp_reduced[j] = xp_reduced[j].minus(
        _fee.times(dx_expected).idiv(this.FEE_DENOMINATOR),
      );
    }

    let dy: BigNumber = xp_reduced[i].minus(
      this.get_y_D(amp, i, xp_reduced, D1),
    );
    dy = dy.minus(1).times(this.PRECISION).idiv(rates[i]); // Withdraw less to account for rounding errors

    return { dy, dy_fee: dy_0.minus(dy) };
  }
}
