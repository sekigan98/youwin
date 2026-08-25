import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPlanById,
  hasActiveEntitlement,
  isAgencyExpired,
  isWithinPlanLimit
} from '../src/lib/pricing.js';

test('un plan pago vencido pierde el entitlement', () => {
  const expired = { status: 'active', plan: 'pro', expiresAt: '2025-01-01T00:00:00.000Z' };
  assert.equal(isAgencyExpired(expired, new Date('2026-01-01T00:00:00.000Z')), true);
  assert.equal(hasActiveEntitlement(expired), false);
});

test('los límites se aplican antes de crear el recurso siguiente', () => {
  assert.equal(isWithinPlanLimit(0, 1), true);
  assert.equal(isWithinPlanLimit(1, 1), false);
  assert.equal(isWithinPlanLimit(500, null), true);
  assert.equal(getPlanById('premium').id, 'agency');
});

test('el constructor de landings se habilita únicamente en planes pagos', () => {
  assert.equal(getPlanById('free').capabilities.canBuildLandings, false);
  for (const planId of ['starter', 'pro', 'agency', 'enterprise']) {
    assert.equal(getPlanById(planId).capabilities.canBuildLandings, true);
  }
});
