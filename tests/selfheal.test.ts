import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

/** the script is run for real under `sh`, with a made-up root folder and made-up modinfo / modprobe / sysctl / systemctl */
const SCRIPT = path.resolve('ota/deploy/selfheal.sh');

function sandbox(opts: { softdog?: boolean; watchdogUSec?: string } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), 'selfheal-'));
  const root = path.join(base, 'root');
  const bin = path.join(base, 'bin');
  const calls = path.join(base, 'calls.log');
  mkdirSync(root);
  mkdirSync(bin);
  writeFileSync(calls, '');
  const stub = (name: string, body: string) => {
    writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
  };
  stub('modinfo', opts.softdog === false ? 'exit 1' : 'exit 0');
  stub('modprobe', `echo "modprobe $*" >> "${calls}"`);
  stub('sysctl', `if [ "$1" = "-n" ]; then echo 30; else echo "sysctl $*" >> "${calls}"; fi`);
  stub('systemctl', `if [ "$1" = "show" ]; then echo "${opts.watchdogUSec ?? '0'}"; else echo "systemctl $*" >> "${calls}"; fi`);
  stub('lsmod', 'echo "softdog 16384 1"');
  const run = (...args: string[]) => spawnSync('sh', [SCRIPT, ...args], { env: { PATH: `${bin}:${process.env.PATH}`, SELFHEAL_ROOT: root, SELFHEAL_SUDO: '' }, encoding: 'utf8' });
  const file = (p: string) => path.join(root, p);
  return { run, file, calls: () => readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean) };
}

describe('the self-restart safety net', () => {
  it('installs: the watchdog for systemd, the module at boot, its setting, and the restart after a panic – and says so', () => {
    const s = sandbox();
    const r = s.run('install');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /自動で再起動します/);
    assert.match(readFileSync(s.file('etc/systemd/system.conf.d/90-musicspace-watchdog.conf'), 'utf8'), /\[Manager\]\nRuntimeWatchdogSec=60s\n/);
    assert.equal(readFileSync(s.file('etc/modules-load.d/musicspace-softdog.conf'), 'utf8'), 'softdog\n');
    assert.equal(readFileSync(s.file('etc/modprobe.d/musicspace-softdog.conf'), 'utf8'), 'options softdog soft_margin=60\n');
    const panic = readFileSync(s.file('etc/sysctl.d/90-musicspace-panic.conf'), 'utf8');
    assert.match(panic, /kernel\.panic = 30/);
    assert.match(panic, /kernel\.panic_on_oops = 1/);
  });

  it('loads the module and applies the settings now (no restart of the machine needed)', () => {
    const s = sandbox();
    s.run('install');
    const calls = s.calls();
    assert.ok(calls.includes('modprobe softdog'));
    assert.ok(calls.some((c) => c.startsWith('sysctl -p') && c.endsWith('90-musicspace-panic.conf')));
    assert.ok(calls.includes('systemctl daemon-reexec'));
    assert.ok(calls.indexOf('modprobe softdog') < calls.indexOf('systemctl daemon-reexec'), 'the module first, then systemd opens the watchdog');
  });

  it('running it twice changes nothing more (same files, same content)', () => {
    const s = sandbox();
    s.run('install');
    const first = readFileSync(s.file('etc/systemd/system.conf.d/90-musicspace-watchdog.conf'), 'utf8');
    assert.equal(s.run('install').status, 0);
    assert.equal(readFileSync(s.file('etc/systemd/system.conf.d/90-musicspace-watchdog.conf'), 'utf8'), first);
  });

  it('a machine without softdog: refuses, says why, and changes nothing', () => {
    const s = sandbox({ softdog: false });
    const r = s.run('install');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /softdog が見つかりません。何も変えませんでした/);
    assert.ok(!existsSync(s.file('etc/systemd')));
    assert.deepEqual(s.calls(), []);
  });

  it('status says what is set and whether the watchdog is really running', () => {
    const off = sandbox();
    assert.match(off.run('status').stdout, /いま動いている見張り: なし/);
    assert.match(off.run('status').stdout, /systemd の設定:\s+なし/);
    const on = sandbox({ watchdogUSec: '1min' });
    on.run('install');
    const out = on.run('status').stdout;
    assert.match(out, /systemd の設定:\s+あり/);
    assert.match(out, /いま動いている見張り: あり（systemd が、1min ごとの合図を待っています）/);
    assert.match(out, /パニック後の再起動: 30 秒/);
    assert.equal(on.run().stdout, on.run('status').stdout, 'status is what you get with no word');
  });

  it('remove takes the four files away again, and says that the watchdog stays until the next restart', () => {
    const s = sandbox();
    s.run('install');
    const r = s.run('remove');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /次に再起動するまで/);
    for (const f of ['etc/systemd/system.conf.d/90-musicspace-watchdog.conf', 'etc/modules-load.d/musicspace-softdog.conf', 'etc/modprobe.d/musicspace-softdog.conf', 'etc/sysctl.d/90-musicspace-panic.conf']) assert.ok(!existsSync(s.file(f)), f);
    assert.equal(sandbox().run('remove').status, 0, 'removing what is not there is fine');
  });

  it('an unknown word shows how to use it', () => {
    const r = sandbox().run('what');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /使い方/);
  });

  it('it touches nothing outside the four files, and uses only what plain sh has', () => {
    const text = readFileSync(SCRIPT, 'utf8');
    assert.equal(spawnSync('sh', ['-n', SCRIPT]).status, 0);
    assert.ok(!/\[\[|\bdeclare\b|\bmapfile\b|<<<|\$\{[^}]*\/\/|\[ [^\]]*==/.test(text), 'no bashisms');
    const paths = new Set([...text.matchAll(/"\$ROOT(\/[a-z0-9_./-]+)"/g)].map((m) => m[1]));
    assert.deepEqual([...paths].sort(), ['/etc/modprobe.d/musicspace-softdog.conf', '/etc/modules-load.d/musicspace-softdog.conf', '/etc/sysctl.d/90-musicspace-panic.conf', '/etc/systemd/system.conf.d/90-musicspace-watchdog.conf']);
  });
});
