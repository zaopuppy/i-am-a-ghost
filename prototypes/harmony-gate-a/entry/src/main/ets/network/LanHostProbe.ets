import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { mdns, socket } from '@kit.NetworkKit';

const SERVICE_TYPE = '_iamaghost._tcp';
const SERVICE_NAME_PREFIX = 'I Am A Ghost Gate A';

export interface LanHostStatus {
  listening: boolean;
  port: number | null;
  mdnsRegistered: boolean;
  discoveryActive: boolean;
  nearbyRoomCount: number;
  connectedPeers: number;
  error: string | null;
}

export interface NearbyRoomStatus {
  serviceName: string;
  host: string | null;
  port: number | null;
  protocol: string | null;
  build: string | null;
  players: number | null;
  state: string;
  receivedBytes: number;
  error: string | null;
}

class LanHostProbe {
  private server: socket.TCPSocketServer | null = null;
  private clients: Map<number, socket.TCPSocketConnection> = new Map();
  private probeClients: Map<string, socket.TCPSocket> = new Map();
  private registeredService: mdns.LocalServiceInfo | null = null;
  private discovery: mdns.DiscoveryService | null = null;
  private discoveredRooms: Map<string, NearbyRoomStatus> = new Map();
  private resolvingRooms: Set<string> = new Set();
  private startPromise: Promise<LanHostStatus> | null = null;
  private port: number | null = null;
  private discoveryActive: boolean = false;
  private lastError: string | null = null;
  private readonly serviceName: string = `${SERVICE_NAME_PREFIX} ${randomSuffix()}`;

  status(): LanHostStatus {
    return {
      listening: this.server !== null && this.port !== null,
      port: this.port,
      mdnsRegistered: this.registeredService !== null,
      discoveryActive: this.discoveryActive,
      nearbyRoomCount: this.discoveredRooms.size,
      connectedPeers: this.clients.size,
      error: this.lastError,
    };
  }

