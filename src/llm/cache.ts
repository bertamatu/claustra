import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sha256 } from '../utils/hash.js';

const cacheDir = (): string =>
  path.join(process.cwd(), 'node_modules', '.cache', 'claustra');

export const cacheGet = <T>(key: string): T | undefined => {
  const file = path.join(cacheDir(), `${sha256(key)}.json`);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as T;
};

export const cacheSet = <T>(key: string, value: T): void => {
  const dir = cacheDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sha256(key)}.json`);
  writeFileSync(file, JSON.stringify(value));
};
