import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network } from '../../constants';

export const DexalotConfig: DexConfigMap<DexParams> = {
  Dexalot: {
    [Network.AVALANCHE]: {
      mainnetRFQAddress: '0xd62f9E53Be8884C21f5aa523B3c7D6F9a0050af5',
    },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.AVALANCHE]: {},
};
