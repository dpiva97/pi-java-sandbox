import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, symlinkSync, statSync, rmSync, copyFileSync } from 'node:fs';
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
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DOCKER_LOG: log, GIT_LOG: gitLog, PI_SANDBOX_DOCKER_SOCKET: socket, PI_SANDBOX_PACKAGES_DIR: skills };
  for (const key of ['INFO_EXIT', 'IMAGE_MISSING', 'BUILD_EXIT', 'RUN_EXIT', 'GIT_EXIT', 'PI_SANDBOX_SKILLS_REPO']) delete env[key];
  const launch = (args = [], executable = launcher, cwd = project) => spawnSync(executable, args, { cwd, env, encoding: 'utf8' });
  const calls = command => {
    const all = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
    return command ? all.filter(call => call[0] === command) : all;
  };
  const gitCalls = () => existsSync(gitLog) ? readFileSync(gitLog, 'utf8').trim().split('\n').map(JSON.parse) : [];
  const packageLaunch = (sources, args = []) => {
    const isolated = join(root, 'launcher repo');
    mkdirSync(isolated, { recursive: true });
    copyFileSync(launcher, join(isolated, 'pi-sandbox'));
    writeFileSync(join(isolated, 'pi-packages.txt'), sources);
    return launch(args, join(isolated, 'pi-sandbox'));
  };
  return { root, project, bin, socket, skills, env, launch, calls, gitCalls, packageLaunch };
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
  assert.ok(!run.includes('--entrypoint'));
  assert.ok(!run.some(arg => arg.includes('docker.sock') || arg.includes('TESTCONTAINERS')));
  assert.deepEqual(f.calls('build'), []);
  assert.ok(run.includes('PI_SANDBOX_REBUILD=false'));
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
  assert.ok(f.calls('run')[0].includes('PI_SANDBOX_REBUILD=true'));
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

test('--shell opens Bash with the same project, volumes and skills, without Docker access', async t => {
  const f = await setup(t);
  const result = f.launch(['--shell']);
  assert.equal(result.status, 0, result.stderr);
  const run = f.calls('run')[0];
  assert.equal(run[run.indexOf('--entrypoint') + 1], '/bin/bash');
  assert.equal(run.at(-1), 'pi-java-sandbox');
  for (const flag of ['--rm', '-it', '--init']) assert.ok(run.includes(flag));
  assert.ok(run.includes(`type=bind,source=${f.project},target=${f.project}`));
  assert.equal(run[run.indexOf('--workdir') + 1], f.project);
  assert.ok(run.includes('type=volume,source=pi-agent-home,target=/home/node/.pi/agent'));
  assert.ok(run.includes('type=volume,source=pi-maven-cache,target=/home/node/.m2'));
  assert.ok(!run.some(arg => arg.includes('docker.sock') || arg.includes('TESTCONTAINERS')));
});

test('--shell combines with --docker and --rebuild', async t => {
  const f = await setup(t);
  const result = f.launch(['--shell', '--docker', '--rebuild']);
  assert.equal(result.status, 0, result.stderr);
  const run = f.calls('run')[0];
  assert.equal(run[run.indexOf('--entrypoint') + 1], '/bin/bash');
  assert.ok(run.includes(`type=bind,source=${f.socket},target=/var/run/docker.sock`));
  assert.ok(run.includes('--group-add'));
  assert.ok(run.includes('TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal'));
  assert.ok(f.calls('build')[0].includes('--no-cache'));
});

test('--shell forwards Bash arguments unchanged after -- and preserves exit status', async t => {
  const f = await setup(t);
  f.env.RUN_EXIT = '42';
  const result = f.launch(['--shell', '--', '-c', 'exit 42']);
  assert.equal(result.status, 42);
  assert.deepEqual(f.calls('run')[0].slice(-5), ['--entrypoint', '/bin/bash', 'pi-java-sandbox', '-c', 'exit 42']);
});

