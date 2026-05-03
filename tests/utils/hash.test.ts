import { describe, it, expect } from 'vitest';
import { sha256 } from '../../src/utils/hash.js';

describe('sha256', () => {
  it('produces deterministic hashes', () => {
    expect(sha256('hello')).toBe(sha256('hello'));
  });

  it('produces different hashes for different inputs', () => {
    expect(sha256('hello')).not.toBe(sha256('world'));
  });

  it('handles empty input', () => {
    expect(sha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('returns a 64-character hex string', () => {
    expect(sha256('anything')).toMatch(/^[a-f0-9]{64}$/);
  });
});
