import { readFile } from 'node:fs/promises';

export async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return undefined;
    throw err;
  }
}

export async function readJsonIfExists<T>(path: string): Promise<T | undefined> {
  const text = await readTextIfExists(path);
  if (!text) return undefined;
  return JSON.parse(text) as T;
}

