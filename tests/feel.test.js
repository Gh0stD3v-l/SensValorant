import test from 'node:test';
import assert from 'node:assert/strict';
import { bracket, pse, feelPick } from '../js/feel.js';
import { SensFinder } from '../js/finder.js';

test('lenta numa sens = ideal acima dela; rápida = ideal abaixo', () => {
  const b = bracket([{ sens: 0.3, j: -1 }, { sens: 0.45, j: 2 }, { sens: 0.25, j: -2 }]);
  assert.equal(b.lo, 0.3);
  assert.equal(b.hi, 0.45);
  assert.equal(b.conflict, false);
  assert.equal(bracket([{ sens: 0.4, j: -1 }, { sens: 0.3, j: 1 }]).conflict, true);
});

test('ponto de igualdade subjetiva', () => {
  const p = pse([{ sens: 0.3, j: -1 }, { sens: 0.4, j: 1 }]);
  assert.ok(p.sens > 0.33 && p.sens < 0.36, `pse ${p.sens}`);
  // Todas lentas: o ideal fica acima da mais alta.
  const up = pse([{ sens: 0.25, j: -2 }, { sens: 0.3, j: -1 }]);
  assert.ok(up.sens > 0.3 && up.extrapolated);
  assert.equal(pse([{ sens: 0.3, j: 0 }, { sens: 0.4, j: 0 }]), null);
});

test('escolha pela sensação segue a direção', () => {
  const lowSlow = feelPick({ sens: 0.25, kind: 'low', j: -1 }, { sens: 0.4, kind: 'high', j: null });
  assert.equal(lowSlow.pick, 'B');
  const between = feelPick({ sens: 0.4, kind: 'high', j: 1 }, { sens: 0.3, kind: 'low', j: -1 });
  assert.equal(between.pick, 'tie');
  assert.ok(between.target > 0.3 && between.target < 0.4);
  assert.equal(feelPick({ sens: 0.3, kind: 'low', j: -2 }, { sens: 0.4, kind: 'high', j: -1 }).pick, 'B');
  assert.equal(feelPick({ sens: 0.3, kind: 'low', j: 0 }, { sens: 0.4, kind: 'high', j: 0 }), null);
});

test('busca nunca desce abaixo de uma sens que pareceu lenta', () => {
  const f = new SensFinder({ startSens: 0.35, dpi: 800, rng: () => 0.1 });
  f.setBounds(0.33, null);
  assert.ok(Math.min(f.pair.A.sens, f.pair.B.sens) >= 0.333);
  f.choose(f.pair.A.kind === 'low' ? 'A' : 'B'); // mesmo escolhendo a mais baixa
  assert.ok(f.center >= 0.333, `centro ${f.center}`);
  f.choose('tie', { target: 0.36 });
  assert.ok(Math.abs(f.center - 0.36) < 0.002);
});
