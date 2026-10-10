import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

/** the recorder is a shell script: it is run for real, under `sh`, with a made-up home and made-up curl / ss / systemctl */
const SCRIPT = path.resolve('ota/deploy/healthlog.sh');

function sandbox() {
  const root = mkdtempSync(path.join(tmpdir(), 'healthlog-'));
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const fake = path.join(root, 'fake');
  for (const d of [home, bin, fake, path.join(home, 'musicspace-ota')]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(home, 'musicspace-ota', 'ota.env'), 'OTA_PUBLIC_BASE=https://example.test\n');
  const script = (name: string, body: string) => {
    writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
  };
  script('curl', 'for a; do url="$a"; done\ncase "$url" in *4416*) f=bg;; *8789*) f=ota;; *) f=web;; esac\nprintf "%s" "$(cat "$FAKE/$f" 2>/dev/null || echo 200/0.05)"');
  script('ss', 'printf "LISTEN 0 4096 *:80 *:*\\nLISTEN 0 4096 *:443 *:*\\n"');
  script('systemctl', 'if [ "$1" = "--user" ] && [ "$2" = "show" ]; then echo 0; fi\nexit 0');
  const run = (...args: string[]) =>
    spawnSync('sh', [SCRIPT, ...args], { env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE: fake, HEALTHLOG_NO_SYSTEMD: '1' }, encoding: 'utf8' });
  const logDir = path.join(home, 'healthlog');
  const logs = () => (existsSync(logDir) ? readdirSync(logDir).filter((f) => f.startsWith('health-')) : []);
  const lines = () => logs().flatMap((f) => readFileSync(path.join(logDir, f), 'utf8').trim().split('\n'));
  return { home, fake, logDir, run, logs, lines };
}

