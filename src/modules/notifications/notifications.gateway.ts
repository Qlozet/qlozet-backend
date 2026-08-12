import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { NotificationDocument } from './schemas/notification.schema';

// ─── Notifications realtime gateway ───────────────────────────
// Socket.IO used as a lightweight "you have a new notification" ping — the REST
// endpoints stay the source of truth. On connect, the client authenticates with
// its Bearer token (handshake.auth.token) and joins a per-user room; when a
// notification is created, we emit `notification` to that user's room and the
// client refetches its list + unread count.
@WebSocketGateway({ cors: { origin: '*' } })
export class NotificationsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  private server: Server;

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const raw =
        client.handshake.auth?.token ||
        (client.handshake.query?.token as string) ||
        (client.handshake.headers?.authorization as string);
      const token = raw?.replace(/^Bearer\s+/i, '');
      if (!token) return client.disconnect();

      const payload: any = await this.jwtService.verifyAsync(token, {
        secret: process.env.ACCESS_SECRET,
      });
      const userId = payload?.id?.toString();
      if (!userId) return client.disconnect();

      client.data.userId = userId;
      client.join(`user:${userId}`);
      this.logger.debug(`Notifications socket connected: user ${userId}`);
    } catch {
      client.disconnect();
    }
  }

  /**
   * Fired by NotificationsService after a notification is persisted. Push a
   * compact payload to the recipient's room; the client refetches for the full,
   * authoritative list.
   */
  @OnEvent('notification.created', { async: true })
  handleNotificationCreated(notification: NotificationDocument) {
    const recipient = (notification as any)?.recipient?.toString();
    if (!recipient || !this.server) return;
    this.server.to(`user:${recipient}`).emit('notification', {
      _id: notification._id,
      category: notification.category,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      action_url: notification.action_url,
      created_at: (notification as any).createdAt,
    });
  }
}
