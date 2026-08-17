import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '../src/net/protocol';
import { RoomManager } from './RoomManager';

export interface GameServerApplication {
  httpServer: HttpServer;
  roomManager: RoomManager;
  listen(port: number, host: string): Promise<number>;
  close(): Promise<void>;
}

export function createGameServer(): GameServerApplication {
  let roomManager: RoomManager;
  const httpServer = createServer((request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(
        JSON.stringify({
          ok: true,
          game: 'i-am-a-ghost',
          phase: 'authoritative-room',
          ...roomManager.getDiagnostics(),
        }),
      );
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: false, error: 'not-found' }));
  });
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: { origin: true, credentials: false },
    serveClient: false,
  });
  roomManager = new RoomManager(io);

  return {
    httpServer,
    roomManager,
    listen: (port, host) =>
      new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          const address = httpServer.address();
          if (!address || typeof address === 'string') {
            reject(new Error('Game server did not expose a TCP address.'));
            return;
          }
          resolve(address.port);
        });
      }),
    close: () =>
      new Promise((resolve) => {
        roomManager.dispose();
        io.close(() => {
          if (!httpServer.listening) {
            resolve();
            return;
          }
          httpServer.close(() => resolve());
        });
      }),
  };
}
