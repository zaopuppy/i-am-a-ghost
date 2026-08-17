import type { ViewerMatchEvent } from '../net/protocol';

export const GAME_AUDIO_ASSETS = Object.freeze({
  flashlight: 'assets/audio/kenney/pick-started.mp3',
  captureWindup: 'assets/audio/kenney/guard-pounce.mp3',
  captured: 'assets/audio/kenney/kid-captured.mp3',
  battery: 'assets/audio/kenney/picked-01.mp3',
  matchEnded: 'assets/audio/kenney/match-ended.mp3',
});

type SoundId = keyof typeof GAME_AUDIO_ASSETS;

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<SoundId, AudioBuffer>();
  private readonly fallbackAudio = new Map<SoundId, HTMLAudioElement>();
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
    if (this.context.state !== 'running') void this.context.resume().catch(() => undefined);
    this.loadPromise ??= this.loadAll();
    await this.loadPromise;
  }

  play(id: SoundId, volume = 1): void {
    const buffer = this.buffers.get(id);
    if (this.muted) return;
    if (!buffer || !this.context || !this.master) {
      const fallback = this.fallbackAudio.get(id);
      if (fallback) {
        const sound = fallback.cloneNode(true) as HTMLAudioElement;
        sound.volume = Math.min(1, volume * 0.72);
        void sound.play().catch(() => undefined);
      }
      return;
    }
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
      loaded: this.buffers.size + this.fallbackAudio.size,
      failed: this.failedAssets,
    };
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.buffers.clear();
    for (const audio of this.fallbackAudio.values()) audio.pause();
    this.fallbackAudio.clear();
  }

  private async loadAll(): Promise<void> {
    if (!this.context) return;
    for (const [id, relativePath] of Object.entries(GAME_AUDIO_ASSETS)) {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}${relativePath}`);
        if (!response.ok) throw new Error(`Audio request failed: ${response.status}`);
        const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        this.buffers.set(id as SoundId, buffer);
      } catch {
        const fallback = await loadHtmlAudio(`${import.meta.env.BASE_URL}${relativePath}`);
        if (fallback) this.fallbackAudio.set(id as SoundId, fallback);
        else this.failedAssets += 1;
      }
    }
  }
}

function loadHtmlAudio(url: string): Promise<HTMLAudioElement | null> {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.preload = 'auto';
    const timeout = window.setTimeout(() => finish(null), 2_000);
    const finish = (result: HTMLAudioElement | null): void => {
      window.clearTimeout(timeout);
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('error', onError);
      resolve(result);
    };
    const onReady = (): void => finish(audio);
    const onError = (): void => finish(null);
    audio.addEventListener('canplay', onReady, { once: true });
    audio.addEventListener('error', onError, { once: true });
    audio.load();
  });
}
