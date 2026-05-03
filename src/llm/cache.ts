import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sha256 } from '../utils/hash.js';

const CACHE_DIR = path.join(process.cwd(), 'node_modules', '.cache', 'claustra');

const ensureCacheDir = () => {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
};

export const cacheGet = <T>(key: string): T | undefined => {
  const file = path.join(CACHE_DIR, `${sha256(key)}.json`);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as T;
};

export const cacheSet = <T>(key: string, value: T): void => {
  ensureCacheDir();
  const file = path.join(CACHE_DIR, `${sha256(key)}.json`);
  writeFileSync(file, JSON.stringify(value));
};
