interface MultiplayerMenuActions {
  resume(): void;
  toggleSound(): void;
  leave(): Promise<void>;
}

/** Local dialog only; the room authority keeps the match running. */
export class MultiplayerMenu {
  private readonly dialog = document.createElement('dialog');
  private leaving = false;

  constructor(private readonly actions: MultiplayerMenuActions) {
    this.dialog.id = 'multiplayer-menu';
    this.dialog.className = 'solo-dialog multiplayer-dialog';
    this.dialog.setAttribute('aria-labelledby', 'multiplayer-menu-title');
    this.dialog.innerHTML = `
      <div class="result-card solo-card">
        <p class="eyebrow">多人联机</p>
        <h2 id="multiplayer-menu-title">游戏菜单</h2>
        <p class="multiplayer-warning">联机对局仍在进行</p>
        <p class="solo-hint">你已停止操作，角色仍可被攻击或捕获。</p>
        <div class="solo-buttons">
          <button id="multiplayer-resume" type="button">继续游戏</button>
          <button id="multiplayer-sound" class="solo-secondary" type="button"></button>
          <details id="multiplayer-help"><summary>操作说明</summary><p class="solo-hint"></p></details>
          <button id="multiplayer-leave" class="solo-secondary" type="button">退出房间</button>
        </div>
        <div id="multiplayer-confirm" hidden>
          <p id="multiplayer-leave-detail"></p>
          <div class="solo-buttons">
            <button id="multiplayer-cancel" class="solo-secondary" type="button">留在对局</button>
            <button id="multiplayer-confirm-leave" type="button">确认退出</button>
          </div>
        </div>
        <p id="multiplayer-menu-error" class="solo-hint" role="status"></p>
      </div>`;
    document.querySelector('#app')!.append(this.dialog);
    this.element('#multiplayer-resume').addEventListener('click', actions.resume);
    this.element('#multiplayer-sound').addEventListener('click', actions.toggleSound);
    this.element('#multiplayer-leave').addEventListener('click', () => {
      this.element('#multiplayer-confirm').hidden = false;
      this.element('#multiplayer-cancel').focus();
    });
    this.element('#multiplayer-cancel').addEventListener('click', () => this.cancelLeave());
    this.element('#multiplayer-confirm-leave').addEventListener('click', () => void this.leave());
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (this.leaving) return;
      if (!this.element('#multiplayer-confirm').hidden) this.cancelLeave();
      else actions.resume();
    });
  }

  get open(): boolean { return this.dialog.open; }

  show(help: string, closesRoom: boolean, muted: boolean): void {
    this.element('#multiplayer-help p').textContent = help;
    this.element('#multiplayer-leave-detail').textContent = closesRoom
      ? '你是房间主机。退出将结束整个房间，所有玩家都会返回首页。'
      : '确认退出房间并返回首页？其他玩家的对局将继续。';
    this.element('#multiplayer-confirm').hidden = true;
    this.element('#multiplayer-menu-error').textContent = '';
    this.dialog.querySelector('details')!.open = false;
    this.setMuted(muted);
    this.dialog.showModal();
    this.element('#multiplayer-resume').focus();
  }

  setMuted(muted: boolean): void {
    const button = this.element('#multiplayer-sound');
    button.textContent = muted ? '声音：关' : '声音：开';
    button.setAttribute('aria-pressed', String(muted));
  }

  close(): void { this.dialog.close(); }
  dispose(): void { this.dialog.remove(); }

  private element(selector: string): HTMLElement { return this.dialog.querySelector<HTMLElement>(selector)!; }

  private cancelLeave(): void {
    this.element('#multiplayer-confirm').hidden = true;
    this.element('#multiplayer-leave').focus();
  }

  private async leave(): Promise<void> {
    if (this.leaving) return;
    this.leaving = true;
    for (const button of this.dialog.querySelectorAll('button')) button.disabled = true;
    try {
      await this.actions.leave();
    } catch (error) {
      this.element('#multiplayer-menu-error').textContent = error instanceof Error ? error.message : '退出失败，请重试。';
    } finally {
      this.leaving = false;
      for (const button of this.dialog.querySelectorAll('button')) button.disabled = false;
    }
  }
}
