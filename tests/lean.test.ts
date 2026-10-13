import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

/** run for real under `sh`, in a made-up root folder, with a made-up systemctl / ps */
const SCRIPT = path.resolve('ota/deploy/lean.sh');

const REPO = `[ol9_baseos_latest]
name=Oracle Linux 9 BaseOS Latest (\$basearch)
baseurl=https://yum.oracle.com/repo/OracleLinux/OL9/baseos/latest/\$basearch/
gpgcheck=1
enabled=1

[ol9_appstream]
name=Oracle Linux 9 Application Stream (\$basearch)
gpgcheck=1
enabled=1

[ol9_oci_included]
name=Oracle Linux 9 OCI Included Packages (\$basearch)
baseurl=https://yum.oracle.com/repo/OracleLinux/OL9/oci/included/\$basearch/
gpgcheck=1
enabled=1

[ol9_ksplice]
name=Ksplice for Oracle Linux 9 (\$basearch)
gpgcheck=1
enabled=1
`;

function sandbox(opts: { repo?: string; extraRepoFile?: string; dnfRunning?: boolean; timerState?: string } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), 'lean-'));
  const root = path.join(base, 'root');
  const bin = path.join(base, 'bin');
  const calls = path.join(base, 'calls.log');
  mkdirSync(path.join(root, 'etc/yum.repos.d'), { recursive: true });
  mkdirSync(bin);
  writeFileSync(calls, '');
  writeFileSync(path.join(root, 'etc/yum.repos.d/oracle-linux-ol9.repo'), opts.repo ?? REPO);
  if (opts.extraRepoFile) writeFileSync(path.join(root, 'etc/yum.repos.d/other.repo'), opts.extraRepoFile);
  const stub = (name: string, body: string) => {
    writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
  };
  stub('systemctl', `if [ "$1" = "is-enabled" ]; then echo "${opts.timerState ?? 'enabled'}"; else echo "systemctl $*" >> "${calls}"; fi`);
  stub('ps', `${opts.dnfRunning ? 'echo dnf; ' : ''}echo systemd; echo node`);
  const run = (...args: string[]) => spawnSync('sh', [SCRIPT, ...args], { env: { PATH: `${bin}:${process.env.PATH}`, LEAN_ROOT: root, LEAN_SUDO: '' }, encoding: 'utf8' });
  const file = (name: string) => path.join(root, 'etc/yum.repos.d', name);
  return { run, file, repo: () => readFileSync(file('oracle-linux-ol9.repo'), 'utf8'), calls: () => readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean), dir: () => readdirSync(path.join(root, 'etc/yum.repos.d')).sort() };
}

/** the "enabled" value that follows a section header */
const enabledOf = (text: string, id: string): string | undefined => new RegExp(`\\[${id}\\][^\\[]*?^enabled=(\\d)`, 'm').exec(text)?.[1];

