import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const installer = fileURLToPath(new URL('../install.sh', import.meta.url));
const launcher = fileURLToPath(new URL('../pi-sandbox', import.meta.url));

function setup(t) {
  const home = mkdtempSync(join(tmpdir(), 'pi install '));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bin = join(home, '.local', 'bin');
  const target = join(bin, 'pi-sandbox');
  const env = { ...process.env, HOME: home };
  const install = (executable = installer, args = []) => {
    const result = spawnSync(executable, args, { env, cwd: home, encoding: 'utf8' });
    assert.ifError(result.error);
    return result;
  };
  return { home, bin, target, env, install };
}

test('installs a working absolute symlink from any directory, including paths with spaces', t => {
  const f = setup(t);
  const result = f.install();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readlinkSync(f.target), launcher);
  const help = spawnSync(f.target, ['--help'], { env: f.env, encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--docker/);
});

test('install is idempotent', t => {
  const f = setup(t);
  assert.equal(f.install().status, 0);
  assert.equal(f.install().status, 0);
  assert.equal(readlinkSync(f.target), launcher);
});

test('does not overwrite an existing command', t => {
  const f = setup(t);
  mkdirSync(f.bin, { recursive: true });
  writeFileSync(f.target, 'keep me');
  const result = f.install();
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(f.target, 'utf8'), 'keep me');
  assert.match(result.stderr, /already exists/);
});

test('does not replace a different or dangling symlink', t => {
  const f = setup(t);
  mkdirSync(f.bin, { recursive: true });
  const other = join(f.home, 'missing-launcher');
  symlinkSync(other, f.target);
  assert.notEqual(f.install().status, 0);
  assert.equal(readlinkSync(f.target), other);
});

test('prints PATH instructions but leaves shell configuration unchanged', t => {
  const f = setup(t);
  const bashrc = join(f.home, '.bashrc');
  writeFileSync(bashrc, '# my config\n');
  const result = f.install();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /export PATH=/);
  assert.equal(readFileSync(bashrc, 'utf8'), '# my config\n');
});

test('does not print PATH instructions when bin is already in PATH', t => {
  const f = setup(t);
  f.env.PATH = `${f.bin}:${f.env.PATH}`;
  const result = f.install();
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /export PATH=/);
});

test('resolves the repository when the installer itself is a symlink', t => {
  const f = setup(t);
  const link = join(f.home, 'install-link');
  symlinkSync(installer, link);
  assert.equal(f.install(link).status, 0);
  assert.equal(readlinkSync(f.target), launcher);
});

test('help and invalid options do not install anything', t => {
  const f = setup(t);
  assert.equal(f.install(installer, ['--help']).status, 0);
  assert.notEqual(f.install(installer, ['--unknown']).status, 0);
  assert.equal(existsSync(f.target), false);
});
