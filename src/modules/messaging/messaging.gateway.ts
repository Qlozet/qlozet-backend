import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import {
  ORDER_MESSAGE_CREATED,
  OrderMessageCreatedEvent,
} from './messaging.service';

// ─── Order-chat realtime gateway ──────────────────────────────
// Socket.IO push for the bespoke customer <-> tailor chat. On connect the
// client authenticates with its Bearer token (handshake.auth.token) and joins a
// per-user room; when a message is persisted, MessagingService emits
// ORDER_MESSAGE_CREATED and we push `order-message` to each participant's room.
// REST stays the source of truth (history + send); this is the live delivery.
@WebSocketGateway({ cors: { origin: '*' } })
export class MessagingGateway implements OnGatewayConnection {
  private readonly logger = new Logger(MessagingGateway.name);

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
      this.logger.debug(`Chat socket connected: user ${userId}`);
    } catch {
      client.disconnect();
    }
  }

  /**
   * Fired by MessagingService after a message is persisted. Push a compact
   * payload to each participant's user room; the sender's own client dedupes by
   * message id against its optimistic append.
   */
  @OnEvent(ORDER_MESSAGE_CREATED, { async: true })
  handleOrderMessageCreated({
    message,
    participantUserIds,
  }: OrderMessageCreatedEvent) {
    if (!this.server || !participantUserIds?.length) return;
    const payload = {
      _id: message._id,
      order_reference: message.order_reference,
      sender: message.sender,
      sender_role: message.sender_role,
      content: message.content,
      created_at: message.createdAt,
    };
    for (const uid of participantUserIds) {
      this.server.to(`user:${uid}`).emit('order-message', payload);
    }
  }
}