  nearbyRooms(): Array<NearbyRoomStatus> {
    const snapshots: Array<NearbyRoomStatus> = [];
    for (const room of this.discoveredRooms.values()) {
      const snapshot: NearbyRoomStatus = {
        serviceName: room.serviceName,
        host: room.host,
        port: room.port,
        protocol: room.protocol,
        build: room.build,
        players: room.players,
        state: room.state,
        receivedBytes: room.receivedBytes,
        error: room.error,
      };
      snapshots.push(snapshot);
    }
    return snapshots;
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
    this.stopDiscovery();

    const service = this.registeredService;
    this.registeredService = null;
    if (service !== null) {
      try {
        await mdns.removeLocalService(context, service);
      } catch (error) {
        console.warn(`[HarmonyGateA] mDNS removal skipped: ${stringifyError(error)}`);
      }
    }

    const probes = Array.from(this.probeClients.values());
    this.probeClients.clear();
    await Promise.all(probes.map(async (client) => {
      try {
        await client.close();
      } catch (error) {
        console.warn(`[HarmonyGateA] probe close skipped: ${stringifyError(error)}`);
      }
    }));

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
        serviceName: this.serviceName,
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
      this.startDiscovery(context);
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

  private startDiscovery(context: common.UIAbilityContext): void {
    try {
      const discovery = mdns.createDiscoveryService(context, SERVICE_TYPE);
      this.discovery = discovery;
      discovery.on('discoveryStart', (event) => {
        this.discoveryActive = event.errorCode === undefined;
        console.info(`[HarmonyGateA] mDNS discovery started; active=${this.discoveryActive}`);
      });
      discovery.on('discoveryStop', () => {
        this.discoveryActive = false;
        console.info('[HarmonyGateA] mDNS discovery stopped');
      });
      discovery.on('serviceFound', (serviceInfo) => this.handleServiceFound(context, serviceInfo));
      discovery.on('serviceLost', (serviceInfo) => this.handleServiceLost(serviceInfo));
      discovery.startSearchingMDNS();
      this.discoveryActive = true;
    } catch (error) {
      this.discovery = null;
      this.discoveryActive = false;
      this.lastError = `mDNS discovery: ${stringifyError(error)}`;
      console.error(`[HarmonyGateA] ${this.lastError}`);
    }
  }

  private stopDiscovery(): void {
    const discovery = this.discovery;
    this.discovery = null;
    this.discoveryActive = false;
    this.resolvingRooms.clear();
    this.discoveredRooms.clear();
    if (discovery === null) return;
    try {
      discovery.stopSearchingMDNS();
      discovery.off('discoveryStart');
      discovery.off('discoveryStop');
      discovery.off('serviceFound');
      discovery.off('serviceLost');
    } catch (error) {
      console.warn(`[HarmonyGateA] discovery cleanup skipped: ${stringifyError(error)}`);
    }
  }

  private handleServiceFound(context: common.UIAbilityContext, serviceInfo: mdns.LocalServiceInfo): void {
    if (serviceInfo.serviceName === this.registeredService?.serviceName) return;
    const key = serviceKey(serviceInfo);
    if (!this.discoveredRooms.has(key)) {
      this.discoveredRooms.set(key, {
        serviceName: serviceInfo.serviceName,
        host: null,
        port: null,
        protocol: null,
        build: null,
        players: null,
        state: 'found',
        receivedBytes: 0,
        error: null,
      });
      console.info(`[HarmonyGateA] nearby service found: ${serviceInfo.serviceName}`);
    }
    if (this.resolvingRooms.has(key)) return;
    this.resolvingRooms.add(key);
    void this.resolveRoom(context, key, serviceInfo);
  }

  private handleServiceLost(serviceInfo: mdns.LocalServiceInfo): void {
    const key = serviceKey(serviceInfo);
    this.discoveredRooms.delete(key);
    this.resolvingRooms.delete(key);
    const probe = this.probeClients.get(key);
    this.probeClients.delete(key);
    if (probe !== undefined) {
      try {
        void probe.close().catch((error: BusinessError) => {
          console.warn(`[HarmonyGateA] lost-service probe close skipped: ${stringifyError(error)}`);
        });
      } catch (error) {
        console.warn(`[HarmonyGateA] lost-service probe close skipped: ${stringifyError(error)}`);
      }
    }
    console.info(`[HarmonyGateA] nearby service lost: ${serviceInfo.serviceName}`);
  }

  private async resolveRoom(
    context: common.UIAbilityContext,
    key: string,
    serviceInfo: mdns.LocalServiceInfo,
  ): Promise<void> {
    try {
      const resolved = await mdns.resolveLocalService(context, serviceInfo);
      const room = this.discoveredRooms.get(key);
      if (room === undefined) return;
      room.host = resolved.host?.address ?? null;
      room.port = resolved.port ?? null;
      room.protocol = attributeText(resolved.serviceAttribute, 'protocol');
      room.build = attributeText(resolved.serviceAttribute, 'build');
      room.players = parsePlayerCount(attributeText(resolved.serviceAttribute, 'players'));
      room.state = 'resolved';
      room.error = null;
      console.info(`[HarmonyGateA] nearby service resolved: ${room.serviceName} ${room.host}:${room.port}`);
      if (room.host !== null && room.port !== null) {
        void this.probeRoom(key, room);
      }
    } catch (error) {
      const room = this.discoveredRooms.get(key);
      if (room !== undefined) {
        room.state = 'resolve-failed';
        room.error = stringifyError(error);
      }
      console.warn(`[HarmonyGateA] nearby service resolve failed: ${stringifyError(error)}`);
    } finally {
      this.resolvingRooms.delete(key);
    }
  }

  private async probeRoom(key: string, room: NearbyRoomStatus): Promise<void> {
    if (room.host === null || room.port === null || this.probeClients.has(key)) return;
    const client = socket.constructTCPSocketInstance();
    this.probeClients.set(key, client);
    room.state = 'probing';
    client.on('message', (messageInfo) => {
      const current = this.discoveredRooms.get(key);
      if (current === undefined) return;
      current.state = 'reachable';
      current.receivedBytes += messageInfo.message.byteLength;
      current.error = null;
    });
    client.on('error', (error) => {
      const current = this.discoveredRooms.get(key);
      if (current !== undefined && current.state !== 'reachable') {
        current.state = 'unreachable';
        current.error = stringifyError(error);
      }
    });
    try {
      await client.connect({
        address: {
          address: room.host,
          family: room.host.includes(':') ? 2 : 1,
          port: room.port,
        },
        timeout: 3_000,
      });
      await client.send({ data: 'gate-a-two-device-probe\n', encoding: 'UTF-8' });
      await delay(1_000);
      if (room.state !== 'reachable') {
        room.state = 'unreachable';
        room.error = 'TCP connected but no probe response arrived';
      }
    } catch (error) {
      room.state = 'unreachable';
      room.error = stringifyError(error);
    } finally {
      this.probeClients.delete(key);
      try {
        await client.close();
      } catch (_) {
        // The peer may already have closed the probe connection.
      }
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

function serviceKey(serviceInfo: mdns.LocalServiceInfo): string {
  return `${serviceInfo.serviceType}|${serviceInfo.serviceName}`;
}

function asciiBytes(value: string): Array<number> {
  const bytes: Array<number> = [];
  for (let index = 0; index < value.length; index += 1) {
    bytes.push(value.charCodeAt(index));
  }
  return bytes;
}

function attributeText(attributes: Array<mdns.ServiceAttribute> | undefined, key: string): string | null {
  const attribute = attributes?.find((candidate) => candidate.key === key);
  if (attribute === undefined) return null;
  let value = '';
  for (const byte of attribute.value) value += String.fromCharCode(byte);
  return value;
}

function parsePlayerCount(value: string | null): number | null {
  if (value === null) return null;
  const count = Number.parseInt(value, 10);
  return Number.isInteger(count) ? count : null;
}

function randomSuffix(): string {
  return String(Math.floor(1_000 + Math.random() * 9_000));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stringifyError(error: Object): string {
  try {
    return JSON.stringify(error);
  } catch (_) {
    return String(error);
  }
}

export const lanHostProbe = new LanHostProbe();
