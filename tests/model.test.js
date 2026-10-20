import test from 'node:test';
import assert from 'node:assert/strict';
import { fitCurve, equilibrium, combineEstimates, rangeVerdict } from '../js/model.js';
import { wilson, lstsq, seeded, compareMeans } from '../js/stats.js';

test('estatística básica', () => {
  const b = lstsq([[1, 0], [1, 1], [1, 2]], [1, 3, 5]);
  assert.ok(Math.abs(b[0] - 1) < 1e-9 && Math.abs(b[1] - 2) < 1e-9);
  const w = wilson(8, 10);
  assert.ok(w.lo < 0.8 && w.hi > 0.8);
  assert.ok(compareMeans([5, 6, 7], [1, 2, 3]).z > 2);
});

/** Jogador sintético: desempenho em U invertido em ln(sens), pico em `opt`, com ruído e aprendizado. */
function synth(opt, sensList, { noise = 0.05, learn = 0, reps = 4, seed = 3 } = {}) {
  const rng = seeded(seed);
  const pts = [];
  let t = 0;
  for (let r = 0; r < reps; r++) {
    for (const s of sensList) {
      const x = Math.log(s / opt);
      pts.push({ sens: s, value: 1 - 3 * x * x + learn * t + (rng() - 0.5) * 2 * noise, t: t++ });
    }
  }
  return pts;
}

test('curva acha o pico de desempenho e a faixa ótima', () => {
  const fit = fitCurve(synth(0.34, [0.22, 0.27, 0.32, 0.38, 0.45]));
  assert.ok(fit.ok);
  assert.ok(Math.abs(fit.opt - 0.34) / 0.34 < 0.05, `opt ${fit.opt}`);
  assert.ok(fit.range[0] < 0.34 && fit.range[1] > 0.34);
  assert.ok(fit.ci[0] <= fit.opt && fit.ci[1] >= fit.opt);
});

test('curva desconta aprendizado ao longo da sessão', () => {
  // Testando da sens mais baixa para a mais alta com aprendizado forte: sem o tempo o pico iria para cima.
  const pts = [];
  let t = 0;
  for (const s of [0.22, 0.25, 0.28, 0.31, 0.34, 0.37, 0.4, 0.44, 0.48]) {
    for (let r = 0; r < 3; r++) {
      const x = Math.log(s / 0.3);
      pts.push({ sens: s, value: 1 - 3 * x * x + 0.02 * t, t: t++ });
    }
  }
  const withTime = fitCurve(pts);
  const noTime = fitCurve(pts, { useTime: false });
  assert.ok(Math.abs(withTime.opt - 0.3) < Math.abs((noTime.ok ? noTime.opt : 0.48) - 0.3));
  assert.ok(Math.abs(withTime.opt - 0.3) / 0.3 < 0.05, `opt ${withTime.opt}`);
});

test('sem pico ou poucos dados', () => {
  assert.equal(fitCurve([{ sens: 0.3, value: 1 }]).ok, false);
  const rising = [0.2, 0.25, 0.3, 0.2, 0.25, 0.3].map((s, t) => ({ sens: s, value: s * 10, t }));
  const r = fitCurve(rising);
  assert.equal(r.ok, false);
  assert.equal(r.direction, 1);
});

test('equilíbrio do primeiro movimento', () => {
  const pts = [];
  for (const s of [0.25, 0.3, 0.35, 0.4, 0.45]) for (let i = 0; i < 3; i++) pts.push({ sens: s, along: -0.03 + 0.8 * Math.log(s / 0.36) });
  const e = equilibrium(pts);
  assert.ok(e.ok);
  assert.ok(Math.abs(e.sens - 0.36) < 0.005, `sens ${e.sens}`);
  assert.equal(equilibrium(pts.map((p) => ({ ...p, along: 0 }))).ok, false);
});

test('combinação das estimativas', () => {
  const c = combineEstimates([{ key: 'a', sens: 0.3, weight: 1 }, { key: 'b', sens: 0.4, weight: 0 }, { key: 'c', sens: 0.32, weight: 1 }]);
  assert.ok(c.sens > 0.3 && c.sens < 0.32);
  assert.equal(c.parts.length, 2);
  assert.equal(c.agreement, 'alta');
});

test('veredito do Campo de Tiro', () => {
  assert.equal(rangeVerdict([20, 21], [19, 20]).level, 'pode ser sorte');
  assert.equal(rangeVerdict([24, 25, 24], [16, 17, 15]).level, 'real');
});
