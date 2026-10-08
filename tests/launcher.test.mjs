import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, symlinkSync, statSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repo = fileURLToPath(new URL('..', import.meta.url));
const launcher = resolve(repo, 'pi-sandbox');

async function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'pi-launcher-'));
  const project = join(root, 'my spring app');
  const bin = join(root, 'bin');
  const log = join(root, 'docker.jsonl');
  const socket = join(root, 'docker.sock');
  mkdirSync(project);
  mkdirSync(bin);
  const docker = join(bin, 'docker');
  writeFileSync(docker, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_LOG, JSON.stringify(args) + '\\n');
const key = args[0] === 'info' ? 'INFO_EXIT'
  : args[0] === 'image' ? 'IMAGE_MISSING'
  : args[0] === 'build' ? 'BUILD_EXIT' : 'RUN_EXIT';
process.exit(Number(process.env[key] || 0));
`);
  chmodSync(docker, 0o755);
  const gitLog = join(root, 'git.jsonl');
  const git = join(bin, 'git');
  writeFileSync(git, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GIT_LOG, JSON.stringify(args) + '\\n');
const exit = Number(process.env.GIT_EXIT || 0);
if (!exit && args[0] === 'clone') fs.mkdirSync(path.join(args.at(-1), '.git'), { recursive: true });
process.exit(exit);
`);
  chmodSync(git, 0o755);
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socket, resolve);
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  });
  const skills = join(root, 'shared skills');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DOCKER_LOG: log, GIT_LOG: gitLog, PI_SANDBOX_DOCKER_SOCKET: socket, PI_SANDBOX_SKILLS_DIR: skills };
  for (const key of ['INFO_EXIT', 'IMAGE_MISSING', 'BUILD_EXIT', 'RUN_EXIT', 'GIT_EXIT', 'PI_SANDBOX_SKILLS_REPO']) delete env[key];
  const launch = (args = [], executable = launcher, cwd = project) => spawnSync(executable, args, { cwd, env, encoding: 'utf8' });
  const calls = command => {
    const all = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
    return command ? all.filter(call => call[0] === command) : all;
  };
  const gitCalls = () => existsSync(gitLog) ? readFileSync(gitLog, 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { root, project, bin, socket, skills, env, launch, calls, gitCalls };
}

// Process-boundary fakes prevent real Git/network and Docker operations.
test('default: new disposable container, shared volumes, project cwd, no Docker socket', async t => {
  const f = await setup(t);
  const result = f.launch();
  assert.equal(result.status, 0, result.stderr || String(result.error));
  const run = f.calls('run')[0];
  for (const flag of ['--rm', '-it', '--init']) assert.ok(run.includes(flag));
  assert.ok(run.includes(`type=bind,source=${f.project},target=${f.project}`));
  assert.equal(run[run.indexOf('--workdir') + 1], f.project);
  assert.ok(run.includes('type=volume,source=pi-agent-home,target=/home/node/.pi/agent'));
  assert.ok(run.includes('type=volume,source=pi-maven-cache,target=/home/node/.m2'));
  assert.ok(!run.includes('--group-add'));
  assert.ok(!run.some(arg => arg.includes('docker.sock') || arg.includes('TESTCONTAINERS')));
  assert.deepEqual(f.calls('build'), []);
});

test('each invocation runs a new container without a fixed name', async t => {
  const f = await setup(t);
  assert.equal(f.launch().status, 0);
  assert.equal(f.launch().status, 0);
  assert.equal(f.calls('run').length, 2);
  assert.ok(f.calls('run').every(call => !call.includes('--name')));
});

test('missing image is built from the repository, not the project', async t => {
  const f = await setup(t);
  f.env.IMAGE_MISSING = '1';
  const result = f.launch();
  assert.equal(result.status, 0, result.stderr);
  const build = f.calls('build')[0];
  assert.equal(build.at(-1), resolve(repo));
  assert.ok(build.includes('pi-java-sandbox'));
  assert.equal(f.calls('run').length, 1);
});

test('--rebuild refreshes an existing image before running', async t => {
  const f = await setup(t);
  assert.equal(f.launch(['--rebuild']).status, 0);
  const build = f.calls('build')[0];
  assert.ok(build.includes('--no-cache'));
  assert.ok(build.includes('--pull'));
  assert.ok(f.calls().findIndex(call => call[0] === 'build') < f.calls().findIndex(call => call[0] === 'run'));
});

test('--docker adds socket group, Desktop host override and warning; flags combine', async t => {
  const f = await setup(t);
  const result = f.launch(['--docker', '--rebuild']);
  assert.equal(result.status, 0, result.stderr);
  const run = f.calls('run')[0];
  assert.ok(run.includes(`type=bind,source=${f.socket},target=/var/run/docker.sock`));
  assert.equal(run[run.indexOf('--group-add') + 1], String(statSync(f.socket).gid));
  assert.ok(run.includes('TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal'));
  assert.match(result.stderr, /WARNING/);
});

