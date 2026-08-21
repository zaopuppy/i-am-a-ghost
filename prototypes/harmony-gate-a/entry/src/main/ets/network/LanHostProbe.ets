import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';
import { connection, mdns, socket } from '@kit.NetworkKit';

const SERVICE_TYPE = '_iamaghost._tcp';
const SERVICE_NAME_PREFIX = 'I Am A Ghost Gate A';
const GAME_PROTOCOL = 'gate-a-game-v1';
const MAX_FRAME_CHARACTERS = 65_536;
const MAX_INBOX_MESSAGES = 512;
const ROOM_PROBE_INTERVAL_MS = 1_500;

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
  roomCode: string | null;
  instanceId: string | null;
  joinable: boolean;
  state: string;
  receivedBytes: number;
  error: string | null;
  lastProbeAt: number;
}

export interface PrototypeRoomStatus {
  ok: boolean;
  roomCode: string | null;
  instanceId: string | null;
  host: string | null;
  port: number | null;
  payload: string | null;
  error: string | null;
}

export interface PrototypeJoinStatus {
  accepted: boolean;
  serviceName: string | null;
  error: string | null;
}

export interface GameConnectionStatus {
  state: string;
  host: string | null;
  port: number | null;
  roomCode: string | null;
  instanceId: string | null;
  error: string | null;
}

export interface GameInboxMessage {
  peerId: string;
  payload: string;
}

interface RoomInfoMessage {
  type?: string;
  protocol?: string;
  roomCode?: string | null;
  instanceId?: string | null;
  players?: number;
  joinable?: boolean;
}

interface SplitLinesResult {
  lines: Array<string>;
  remainder: string;
}

