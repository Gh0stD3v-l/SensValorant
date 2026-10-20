// Modelo de precisão: usa TODAS as rodadas (não só a escolha A/B) para estimar a sens ideal.
// 1. Curva de desempenho × sens (quadrática em ln(sens), descontando aprendizado/cansaço pelo tempo).
//    O pico é o melhor ponto; a faixa onde o desempenho fica a até 3% do pico é a faixa ótima.
// 2. Ponto de equilíbrio do primeiro movimento: a sens em que o flick nem passa do alvo nem
//    para curto demais (pesquisas de mira mostram um leve viés natural para parar antes).
// 3. Combinação com a preferência do jogador (resultado da busca A/B).
// Módulo puro.

import { lstsq, quantile, seeded, mean, variance, normCdf } from './stats.js';

const ln = Math.log;

/**
 * @param {{sens:number, value:number, t?:number, w?:number}[]} points value: maior é melhor
 * @returns {object} { ok, opt, range, ci, confidence, rel, edge, direction, predict }
 */
export function fitCurve(points, { useTime = true, boot = 200, rng = seeded(7), tol = 0.03 } = {}) {
  const distinct = new Set(points.map((p) => p.sens.toFixed(3))).size;
  const n = points.length;
  if (n < 6 || distinct < 3) return { ok: false, reason: 'poucos dados', n, distinct };
  const ref = Math.exp(mean(points.map((p) => ln(p.sens))));
  const tMean = mean(points.map((p) => p.t ?? 0));
  const time = useTime && new Set(points.map((p) => p.t ?? 0)).size > 2;
  const row = (p) => {
    const x = ln(p.sens / ref);
    return time ? [1, x, x * x, (p.t ?? 0) - tMean] : [1, x, x * x];
  };
  const fit = (pts) => lstsq(pts.map(row), pts.map((p) => p.value), pts.map((p) => p.w ?? 1));
  const b = fit(points);
  if (!b) return { ok: false, reason: 'dados sem variação', n, distinct };
  const xs = points.map((p) => ln(p.sens / ref));
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const predictX = (x) => b[0] + b[1] * x + b[2] * x * x;
  const predict = (s) => predictX(ln(s / ref));

  if (b[2] >= 0) {
    // Sem pico: o desempenho só sobe (ou só desce) dentro das sens testadas.
    const direction = predictX(xmax) > predictX(xmin) ? 1 : -1;
    return { ok: false, reason: 'sem pico', direction, n, distinct, predict, ref, xmin, xmax };
  }
  const lo = xmin - 0.1, hi = xmax + 0.1;
  const raw = -b[1] / (2 * b[2]);
  const xopt = Math.min(hi, Math.max(lo, raw));
  const edge = xopt !== raw;
  const peak = predictX(xopt);
  const half = Math.sqrt((tol * Math.abs(peak)) / -b[2]);

  const opts = [];
  for (let i = 0; i < boot; i++) {
    const sample = Array.from({ length: n }, () => points[Math.floor(rng() * n)]);
    const bb = fit(sample);
    if (bb && bb[2] < 0) opts.push(Math.min(hi, Math.max(lo, -bb[1] / (2 * bb[2]))));
  }
  const stable = opts.length / boot;
  const ci = opts.length >= 20 ? [quantile(opts, 0.1), quantile(opts, 0.9)] : [lo, hi];
  const rel = (Math.exp(ci[1]) - Math.exp(ci[0])) / 2 / Math.exp(xopt);
  const confidence = edge || stable < 0.6 ? 'baixa' : rel < 0.06 ? 'alta' : rel < 0.15 ? 'média' : 'baixa';
  return {
    ok: true,
    opt: ref * Math.exp(xopt),
    range: [ref * Math.exp(xopt - half), ref * Math.exp(xopt + half)],
    ci: [ref * Math.exp(ci[0]), ref * Math.exp(ci[1])],
    rel, confidence, edge, stable, n, distinct, predict, ref,
    tested: [ref * Math.exp(xmin), ref * Math.exp(xmax)],
  };
}

/**
 * Sens em que o erro médio do primeiro movimento fica no alvo (levemente antes: -3%).
 * @param {{sens:number, along:number}[]} pts along: erro do 1º movimento em fração da distância (+ passou)
 */
export function equilibrium(pts, target = -0.03) {
  const distinct = new Set(pts.map((p) => p.sens.toFixed(3))).size;
  if (pts.length < 8 || distinct < 3) return { ok: false, reason: 'poucos dados' };
  // Limita outliers (um flick muito errado não pode mandar no resultado).
  const clean = pts.map((p) => ({ ...p, along: Math.max(-0.6, Math.min(0.6, p.along)) }));
  const ref = Math.exp(mean(clean.map((p) => ln(p.sens))));
  const b = lstsq(clean.map((p) => [1, ln(p.sens / ref)]), clean.map((p) => p.along));
  if (!b) return { ok: false, reason: 'dados sem variação' };
  if (b[1] <= 0.05) return { ok: false, reason: 'o erro do 1º movimento não muda com a sens', slope: b[1] };
  const sens = ref * Math.exp((target - b[0]) / b[1]);
  const smin = Math.min(...clean.map((p) => p.sens)), smax = Math.max(...clean.map((p) => p.sens));
  if (sens < smin * 0.9 || sens > smax * 1.1) return { ok: false, reason: 'fora das sens testadas', sens, slope: b[1] };
  return { ok: true, sens, slope: b[1] };
}

export const CURVE_WEIGHT = { alta: 1.2, 'média': 0.7, baixa: 0.25 };

/**
 * Média geométrica ponderada das estimativas.
 * @param {{key:string, label:string, sens:number, weight:number}[]} list
 */
export function combineEstimates(list) {
  const valid = list.filter((p) => p.weight > 0 && p.sens > 0);
  const W = valid.reduce((s, p) => s + p.weight, 0);
  if (!W) return null;
  const sens = Math.exp(valid.reduce((s, p) => s + p.weight * ln(p.sens), 0) / W);
  const maxDev = Math.max(...valid.map((p) => Math.abs(ln(p.sens / sens))));
  return {
    sens,
    parts: valid.map((p) => ({ ...p, share: p.weight / W })),
    agreement: valid.length < 2 ? 'só uma fonte' : maxDev < 0.05 ? 'alta' : maxDev < 0.12 ? 'média' : 'baixa',
  };
}

/**
 * Diferença de abates no Teste de tiro (30 bots) é real ou pode ser sorte?
 * Usa a variância binomial ou a observada, a que for maior.
 */
export function rangeVerdict(killsA, killsB, bots = 30) {
  const nA = killsA.length, nB = killsB.length;
  if (!nA || !nB) return null;
  const p = Math.min(0.97, Math.max(0.03, (killsA.reduce((s, k) => s + k, 0) + killsB.reduce((s, k) => s + k, 0)) / (bots * (nA + nB))));
  const binom = bots * p * (1 - p);
  const obs = nA + nB > 3 ? (variance(killsA) * (nA - 1) + variance(killsB) * (nB - 1)) / Math.max(1, nA + nB - 2) : 0;
  const v = Math.max(binom, obs);
  const d = mean(killsA) - mean(killsB);
  const z = d / Math.sqrt(v / nA + v / nB);
  const level = Math.abs(z) >= 1.96 ? 'real' : Math.abs(z) >= 1 ? 'provável' : 'pode ser sorte';
  return { d, z, level, pA: normCdf(z) };
}
