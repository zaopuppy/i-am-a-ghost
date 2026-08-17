import { createGameServer } from './createGameServer';

const host = process.env.I_AM_A_GHOST_SERVER_HOST ?? '0.0.0.0';
const parsedPort = Number.parseInt(process.env.I_AM_A_GHOST_SERVER_PORT ?? '5191', 10);
if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
  throw new RangeError('I_AM_A_GHOST_SERVER_PORT must be a valid TCP port.');
}

const application = createGameServer();
await application.listen(parsedPort, host);
console.log(`[rooms] authoritative service listening on http://${host}:${parsedPort}`);

const shutdown = (): void => {
  void application.close().then(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
