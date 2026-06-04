import { describe, it, expect } from 'vitest';
import { CONTRACT_VERSION } from './index';

describe('@cece/contract', () => {
  it('exposes the API version', () => {
    expect(CONTRACT_VERSION).toBe('v1');
  });
});
