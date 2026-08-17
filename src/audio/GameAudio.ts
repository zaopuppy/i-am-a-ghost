import type { ViewerMatchEvent } from '../net/protocol';

export const GAME_AUDIO_ASSETS = Object.freeze({
  flashlight: 'assets/audio/kenney/pick-started.mp3',
  captureWindup: 'assets/audio/kenney/guard-pounce.mp3',
  captured: 'assets/audio/kenney/kid-captured.mp3',
  battery: 'assets/audio/kenney/picked-01.mp3',
  matchEnded: 'assets/audio/kenney/match-ended.mp3',
});
export const GAME_AUDIO_PACK_PATH = 'assets/audio/kenney/sfx-pack.json';

type SoundId = keyof typeof GAME_AUDIO_ASSETS;

interface AudioPack {
  format: 'base64-audio-pack-v1';
  mimeType: 'audio/mpeg';
  samples: Record<string, string>;
}

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<SoundId, AudioBuffer>();
  private loadPromise: Promise<void> | null = null;
  private muted = false;
  private failedAssets = 0;

  async unlock(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.72;
      this.master.connect(this.context.destination);
    }
    if (this.context.state !== 'running') {
      await this.context.resume().catch(() => undefined);
    }
    this.loadPromise ??= this.loadAll(this.context);
    await this.loadPromise;
  }

  play(id: SoundId, volume = 1): void {
    const buffer = this.buffers.get(id);
    if (this.muted) return;
    if (!buffer || !this.context || !this.master) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(gain).connect(this.master);
    source.start();
  }

  handleEvents(events: readonly ViewerMatchEvent[]): void {
    for (const event of events) {
      if (event.type === 'capture-started') this.play('captureWindup', 0.72);
      else if (event.type === 'child-captured') this.play('captured', 0.86);
      else if (event.type === 'battery-collected') this.play('battery', 0.72);
      else if (event.type === 'match-ended') this.play('matchEnded', 0.84);
    }
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.72;
    return this.muted;
  }

  metrics(): { unlocked: boolean; muted: boolean; loaded: number; failed: number } {
    return {
      unlocked: this.context?.state === 'running',
      muted: this.muted,
      loaded: this.buffers.size,
      failed: this.failedAssets,
    };
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.buffers.clear();
  }

  private async loadAll(context: AudioContext): Promise<void> {
    let pack: AudioPack;
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${GAME_AUDIO_PACK_PATH}`);
      if (!response.ok) throw new Error(`Audio pack request failed: ${response.status}`);
      const payload: unknown = await response.json();
      if (!isAudioPack(payload)) throw new Error('Unsupported audio pack format');
      pack = payload;
    } catch {
      this.failedAssets = Object.keys(GAME_AUDIO_ASSETS).length;
      return;
    }

    await Promise.all(Object.entries(GAME_AUDIO_ASSETS).map(async ([id, relativePath]) => {
      try {
        const encoded = pack.samples[relativePath];
        if (typeof encoded !== 'string') throw new Error(`Missing audio sample: ${relativePath}`);
        const buffer = await context.decodeAudioData(decodeBase64(encoded));
        if (this.context === context) this.buffers.set(id as SoundId, buffer);
      } catch {
        this.failedAssets += 1;
      }
    }));
  }
}

function isAudioPack(value: unknown): value is AudioPack {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AudioPack>;
  return candidate.format === 'base64-audio-pack-v1'
    && candidate.mimeType === 'audio/mpeg'
    && Boolean(candidate.samples)
    && typeof candidate.samples === 'object';
}

function decodeBase64(encoded: string): ArrayBuffer {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
