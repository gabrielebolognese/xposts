// Real resource use of this PC for the studio projects: CPU per thread and RAM every 250 ms (Node), GPU, disk and
// network about every 1.5 s (Windows performance counters through counters.ps1). Keeps the last 10 minutes.
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const HERE = import.meta.dirname;
const KEEP = 2400; // 10 minutes at 4 samples a second

export function systemInfo() {
  const info = {
    cpu: os.cpus()[0].model.trim(),
    cores: os.cpus().length,
    threads: os.cpus().length,
    ramGB: +(os.totalmem() / 1073741824).toFixed(1),
    gpu: '',
    gpuMB: 0,
    os: `${os.type()} ${os.release()}`,
  };
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      '$p=Get-CimInstance Win32_Processor|Select-Object -First 1;$g=Get-CimInstance Win32_VideoController|Select-Object -First 1;' +
      '@{cores=$p.NumberOfCores;threads=$p.NumberOfLogicalProcessors;gpu=$g.Name;gpuMB=[math]::Round($g.AdapterRAM/1MB);' +
      'os=(Get-CimInstance Win32_OperatingSystem).Caption}|ConvertTo-Json -Compress'], { timeout: 20000 }).toString();
    const x = JSON.parse(out);
    Object.assign(info, { cores: x.cores, threads: x.threads, gpu: String(x.gpu).trim(), gpuMB: x.gpuMB, os: String(x.os).trim() });
  } catch {}
  return info;
}

export function startSampler() {
  const samples = [];
  let counters = { gpu: null, r: null, w: null, n: null };
  let prev = os.cpus();
  const timer = setInterval(() => {
    const cur = os.cpus();
    const cpu = cur.map((c, i) => {
      const a = prev[i].times, b = c.times;
      const busy = (b.user - a.user) + (b.nice - a.nice) + (b.sys - a.sys) + (b.irq - a.irq);
      const total = busy + (b.idle - a.idle);
      return total > 0 ? +((100 * busy) / total).toFixed(1) : 0;
    });
    prev = cur;
    const total = os.totalmem(), free = os.freemem();
    samples.push({
      t: Date.now(),
      cpu,
      cpuTotal: +(cpu.reduce((s, x) => s + x, 0) / cpu.length).toFixed(1),
      ramUsed: +((total - free) / 1073741824).toFixed(2),
      ramTotal: +(total / 1073741824).toFixed(1),
      gpu: counters.gpu,
      diskR: counters.r,
      diskW: counters.w,
      net: counters.n,
    });
    if (samples.length > KEEP) samples.splice(0, samples.length - KEEP);
  }, 250);
  const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'counters.ps1')],
    { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  let buf = '';
  ps.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      try {
        if (line) counters = JSON.parse(line);
      } catch {}
    }
  });
  ps.on('error', () => {});
  return {
    samples,
    latest: () => samples.at(-1) || null,
    stop() {
      clearInterval(timer);
      try {
        ps.kill();
      } catch {}
    },
  };
}
