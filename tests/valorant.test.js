import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../js/valorant.js';

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('cm/360 usa yaw 0,07', () => {
  close(V.CM360_CONST, 13062.857, 1e-2);
  close(V.cm360(0.35, 800), 46.653, 1e-2);
  close(V.sensFromCm360(V.cm360(0.4, 1600), 1600), 0.4);
});

test('troca de DPI mantém eDPI', () => {
  close(V.convertDpi(0.4, 800, 1600), 0.2);
});

test('conversão CS2 e Overwatch 2', () => {
  close(V.fromOtherGame(1.1, V.GAMES.cs2.yaw, 800), 0.3457, 1e-3);
  close(V.fromOtherGame(5, V.GAMES.ow2.yaw, 800), 0.4714, 1e-3);
  close(V.toOtherGame(V.fromOtherGame(2, 0.022, 800), 0.022), 2);
});

test('percentil dos pros centrado na mediana', () => {
  close(V.proPercentile(V.PRO_MEDIAN_EDPI), 50, 0.01);
  assert.ok(V.proPercentile(185) > 20 && V.proPercentile(185) < 30);
  assert.ok(V.proPercentile(295) > 70 && V.proPercentile(295) < 80);
});

test('ponto de partida respeita perfil e hábito', () => {
  const base = V.suggestStart({ dpi: 800, style: 'misto', padWidthCm: 45, role: 'flex' });
  close(base.edpi, 235, 1);
  const arm = V.suggestStart({ dpi: 800, style: 'braco', padWidthCm: 90, role: 'flex' });
  assert.ok(arm.edpi < base.edpi);
  const withCur = V.suggestStart({ dpi: 800, currentSens: 0.6, style: 'misto', padWidthCm: 45, role: 'flex' });
  assert.ok(withCur.edpi > base.edpi && withCur.edpi < 480);
  const extreme = V.suggestStart({ dpi: 800, currentSens: 5, style: 'misto' });
  assert.ok(extreme.edpi <= V.EDPI_MAX);
});

test('checagem do giro de 180°', () => {
  assert.equal(V.turnCheck(0.2, 800, 30).ok, false);
  assert.equal(V.turnCheck(0.4, 800, 90).ok, true);
  assert.equal(V.turnCheck(0.4, 800, 0), null);
});

test('calibração detecta escala e aceleração', () => {
  // 10 cm a 800 DPI = 3149,6 contagens
  const ok = V.calibrationResult([{ counts: 3150, speed: 'lento' }, { counts: 3100, speed: 'rapido' }], 10, 800);
  assert.equal(ok.ok, true);
  assert.equal(ok.factor, 1);
  const scaled = V.calibrationResult([{ counts: 2520, speed: 'lento' }, { counts: 2500, speed: 'rapido' }], 10, 800);
  assert.equal(scaled.ok, false);
  close(scaled.factor, 1.255, 0.01);
  const accel = V.calibrationResult([{ counts: 3150, speed: 'lento' }, { counts: 4200, speed: 'rapido' }], 10, 800);
  assert.equal(accel.accel, true);
  assert.equal(accel.ok, true);
});
