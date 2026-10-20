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

test('detecção nova: flick torto, hesitação, lado, posicionamento e confiança', async () => {
  const { sensTrends, sessionTrend } = await import('../js/analysis.js');
  // Flick com arco vertical e mira parada na cabeça 300 ms antes do clique.
  const mk = (dist, side, { arc = 0, wait = 0, startPitch = 0, sens = 0.3, reach = 1, at = 0 } = {}) => {
    const target = { spec: { type: 'flick', head: 0.75, height: 0 }, yaw0: side * dist, pitch0: 0 };
    const path = [];
    let t = 0;
    for (; t <= 400; t += 5) {
      const k = t < 100 ? 0 : Math.min(1, (t - 100) / 250);
      const e = (1 - Math.cos(k * Math.PI)) / 2;
      path.push([t, side * dist * reach * e, startPitch * (1 - e) + arc * Math.sin(e * Math.PI)]);
    }
    for (; t <= 400 + wait; t += 5) path.push([t, side * dist * reach, 0]);
    return { type: 'flick', dist, radius: 0.75, time: (400 + wait) / 1000, hit: true, misses: 0, body: 0, overshoot: 0, path, clicks: [[400 + wait, side * dist * reach, 0, 'head']], target, startYaw: 0, startPitch, sens, at };
  };
  const trials = [
    ...Array.from({ length: 4 }, () => mk(30, 1, { arc: 5, wait: 300, startPitch: 4 })),
    ...Array.from({ length: 4 }, () => mk(30, -1, { arc: 5, wait: 300, startPitch: 4 })),
  ];
  const ids = diagnose(trials).map((d) => d.id);
  for (const id of ['curve', 'hesitation', 'placement']) assert.ok(ids.includes(id), `${id} em ${ids}`);
  for (const d of diagnose(trials)) assert.ok(['alta', 'média'].includes(d.confidence));

  // Tendência: passar do alvo cresce com a sens.
  const trend = [];
  for (const [sens, reach] of [[0.25, 0.9], [0.3, 1.0], [0.35, 1.2], [0.4, 1.35]]) {
    for (let i = 0; i < 5; i++) trend.push(mk(30, 1, { sens, reach }));
  }
  const tr = sensTrends(trend);
  const over = tr.find((x) => x.id === 'overshoot');
  assert.ok(over && over.delta > 15, JSON.stringify(tr));
  assert.equal(sessionTrend(trend.slice(0, 5)), null);
});

test('estilo de mira pelos centímetros: levantadas e eficiência', async () => {
  const { movementProfile, countLifts, cmFor } = await import('../js/analysis.js');
  // 800 DPI, sens 0,4 (eDPI 320, 40,8 cm/360): 90° ≈ 10,2 cm
  assert.ok(Math.abs(cmFor(90, 0.4, 800) - 10.2) < 0.05);
  const mk = (dist, time, lift = false, sens = 0.4) => {
    const target = { spec: { type: dist > 60 ? 'turn' : 'flick', head: 0.75 }, yaw0: dist, pitch0: 0 };
    const path = [];
    const T = time * 1000;
    for (let t = 0; t <= T; t += 5) {
      let k = Math.min(1, t / (T * 0.8));
      if (lift) {
        // anda até 45%, para 120 ms no ar e continua
        const t1 = T * 0.35, t2 = t1 + 120;
        k = t < t1 ? 0.45 * (t / t1) : t < t2 ? 0.45 : 0.45 + 0.55 * Math.min(1, (t - t2) / (T * 0.8 - t2));
      }
      path.push([t, dist * k, 0]);
    }
    return { type: target.spec.type, dist, radius: 0.75, time, hit: true, misses: 0, body: 0, overshoot: 0, path, clicks: [[T, dist, 0, 'head']], target, startYaw: 0, startPitch: 0, sens };
  };
  assert.equal(countLifts(mk(120, 0.9, true)), 1);
  assert.equal(countLifts(mk(120, 0.9)), 0);
  // Pulso: viradas longas com levantada.
  const wrist = [...Array.from({ length: 4 }, () => mk(20, 0.35)), ...Array.from({ length: 4 }, () => mk(120, 1.2, true))];
  assert.equal(movementProfile(wrist, 800).style, 'pulso');
  // Braço: viradas longas lisas e rápidas.
  // Braço: viradas de ~18 cm (sens 0,3) lisas e rápidas.
  const arm = [...Array.from({ length: 4 }, () => mk(20, 0.35, false, 0.3)), ...Array.from({ length: 4 }, () => mk(120, 0.55, false, 0.3))];
  const pa = movementProfile(arm, 800);
  assert.equal(pa.style, 'braco', JSON.stringify(pa));
  // Bom nos longos, mas nenhum passa de 15 cm: ainda não dá para afirmar.
  assert.equal(movementProfile([...Array.from({ length: 4 }, () => mk(20, 0.35)), ...Array.from({ length: 4 }, () => mk(120, 0.55))], 800).style, null);
});

test('pegada ajusta o ponto de partida', async () => {
  const V = await import('../js/valorant.js');
  const base = V.suggestStart({ dpi: 800, style: 'misto', padWidthCm: 45, role: 'flex' });
  const ft = V.suggestStart({ dpi: 800, style: 'misto', grip: 'fingertip', padWidthCm: 45, role: 'flex' });
  const palm = V.suggestStart({ dpi: 800, style: 'misto', grip: 'palm', padWidthCm: 45, role: 'flex' });
  assert.ok(ft.edpi > base.edpi && palm.edpi < base.edpi);
});
