export const createLimit = (concurrency: number) => {
  let active = 0;
  const waiting: (() => void)[] = [];

  const acquire = async () => {
    if (active < concurrency) {
      active += 1;

      return;
    }

    const { promise, resolve } = Promise.withResolvers<undefined>();

    waiting.push(() => {
      resolve(undefined);
    });
    await promise;
  };

  const release = () => {
    const handOver = waiting.shift();

    if (handOver === undefined) {
      active -= 1;
    } else {
      handOver();
    }
  };

  return async <T>(task: () => Promise<T>): Promise<T> => {
    await acquire();

    try {
      return await task();
    } finally {
      release();
    }
  };
};

export const issueRequests = createLimit(4);
