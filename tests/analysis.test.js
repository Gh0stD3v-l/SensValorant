import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBlockPlan, spawn, targetAt, hitTest, wrap, visibleAt } from '../js/targets.js';
import { trialMetrics, diagnose, resample, sensTendency } from '../js/analysis.js';

function seeded(seed = 1) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

test('bloco tem todos os tipos de alvo', () => {
  const plan = makeBlockPlan(seeded(3));
  const types = plan.map((s) => s.type).sort();
  assert.deepEqual(types, ['flick', 'flick', 'micro', 'micro', 'peek', 'strafe', 'strafe', 'turn']);
});

test('acerto na cabeça, no corpo e erro', () => {
  const pos = { yaw: 10, pitch: 0 };
  assert.equal(hitTest(pos, 0.5, 10.3, 0.2), 'head');
  assert.equal(hitTest(pos, 0.5, 10, -2), 'body');
  assert.equal(hitTest(pos, 0.5, 13, 0), null);
  assert.equal(wrap(350), -10);
});

test('strafe anda e peek some', () => {
  const plan = makeBlockPlan(seeded(5));
  const s = spawn(plan.find((p) => p.type === 'strafe'), 0, 0);
  assert.notEqual(targetAt(s, 0).yaw, targetAt(s, 600).yaw);
  const p = spawn(plan.find((x) => x.type === 'peek'), 0, 0);
  assert.ok(visibleAt(p, 500));
  assert.ok(!visibleAt(p, 1500));
});

/** Gera um flick sintético: vai até `reach` × distância e depois corrige até o alvo. */
function fakeFlick(dist, reach, { clickWhileMoving = false } = {}) {
  const target = { spec: { type: 'flick', head: 0.75 }, yaw0: dist, pitch0: 0 };
  const path = [];
  for (let t = 0; t <= 600; t += 5) {
    let y;
    if (t < 150) y = 0;
    else if (t < 350) y = dist * reach * (1 - Math.cos(((t - 150) / 200) * Math.PI)) / 2;
    else if (t < 420) y = dist * reach;
    else y = dist * reach + (dist - dist * reach) * Math.min(1, (t - 420) / 120);
    path.push([t, y, 0]);
  }
  const clicks = clickWhileMoving ? [[250, path[50][1], 0, 'miss'], [600, dist, 0, 'head']] : [[600, dist, 0, 'head']];
  return { type: 'flick', dist, radius: 0.75, time: 0.6, hit: true, misses: clickWhileMoving ? 1 : 0, body: 0, overshoot: Math.max(0, dist * reach - dist - 0.75), path, clicks, target, startYaw: 0, startPitch: 0 };
}

test('métricas: reação, overshoot e correções', () => {
  const m = trialMetrics(fakeFlick(30, 1.25));
  assert.ok(m.reactionMs >= 150 && m.reactionMs < 200, `reação ${m.reactionMs}`);
  assert.ok(m.endpoint.alongPct > 0.15, `along ${m.endpoint.alongPct}`);
  const u = trialMetrics(fakeFlick(30, 0.6));
  assert.ok(u.endpoint.alongPct < -0.3);
  assert.ok(u.corrections >= 1);
  assert.equal(resample([[0, 0, 0], [20, 2, 0]], 10).length, 3);
});

test('diagnóstico detecta overshoot e tiro em movimento', () => {
  const over = Array.from({ length: 5 }, () => fakeFlick(30, 1.3, { clickWhileMoving: true }));
  const d = diagnose(over);
  const ids = d.map((x) => x.id);
  assert.ok(ids.includes('overshoot'), ids.join());
  assert.ok(ids.includes('clickmoving'), ids.join());
  assert.ok(sensTendency(d) < 0);
  const under = Array.from({ length: 5 }, () => fakeFlick(30, 0.55));
  assert.ok(diagnose(under).some((x) => x.id === 'undershoot'));
});
