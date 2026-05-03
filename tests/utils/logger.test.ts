import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger } from '../../src/utils/logger.js';

describe('logger', () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  afterEach(() => errorSpy.mockClear());

  it('info writes to stderr with [claustra] prefix', () => {
    logger.info('hello');
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0]?.[0]).toContain('[claustra] hello');
  });

  it('warn writes to stderr', () => {
    logger.warn('careful');
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0]?.[0]).toContain('careful');
  });

  it('error writes to stderr', () => {
    logger.error('boom');
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0]?.[0]).toContain('boom');
  });
});
