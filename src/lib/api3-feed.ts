import { DeepReadonly } from 'ts-essentials';
import { PartialEventSubscriber } from '../composed-event-subscriber';
import {
  Address,
  BlockHeader,
  Log,
  Logger,
  MultiCallInput,
  MultiCallOutput,
} from '../types';
import { Lens } from '../lens';
import { Interface } from '@ethersproject/abi';
import ProxyABI from '../abi/api3-proxy.json';
import Api3ServerV1ABI from '../abi/api3-server-v1.json';

export type Api3FeedSubscriberState = {
  value: bigint;
  timestamp: bigint;
};

export class Api3FeedSubscriber<State> extends PartialEventSubscriber<
  State,
  Api3FeedSubscriberState
> {
  static readonly proxyInterface = new Interface(ProxyABI);
  static readonly api3ServerV1Iface = new Interface(Api3ServerV1ABI);
  static readonly ANSWER_UPDATED_SIGNED_DATA =
    Api3FeedSubscriber.api3ServerV1Iface.getEventTopic(
      'UpdatedBeaconWithSignedData',
    );

  constructor(
    private proxy: Address,
    api3Server: Address,
    lens: Lens<DeepReadonly<State>, DeepReadonly<Api3FeedSubscriberState>>,
    logger: Logger,
  ) {
    super([api3Server], lens, logger);
  }

  static getApi3ServerV1MultiCallInput(proxy: Address): MultiCallInput {
    return {
      target: proxy,
      callData:
        Api3FeedSubscriber.proxyInterface.encodeFunctionData('api3ServerV1'),
    };
  }

  static decodeApi3ServerV1Result(multicallOutput: MultiCallOutput): Address {
    return Api3FeedSubscriber.proxyInterface.decodeFunctionResult(
      'api3ServerV1',
      multicallOutput,
    )[0];
  }

  public processLog(
    state: DeepReadonly<Api3FeedSubscriberState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<Api3FeedSubscriberState> | null {
    if (log.topics[0] !== Api3FeedSubscriber.ANSWER_UPDATED_SIGNED_DATA)
      return null; // Ignore other events
    const decoded = Api3FeedSubscriber.api3ServerV1Iface.decodeEventLog(
      'UpdatedBeaconWithSignedData',
      log.data,
      log.topics,
    );
    return {
      value: BigInt(decoded.value.toString()),
      timestamp: BigInt(decoded.timestamp.toString()),
    };
  }

  public getGenerateStateMultiCallInputs(): MultiCallInput[] {
    return [
      {
        target: this.proxy,
        callData: Api3FeedSubscriber.proxyInterface.encodeFunctionData('read'),
      },
    ];
  }

  public generateState(
    multicallOutputs: MultiCallOutput[],
    blockNumber?: number | 'latest',
  ): DeepReadonly<Api3FeedSubscriberState> {
    const decoded = Api3FeedSubscriber.proxyInterface.decodeFunctionResult(
      'read',
      multicallOutputs[0],
    );
    return {
      value: BigInt(decoded.value.toString()),
      timestamp: BigInt(decoded.timestamp.toString()),
    };
  }

  public getLatestData(state: DeepReadonly<State>): bigint {
    return this.lens.get()(state).value;
  }
}
