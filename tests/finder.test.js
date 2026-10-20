import test from 'node:test';
import assert from 'node:assert/strict';
import { SensFinder } from '../js/finder.js';
import { summarize, compare, throughput } from '../js/scoring.js';

/** Simula um jogador que sempre escolhe a sens mais perto da ideal dele. */
function runTo(ideal, start, extra = {}) {
  const f = new SensFinder({ startSens: start, dpi: 800, ...extra });
  while (!f.done) {
    const { A, B } = f.pair;
    f.choose(Math.abs(A.sens - ideal) < Math.abs(B.sens - ideal) ? 'A' : 'B');
  }
  return f;
}

test('converge para a preferência do jogador', () => {
  for (const [ideal, start] of [[0.42, 0.3], [0.25, 0.35], [0.35, 0.35]]) {
    const f = runTo(ideal, start);
    assert.ok(Math.abs(f.result - ideal) / ideal < 0.06, `ideal ${ideal}: ${f.result}`);
  }
});

test('continua andando quando a sens ideal está longe do começo', () => {
  const f = runTo(0.7, 0.3);
  assert.ok(Math.abs(f.result - 0.7) / 0.7 < 0.06, `resultado ${f.result}`);
  assert.ok(f.round <= f.maxRounds);
});

test('par é cego (ordem aleatória) e o intervalo diminui', () => {
  let i = 0;
  const f = new SensFinder({ startSens: 0.4, dpi: 800, rng: () => (i++ % 2 ? 0.9 : 0.1) });
  assert.equal(f.pair.A.kind, 'low');
  const gap1 = Math.abs(f.pair.A.sens - f.pair.B.sens);
  f.choose('tie');
  assert.equal(f.pair.A.kind, 'high');
  assert.ok(Math.abs(f.pair.A.sens - f.pair.B.sens) < gap1);
});

test('parar quando estiver confortável, repetir e re-checar', () => {
  const f = new SensFinder({ startSens: 0.4, dpi: 800 });
  const before = f.spread;
  f.repeat();
  assert.equal(f.spread, before);
  assert.equal(f.round, 0);
  f.finishWith(0.377);
  assert.ok(f.done);
  assert.equal(f.result, 0.377);
  f.recheck(0.1);
  assert.ok(!f.done);
  assert.ok(Math.abs(f.pair.A.sens - f.pair.B.sens) < 0.1);
});

test('nudge pela sensação ajusta o centro', () => {
  const f = new SensFinder({ startSens: 0.4, dpi: 800, rng: () => 0.1 });
  const low = f.pair.A.sens;
  f.choose('A', { nudge: -0.03 });
  assert.equal(f.center, Math.round(low * 0.97 * 1000) / 1000);
});

test('limites de eDPI', () => {
  const f = new SensFinder({ startSens: 0.13, dpi: 800 });
  assert.ok(Math.min(f.pair.A.sens, f.pair.B.sens) * 800 >= 100 - 1);
});

test('pontuação favorece rápido e preciso e confere blocos A-B-B-A', () => {
  const good = [{ type: 'flick', dist: 30, radius: 1, time: 0.5, misses: 0, body: 0, hit: true, overshoot: 0 }];
  const bad = [{ type: 'flick', dist: 30, radius: 1, time: 0.5, misses: 1, body: 1, hit: true, overshoot: 6 }];
  const a = summarize(good), b = summarize(bad);
  assert.ok(a.score > b.score);
  assert.equal(b.accuracy, 1 / 3);
  assert.equal(b.bodies, 1);
  assert.equal(Math.round(b.overshootPct), 20);
  assert.ok(throughput(30, 1, 0.5) > throughput(30, 1, 1));
  assert.equal(compare({ kind: 'low', stats: a }, { kind: 'high', stats: b }).pick, 'A');
  assert.equal(compare({ kind: 'low', stats: a }, { kind: 'high', stats: a }).pick, 'tie');
  const mixed = compare(
    { kind: 'low', stats: { ...a, score: 1.05 }, blocks: [{ score: 1.2 }, { score: 0.9 }] },
    { kind: 'high', stats: { ...a, score: 1.0 }, blocks: [{ score: 1.0 }, { score: 1.0 }] },
  );
  assert.equal(mixed.consistent, false);
  assert.equal(mixed.confidence, 'baixa');
});
