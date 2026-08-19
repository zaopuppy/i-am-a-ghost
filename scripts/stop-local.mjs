import { execFileSync } from 'node:child_process';
import process from 'node:process';

const DEFAULT_PORTS = [5189, 5191, 4189];

const extraPort = Number.parseInt(process.env.I_AM_A_GHOST_SERVER_PORT ?? '', 10);
const ports = extraPort > 0 && extraPort <= 65_535
  ? [...new Set([...DEFAULT_PORTS, extraPort])]
  : DEFAULT_PORTS;

const pids = process.platform === 'win32' ? listeningPidsWindows(ports) : listeningPidsUnix(ports);
if (pids.length === 0) {
  console.log(`没有占用 ${ports.join(' / ')} 的本地服务。`);
  process.exit(0);
}

for (const pid of pids) {
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

console.log(`已停止 PID ${pids.join(', ')}（端口 ${ports.join(', ')}）。`);

function listeningPidsWindows(listenPorts) {
  const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
  const found = new Set();
  for (const line of output.split(/\r?\n/)) {
    if (!/\bLISTENING\b/i.test(line)) continue;
    const columns = line.trim().split(/\s+/);
    const localAddress = columns[1] ?? '';
    const pid = Number.parseInt(columns.at(-1) ?? '', 10);
    if (!Number.isInteger(pid) || pid <= 4) continue;
    if (listenPorts.some((port) => localAddressEndsWithPort(localAddress, port))) found.add(pid);
  }
  return [...found];
}

function listeningPidsUnix(listenPorts) {
  const found = new Set();
  for (const port of listenPorts) {
    try {
      const output = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      for (const line of output.split(/\r?\n/)) {
        const pid = Number.parseInt(line.trim(), 10);
        if (Number.isInteger(pid) && pid > 0) found.add(pid);
      }
    } catch {
      // lsof missing or nothing listening
    }
  }
  return [...found];
}

function localAddressEndsWithPort(localAddress, port) {
  return localAddress.endsWith(`:${port}`) || localAddress.endsWith(`]:${port}`);
}
