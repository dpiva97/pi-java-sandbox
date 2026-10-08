import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const entrypoint = fileURLToPath(new URL('../pi-entrypoint.sh', import.meta.url));

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'pi-entrypoint-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = join(root, 'calls.jsonl');
  const fakePi = join(root, 'pi');
  writeFileSync(fakePi, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PI_TEST_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'install') {
  fs.readFileSync(0); // Installation may consume stdin; package iteration must not.
  process.exit(Number(process.env.PI_TEST_INSTALL_EXIT || 0));
}
process.exit(42);
`);
  chmodSync(fakePi, 0o755);
  const agentDir = join(root, 'agent home');
  const marker = join(agentDir, '.pi-sandbox-packages-installed');
  const env = {
    ...process.env, PATH: `${root}:${process.env.PATH}`, PI_TEST_LOG: log, PI_TEST_INSTALL_EXIT: '0',
    PI_CODING_AGENT_DIR: agentDir, PI_SANDBOX_REBUILD: 'false',
  };
  const run = packages => spawnSync('bash', [entrypoint, '--model', 'some model'], {
    env: { ...env, PI_SANDBOX_PACKAGES: packages }, input: 'interactive input', encoding: 'utf8',
  });
  const calls = () => readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  return { env, run, calls, marker };
}

test('installs host-resolved sources despite stdin consumption and forwards Pi arguments and status', t => {
  const f = setup(t);
  const result = f.run('npm:example\n\n# comment\n/opt/pi-packages/git/checkout');
  assert.equal(result.status, 42, result.stderr);
  assert.deepEqual(f.calls(), [
    ['install', 'npm:example'], ['install', '/opt/pi-packages/git/checkout'], ['--model', 'some model'],
  ]);
});

test('failed package installation stops before Pi starts', t => {
  const f = setup(t);
  f.env.PI_TEST_INSTALL_EXIT = '7';
  assert.equal(f.run('npm:first\nnpm:second').status, 7);
  assert.deepEqual(f.calls(), [['install', 'npm:first']]);
});

test('empty host list starts Pi without falling back to image packages', t => {
  const f = setup(t);
  assert.equal(f.run('').status, 42);
  assert.deepEqual(f.calls(), [['--model', 'some model']]);
});

test('normal launches reuse packages installed in the persistent agent directory', t => {
  const f = setup(t);
  assert.equal(f.run('npm:example\n/opt/pi-packages/git/checkout').status, 42);
  assert.ok(existsSync(f.marker));
  assert.equal(f.run('npm:example\n/opt/pi-packages/git/checkout').status, 42);
  assert.deepEqual(f.calls(), [
    ['install', 'npm:example'], ['install', '/opt/pi-packages/git/checkout'],
    ['--model', 'some model'], ['--model', 'some model'],
  ]);
});

test('rebuild reinstalls packages once; following normal launches reuse them', t => {
  const f = setup(t);
  assert.equal(f.run('npm:example').status, 42);
  f.env.PI_SANDBOX_REBUILD = 'true';
  assert.equal(f.run('npm:example').status, 42);
  f.env.PI_SANDBOX_REBUILD = 'false';
  assert.equal(f.run('npm:example').status, 42);
  assert.equal(f.calls().filter(call => call[0] === 'install').length, 2);
});

test('list changes wait for rebuild rather than triggering automatic installation', t => {
  const f = setup(t);
  assert.equal(f.run('npm:first').status, 42);
  assert.equal(f.run('npm:first\nnpm:second').status, 42);
  assert.deepEqual(f.calls().filter(call => call[0] === 'install'), [['install', 'npm:first']]);
  f.env.PI_SANDBOX_REBUILD = 'true';
  assert.equal(f.run('npm:first\nnpm:second').status, 42);
  assert.deepEqual(f.calls().filter(call => call[0] === 'install'), [
    ['install', 'npm:first'], ['install', 'npm:first'], ['install', 'npm:second'],
  ]);
});

test('failed first installation is retried on the next launch', t => {
  const f = setup(t);
  f.env.PI_TEST_INSTALL_EXIT = '7';
  assert.equal(f.run('npm:example').status, 7);
  assert.equal(existsSync(f.marker), false);
  f.env.PI_TEST_INSTALL_EXIT = '0';
  assert.equal(f.run('npm:example').status, 42);
  assert.ok(existsSync(f.marker));
});

test('failed rebuild invalidates the marker and is retried without rebuild', t => {
  const f = setup(t);
  assert.equal(f.run('npm:example').status, 42);
  f.env.PI_SANDBOX_REBUILD = 'true';
  f.env.PI_TEST_INSTALL_EXIT = '7';
  assert.equal(f.run('npm:example').status, 7);
  assert.equal(existsSync(f.marker), false);
  f.env.PI_SANDBOX_REBUILD = 'false';
  f.env.PI_TEST_INSTALL_EXIT = '0';
  assert.equal(f.run('npm:example').status, 42);
  assert.ok(existsSync(f.marker));
  assert.equal(f.calls().filter(call => call[0] === 'install').length, 3);
});
