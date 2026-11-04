import IORedis from 'ioredis';

/**
 * One Redis connection for every BullMQ queue in the app.
 *
 * The Redis plan caps connections, and each queue used to open its own. With a
 * shared connection the queues reuse this one; each worker still adds its own
 * blocking connection (BullMQ needs one per worker to wait for jobs). That
 * takes a running backend from about six connections to three.
 *
 * maxRetriesPerRequest must be null for a connection BullMQ workers use.
 */
let shared: IORedis | undefined;
let subscriber: IORedis | undefined;

export function sharedRedis(): IORedis {
  if (!shared) {
    shared = new IORedis(process.env.REDIS_URL as string, {
      maxRetriesPerRequest: null,
      connectTimeout: 30000,
    });
  }
  return shared;
}

/**
 * A second connection for listening. A connection that subscribes to Redis
 * messages can do nothing else, so the live-message relay between servers
 * (see redis-io.adapter.ts) gets its own: one extra connection per machine.
 */
export function sharedRedisSubscriber(): IORedis {
  if (!subscriber) {
    subscriber = sharedRedis().duplicate();
  }
  return subscriber;
}

/** Closed on shutdown, so a stopped machine gives its slot back at once. */
export async function closeSharedRedis(): Promise<void> {
  if (subscriber) {
    const sub = subscriber;
    subscriber = undefined;
    try {
      await sub.quit();
    } catch {
      sub.disconnect();
    }
  }
  if (!shared) return;
  const conn = shared;
  shared = undefined;
  try {
    await conn.quit();
  } catch {
    conn.disconnect();
  }
}
