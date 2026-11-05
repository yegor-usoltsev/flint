export const perMinute = (limit: () => number) => {
  const buckets = new Map<string, { at: number; tokens: number }>();

  return (key: string) => {
    const now = Date.now();
    const capacity = limit();

    for (const [stale, bucket] of buckets) {
      if (now - bucket.at < 60_000) {
        break;
      }

      buckets.delete(stale);
    }

    const bucket = buckets.get(key);

    const tokens = Math.min(
      capacity,
      bucket === undefined
        ? capacity
        : bucket.tokens + ((now - bucket.at) / 60_000) * capacity
    );

    buckets.delete(key);

    if (tokens < 1) {
      buckets.set(key, { at: now, tokens });

      return false;
    }

    buckets.set(key, { at: now, tokens: tokens - 1 });

    return true;
  };
};

export const perKey = (limit: () => number) => {
  const active = new Map<string, number>();

  const acquire = (key: string) => {
    const count = active.get(key) ?? 0;

    if (count >= limit()) {
      return false;
    }

    active.set(key, count + 1);

    return true;
  };

  const release = (key: string) => {
    const left = (active.get(key) ?? 1) - 1;

    if (left <= 0) {
      active.delete(key);
    } else {
      active.set(key, left);
    }
  };

  return { acquire, release };
};

export const roundRobin = () => {
  const queues = new Map<string, (() => Promise<void>)[]>();
  const served = new Map<string, number>();
  let turn = 0;
  let running = false;

  const nextKey = () => {
    let pick: string | undefined;

    for (const key of queues.keys()) {
      if (
        pick === undefined ||
        (served.get(key) ?? -1) < (served.get(pick) ?? -1)
      ) {
        pick = key;
      }
    }

    return pick;
  };

  const drain = async () => {
    running = true;

    let key = nextKey();

    while (key !== undefined) {
      const queue = queues.get(key) ?? [];
      const task = queue.shift();

      if (queue.length === 0) {
        queues.delete(key);
      }

      turn += 1;
      served.set(key, turn);
      // oxlint-disable-next-line no-await-in-loop -- Tasks run one at a time, and the user served longest ago goes next.
      await task?.();
      key = nextKey();
    }

    served.clear();
    running = false;
  };

  return async <T>(key: string, task: () => Promise<T>) => {
    const { promise, reject, resolve } = Promise.withResolvers<T>();
    const queue = queues.get(key) ?? [];

    queue.push(async () => {
      try {
        resolve(await task());
      } catch (error) {
        reject(error);
      }
    });
    queues.set(key, queue);

    if (!running) {
      void drain();
    }

    return await promise;
  };
};