describe('the health recorder', () => {
  it('installs, writes the first line at once, and says how to look at it', () => {
    const s = sandbox();
    const r = s.run('install');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /始めました/);
    assert.ok(existsSync(path.join(s.logDir, 'log-once.sh')));
    assert.equal(s.lines().length, 1);
  });

  it('a line says time, load, memory, swap, pressure, the three services, ports, restarts and the biggest programs', () => {
    const s = sandbox();
    s.run('install');
    const line = s.lines()[0];
    assert.match(line, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d load=[\d.]+ avail=\d+MB swap=\d+MB psi=\S+ bgutil=200\/0\.05 ota=200\/0\.05 https=200\/0\.05 ports=\S+ bg_restarts=0 top=/);
    assert.match(line, /ports=(80,443|443,80)\b/);
  });

  it('each run adds one line; nothing is changed except ~/healthlog', () => {
    const s = sandbox();
    s.run('install');
    for (let i = 0; i < 3; i++) assert.equal(spawnSync('sh', [path.join(s.logDir, 'log-once.sh')], { env: { PATH: `${path.join(s.home, '..', 'bin')}:${process.env.PATH}`, HOME: s.home, FAKE: s.fake }, encoding: 'utf8' }).status, 0);
    assert.equal(s.lines().length, 4);
    // it writes its own folder and the two systemd files – nothing else in the home folder is touched
    assert.deepEqual(readdirSync(s.home).sort(), ['.config', 'healthlog', 'musicspace-ota']);
    assert.deepEqual(readdirSync(path.join(s.home, '.config', 'systemd', 'user')).sort(), ['healthlog.service', 'healthlog.timer']);
    assert.equal(readFileSync(path.join(s.home, 'musicspace-ota', 'ota.env'), 'utf8'), 'OTA_PUBLIC_BASE=https://example.test\n');
  });

  it('a service that does not answer, or answers with an error, or slowly, shows up in "problems"; a good minute does not', () => {
    const s = sandbox();
    s.run('install');
    assert.match(s.run('problems').stdout, /まだありません/);
    writeFileSync(path.join(s.fake, 'bg'), '000/6.00');
    s.run('install');
    writeFileSync(path.join(s.fake, 'bg'), '200/0.05');
    writeFileSync(path.join(s.fake, 'ota'), '502/0.01');
    s.run('install');
    writeFileSync(path.join(s.fake, 'ota'), '200/0.05');
    writeFileSync(path.join(s.fake, 'web'), '200/5.40'); // answers, but slowly: the app gives up after 8 seconds
    s.run('install');
    writeFileSync(path.join(s.fake, 'web'), '200/0.05');
    s.run('install');
    const out = s.run('problems').stdout.trim().split('\n');
    assert.equal(out.length, 3, out.join('\n'));
    assert.match(out[0], /bgutil=000\/6\.00/);
    assert.match(out[1], /ota=502/);
    assert.match(out[2], /https=200\/5\.40/);
  });

  it('low memory, waiting for memory, and a missing port also count as a problem', () => {
    const s = sandbox();
    s.run('install');
    const file = path.join(s.logDir, s.logs()[0]);
    const base = 'load=0.1 swap=10MB bgutil=200/0.05 ota=200/0.05 https=200/0.05 bg_restarts=0 top=node:100MB';
    writeFileSync(file, [
      `2026-10-09 10:00:00 ${base} avail=400MB psi=0.00 ports=80,443`,
      `2026-10-09 10:01:00 ${base} avail=90MB psi=0.00 ports=80,443`,
      `2026-10-09 10:02:00 ${base} avail=400MB psi=25.30 ports=80,443`,
      `2026-10-09 10:03:00 ${base} avail=400MB psi=0.00 ports=none`,
      `2026-10-09 10:04:00 ${base} avail=400MB psi=0.00 ports=443`,
      `2026-10-09 10:05:00 ${base} avail=400MB psi=- ports=443,80`,
    ].join('\n') + '\n');
    const out = s.run('problems').stdout.trim().split('\n').filter((l) => l.startsWith('2026-10-09'));
    assert.deepEqual(out.map((l) => l.slice(11, 19)), ['10:01:00', '10:02:00', '10:03:00', '10:04:00']);
  });

  it('"show" gives the last lines; before there is anything, it says so', () => {
    const s = sandbox();
    assert.match(s.run('show').stdout + s.run('show').stderr, /まだ記録がありません/);
    s.run('install');
    for (let i = 0; i < 4; i++) s.run('install');
    assert.equal(s.run('show', '2').stdout.trim().split('\n').filter((l) => /^\d{4}-/.test(l)).length, 2);
  });

  it('logs older than 14 days are deleted, newer ones stay', () => {
    const s = sandbox();
    s.run('install');
    const old = path.join(s.logDir, 'health-20250101.log');
    const recent = path.join(s.logDir, 'health-20260101.log');
    writeFileSync(old, 'x\n');
    writeFileSync(recent, 'y\n');
    const t = (days: number) => new Date(Date.now() - days * 86400_000);
    utimesSync(old, t(20), t(20));
    utimesSync(recent, t(3), t(3));
    s.run('install');
    assert.ok(!existsSync(old));
    assert.ok(existsSync(recent));
  });

  it('"stop" works, and an unknown word shows how to use it', () => {
    const s = sandbox();
    s.run('install');
    assert.match(s.run('stop').stdout, /止めました/);
    assert.ok(s.logs().length >= 1, 'the logs stay');
    const bad = s.run('nonsense');
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /使い方/);
  });

  it('the units for systemd are written: a run once a minute, as the user', () => {
    const s = sandbox();
    s.run('install');
    const dir = path.join(s.home, '.config', 'systemd', 'user');
    const service = readFileSync(path.join(dir, 'healthlog.service'), 'utf8');
    const timer = readFileSync(path.join(dir, 'healthlog.timer'), 'utf8');
    assert.match(service, /Type=oneshot/);
    assert.match(service, new RegExp(`ExecStart=${s.logDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/log-once\\.sh`));
    assert.match(timer, /OnUnitActiveSec=60s/);
    assert.match(timer, /WantedBy=timers\.target/);
  });

  it('the script uses nothing that only bash has (it runs under plain sh)', () => {
    const text = readFileSync(SCRIPT, 'utf8');
    const shellOnly = text.replace(/awk [^']*'[^']*'/g, 'awk X'); // what is inside awk (with or without options before it) is awk, not shell
    assert.ok(!/\[\[|\bdeclare\b|\bmapfile\b|<<<|\$\{[^}]*\/\/|\[ [^\]]*==/.test(shellOnly), 'no [[ ]], no <<<, no ${x//y}, no == inside [ ] (the "===" of a heading is only text)');
    assert.equal(spawnSync('sh', ['-n', SCRIPT]).status, 0);
  });
});

describe('finding where the machine froze', () => {
  /** a log file with one line a minute between two times (and the lines before / after a hole, if asked) */
  function logWith(s: ReturnType<typeof sandbox>, file: string, times: string[]) {
    mkdirSync(s.logDir, { recursive: true });
    writeFileSync(path.join(s.logDir, file), times.map((t, i) => `${t} load=0.1 avail=${400 - i}MB swap=10MB psi=0.00 bgutil=200/0.05 ota=200/0.05 https=200/0.05 ports=80,443 bg_restarts=0 top=node:100MB`).join('\n') + '\n');
  }
  const minutes = (day: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${day} ${String(Math.floor((from + i) / 60)).padStart(2, '0')}:${String((from + i) % 60).padStart(2, '0')}:00`);

  it('a record without holes: says there are none', () => {
    const s = sandbox();
    logWith(s, 'health-20261009.log', minutes('2026-10-09', 600, 640));
    assert.match(s.run('gaps').stdout, /途切れ（150秒以上）は、ありません/);
  });

  it('a hole shows how long it was, from when to when, the three lines before it and the first line after', () => {
    const s = sandbox();
    logWith(s, 'health-20261009.log', [...minutes('2026-10-09', 600, 640), ...minutes('2026-10-09', 665, 670)]);
    const out = s.run('gaps').stdout;
    assert.match(out, /=== ここで 25分 途切れています（10:40:00 → 11:05:00）===/);
    const lines = out.split('\n');
    const i = lines.findIndex((l) => l.includes('途切れる直前の3行'));
    assert.match(lines[i + 1], /10:38:00 .*avail=/);
    assert.match(lines[i + 3], /10:40:00 /);
    assert.match(lines[i + 4], /戻って、最初の行/);
    assert.match(lines[i + 5], /11:05:00 /);
  });

  it('a hole across midnight (two files), and a long one in hours', () => {
    const s = sandbox();
    logWith(s, 'health-20261009.log', minutes('2026-10-09', 22 * 60, 22 * 60 + 30));
    logWith(s, 'health-20261010.log', minutes('2026-10-10', 60 + 15, 60 + 20)); // 01:15 – 01:20
    assert.match(s.run('gaps').stdout, /ここで 2時間45分 途切れています（22:30:00 → 01:15:00）/);
  });

  it('a slow minute is no hole; the limit can be given; only the latest five holes are shown', () => {
    const s = sandbox();
    logWith(s, 'health-20261009.log', ['2026-10-09 10:00:00', '2026-10-09 10:01:05', '2026-10-09 10:02:00', '2026-10-09 10:03:30']);
    assert.match(s.run('gaps').stdout, /ありません/, '65 s and 90 s are normal');
    assert.match(s.run('gaps', '80').stdout, /ここで 90秒 途切れています/);
    const many = Array.from({ length: 8 }, (_, k) => minutes('2026-10-09', 600 + k * 20, 600 + k * 20 + 2)).flat();
    logWith(s, 'health-20261009.log', many);
    const out = s.run('gaps').stdout;
    assert.equal((out.match(/=== ここで/g) ?? []).length, 5);
    assert.match(out, /再起動のあいだも、途切れとして出ます/);
  });

  it('with no record at all it says so instead of failing', () => {
    const s = sandbox();
    const r = s.run('gaps');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /ありません/);
  });
});

describe('what the previous start of the machine left behind', () => {
  function withJournal(s: ReturnType<typeof sandbox>, body: string) {
    const bin = path.join(path.dirname(s.home), 'bin');
    writeFileSync(path.join(bin, 'sudo'), '#!/bin/sh\n[ "$1" = "-n" ] && shift\nexec "$@"\n');
    writeFileSync(path.join(bin, 'journalctl'), `#!/bin/sh\n${body}\n`);
    chmodSync(path.join(bin, 'sudo'), 0o755);
    chmodSync(path.join(bin, 'journalctl'), 0o755);
  }

  it('finds the out-of-memory traces and the last lines of the previous start', () => {
    const s = sandbox();
    withJournal(s, `case "$*" in
  *--list-boots*) echo "-1 aaa Thu 2026-10-08 20:00:00 JST—Fri 2026-10-09 03:12:44 JST"; echo " 0 bbb Fri 2026-10-09 03:20:01 JST—Fri 2026-10-09 10:00:00 JST";;
  *"-b -1 -k"*) echo "Oct 09 03:11:02 host kernel: Out of memory: Killed process 4242 (node) total-vm:900000kB"; echo "Oct 09 03:11:09 host kernel: INFO: task kworker blocked for more than 120 seconds.";;
  *"-b -1 -n 1"*) echo "x";;
  *"-b -1"*) echo "Oct 09 03:12:40 host systemd[1]: last line before it froze";;
esac`);
    const out = s.run('crash').stdout;
    assert.match(out, /=== 起動の履歴/);
    assert.match(out, /Out of memory: Killed process 4242 \(node\)/);
    assert.match(out, /blocked for more than 120 seconds/);
    assert.match(out, /last line before it froze/);
  });

  it('nothing found: says that there is no trace of running out of memory', () => {
    const s = sandbox();
    withJournal(s, `case "$*" in *--list-boots*) echo "-1 aaa x";; *"-b -1 -k"*) ;; *) echo "some line";; esac`);
    assert.match(s.run('crash').stdout, /メモリ不足の記録は、ありません/);
  });

  it('no journal kept from before: says how to keep it from now on', () => {
    const s = sandbox();
    withJournal(s, 'echo "No journal files were found." >&2; exit 1');
    const out = s.run('crash').stdout;
    assert.match(out, /前回の起動の記録が、残っていません/);
    assert.match(out, /sudo mkdir -p \/var\/log\/journal/);
    assert.match(out, /systemctl restart systemd-journald/);
  });
});

describe('using it from any folder', () => {
  it('installing leaves a copy in ~/healthlog, and the copy works from another folder', () => {
    const s = sandbox();
    const r = s.run('install');
    assert.equal(r.status, 0, r.stderr);
    const copy = path.join(s.logDir, 'healthlog.sh');
    assert.ok(existsSync(copy));
    assert.equal(readFileSync(copy, 'utf8'), readFileSync(SCRIPT, 'utf8'));
    assert.match(r.stdout, /sh ~\/healthlog\/healthlog\.sh gaps/);
    const elsewhere = mkdtempSync(path.join(tmpdir(), 'elsewhere-'));
    const env = { PATH: `${path.join(path.dirname(s.home), 'bin')}:${process.env.PATH}`, HOME: s.home, FAKE: s.fake, HEALTHLOG_NO_SYSTEMD: '1' };
    const out = spawnSync('sh', [copy, 'gaps'], { cwd: elsewhere, env, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /途切れ（150秒以上）は、ありません/);
  });

  it('started with a relative name from its own folder, it still finds itself to copy', () => {
    const s = sandbox();
    const env = { PATH: `${path.join(path.dirname(s.home), 'bin')}:${process.env.PATH}`, HOME: s.home, FAKE: s.fake, HEALTHLOG_NO_SYSTEMD: '1' };
    const r = spawnSync('sh', ['healthlog.sh', 'install'], { cwd: path.dirname(SCRIPT), env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(path.join(s.logDir, 'healthlog.sh'), 'utf8'), readFileSync(SCRIPT, 'utf8'));
  });

  it('installing again from the copy itself does not try to copy a file onto itself', () => {
    const s = sandbox();
    s.run('install');
    const env = { PATH: `${path.join(path.dirname(s.home), 'bin')}:${process.env.PATH}`, HOME: s.home, FAKE: s.fake, HEALTHLOG_NO_SYSTEMD: '1' };
    const again = spawnSync('sh', [path.join(s.logDir, 'healthlog.sh'), 'install'], { env, encoding: 'utf8' });
    assert.equal(again.status, 0, again.stderr);
  });
});