class LanHostProbe {
  private server: socket.TCPSocketServer | null = null;
  private clients: Map<number, socket.TCPSocketConnection> = new Map();
  private clientBuffers: Map<number, string> = new Map();
  private clientDecoders: Map<number, util.TextDecoder> = new Map();
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
  private hostedRoom: PrototypeRoomStatus | null = null;
  private hostedPlayers: number = 0;
  private gameClient: socket.TCPSocket | null = null;
  private gameClientBuffer: string = '';
  private gameClientDecoder: util.TextDecoder = util.TextDecoder.create('utf-8');
  private gameConnection: GameConnectionStatus = disconnectedGameStatus();
  private gameInbox: Array<GameInboxMessage> = [];

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
        roomCode: room.roomCode,
        instanceId: room.instanceId,
        joinable: room.joinable,
        state: room.state,
        receivedBytes: room.receivedBytes,
        error: room.error,
        lastProbeAt: room.lastProbeAt,
      };
      snapshots.push(snapshot);
      if (Date.now() - room.lastProbeAt >= ROOM_PROBE_INTERVAL_MS) {
        void this.probeRoom(serviceKeyFromStatus(room), room);
      }
    }
    return snapshots;
  }

  createPrototypeRoom(): PrototypeRoomStatus {
    if (this.server === null || this.port === null) {
      return failedPrototypeRoom('TCP listener is not ready');
    }
    try {
      const netHandle = connection.getDefaultNetSync();
      if (netHandle.netId === 0) return failedPrototypeRoom('No active network');
      const properties = connection.getConnectionPropertiesSync(netHandle);
      const address = properties.linkAddresses.find((linkAddress) => {
        const candidate = linkAddress.address;
        return candidate.family === 1 && isUsableIpv4(candidate.address);
      })?.address.address;
      if (address === undefined) return failedPrototypeRoom('No usable IPv4 address on the active network');

      const roomCode = randomRoomCode();
      const instanceId = `gate-a-${Date.now()}-${randomSuffix()}`;
      const payload = 'iamaghost://gate-a/join' +
        `?v=1&instance=${instanceId}&room=${roomCode}&host=${address}&port=${this.port}`;
      const room: PrototypeRoomStatus = {
        ok: true,
        roomCode,
        instanceId,
        host: address,
        port: this.port,
        payload,
        error: null,
      };
      this.hostedRoom = room;
      this.hostedPlayers = 1;
      return room;
    } catch (error) {
      return failedPrototypeRoom(`Network address: ${stringifyError(error)}`);
    }
  }

  gameConnectionStatus(): GameConnectionStatus {
    return {
      state: this.gameConnection.state,
      host: this.gameConnection.host,
      port: this.gameConnection.port,
      roomCode: this.gameConnection.roomCode,
      instanceId: this.gameConnection.instanceId,
      error: this.gameConnection.error,
    };
  }

  connectGameRoom(host: string, port: number, roomCode: string, instanceId: string): PrototypeJoinStatus {
    if (!isUsableIpv4(host) || !Number.isInteger(port) || port < 1 || port > 65_535) {
      return { accepted: false, serviceName: null, error: 'Invalid game endpoint' };
    }
    const normalizedRoomCode = roomCode.replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (normalizedRoomCode.length !== 6 || instanceId.length < 1 || instanceId.length > 80) {
      return { accepted: false, serviceName: null, error: 'Invalid game room identity' };
    }
    this.closeGameClient();
    this.gameConnection = {
      state: 'connecting',
      host,
      port,
      roomCode: normalizedRoomCode,
      instanceId,
      error: null,
    };
    void this.connectGameRoomInternal(host, port);
    return { accepted: true, serviceName: `Game ${normalizedRoomCode}`, error: null };
  }

  sendGameMessage(payload: string): boolean {
    const client = this.gameClient;
    if (client === null || this.gameConnection.state !== 'connected' || !validPayload(payload)) return false;
    void client.send({ data: `${payload}\n`, encoding: 'UTF-8' }).catch((error: BusinessError) => {
      this.gameConnection.state = 'error';
      this.gameConnection.error = stringifyError(error);
    });
    return true;
  }

  sendGamePeer(peerId: string, payload: string): boolean {
    if (!validPayload(payload)) return false;
    const clientId = parsePeerId(peerId);
    const client = clientId === null ? undefined : this.clients.get(clientId);
    if (client === undefined) return false;
    void client.send({ data: `${payload}\n`, encoding: 'UTF-8' }).catch((error: BusinessError) => {
      console.warn(`[HarmonyGateA] game peer send failed: ${stringifyError(error)}`);
      this.removeClient(clientId as number);
    });
    return true;
  }

  drainGameMessages(): Array<GameInboxMessage> {
    const messages = this.gameInbox;
    this.gameInbox = [];
    return messages;
  }

  setHostedRoomPlayers(players: number): boolean {
    if (!Number.isInteger(players) || players < 0 || players > 5 || this.hostedRoom === null) return false;
    this.hostedPlayers = players;
    return true;
  }

  closeHostedRoom(): void {
    this.hostedRoom = null;
    this.hostedPlayers = 0;
  }

  joinPrototypeRoom(host: string, port: number, roomCode: string, instanceId: string): PrototypeJoinStatus {
    if (!isUsableIpv4(host) || !Number.isInteger(port) || port < 1 || port > 65_535) {
      return { accepted: false, serviceName: null, error: 'Invalid QR endpoint' };
    }
    const normalizedRoomCode = roomCode.replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (normalizedRoomCode.length !== 6 || instanceId.length < 1 || instanceId.length > 80) {
      return { accepted: false, serviceName: null, error: 'Invalid QR room identity' };
    }
    const key = `qr|${instanceId}|${host}|${port}`;
    const serviceName = `QR ${normalizedRoomCode}`;
    const room: NearbyRoomStatus = {
      serviceName,
      host,
      port,
      protocol: 'gate-a-v1',
      build: 'prototype',
      players: null,
      roomCode: normalizedRoomCode,
      instanceId,
      joinable: true,
      state: 'resolved',
      receivedBytes: 0,
      error: null,
      lastProbeAt: 0,
    };
    this.discoveredRooms.set(key, room);
    void this.probeRoom(key, room);
    return { accepted: true, serviceName, error: null };
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
    this.clientBuffers.clear();
    this.clientDecoders.clear();
    await Promise.all(clients.map(async (client) => {
      try {
        await client.close();
      } catch (error) {
        console.warn(`[HarmonyGateA] peer close skipped: ${stringifyError(error)}`);
      }
    }));

    this.closeGameClient();
    this.hostedRoom = null;
    this.hostedPlayers = 0;
    this.gameInbox = [];

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
          roomCode: null,
          instanceId: null,
          joinable: false,
          state: 'found',
        receivedBytes: 0,
          error: null,
          lastProbeAt: 0,
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
    room.lastProbeAt = Date.now();
    room.state = 'probing';
    let responseBuffer = '';
    const responseDecoder = util.TextDecoder.create('utf-8');
    client.on('message', (messageInfo) => {
      const current = this.discoveredRooms.get(key);
      if (current === undefined) return;
      current.state = 'reachable';
      current.receivedBytes += messageInfo.message.byteLength;
      current.error = null;
      responseBuffer += responseDecoder.decodeToString(new Uint8Array(messageInfo.message), { stream: true });
      const split = splitCompleteLines(responseBuffer);
      responseBuffer = split.remainder;
      for (const line of split.lines) this.acceptRoomInfo(current, line);
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
      await client.send({
        data: `${JSON.stringify({ type: 'gate-a-room-info-request', protocol: GAME_PROTOCOL })}\n`,
        encoding: 'UTF-8',
      });
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
    this.clientBuffers.set(client.clientId, '');
    this.clientDecoders.set(client.clientId, util.TextDecoder.create('utf-8'));
    console.info(`[HarmonyGateA] TCP peer connected; peers=${this.clients.size}`);
    client.on('message', (messageInfo) => {
      const decoder = this.clientDecoders.get(client.clientId);
      if (decoder !== undefined) {
        this.acceptClientChunk(client, decoder.decodeToString(new Uint8Array(messageInfo.message), { stream: true }));
      }
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
    if (!this.clients.has(clientId)) return;
    this.clients.delete(clientId);
    this.clientBuffers.delete(clientId);
    this.clientDecoders.delete(clientId);
    this.pushGameInbox({
      peerId: formatPeerId(clientId),
      payload: JSON.stringify({ type: 'peer-disconnected' }),
    });
    console.info(`[HarmonyGateA] TCP peer disconnected; peers=${this.clients.size}`);
  }

  private acceptClientChunk(client: socket.TCPSocketConnection, chunk: string): void {
    const combined = `${this.clientBuffers.get(client.clientId) ?? ''}${chunk}`;
    if (combined.length > MAX_FRAME_CHARACTERS * 2) {
      this.closeAcceptedClient(client);
      return;
    }
    const split = splitCompleteLines(combined);
    this.clientBuffers.set(client.clientId, split.remainder);
    for (const line of split.lines) this.acceptClientLine(client, line);
  }

  private acceptClientLine(client: socket.TCPSocketConnection, line: string): void {
    if (!validPayload(line)) {
      this.closeAcceptedClient(client);
      return;
    }
    if (line === 'gate-a-two-device-probe') {
      const response = JSON.stringify({ type: 'gate-a-echo', protocol: 'gate-a-v1', receivedBytes: line.length + 1 });
      this.sendAcceptedClient(client, response);
      return;
    }
    try {
      const message = JSON.parse(line) as RoomInfoMessage;
      if (message.type === 'gate-a-room-info-request') {
        this.sendAcceptedClient(client, this.roomInfoPayload());
        return;
      }
    } catch (_) {
      this.closeAcceptedClient(client);
      return;
    }
    this.pushGameInbox({ peerId: formatPeerId(client.clientId), payload: line });
  }

  private sendAcceptedClient(client: socket.TCPSocketConnection, payload: string): void {
    try {
      void client.send({ data: `${payload}\n`, encoding: 'UTF-8' }).catch((error: BusinessError) => {
        console.warn(`[HarmonyGateA] TCP peer send failed: ${stringifyError(error)}`);
        this.removeClient(client.clientId);
      });
    } catch (error) {
      console.warn(`[HarmonyGateA] TCP peer send failed: ${stringifyError(error)}`);
      this.removeClient(client.clientId);
    }
  }

  private closeAcceptedClient(client: socket.TCPSocketConnection): void {
    try {
      void client.close().catch((error: BusinessError) => {
        console.warn(`[HarmonyGateA] TCP peer close skipped: ${stringifyError(error)}`);
      });
    } catch (error) {
      console.warn(`[HarmonyGateA] TCP peer close skipped: ${stringifyError(error)}`);
    }
  }

  private roomInfoPayload(): string {
    const room = this.hostedRoom;
    return JSON.stringify({
      type: 'gate-a-room-info',
      protocol: GAME_PROTOCOL,
      roomCode: room?.roomCode ?? null,
      instanceId: room?.instanceId ?? null,
      players: room === null ? 0 : this.hostedPlayers,
      joinable: room !== null && this.hostedPlayers < 5,
    });
  }

  private acceptRoomInfo(room: NearbyRoomStatus, line: string): void {
    try {
      const message = JSON.parse(line) as RoomInfoMessage;
      if (message.type !== 'gate-a-room-info' || message.protocol !== GAME_PROTOCOL) return;
      room.roomCode = typeof message.roomCode === 'string' ? message.roomCode : null;
      room.instanceId = typeof message.instanceId === 'string' ? message.instanceId : null;
      room.players = typeof message.players === 'number' ? message.players : null;
      room.joinable = message.joinable === true && room.roomCode !== null && room.instanceId !== null;
    } catch (_) {
      // Greeting and legacy echo lines are intentionally ignored.
    }
  }

  private async connectGameRoomInternal(host: string, port: number): Promise<void> {
    const client = socket.constructTCPSocketInstance();
    this.gameClient = client;
    this.gameClientBuffer = '';
    this.gameClientDecoder = util.TextDecoder.create('utf-8');
    client.on('message', (messageInfo) => {
      this.acceptGameClientChunk(
        this.gameClientDecoder.decodeToString(new Uint8Array(messageInfo.message), { stream: true }),
      );
    });
    client.on('close', () => {
      if (this.gameClient !== client) return;
      this.gameClient = null;
      this.gameConnection.state = 'disconnected';
      this.pushGameInbox({ peerId: 'host', payload: JSON.stringify({ type: 'host-closed' }) });
    });
    client.on('error', (error) => {
      if (this.gameClient !== client) return;
      this.gameConnection.state = 'error';
      this.gameConnection.error = stringifyError(error);
    });
    try {
      await client.connect({
        address: { address: host, family: host.includes(':') ? 2 : 1, port },
        timeout: 3_000,
      });
      if (this.gameClient !== client) {
        await client.close();
        return;
      }
      this.gameConnection.state = 'connected';
    } catch (error) {
      if (this.gameClient === client) {
        this.gameClient = null;
        this.gameConnection.state = 'error';
        this.gameConnection.error = stringifyError(error);
      }
      try {
        await client.close();
      } catch (_) {
        // The socket may not have reached the connected state.
      }
    }
  }

  private acceptGameClientChunk(chunk: string): void {
    this.gameClientBuffer += chunk;
    if (this.gameClientBuffer.length > MAX_FRAME_CHARACTERS * 2) {
      this.closeGameClient();
      return;
    }
    const split = splitCompleteLines(this.gameClientBuffer);
    this.gameClientBuffer = split.remainder;
    for (const line of split.lines) {
      if (!validPayload(line)) continue;
      try {
        const message = JSON.parse(line) as RoomInfoMessage;
        if (message.type === 'gate-a-ready' || message.type === 'gate-a-echo') continue;
      } catch (_) {
        continue;
      }
      this.pushGameInbox({ peerId: 'host', payload: line });
    }
  }

  private closeGameClient(): void {
    const client = this.gameClient;
    this.gameClient = null;
    this.gameClientBuffer = '';
    this.gameConnection = disconnectedGameStatus();
    if (client !== null) {
      try {
        void client.close();
      } catch (_) {
        // The socket may already be closed.
      }
    }
  }

  private pushGameInbox(message: GameInboxMessage): void {
    if (this.gameInbox.length >= MAX_INBOX_MESSAGES) this.gameInbox.shift();
    this.gameInbox.push(message);
  }
}

function serviceKey(serviceInfo: mdns.LocalServiceInfo): string {
  return `${serviceInfo.serviceType}|${serviceInfo.serviceName}`;
}

function serviceKeyFromStatus(room: NearbyRoomStatus): string {
  return `${SERVICE_TYPE}|${room.serviceName}`;
}

function formatPeerId(clientId: number): string {
  return `peer-${clientId}`;
}

function parsePeerId(peerId: string): number | null {
  if (!/^peer-\d+$/.test(peerId)) return null;
  const clientId = Number.parseInt(peerId.slice(5), 10);
  return Number.isInteger(clientId) ? clientId : null;
}

function splitCompleteLines(value: string): SplitLinesResult {
  const parts = value.split('\n');
  const remainder = parts.pop() ?? '';
  return { lines: parts.filter((line) => line.length > 0), remainder };
}

function validPayload(payload: string): boolean {
  return payload.length > 0 && payload.length <= MAX_FRAME_CHARACTERS && !payload.includes('\n');
}

function disconnectedGameStatus(): GameConnectionStatus {
  return {
    state: 'disconnected',
    host: null,
    port: null,
    roomCode: null,
    instanceId: null,
    error: null,
  };
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

function randomRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return code;
}

function isUsableIpv4(address: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return false;
  const octets = address.split('.').map((part) => Number.parseInt(part, 10));
  return octets.every((octet) => octet >= 0 && octet <= 255)
    && address !== '0.0.0.0'
    && !address.startsWith('127.')
    && !address.startsWith('169.254.');
}

function failedPrototypeRoom(error: string): PrototypeRoomStatus {
  return {
    ok: false,
    roomCode: null,
    instanceId: null,
    host: null,
    port: null,
    payload: null,
    error,
  };
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
