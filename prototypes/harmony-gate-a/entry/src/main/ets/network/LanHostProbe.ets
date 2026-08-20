import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { mdns, socket } from '@kit.NetworkKit';

const SERVICE_TYPE = '_iamaghost._tcp';
const SERVICE_NAME = 'I Am A Ghost Gate A';

export interface LanHostStatus {
  listening: boolean;
  port: number | null;
  mdnsRegistered: boolean;
  connectedPeers: number;
  error: string | null;
}

class LanHostProbe {
  private server: socket.TCPSocketServer | null = null;
  private clients: Map<number, socket.TCPSocketConnection> = new Map();
  private registeredService: mdns.LocalServiceInfo | null = null;
  private startPromise: Promise<LanHostStatus> | null = null;
  private port: number | null = null;
  private lastError: string | null = null;

  status(): LanHostStatus {
    return {
      listening: this.server !== null && this.port !== null,
      port: this.port,
      mdnsRegistered: this.registeredService !== null,
      connectedPeers: this.clients.size,
      error: this.lastError,
    };
  }

  start(context: common.UIAbilityContext): Promise<LanHostStatus> {
    if (this.startPromise !== null) return this.startPromise;
    if (this.server !== null && this.port !== null) return Promise.resolve(this.status());
    this.startPromise = this.startInternal(context).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async stop(context: common.UIAbilityContext): Promise<void> {
    const service = this.registeredService;
    this.registeredService = null;
    if (service !== null) {
      try {
        await mdns.removeLocalService(context, service);
      } catch (error) {
        console.warn(`[HarmonyGateA] mDNS removal skipped: ${stringifyError(error)}`);
      }
    }

    const clients = Array.from(this.clients.values());
    this.clients.clear();
    await Promise.all(clients.map(async (client) => {
      try {
        await client.close();
      } catch (error) {
        console.warn(`[HarmonyGateA] peer close skipped: ${stringifyError(error)}`);
      }
    }));

    const server = this.server;
    this.server = null;
    this.port = null;
    if (server !== null) {
      try {
        await server.close();
      } catch (error) {
        console.warn(`[HarmonyGateA] TCP server close skipped: ${stringifyError(error)}`);
      }
    }
    console.info('[HarmonyGateA] LAN host stopped');
  }

  private async startInternal(context: common.UIAbilityContext): Promise<LanHostStatus> {
    this.lastError = null;
    const server = socket.constructTCPSocketServerInstance();
    this.server = server;
    server.on('connect', (client) => this.acceptClient(client));
    server.on('error', (error) => {
      this.lastError = stringifyError(error);
      console.error(`[HarmonyGateA] TCP server error: ${this.lastError}`);
    });

    try {
      await server.listen({ address: '0.0.0.0', family: 1, port: 0 });
      const address = await server.getLocalAddress();
      if (typeof address.port !== 'number' || address.port <= 0) {
        throw new Error('TCP server did not report an allocated port');
      }
      this.port = address.port;
      console.info(`[HarmonyGateA] TCP host listening on 0.0.0.0:${this.port}`);

      const serviceInfo: mdns.LocalServiceInfo = {
        serviceType: SERVICE_TYPE,
        serviceName: SERVICE_NAME,
        port: this.port,
        serviceAttribute: [
          { key: 'protocol', value: asciiBytes('gate-a-v1') },
          { key: 'build', value: asciiBytes('prototype') },
          { key: 'name', value: asciiBytes('I Am A Ghost') },
          { key: 'players', value: asciiBytes('0') },
        ],
      };
      try {
        this.registeredService = await mdns.addLocalService(context, serviceInfo);
        console.info(`[HarmonyGateA] mDNS registered ${SERVICE_TYPE} on port ${this.port}`);
      } catch (error) {
        this.lastError = `mDNS: ${stringifyError(error)}`;
        console.error(`[HarmonyGateA] ${this.lastError}`);
      }
      return this.status();
    } catch (error) {
      this.lastError = stringifyError(error);
      this.server = null;
      this.port = null;
      try {
        await server.close();
      } catch (_) {
        // The socket may not have reached the listening state.
      }
      console.error(`[HarmonyGateA] LAN host start failed: ${this.lastError}`);
      return this.status();
    }
  }

  private acceptClient(client: socket.TCPSocketConnection): void {
    this.clients.set(client.clientId, client);
    console.info(`[HarmonyGateA] TCP peer connected; peers=${this.clients.size}`);
    client.on('message', (messageInfo) => {
      const response = JSON.stringify({
        type: 'gate-a-echo',
        protocol: 'gate-a-v1',
        receivedBytes: messageInfo.message.byteLength,
      });
      void client.send({ data: `${response}\n`, encoding: 'UTF-8' }).catch((error: BusinessError) => {
        console.error(`[HarmonyGateA] TCP reply failed: ${stringifyError(error)}`);
      });
    });
    client.on('close', () => this.removeClient(client.clientId));
    client.on('error', (error) => {
      console.warn(`[HarmonyGateA] TCP peer error: ${stringifyError(error)}`);
      this.removeClient(client.clientId);
    });
    const greeting = JSON.stringify({ type: 'gate-a-ready', protocol: 'gate-a-v1' });
    void client.send({ data: `${greeting}\n`, encoding: 'UTF-8' }).catch((error: BusinessError) => {
      console.error(`[HarmonyGateA] TCP greeting failed: ${stringifyError(error)}`);
    });
  }

  private removeClient(clientId: number): void {
    this.clients.delete(clientId);
    console.info(`[HarmonyGateA] TCP peer disconnected; peers=${this.clients.size}`);
  }
}

function asciiBytes(value: string): Array<number> {
  const bytes: Array<number> = [];
  for (let index = 0; index < value.length; index += 1) {
    bytes.push(value.charCodeAt(index));
  }
  return bytes;
}

function stringifyError(error: Object): string {
  try {
    return JSON.stringify(error);
  } catch (_) {
    return String(error);
  }
}

export const lanHostProbe = new LanHostProbe();
