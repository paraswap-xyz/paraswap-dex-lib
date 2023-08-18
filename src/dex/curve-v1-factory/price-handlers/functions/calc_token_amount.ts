import _ from 'lodash';
import { ImplementationNames, PoolState } from '../../types';
import { calc_token_amount, IPoolContext } from '../types';
import { throwNotImplemented } from './utils';

const customPlain3CoinThree: calc_token_amount = (
  self: IPoolContext,
  state: PoolState,
  amounts: bigint[],
  is_deposit: boolean,
) => {
  const { N_COINS } = self.constants;
  const amp = state.A;
  const balances = [...state.balances];
  const D0 = self.get_D_mem(self, state, balances, amp);
  for (const i of _.range(N_COINS)) {
    if (is_deposit) balances[i] += amounts[i];
    else balances[i] -= amounts[i];
  }
  const D1 = self.get_D_mem(self, state, balances, amp);

  if (state.totalSupply === undefined) {
    throw new Error(
      `${self.IMPLEMENTATION_NAME} customPlain3CoinThree: totalSupply is not provided`,
    );
  }

  const token_amount = state.totalSupply;
  let diff = 0n;
  if (is_deposit) {
    diff = D1 - D0;
  } else {
    diff = D0 - D1;
  }
  return (diff * token_amount) / D0;
};

const factoryPlain2Basic: calc_token_amount = (
  self: IPoolContext,
  state: PoolState,
  amounts: bigint[],
  is_deposit: boolean,
) => {
  const { N_COINS } = self.constants;
  const amp = state.A;
  const balances = [...state.balances];
  const D0 = self.get_D(self, balances, amp);
  for (const i of _.range(N_COINS)) {
    if (is_deposit) balances[i] += amounts[i];
    else balances[i] -= amounts[i];
  }
  const D1 = self.get_D(self, balances, amp);

  if (state.totalSupply === undefined) {
    throw new Error(
      `${self.IMPLEMENTATION_NAME} customPlain3CoinThree: totalSupply is not provided`,
    );
  }

  const token_amount = state.totalSupply;
  let diff = 0n;
  if (is_deposit) {
    diff = D1 - D0;
  } else {
    diff = D0 - D1;
  }
  return (diff * token_amount) / D0;
};

const customAvalanche3CoinLending: calc_token_amount = (
  self: IPoolContext,
  state: PoolState,
  amounts: bigint[],
  is_deposit: boolean,
) => {
  const { N_COINS } = self.constants;

  const coin_balances = [...state.balances];
  const amp = state.A;
  const D0 = self.get_D_precision(self, coin_balances, amp);
  for (const i of _.range(N_COINS)) {
    if (is_deposit) coin_balances[i] += amounts[i];
    else coin_balances[i] -= amounts[i];
  }
  const D1 = self.get_D_precision(self, coin_balances, amp);
  let diff = 0n;
  if (is_deposit) diff = D1 - D0;
  else diff = D0 - D1;

  if (state.totalSupply === undefined) {
    throw new Error(
      `${self.IMPLEMENTATION_NAME} customAvalanche3CoinLending: totalSupply is not provided`,
    );
  }

  return (diff * state.totalSupply) / D0;
};

const customPlain2CoinCrv: calc_token_amount = (
  self: IPoolContext,
  state: PoolState,
  amounts: bigint[],
  is_deposit: boolean,
) => {
  const { N_COINS, BI_N_COINS, FEE_DENOMINATOR } = self.constants;
  const amp = state.A;
  const balances = [...state.balances];
  const D0 = self.get_D_mem(self, state, balances, amp);
  for (const i of _.range(N_COINS)) {
    if (is_deposit) balances[i] += amounts[i];
    else balances[i] -= amounts[i];
  }
  const D1 = self.get_D_mem(self, state, balances, amp);

  if (state.totalSupply === undefined) {
    throw new Error(
      `${self.IMPLEMENTATION_NAME} customPlain3CoinThree: totalSupply is not provided`,
    );
  }

  const total_supply = state.totalSupply;
  let D2 = D1;

  if (total_supply > 0n) {
    const base_fee = (state.fee * BI_N_COINS) / (4n * (BI_N_COINS - 1n));
    for (const i of _.range(N_COINS)) {
      const ideal_balance = (D1 * state.balances[i]) / D0;
      let difference = 0n;
      const new_balance = balances[i];
      if (ideal_balance > new_balance) {
        difference = ideal_balance - new_balance;
      } else {
        difference = new_balance - ideal_balance;
      }
      balances[i] -= (base_fee * difference) / FEE_DENOMINATOR;
    }
    const xp = self._xp_mem(
      self,
      [...state.constants.rate_multipliers],
      balances,
    );
    D2 = self.get_D_mem(self, state, xp, amp);
  } else {
    return D1;
  }

  let diff = 0n;
  if (is_deposit) {
    diff = D2 - D0;
  } else {
    diff = D0 - D2;
  }
  return (diff * total_supply) / D0;
};

