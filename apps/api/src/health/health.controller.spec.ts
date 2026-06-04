import { describe, it, expect } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports ok with the API version', () => {
    const controller = new HealthController();
    expect(controller.check()).toEqual({ status: 'ok', apiVersion: 'v1' });
  });
});