test('--shell after -- is forwarded to pi, not interpreted by the launcher', async t => {
  const f = await setup(t);
  assert.equal(f.launch(['--', '--shell']).status, 0);
  const run = f.calls('run')[0];
  assert.ok(!run.includes('--entrypoint'));
  assert.deepEqual(run.slice(-2), ['pi-java-sandbox', '--shell']);
});

test('--add-dir is repeatable and resolves relative paths with spaces', async t => {
  const f = await setup(t);
  const first = join(f.root, 'shared library');
  const second = join(f.root, 'other app');
  mkdirSync(first);
  mkdirSync(second);
  const result = f.launch(['--add-dir', '../shared library', `--add-dir=${second}`]);
  assert.equal(result.status, 0, result.stderr);
  const run = f.calls('run')[0];
  for (const dir of [f.project, first, second]) {
    assert.ok(run.includes(`type=bind,source=${dir},target=${dir}`));
  }
  assert.equal(run[run.indexOf('--workdir') + 1], f.project);
});

test('--add-dir resolves symlinks and mounts duplicate directories only once', async t => {
  const f = await setup(t);
  const dir = join(f.root, 'library');
  const link = join(f.root, 'library link');
  mkdirSync(dir);
  symlinkSync(dir, link);
  const result = f.launch(['--add-dir', dir, '--add-dir', link, '--add-dir', '.']);
  assert.equal(result.status, 0, result.stderr);
  const run = f.calls('run')[0];
  for (const path of [f.project, dir]) {
    assert.equal(run.filter(arg => arg === `type=bind,source=${path},target=${path}`).length, 1);
  }
  assert.ok(!run.some(arg => arg.includes(link)));
});

test('--add-dir combines with shell, Docker, rebuild and argument forwarding', async t => {
  const f = await setup(t);
  const dir = join(f.root, 'library');
  mkdirSync(dir);
  const result = f.launch(['--add-dir', dir, '--shell', '--docker', '--rebuild', '--', '-c', 'pwd']);
  assert.equal(result.status, 0, result.stderr);
  const run = f.calls('run')[0];
  assert.ok(run.includes(`type=bind,source=${dir},target=${dir}`));
  assert.ok(run.includes(`type=bind,source=${f.socket},target=/var/run/docker.sock`));
  assert.deepEqual(run.slice(-5), ['--entrypoint', '/bin/bash', 'pi-java-sandbox', '-c', 'pwd']);
  assert.ok(f.calls('build')[0].includes('--no-cache'));
});

test('--add-dir rejects missing or empty values before Docker or Git operations', async t => {
  const f = await setup(t);
  for (const args of [['--add-dir'], ['--add-dir', ''], ['--add-dir='], ['--add-dir', '--shell'], ['--add-dir', '--']]) {
    const result = f.launch(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--add-dir requires a directory path/);
  }
  assert.deepEqual(f.calls(), []);
  assert.deepEqual(f.gitCalls(), []);
});

test('--add-dir rejects nonexistent paths, files and commas before Docker or Git operations', async t => {
  const f = await setup(t);
  const file = join(f.root, 'file');
  writeFileSync(file, 'not a directory');
  const commaDir = join(f.root, 'library,readonly');
  mkdirSync(commaDir);
  const link = join(f.root, 'comma link');
  symlinkSync(commaDir, link);
  for (const path of [join(f.root, 'missing'), file, commaDir, link]) {
    const result = f.launch(['--add-dir', path]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /directory|commas/);
  }
  assert.deepEqual(f.calls(), []);
  assert.deepEqual(f.gitCalls(), []);
});