const notImplemented: calc_token_amount = (
  self: IPoolContext,
  state: PoolState,
  amounts: bigint[],
  is_deposit: boolean,
) => {
  return throwNotImplemented('calc_token_amount', self.IMPLEMENTATION_NAME);
};

const implementations: Record<ImplementationNames, calc_token_amount> = {
  [ImplementationNames.CUSTOM_PLAIN_2COIN_FRAX]: customPlain3CoinThree,
  [ImplementationNames.CUSTOM_PLAIN_2COIN_RENBTC]: customPlain3CoinThree,
  [ImplementationNames.CUSTOM_PLAIN_2COIN_WBTC]: customPlain3CoinThree,
  [ImplementationNames.CUSTOM_PLAIN_3COIN_SBTC]: customPlain3CoinThree,
  [ImplementationNames.CUSTOM_PLAIN_3COIN_THREE]: customPlain3CoinThree,

  [ImplementationNames.CUSTOM_ARBITRUM_2COIN_BTC]: customPlain3CoinThree,
  [ImplementationNames.CUSTOM_ARBITRUM_2COIN_USD]: customPlain3CoinThree,

  [ImplementationNames.CUSTOM_AVALANCHE_3COIN_LENDING]:
    customAvalanche3CoinLending,

  [ImplementationNames.CUSTOM_FANTOM_2COIN_BTC]: customPlain3CoinThree,
  [ImplementationNames.CUSTOM_FANTOM_2COIN_USD]: customPlain3CoinThree,
  [ImplementationNames.CUSTOM_FANTOM_3COIN_LENDING]:
    customAvalanche3CoinLending,

  [ImplementationNames.CUSTOM_OPTIMISM_3COIN_USD]: customPlain3CoinThree,

  [ImplementationNames.CUSTOM_POLYGON_2COIN_LENDING]:
    customAvalanche3CoinLending,
  [ImplementationNames.CUSTOM_POLYGON_3COIN_LENDING]:
    customAvalanche3CoinLending,

  [ImplementationNames.FACTORY_V1_META_BTC]: notImplemented,
  [ImplementationNames.FACTORY_V1_META_USD]: notImplemented,

  [ImplementationNames.FACTORY_META_BTC]: notImplemented,
  [ImplementationNames.FACTORY_META_BTC_BALANCES]: notImplemented,

  [ImplementationNames.FACTORY_META_BTC_REN]: notImplemented,
  [ImplementationNames.FACTORY_META_BTC_BALANCES_REN]: notImplemented,

  [ImplementationNames.FACTORY_META_USD]: notImplemented,
  [ImplementationNames.FACTORY_META_USD_BALANCES]: notImplemented,

  [ImplementationNames.FACTORY_META_USD_FRAX_USDC]: notImplemented,
  [ImplementationNames.FACTORY_META_USD_BALANCES_FRAX_USDC]: notImplemented,

  [ImplementationNames.FACTORY_PLAIN_2_BALANCES]: notImplemented,
  [ImplementationNames.FACTORY_PLAIN_2_BASIC]: factoryPlain2Basic,
  [ImplementationNames.FACTORY_PLAIN_2_ETH]: notImplemented,
  [ImplementationNames.FACTORY_PLAIN_2_OPTIMIZED]: notImplemented,

  [ImplementationNames.FACTORY_PLAIN_3_BALANCES]: notImplemented,
  [ImplementationNames.FACTORY_PLAIN_3_BASIC]: customPlain3CoinThree,
  [ImplementationNames.FACTORY_PLAIN_3_ETH]: notImplemented,
  [ImplementationNames.FACTORY_PLAIN_3_OPTIMIZED]: notImplemented,

  [ImplementationNames.FACTORY_PLAIN_4_BALANCES]: notImplemented,
  [ImplementationNames.FACTORY_PLAIN_4_BASIC]: notImplemented,
  [ImplementationNames.FACTORY_PLAIN_4_ETH]: notImplemented,
  [ImplementationNames.FACTORY_PLAIN_4_OPTIMIZED]: notImplemented,

  [ImplementationNames.FACTORY_META_BTC_SBTC2]: customPlain3CoinThree,
  [ImplementationNames.FACTORY_META_BTC_BALANCES_SBTC2]: customPlain3CoinThree,
  [ImplementationNames.FACTORY_PLAIN_2_BASIC_EMA]: customPlain3CoinThree,
  [ImplementationNames.FACTORY_PLAIN_2_ETH_EMA]: customPlain3CoinThree,
  [ImplementationNames.FACTORY_PLAIN_2_ETH_EMA2]: customPlain3CoinThree,
  [ImplementationNames.FACTORY_PLAIN_2_CRV_EMA]: customPlain2CoinCrv,
};

export default implementations;
