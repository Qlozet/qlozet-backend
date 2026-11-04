import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server, ServerOptions } from 'socket.io';
import { sharedRedis, sharedRedisSubscriber } from './shared-redis';

/**
 * Socket.IO across several servers.
 *
 * Fly runs more than one backend machine when traffic rises. Without this, a
 * live event (a chat message, a notification) only reaches people connected to
 * the machine that sent it, so a customer and a vendor on different machines
 * stop seeing each other's messages arrive. The Redis adapter relays every
 * event to all machines.
 *
 * Without REDIS_URL (local runs, tests) it falls back to plain Socket.IO.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger('RedisIoAdapter');

  constructor(app: INestApplicationContext) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, options);
    if (!process.env.REDIS_URL) return server;

    const pub = sharedRedis();
    const sub = sharedRedisSubscriber();
    sub.on('error', (err) =>
      this.logger.warn(`Redis subscriber error: ${err?.message ?? err}`),
    );
    server.adapter(createAdapter(pub, sub));
    this.logger.log('Socket.IO events are shared across machines via Redis');
    return server;
  }
}
