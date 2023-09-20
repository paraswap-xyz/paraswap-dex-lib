import { PoolState, TickInfo } from '../types';
import { LiquidityMath } from './LiquidityMath';
import { _require } from '../../../utils';
import { NumberAsString } from '@paraswap/core';
import { ZERO_TICK_INFO } from '../constants';

export class Tick {
  static update(
    state: Pick<PoolState, 'ticks'>,
    tick: bigint,
    liquidityDelta: bigint,
    upper: boolean,
    maxLiquidity: bigint,
  ): boolean {
    let info = state.ticks[Number(tick)];

    if (info === undefined) {
      info = { ...ZERO_TICK_INFO };
      state.ticks[Number(tick)] = info;
    }

    const liquidityGrossBefore = info.liquidityGross;
    const liquidityGrossAfter = LiquidityMath.addDelta(
      liquidityGrossBefore,
      liquidityDelta,
    );

    _require(
      liquidityGrossAfter <= maxLiquidity,
      'LO',
      { liquidityGrossAfter, maxLiquidity },
      'liquidityGrossAfter <= maxLiquidity',
    );

    const flipped = (liquidityGrossAfter == 0n) != (liquidityGrossBefore == 0n);

    if (liquidityGrossBefore == 0n) {
      info.initialized = true;
    }

    info.liquidityGross = liquidityGrossAfter;

    info.liquidityNet = upper
      ? BigInt.asIntN(
          128,
          BigInt.asIntN(256, info.liquidityNet) - liquidityDelta,
        )
      : BigInt.asIntN(
          128,
          BigInt.asIntN(256, info.liquidityNet) + liquidityDelta,
        );
    return flipped;
  }

  static clear(state: Pick<PoolState, 'ticks'>, tick: bigint) {
    delete state.ticks[Number(tick)];
  }

  static cross(
    ticks: Record<NumberAsString, TickInfo>,
    tick: bigint,
  ): bigint {
    const info = ticks[Number(tick)];
    return info.liquidityNet;
  }
}
