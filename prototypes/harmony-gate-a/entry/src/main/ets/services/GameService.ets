import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { gamePlayer } from '@kit.GameServiceKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import BuildProfile from 'entry/BuildProfile';
import { lanHostProbe } from '../network/LanHostProbe';

class GameService {
  private context: common.UIAbilityContext | null = null;
  private initialized: boolean = false;
  private listening: boolean = false;
  private running: boolean = false;
  private revision: number = 0;
  private loginAgain: boolean = false;

  start(context: common.UIAbilityContext): void {
    this.context = context;
    this.revision += 1;
    this.loginAgain = this.running;
    void this.authenticate();
  }

  retry(): void {
    void this.authenticate();
  }

  private playerChanged = (result: gamePlayer.PlayerChangedResult): void => {
    if (result.event !== gamePlayer.PlayerChangedEvent.SWITCH_GAME_ACCOUNT) return;
    this.revision += 1;
    this.loginAgain = true;
    AppStorage.setOrCreate('gameServiceState', 'checking');
    if (this.context !== null) void lanHostProbe.stop(this.context);
    if (!this.running) void this.authenticate();
  };

  private async authenticate(): Promise<void> {
    const context = this.context;
    if (context === null || this.running) return;
    // Only the explicit local/debug product may run without platform services.
    if (BuildProfile.DEBUG && BuildProfile.PRODUCT_NAME.toString() === 'local') {
      AppStorage.setOrCreate('gameServiceMessage', '本地调试');
      AppStorage.setOrCreate('gameServiceState', 'ready');
      hilog.info(0x0000, 'GameService', 'Local debug build: platform authentication disabled.');
      return;
    }
    this.running = true;
    const revision = this.revision;
    const showLoginDialog = this.loginAgain;
    this.loginAgain = false;
    AppStorage.setOrCreate('gameServiceState', 'checking');
    AppStorage.setOrCreate('gameServiceMessage', '正在连接游戏服务…');
    try {
      if (!this.initialized) {
        await gamePlayer.init(context);
        if (this.context !== context || revision !== this.revision) return;
        this.initialized = true;
      }
      if (!this.listening) {
        gamePlayer.on('playerChanged', this.playerChanged);
        this.listening = true;
      }
      const result = await gamePlayer.unionLogin(context, {
        thirdAccountInfos: [],
        showLoginDialog,
      });
      if (this.context !== context || revision !== this.revision) return;
      if (result.accountName !== 'hw_account') {
        AppStorage.setOrCreate('gameServiceMessage', '请使用平台账号登录游戏。');
        AppStorage.setOrCreate('gameServiceState', 'error');
        return;
      }
      AppStorage.setOrCreate('gameServiceMessage', '正在验证玩家信息…');
      await gamePlayer.verifyLocalPlayer(context, { thirdOpenId: '' });
      if (this.context !== context || revision !== this.revision) return;
      AppStorage.setOrCreate('gameServiceState', 'ready');
      hilog.info(0x0000, 'GameService', 'Player verification succeeded.');
    } catch (error) {
      if (this.context !== context || revision !== this.revision) return;
      const code = (error as BusinessError).code;
      hilog.error(0x0000, 'GameService', 'Authentication failed, code: %{public}d', code);
      AppStorage.setOrCreate('gameServiceMessage', authenticationMessage(code));
      AppStorage.setOrCreate('gameServiceState', 'error');
    } finally {
      this.running = false;
      if (this.context !== null && this.loginAgain) void this.authenticate();
    }
  }

  stop(): void {
    this.context = null;
    this.revision += 1;
    this.loginAgain = false;
    this.initialized = false;
    AppStorage.setOrCreate('gameServiceState', 'checking');
    if (this.listening) {
      try {
        gamePlayer.off('playerChanged', this.playerChanged);
      } catch (error) {
        hilog.error(0x0000, 'GameService', 'Listener cleanup failed, code: %{public}d',
          (error as BusinessError).code);
      }
      this.listening = false;
    }
  }
}

function authenticationMessage(code: number): string {
  switch (code) {
    case 1002000002:
      return '连接失败，请检查网络后重试。';
    case 1002000003:
      return '请登录平台账号后重试。';
    case 1002000004:
      return '需要完成实名认证才能进入游戏。';
    case 1002000006:
      return '当前不在允许的游戏时间内，请退出游戏。';
    case 1002000011:
      return '需要同意游戏服务隐私声明才能继续。';
    case 1002000016:
    case 1002000020:
      return '已取消登录。你可以重新登录或退出游戏。';
    default:
      return `暂时无法完成玩家验证（${code}），请稍后重试。`;
  }
}

export const gameService = new GameService();
