import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import {
  Tokens,
  Holders,
  NativeTokenSymbols,
} from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

function testForNetwork(
  network: Network,
  dexKey: string,
  tokenASymbol: string,
  tokenBSymbol: string,
  tokenAAmount: string,
  tokenBAmount: string,
  nativeTokenAmount: string,
  slippage?: number | undefined,
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network];
  const nativeTokenSymbol = NativeTokenSymbols[network];

  const sideToContractMethods = new Map([
    [
      SwapSide.SELL,
      [
        ContractMethod.simpleSwap,
        ContractMethod.multiSwap,
        ContractMethod.megaSwap,
      ],
    ],
    [SwapSide.BUY, [ContractMethod.simpleBuy, ContractMethod.buy]],
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            it(`${nativeTokenSymbol} -> ${tokenASymbol}`, async () => {
              await testE2E(
                tokens[nativeTokenSymbol],
                tokens[tokenASymbol],
                holders[nativeTokenSymbol],
                side === SwapSide.SELL ? nativeTokenAmount : tokenAAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
                undefined,
                undefined,
                undefined,
                slippage,
              );
            });
            it(`${tokenASymbol} -> ${nativeTokenSymbol}`, async () => {
              await testE2E(
                tokens[tokenASymbol],
                tokens[nativeTokenSymbol],
                holders[tokenASymbol],
                side === SwapSide.SELL ? tokenAAmount : nativeTokenAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
                undefined,
                undefined,
                undefined,
                slippage,
              );
            });
            it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
              await testE2E(
                tokens[tokenASymbol],
                tokens[tokenBSymbol],
                holders[tokenASymbol],
                side === SwapSide.SELL ? tokenAAmount : tokenBAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
                undefined,
                undefined,
                undefined,
                slippage,
              );
            });
          });
        });
      }),
    );
  });
}

describe('BaseswapV3 E2E', () => {
  const dexKey = 'BaseswapV3';
  describe('Base', () => {
    const network = Network.BASE;

    const tokenASymbol: string = 'USDC';
    const tokenBSymbol: string = 'USDbC';

    const tokenAAmount: string = '1000000';
    const tokenBAmount: string = '1000000';
    const nativeTokenAmount = '1000000000000000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      nativeTokenAmount,
    );
  });
});
