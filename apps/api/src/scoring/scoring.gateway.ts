import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import {
  WS_CLIENT_EVENTS,
  WS_SERVER_EVENTS,
  matchJoinSchema,
  potPayloadSchema,
  foulPayloadSchema,
  type ActionAck,
  type ScoringAction,
} from '@cece/contract';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import type { JwtPayload } from '../auth/jwt-payload';
import { MatchStateService } from './match-state.service';

/** Socket.IO room for a match. */
const roomFor = (matchId: string): string => `match:${matchId}`;

function extractToken(client: Socket): string {
  const fromAuth = client.handshake.auth?.token as unknown;
  if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;
  const header = client.handshake.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
  throw new Error('missing token');
}

function toAck(err: unknown): ActionAck {
  if (err instanceof ApiError) {
    return err.getResponse() as { error: { code: string; message: string } };
  }
  return { error: { code: 'internal_error', message: 'Internal server error' } };
}

const invalidPayload: ActionAck = {
  error: { code: 'validation_error', message: 'Invalid payload' },
};

/**
 * Real-time scoring channel (Phase 2). Authenticates the connection via JWT in
 * the handshake (middleware, before any event), lets participants join their
 * match room, and applies scoring actions: validate via the engine, append to
 * the log, then broadcast the full `match:state` to the room.
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class ScoringGateway implements OnGatewayInit {
  private readonly log = new Logger(ScoringGateway.name);

  @WebSocketServer() private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly matchState: MatchStateService,
  ) {}

  afterInit(server: Server): void {
    server.use((socket: Socket, next: (err?: Error) => void) => {
      void this.authenticate(socket)
        .then((userId) => {
          socket.data.userId = userId;
          next();
        })
        .catch(() => next(new Error('unauthorized')));
    });
  }

  private async authenticate(client: Socket): Promise<string> {
    const token = extractToken(client);
    const { sub } = await this.jwt.verifyAsync<JwtPayload>(token);
    const user = await this.prisma.user.findUnique({ where: { id: sub } });
    if (!user) throw new Error('user no longer exists');
    return user.id;
  }

  @SubscribeMessage(WS_CLIENT_EVENTS.join)
  async onJoin(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<ActionAck> {
    const parsed = matchJoinSchema.safeParse(body);
    if (!parsed.success) return invalidPayload;
    const userId = userIdOf(client);
    if (!userId) return { error: { code: 'unauthorized', message: 'Not authenticated' } };

    try {
      const state = await this.matchState.snapshot(parsed.data.matchId, userId);
      await client.join(roomFor(parsed.data.matchId));
      client.data.matchId = parsed.data.matchId;
      client.emit(WS_SERVER_EVENTS.state, state);
      return { ok: true, version: state.version };
    } catch (err) {
      this.log.debug(`join rejected for ${parsed.data.matchId}: ${String(err)}`);
      return toAck(err);
    }
  }

  @SubscribeMessage(WS_CLIENT_EVENTS.pot)
  onPot(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<ActionAck> {
    const parsed = potPayloadSchema.safeParse(body);
    if (!parsed.success) return Promise.resolve(invalidPayload);
    return this.applyAndBroadcast(client, { type: 'pot', ball: parsed.data.ball });
  }

  @SubscribeMessage(WS_CLIENT_EVENTS.foul)
  onFoul(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<ActionAck> {
    const parsed = foulPayloadSchema.safeParse(body);
    if (!parsed.success) return Promise.resolve(invalidPayload);
    return this.applyAndBroadcast(client, { type: 'foul', points: parsed.data.points });
  }

  @SubscribeMessage(WS_CLIENT_EVENTS.endVisit)
  onEndVisit(@ConnectedSocket() client: Socket): Promise<ActionAck> {
    return this.applyAndBroadcast(client, { type: 'endVisit' });
  }

  @SubscribeMessage(WS_CLIENT_EVENTS.undo)
  onUndo(@ConnectedSocket() client: Socket): Promise<ActionAck> {
    return this.applyAndBroadcast(client, { type: 'undo' });
  }

  private async applyAndBroadcast(client: Socket, action: ScoringAction): Promise<ActionAck> {
    const userId = userIdOf(client);
    const matchId = client.data.matchId as string | undefined;
    if (!userId) return { error: { code: 'unauthorized', message: 'Not authenticated' } };
    if (!matchId) return { error: { code: 'validation_error', message: 'Join a match first' } };

    try {
      const state = await this.matchState.apply(matchId, userId, action);
      this.server.to(roomFor(matchId)).emit(WS_SERVER_EVENTS.state, state);
      return { ok: true, version: state.version };
    } catch (err) {
      return toAck(err);
    }
  }
}

function userIdOf(client: Socket): string | undefined {
  return client.data.userId as string | undefined;
}
