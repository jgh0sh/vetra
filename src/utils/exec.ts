import { spawn } from 'node:child_process';

export interface ExecOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  stdin?: string;
}

export interface ExecResult {
  cmd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export async function execCommand(command: string, args: string[], options: ExecOptions): Promise<ExecResult> {
  const startedAt = Date.now();

  return await new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (err) => reject(err));

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();

    let timeout: NodeJS.Timeout | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        child.kill('SIGKILL');
      }, options.timeoutMs);
    }

    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      const durationMs = Date.now() - startedAt;
      resolve({
        cmd: `${command} ${args.join(' ')}`.trim(),
        exitCode: code ?? 0,
        stdout,
        stderr,
        durationMs
      });
    });
  });
}

export async function execShell(command: string, options: ExecOptions): Promise<ExecResult> {
  const startedAt = Date.now();

  return await new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(command, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (err) => reject(err));

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();

    let timeout: NodeJS.Timeout | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        child.kill('SIGKILL');
      }, options.timeoutMs);
    }

    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      const durationMs = Date.now() - startedAt;
      resolve({
        cmd: command,
        exitCode: code ?? 0,
        stdout,
        stderr,
        durationMs
      });
    });
  });
}
