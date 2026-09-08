import type { SoloOptions } from './SoloMatch';
import type { ViewerFrame } from './ViewerFrame';

interface SoloMenuActions {
  start(options: SoloOptions): void;
  resume(): void;
  restart(): void;
  home(): void;
  setup(): void;
}

/** Owns solo dialogs; gameplay and loading stay with the app/session. */
export class SoloMenu {
  private readonly dialog = document.createElement('dialog');
  private readonly setup: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly title: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly status: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly resumeButton: HTMLButtonElement;
  private readonly restartButton: HTMLButtonElement;
  private readonly changeButton: HTMLButtonElement;
  private readonly count: HTMLSelectElement;
  private role: SoloOptions['role'] = 'ghost';
  private screen: 'setup' | 'paused' | 'ended' | null = null;

  constructor(actions: SoloMenuActions) {
    this.dialog.className = 'solo-dialog';
    this.dialog.id = 'solo-dialog';
    this.dialog.setAttribute('aria-labelledby', 'solo-title');
    this.dialog.innerHTML = `
      <div class="result-card solo-card">
        <p class="eyebrow">单人游戏 · 标准难度</p>
        <h2 id="solo-title">独自走进黑暗</h2>
        <p id="solo-detail">五分钟，一栋房子。其他角色由 AI 控制。</p>
        <div id="solo-setup">
          <fieldset class="role-picker">
            <legend>选择你的阵营</legend>
            <p class="role-picker__hint">鬼累计抓捕三次；小孩照亮鬼或撑到天亮。</p>
            <div class="role-picker__choices">
              <button type="button" class="role-choice role-choice--ghost" data-solo-role="ghost" aria-pressed="true">
                <span class="role-choice__mark" aria-hidden="true">鬼</span>
                <span class="role-choice__copy"><strong>成为鬼</strong><small>接近、追逐、抓捕</small></span>
              </button>
              <button type="button" class="role-choice role-choice--child" data-solo-role="child" aria-pressed="false">
                <span class="role-choice__mark" aria-hidden="true">孩</span>
                <span class="role-choice__copy"><strong>成为小孩</strong><small>探索、照射、求生</small></span>
              </button>
            </div>
          </fieldset>
          <label class="solo-count" for="solo-child-count">小孩数量
            <select id="solo-child-count" aria-describedby="solo-roster">
              <option value="1">1 个</option><option value="2">2 个</option>
              <option value="3">3 个</option><option value="4" selected>4 个</option>
            </select>
          </label>
          <p id="solo-roster" class="solo-hint"></p>
          <p id="solo-status" class="solo-hint" role="status"></p>
          <button id="solo-start" type="button" disabled>正在准备…</button>
        </div>
        <div class="solo-buttons">
          <button id="solo-resume" type="button" hidden>继续游戏</button>
          <button id="solo-restart" type="button" hidden>重新开始</button>
          <button id="solo-change-role" class="solo-secondary" type="button" hidden>更换角色</button>
          <button id="solo-home" class="solo-secondary" type="button">返回首页</button>
        </div>
      </div>`;
    document.querySelector('#app')!.append(this.dialog);
    const element = <T extends HTMLElement>(selector: string): T => this.dialog.querySelector<T>(selector)!;
    this.setup = element('#solo-setup');
    this.summary = element('#solo-roster');
    this.title = element('#solo-title');
    this.detail = element('#solo-detail');
    this.status = element('#solo-status');
    this.startButton = element('#solo-start');
    this.resumeButton = element('#solo-resume');
    this.restartButton = element('#solo-restart');
    this.changeButton = element('#solo-change-role');
    this.count = element('#solo-child-count');
    this.count.addEventListener('change', () => this.renderRoster());
    for (const button of this.dialog.querySelectorAll<HTMLButtonElement>('[data-solo-role]')) {
      button.addEventListener('click', () => {
        this.role = button.dataset.soloRole as SoloOptions['role'];
        for (const choice of this.dialog.querySelectorAll('[data-solo-role]')) {
          choice.setAttribute('aria-pressed', String(choice === button));
        }
        this.renderRoster();
      });
    }
    this.startButton.addEventListener('click', () => actions.start({
      role: this.role,
      childCount: Number(this.count.value),
      seed: crypto.getRandomValues(new Uint32Array(1))[0],
    }));
    this.resumeButton.addEventListener('click', actions.resume);
    this.restartButton.addEventListener('click', actions.restart);
    this.changeButton.addEventListener('click', actions.setup);
    element('#solo-home').addEventListener('click', actions.home);
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (this.screen === 'paused') actions.resume();
      else actions.home();
    });
  }

  showSetup(): void {
    this.show('setup', '独自走进黑暗', '五分钟，一栋房子。其他角色由 AI 控制。');
    this.renderRoster();
    this.setReady(false);
  }

  setReady(ready: boolean, error?: string): void {
    this.startButton.disabled = !ready;
    this.startButton.textContent = ready ? '开始游戏' : error ? '资源尚未就绪' : '正在准备…';
    this.status.textContent = error ?? (ready
      ? '本机已就绪，断网也能开始和完成对局。'
      : '正在装入角色、光影和声音…');
  }

  showPaused(): void {
    this.show('paused', '黑暗暂歇', '对局已暂停，准备好后继续。');
    this.resumeButton.focus();
  }

  showResult(frame: ViewerFrame): void {
    if (this.screen === 'ended') return;
    const won = frame.viewerRole === 'ghost' ? frame.winner === 'ghost' : frame.winner === 'children';
    this.show('ended', won ? '你赢了' : '这次输了', frame.winner === 'ghost'
      ? '第三次抓捕完成，房子归于寂静。'
      : frame.ghostHealth <= 0 ? '鬼的力量已经耗尽。' : '五分钟过去了，孩子们撑到了天亮。');
    this.restartButton.focus();
  }

  close(): void {
    this.screen = null;
    this.dialog.close();
  }

  dispose(): void { this.dialog.remove(); }

  private show(screen: NonNullable<SoloMenu['screen']>, title: string, detail: string): void {
    this.screen = screen;
    this.dialog.dataset.screen = screen;
    this.title.textContent = title;
    this.detail.textContent = detail;
    this.setup.hidden = screen !== 'setup';
    this.resumeButton.hidden = screen !== 'paused';
    this.restartButton.hidden = screen === 'setup';
    this.restartButton.textContent = screen === 'ended' ? '再来一局' : '重新开始';
    this.changeButton.hidden = screen === 'setup';
    if (!this.dialog.open) this.dialog.showModal();
  }

  private renderRoster(): void {
    const count = Number(this.count.value);
    this.summary.textContent = this.role === 'ghost'
      ? `你对抗 ${count} 个 AI 小孩。${count < 4 ? `另有 ${4 - count} 个感应人偶。` : ''}`
      : `你与 ${count - 1} 个 AI 小孩对抗 AI 鬼。${count < 4 ? `另有 ${4 - count} 个感应人偶。` : ''}`;
  }
}