describe('keeping dnf from eating the memory', () => {
  it('apply: stops (and masks) the automatic makecache', () => {
    const s = sandbox();
    const r = s.run('apply');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(s.calls(), ['systemctl mask --now dnf-makecache.timer dnf-makecache.service']);
  });

  it('apply: switches off exactly the two big lists – the others stay on, and nothing else in the file changes', () => {
    const s = sandbox();
    s.run('apply');
    const after = s.repo();
    assert.equal(enabledOf(after, 'ol9_oci_included'), '0');
    assert.equal(enabledOf(after, 'ol9_ksplice'), '0');
    assert.equal(enabledOf(after, 'ol9_baseos_latest'), '1');
    assert.equal(enabledOf(after, 'ol9_appstream'), '1');
    assert.equal(after.replace(/enabled=0/g, 'enabled=1'), REPO, 'only those two "enabled" lines changed');
  });

  it('apply keeps a copy of the file first, once (running it again does not overwrite the original copy)', () => {
    const s = sandbox();
    s.run('apply');
    assert.equal(readFileSync(s.file('oracle-linux-ol9.repo.bak-lean'), 'utf8'), REPO);
    s.run('apply');
    assert.equal(readFileSync(s.file('oracle-linux-ol9.repo.bak-lean'), 'utf8'), REPO, 'still the ORIGINAL');
    assert.equal(enabledOf(s.repo(), 'ol9_oci_included'), '0');
  });

  it('a section at the very end of the file, "enabled = 1" with spaces, and other versions (ol8) are handled; other files are left alone', () => {
    const repo = '[ol8_oci_included]\nname=x\nenabled = 1\n\n[ol8_baseos_latest]\nenabled=1\n\n[ol8_ksplice]\nname=y\nenabled=1';
    const other = '[some_other]\nenabled=1\n';
    const s = sandbox({ repo, extraRepoFile: other });
    s.run('apply');
    const after = s.repo();
    assert.match(after, /\[ol8_oci_included\]\nname=x\nenabled=0/);
    assert.match(after, /\[ol8_baseos_latest\]\nenabled=1/);
    assert.match(after, /\[ol8_ksplice\]\nname=y\nenabled=0$/);
    assert.equal(readFileSync(s.file('other.repo'), 'utf8'), other);
    assert.ok(!existsSync(s.file('other.repo.bak-lean')), 'no copy of a file that was not touched');
  });

  it('a machine without those lists: nothing is changed, and it says so', () => {
    const plain = '[ol9_baseos_latest]\nenabled=1\n';
    const s = sandbox({ repo: plain });
    const r = s.run('apply');
    assert.equal(r.status, 0);
    assert.equal(s.repo(), plain);
    assert.match(r.stdout, /見つかりません/);
    assert.deepEqual(s.dir(), ['oracle-linux-ol9.repo']);
  });

  it('undo: the original file is back, the copy is removed, the timer is unmasked', () => {
    const s = sandbox();
    s.run('apply');
    const r = s.run('undo');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(s.repo(), REPO);
    assert.ok(!existsSync(s.file('oracle-linux-ol9.repo.bak-lean')));
    assert.ok(s.calls().includes('systemctl unmask dnf-makecache.timer dnf-makecache.service'));
    assert.match(r.stdout, /元に戻しました/);
  });

  it('undo with nothing to undo is harmless', () => {
    const s = sandbox();
    assert.equal(s.run('undo').status, 0);
    assert.equal(s.repo(), REPO);
  });

  it('status tells the timer, the two lists, and whether dnf is running now', () => {
    const before = sandbox({ timerState: 'enabled', dnfRunning: true });
    const out = before.run('status').stdout;
    assert.match(out, /dnf-makecache\.timer（自動の下調べ）: enabled/);
    assert.match(out, /ol9_oci_included\s+enabled=1/);
    assert.match(out, /ol9_ksplice\s+enabled=1/);
    assert.match(out, /いま dnf が動いています/);
    assert.doesNotMatch(out, /ol9_baseos_latest/, 'only the big ones are listed');
    const after = sandbox({ timerState: 'masked' });
    after.run('apply');
    const out2 = after.run('status').stdout;
    assert.match(out2, /ol9_oci_included\s+enabled=0/);
    assert.match(out2, /いま dnf は動いていません/);
    assert.equal(after.run().stdout, after.run('status').stdout, 'status is what you get with no word');
  });

  it('an unknown word shows how to use it; the script uses nothing that only bash has', () => {
    const r = sandbox().run('what');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /使い方/);
    const text = readFileSync(SCRIPT, 'utf8').replace(/awk -v [^']*'[^']*'/g, 'awk X');
    assert.ok(!/\[\[ |\bdeclare\b|\bmapfile\b|<<<|\$\{[^}]*\/\/|\[ [^\]]*==/.test(text), 'no bashisms');
    assert.equal(spawnSync('sh', ['-n', SCRIPT]).status, 0);
  });
});
