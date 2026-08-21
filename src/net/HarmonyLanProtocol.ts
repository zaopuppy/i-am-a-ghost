export const HARMONY_LAN_PROTOCOL = 'gate-a-game-v1';

export interface HarmonyRoomEndpoint {
  host: string;
  port: number;
  roomCode: string;
  instanceId: string;
  serviceName: string;
}
