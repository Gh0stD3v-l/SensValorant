// Pontuação objetiva de um teste de mira (Lei de Fitts + precisão). Módulo puro.

import { compareMeans } from './stats.js';

/**
 * Throughput de Fitts (bits/s) de uma tentativa.
 * @param {number} distDeg distância angular até o alvo
 * @param {number} radiusDeg raio angular da cabeça
 * @param {number} timeS tempo até acertar
 */
export function throughput(distDeg, radiusDeg, timeS) {
  const id = Math.log2(distDeg / (2 * radiusDeg) + 1);
  return id / Math.max(timeS, 0.05);
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** Pontuação de uma tentativa: throughput dividido pelos cliques errados; 0 se não acertou a cabeça. */
export function trialScore(t) {
  return t.hit ? throughput(t.dist, t.radius, t.time) / (1 + t.misses + (t.body || 0)) : 0;
}

/**
 * @param {{type:string, dist:number, radius:number, time:number, misses:number, body?:number, hit:boolean, overshoot:number}[]} trials
 */
export function summarize(trials) {
  const hits = trials.filter((t) => t.hit);
  const misses = trials.reduce((s, t) => s + t.misses + (t.body || 0) + (t.hit ? 0 : 1), 0);
  const bodies = trials.reduce((s, t) => s + (t.body || 0), 0);
  const clicks = hits.length + misses;
  const accuracy = clicks ? hits.length / clicks : 0;
  const tp = mean(hits.map((t) => throughput(t.dist, t.radius, t.time)));
  const flicks = trials.filter((t) => t.type === 'flick' || t.type === 'turn');
  const overshootPct = 100 * mean(flicks.map((t) => Math.max(0, t.overshoot) / t.dist));
  const timeOf = (type) => mean(hits.filter((t) => type.includes(t.type)).map((t) => t.time));
  return {
    score: tp * accuracy,
    throughput: tp,
    accuracy,
    overshootPct,
    flickTime: timeOf(['flick', 'turn']),
    microTime: timeOf(['micro']),
    strafeTime: timeOf(['strafe']),
    peekRate: (() => {
      const p = trials.filter((t) => t.type === 'peek');
      return p.length ? p.filter((t) => t.hit).length / p.length : null;
    })(),
    hits: hits.length,
    misses,
    bodies,
    targets: trials.length,
  };
}

/**
 * Compara A e B. Com blocos A-B-B-A, confere se os dois pares de blocos concordam.
 * @param {{kind:'low'|'high', stats:object, blocks?:object[]}} a
 * @param {{kind:'low'|'high', stats:object, blocks?:object[]}} b
 */
export function compare(a, b) {
  const sa = a.stats.score;
  const sb = b.stats.score;
  const best = sa >= sb ? 'A' : 'B';
  const diff = Math.abs(sa - sb) / Math.max(sa, sb, 1e-9);
  const notes = [];
  const lowStats = a.kind === 'low' ? a.stats : b.stats;
  const highStats = a.kind === 'high' ? a.stats : b.stats;
  if (highStats.overshootPct > 18) notes.push('Na sens mais rápida você passou do alvo com frequência.');
  if (lowStats.flickTime > highStats.flickTime * 1.35) notes.push('Na sens mais lenta os flicks demoraram bem mais.');

  // Significância: a diferença entre as tentativas é maior que o ruído?
  let z = null;
  if (a.trials?.length && b.trials?.length) z = compareMeans(a.trials.map(trialScore), b.trials.map(trialScore)).z;
  const luck = z != null && Math.abs(z) < 1;
  if (luck) notes.push('Pela variação entre os alvos, essa diferença ainda pode ser sorte.');

  let consistent = true;
  if (a.blocks?.length === 2 && b.blocks?.length === 2) {
    const d1 = a.blocks[0].score - b.blocks[0].score;
    const d2 = a.blocks[1].score - b.blocks[1].score;
    consistent = Math.sign(d1) === Math.sign(d2);
  }
  if (diff < 0.04) return { pick: 'tie', confidence: 'baixa', diff, z, consistent, notes: ['Empate técnico: escolha pela sensação (controle e conforto).', ...notes] };
  if ((!consistent && diff < 0.12) || luck) {
    return { pick: best, confidence: 'baixa', diff, z, consistent, notes: [...(consistent ? [] : ['Os dois blocos de cada sens discordaram. Vale repetir a rodada.']), ...notes] };
  }
  const strong = diff > 0.15 && (z == null || Math.abs(z) >= 1.96);
  return { pick: best, confidence: strong ? 'alta' : 'média', diff, z, consistent, notes };
}