test('--docker rejects a missing socket before building or running', async t => {
  const f = await setup(t);
  f.env.PI_SANDBOX_DOCKER_SOCKET = join(f.root, 'missing.sock');
  const result = f.launch(['--docker', '--rebuild']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /socket/);
  assert.deepEqual(f.calls('build'), []);
  assert.deepEqual(f.calls('run'), []);
});

test('without --docker no socket is required', async t => {
  const f = await setup(t);
  f.env.PI_SANDBOX_DOCKER_SOCKET = join(f.root, 'missing.sock');
  assert.equal(f.launch().status, 0);
});

test('help and unknown options do not call Docker', async t => {
  const f = await setup(t);
  const result = f.launch(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--docker/);
  assert.notEqual(f.launch(['--unknown']).status, 0);
  assert.deepEqual(f.calls(), []);
});

test('pi arguments are forwarded unchanged after --', async t => {
  const f = await setup(t);
  assert.equal(f.launch(['--', '--model', 'some model', 'a prompt']).status, 0);
  assert.deepEqual(f.calls('run')[0].slice(-4), ['pi-java-sandbox', '--model', 'some model', 'a prompt']);
});

test('symlink installation preserves the repository build context', async t => {
  const f = await setup(t);
  const link = join(f.bin, 'pi-sandbox');
  symlinkSync(launcher, link);
  assert.equal(f.launch(['--rebuild'], link).status, 0);
  assert.equal(f.calls('build')[0].at(-1), resolve(repo));
});

test('failed rebuild never runs the old image', async t => {
  const f = await setup(t);
  f.env.BUILD_EXIT = '23';
  assert.equal(f.launch(['--rebuild']).status, 23);
  assert.deepEqual(f.calls('run'), []);
});

test('daemon failure is reported without building or running', async t => {
  const f = await setup(t);
  f.env.INFO_EXIT = '1';
  const result = f.launch();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Docker/);
  assert.deepEqual(f.calls('build'), []);
  assert.deepEqual(f.calls('run'), []);
});

test('container exit status is preserved', async t => {
  const f = await setup(t);
  f.env.RUN_EXIT = '42';
  assert.equal(f.launch().status, 42);
});

test('commas in project paths cannot inject mount options', async t => {
  const f = await setup(t);
  const project = join(f.root, 'project,readonly');
  mkdirSync(project);
  assert.notEqual(f.launch([], launcher, project).status, 0);
  assert.deepEqual(f.calls('run'), []);
});

test('clones shared skills once on the host and mounts them read-only outside the Pi volume', async t => {
  const f = await setup(t);
  assert.equal(f.launch().status, 0);
  assert.equal(f.launch().status, 0);
  assert.deepEqual(f.gitCalls(), [['clone', '--', 'https://gitlab.intesys.it/davide.piva/skills.git', f.skills]]);
  for (const run of f.calls('run')) {
    assert.ok(run.includes(`type=bind,source=${f.skills},target=/home/node/.agents/skills/intesys,readonly`));
  }
});

test('--rebuild updates an existing skills checkout with fast-forward only', async t => {
  const f = await setup(t);
  assert.equal(f.launch().status, 0);
  assert.equal(f.launch(['--rebuild']).status, 0);
  assert.deepEqual(f.gitCalls()[1], ['-C', f.skills, 'pull', '--ff-only']);
});

test('supports an SSH skills repository using host authentication', async t => {
  const f = await setup(t);
  f.env.PI_SANDBOX_SKILLS_REPO = 'git@gitlab.intesys.it:davide.piva/skills.git';
  assert.equal(f.launch().status, 0);
  assert.equal(f.gitCalls()[0][2], f.env.PI_SANDBOX_SKILLS_REPO);
});

test('clone failure reports authentication setup and never builds or runs', async t => {
  const f = await setup(t);
  f.env.GIT_EXIT = '1';
  const result = f.launch();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /authentication/);
  assert.deepEqual(f.calls('build'), []);
  assert.deepEqual(f.calls('run'), []);
});

test('failed skills update never builds or runs a new container', async t => {
  const f = await setup(t);
  assert.equal(f.launch().status, 0);
  f.env.GIT_EXIT = '1';
  const result = f.launch(['--rebuild']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Skills update failed/);
  assert.deepEqual(f.calls('build'), []);
  assert.equal(f.calls('run').length, 1);
});

test('rejects invalid skills paths without cloning or running', async t => {
  const f = await setup(t);
  for (const path of ['relative/skills', join(f.root, 'skills,readonly')]) {
    f.env.PI_SANDBOX_SKILLS_DIR = path;
    assert.notEqual(f.launch().status, 0);
  }
  assert.deepEqual(f.gitCalls(), []);
  assert.deepEqual(f.calls('run'), []);
});

test('does not overwrite an existing non-checkout skills directory', async t => {
  const f = await setup(t);
  mkdirSync(f.skills);
  const result = f.launch();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a Git checkout/);
  assert.deepEqual(f.gitCalls(), []);
  assert.deepEqual(f.calls('run'), []);
});