test('--add-dir after -- is forwarded to pi without mounting the argument', async t => {
  const f = await setup(t);
  assert.equal(f.launch(['--', '--add-dir', '/nonexistent']).status, 0);
  assert.deepEqual(f.calls('run')[0].slice(-3), ['pi-java-sandbox', '--add-dir', '/nonexistent']);
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
  assert.match(result.stdout, /--shell/);
  assert.match(result.stdout, /--add-dir/);
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


test('Git packages clone once on the host and are installed through stable local paths', async t => {
  const f = await setup(t);
  const sources = '# packages\nnpm:example\nhttps://git.example/team/skills.git\nhttps://git.example/team/skills.git';
  assert.equal(f.packageLaunch(sources).status, 0);
  assert.equal(f.packageLaunch(sources).status, 0);
  assert.equal(f.gitCalls().length, 1);
  assert.deepEqual(f.gitCalls()[0].slice(0, 3), ['clone', '--', 'https://git.example/team/skills.git']);
  const runs = f.calls('run');
  const mount = runs[0].find(arg => arg.includes('target=/opt/pi-packages/git/'));
  assert.ok(mount.endsWith(',readonly'));
  assert.ok(mount.includes(`source=${f.skills}/`));
  assert.ok(runs[1].includes(mount));
  const packages = runs[0].find(arg => arg.startsWith('PI_SANDBOX_PACKAGES='));
  assert.match(packages, /^PI_SANDBOX_PACKAGES=npm:example\n\/opt\/pi-packages\/git\/[a-f0-9]{64}\n$/);
  assert.ok(!packages.includes('https://'));
});

test('rebuild updates unpinned host checkouts with fast-forward only', async t => {
  const f = await setup(t);
  assert.equal(f.launch().status, 0);
  assert.equal(f.launch(['--rebuild']).status, 0);
  const checkout = f.gitCalls()[0].at(-1);
  assert.deepEqual(f.gitCalls()[1], ['-C', checkout, 'pull', '--ff-only']);
});

test('SSH and Pi Git syntax use host authentication and support pinned refs', async t => {
  const f = await setup(t);
  const sources = 'git@git.example:team/skills.git\ngit:git.example/team/other@v1';
  assert.equal(f.packageLaunch(sources).status, 0);
  const calls = f.gitCalls();
  assert.equal(calls[0][2], 'git@git.example:team/skills.git');
  assert.equal(calls[1][2], 'https://git.example/team/other');
  assert.deepEqual(calls[2], ['-C', calls[1].at(-1), 'checkout', '--detach', 'v1']);
  assert.equal(f.packageLaunch(sources).status, 0);
  assert.deepEqual(f.gitCalls(), calls); // No fetch, pull or checkout on ordinary launches.
  assert.equal(f.packageLaunch(sources, ['--rebuild']).status, 0);
  assert.ok(f.gitCalls().some(call => call[2] === 'fetch' && call[3] === 'origin'));
});

test('host clone or update failures stop before building or running', async t => {
  const f = await setup(t);
  f.env.GIT_EXIT = '1';
  const failedClone = f.launch();
  assert.notEqual(failedClone.status, 0);
  assert.match(failedClone.stderr, /authentication on the host/);
  assert.deepEqual(f.calls('run'), []);
  f.env.GIT_EXIT = '0';
  assert.equal(f.launch().status, 0);
  f.env.GIT_EXIT = '1';
  assert.notEqual(f.launch(['--rebuild']).status, 0);
  assert.deepEqual(f.calls('build'), []);
  assert.equal(f.calls('run').length, 1);
});

test('npm-only lists do not invoke Git', async t => {
  const f = await setup(t);
  assert.equal(f.packageLaunch('npm:example').status, 0);
  assert.deepEqual(f.gitCalls(), []);
  assert.ok(f.calls('run')[0].includes('PI_SANDBOX_PACKAGES=npm:example\n'));
});

test('invalid package cache paths stop before clone or container launch', async t => {
  const f = await setup(t);
  for (const path of ['relative/cache', join(f.root, 'cache,readonly')]) {
    f.env.PI_SANDBOX_PACKAGES_DIR = path;
    assert.notEqual(f.launch().status, 0);
  }
  assert.deepEqual(f.gitCalls(), []);
  assert.deepEqual(f.calls('run'), []);
});
