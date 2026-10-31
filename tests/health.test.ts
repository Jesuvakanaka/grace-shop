import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as healthRoute from '../src/app/api/health/route';

describe('GET /api/health (Cloud Run startup/liveness probe)', () => {
  test('returns 200 with {"status":"ok"}', async () => {
    const res = await healthRoute.GET();
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { status: 'ok' });
  });

  test('is never cached', async () => {
    const res = await healthRoute.GET();
    assert.match(res.headers.get('cache-control') ?? '', /no-store/);
    assert.strictEqual(healthRoute.dynamic, 'force-dynamic');
  });

  test('needs no request (no auth, no DB, no request data)', () => {
    assert.strictEqual(healthRoute.GET.length, 0);
  });
});
