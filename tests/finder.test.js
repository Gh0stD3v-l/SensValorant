import test from 'node:test';
import assert from 'node:assert/strict';
import { SensFinder } from '../js/finder.js';
import { summarize, compare, throughput } from '../js/scoring.js';

test('busca converge para a preferência do jogador', () => {
  const ideal = 0.42;
  const f = new SensFinder({ startSens: 0.3, dpi: 800, rounds: 7 });
  while (!f.done) {
    const { A, B } = f.pair;
    f.choose(Math.abs(A.sens - ideal) < Math.abs(B.sens - ideal) ? 'A' : 'B');
  }
  assert.ok(Math.abs(f.result - ideal) / ideal < 0.12, `resultado ${f.result}`);
  assert.equal(f.history.length, 7);
});

test('par é cego (ordem aleatória) e o intervalo diminui', () => {
  let i = 0;
  const f = new SensFinder({ startSens: 0.4, dpi: 800, rng: () => (i++ % 2 ? 0.9 : 0.1) });
  assert.equal(f.pair.A.kind, 'low');
  const gap1 = Math.abs(f.pair.A.sens - f.pair.B.sens);
  f.choose('tie');
  assert.equal(f.pair.A.kind, 'high');
  const gap2 = Math.abs(f.pair.A.sens - f.pair.B.sens);
  assert.ok(gap2 < gap1);
});

test('limites de eDPI e extensão', () => {
  const f = new SensFinder({ startSens: 0.13, dpi: 800, rounds: 1 });
  assert.ok(Math.min(f.pair.A.sens, f.pair.B.sens) * 800 >= 100 - 1);
  f.choose('A');
  assert.ok(f.done);
  f.extend(2);
  assert.ok(!f.done);
  assert.equal(f.totalRounds, 3);
});

test('pontuação favorece rápido e preciso', () => {
  const good = [{ type: 'flick', dist: 30, radius: 1, time: 0.5, misses: 0, hit: true, overshoot: 0 }];
  const bad = [{ type: 'flick', dist: 30, radius: 1, time: 0.5, misses: 2, hit: true, overshoot: 6 }];
  const a = summarize(good), b = summarize(bad);
  assert.ok(a.score > b.score);
  assert.equal(b.accuracy, 1 / 3);
  assert.equal(Math.round(b.overshootPct), 20);
  assert.ok(throughput(30, 1, 0.5) > throughput(30, 1, 1));
  const c = compare({ kind: 'low', sens: 0.3, stats: a }, { kind: 'high', sens: 0.5, stats: b });
  assert.equal(c.pick, 'A');
  assert.equal(compare({ kind: 'low', stats: a }, { kind: 'high', stats: a }).pick, 'tie');
});
