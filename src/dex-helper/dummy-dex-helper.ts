import {
  IDexHelper,
  ICache,
  IBlockManager,
  EventSubscriber,
  IRequestWrapper,
} from './index';
import axios from 'axios';
import { Address, LoggerConstructor } from '../types';
import { MULTI_V2, ProviderURL, AugustusAddress } from '../constants';
import { Contract } from '@ethersproject/contracts';
import { JsonRpcProvider } from '@ethersproject/providers';
import multiABIV2 from '../abi/multi-v2.json';
import log4js from 'log4js';

// This is a dummy cache for testing purposes
class DummyCache implements ICache {
  async get(key: string): Promise<string | null> {
    // console.log('Cache Requested: ', key);
    return null;
  }

  async setex(key: string, seconds: number, value: string): Promise<void> {
    // console.log('Cache Stored: ', key, seconds, value);
    return;
  }
}

class DummyRequestWrapper implements IRequestWrapper {
  async get(
    url: string,
    timeout?: number,
    headers?: { [key: string]: string | number },
  ) {
    const axiosResult = await axios({
      method: 'get',
      url,
      timeout,
      headers: {
        'User-Agent': 'node.js',
        ...headers,
      },
    });
    return axiosResult.data;
  }

  async post(
    url: string,
    data: any,
    timeout?: number,
    headers?: { [key: string]: string | number },
  ) {
    const axiosResult = await axios({
      method: 'post',
      url,
      data,
      timeout,
      headers: {
        'User-Agent': 'node.js',
        ...headers,
      },
    });
    return axiosResult.data;
  }
}

class DummyBlockManager implements IBlockManager {
  subscribeToLogs(
    subscriber: EventSubscriber,
    contractAddress: Address | Address[],
    afterBlockNumber: number,
  ): void {
    console.log(
      `Subscribed to logs ${subscriber.name} ${contractAddress} ${afterBlockNumber}`,
    );
  }
}

export class DummyDexHelper implements IDexHelper {
  cache: ICache;
  httpRequest: IRequestWrapper;
  augustusAddress: Address;
  provider: JsonRpcProvider;
  multiContract: Contract;
  blockManager: IBlockManager;
  getLogger: LoggerConstructor;

  constructor(network: number) {
    this.cache = new DummyCache();
    this.httpRequest = new DummyRequestWrapper();
    this.augustusAddress = AugustusAddress[network];
    this.provider = new JsonRpcProvider(ProviderURL[network]);
    this.multiContract = new Contract(
      MULTI_V2[network],
      multiABIV2,
      this.provider,
    );
    this.blockManager = new DummyBlockManager();
    this.getLogger = name => log4js.getLogger(name);
  }
}
