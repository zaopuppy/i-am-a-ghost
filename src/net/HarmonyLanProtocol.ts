import type {
  BasicActionResponse,
  ClientInputFrame,
  MatchEventEnvelope,
  MatchFrameEnvelope,
  RoomActionResponse,
  RoomState,
} from './protocol';

export const HARMONY_LAN_PROTOCOL = 'gate-a-game-v1';

export interface HarmonyRoomEndpoint {
  host: string;
  port: number;
  roomCode: string;
  instanceId: string;
  serviceName: string;
}

export type HarmonyClientMessage =
  | {
    type: 'create-room';
    requestId: string;
    nickname: string;
  }
  | {
    type: 'join-room';
    requestId: string;
    protocolVersion: number;
    buildVersion: string;
    roomCode: string;
    nickname: string;
  }
  | {
    type: 'start-match';
    requestId: string;
  }
  | {
    type: 'set-ready';
    requestId: string;
    ready: boolean;
  }
  | {
    type: 'input-frame';
    frame: ClientInputFrame;
  };

export type HarmonyActionResult = RoomActionResponse | BasicActionResponse;

export type HarmonyServerMessage =
  | {
    type: 'response';
    requestId: string;
    result: HarmonyActionResult;
  }
  | {
    type: 'room-state';
    state: RoomState;
  }
  | {
    type: 'match-frame';
    envelope: MatchFrameEnvelope;
  }
  | {
    type: 'match-events';
    envelope: MatchEventEnvelope;
  }
  | {
    type: 'room-error';
    message: string;
  }
  | {
    type: 'host-closed';
  };

export type HarmonyWorkerInput =
  | {
    type: 'configure';
    roomCode: string;
  }
  | {
    type: 'peer-message';
    peerId: string;
    payload: string;
  }
  | {
    type: 'peer-disconnected';
    peerId: string;
  }
  | {
    type: 'close';
  };

export type HarmonyWorkerOutput =
  | {
    type: 'send';
    peerId: string;
    payload: string;
  }
  | {
    type: 'player-count';
    count: number;
  };

