import { createServer } from 'node:http';
import { Server } from 'socket.io';

const host = process.env.I_AM_A_GHOST_SERVER_HOST ?? '0.0.0.0';
const parsedPort = Number.parseInt(process.env.I_AM_A_GHOST_SERVER_PORT ?? '5191', 10);

if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
  throw new RangeError('I_AM_A_GHOST_SERVER_PORT must be a valid TCP port.');
}

const connectedClients = new Set<string>();
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
        phase: 'foundation',
        connectedClients: connectedClients.size,
      }),
    );
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ ok: false, error: 'not-found' }));
});

const io = new Server(httpServer, {
  cors: {
    origin: true,
    credentials: false,
  },
  serveClient: false,
});

io.on('connection', (socket) => {
  connectedClients.add(socket.id);
  socket.on('disconnect', () => connectedClients.delete(socket.id));
});

httpServer.listen(parsedPort, host, () => {
  console.log(`[rooms] foundation service listening on http://${host}:${parsedPort}`);
});

const shutdown = (): void => {
  io.close(() => {
    httpServer.close(() => process.exit(0));
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
