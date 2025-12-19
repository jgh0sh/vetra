#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function formatTimestampForFilename(date) {
  const pad2 = (n) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    '_',
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
  ].join('');
}

function resolveLogFile() {
  if (process.env.VETRA_DEMO_LOG_FILE && process.env.VETRA_DEMO_LOG_FILE.trim().length > 0) {
    return path.resolve(process.cwd(), process.env.VETRA_DEMO_LOG_FILE);
  }
  const stamp = formatTimestampForFilename(new Date());
  return path.resolve(process.cwd(), `vetra-demo_${stamp}.log`);
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runProcess({ label, command, args, cwd, env, logStream }) {
  return new Promise((resolve, reject) => {
    logStream.write(`\n${'='.repeat(80)}\n${label}\n${'='.repeat(80)}\n`);

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      logStream.write(chunk);
    });

    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      logStream.write(chunk);
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code, signal) => {
      if (code === 0) return resolve({ code: 0 });
      const err = new Error(`${label} failed (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
      err.code = code ?? 1;
      reject(err);
    });
  });
}

async function main() {
  const logFile = resolveLogFile();
  const logStream = fs.createWriteStream(logFile, { flags: 'w' });

  const env = { ...process.env };

  logStream.write(
    [
      `timestamp=${new Date().toISOString()}`,
      `cwd=${process.cwd()}`,
      `node=${process.version}`,
      `platform=${process.platform}`,
      `arch=${process.arch}`,
      '',
    ].join('\n'),
  );

  try {
    await runProcess({
      label: 'PHASE: build',
      command: npmCommand(),
      args: ['run', 'build'],
      cwd: process.cwd(),
      env,
      logStream,
    });

    await runProcess({
      label: 'PHASE: demo',
      command: process.execPath,
      args: ['dist/scripts/demo.js'],
      cwd: process.cwd(),
      env,
      logStream,
    });

    process.stdout.write(`\nWrote demo output to ${path.relative(process.cwd(), logFile)}\n`);
  } finally {
    await new Promise((resolve) => logStream.end(resolve));
  }
}

main().catch((err) => {
  const code = typeof err?.code === 'number' ? err.code : 1;
  process.stderr.write(`\nERROR: ${err?.message ?? String(err)}\n`);
  process.stderr.write(`(demo log written to file; see current directory)\n`);
  process.exit(code);
});

