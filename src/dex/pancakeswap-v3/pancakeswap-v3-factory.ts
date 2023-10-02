import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import FactoryABI from '../../abi/pancakeswap-v3/PancakeswapV3Factory.abi.json';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Address, Log, Logger } from '../../types';
import { LogDescription } from 'ethers/lib/utils';
import { FactoryState } from '../uniswap-v3/types';

export type OnPoolCreatedCallback = ({
  token0,
  token1,
  fee,
}: {
  token0: string;
  token1: string;
  fee: bigint;
}) => FactoryState;

/*
 * "Stateless" event subscriber in order to capture "PoolCreated" event on new pools created.
 * State is present, but it's a placeholder to actually make the events reach handlers (if there's no previous state - `processBlockLogs` is not called)
 */
export class PancakeswapV3Factory extends StatefulEventSubscriber<FactoryState> {
  handlers: {
    [event: string]: (event: any) => DeepReadonly<FactoryState> | null;
  } = {};

  logDecoder: (log: Log) => any;

  public readonly factoryIface = new Interface(FactoryABI);

  constructor(
    readonly dexHelper: IDexHelper,
    parentName: string,
    protected readonly factoryAddress: Address,
    logger: Logger,
    protected readonly onPoolCreated: OnPoolCreatedCallback,
    mapKey: string = '',
  ) {
    super(parentName, `${parentName} Factory`, dexHelper, logger, true, mapKey);

    this.addressesSubscribed = [factoryAddress];

    this.logDecoder = (log: Log) => this.factoryIface.parseLog(log);

    this.handlers['PoolCreated'] = this.handleNewPool.bind(this);
  }

  generateState(): FactoryState {
    return {
      token0: '',
      token1: '',
      fee: 0n,
    };
  }

  protected processLog(
    _: DeepReadonly<FactoryState>,
    log: Readonly<Log>,
  ): DeepReadonly<FactoryState> | null {
    const event = this.logDecoder(log);
    if (event.name in this.handlers) {
      return this.handlers[event.name](event);
    }

    return null;
  }

  handleNewPool(event: LogDescription) {
    const token0 = event.args.token0;
    const token1 = event.args.token1;
    const fee = event.args.fee;

    return this.onPoolCreated({ token0, token1, fee });
  }
}
