import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  readonly requestId: string;
  /** Present once the request has been authenticated. */
  tenantId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(context: RequestContext, work: () => T): T {
    return storage.run(context, work);
  },
  current(): RequestContext | undefined {
    return storage.getStore();
  },
};
