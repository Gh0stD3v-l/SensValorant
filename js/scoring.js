// Pontuação objetiva de um teste de mira (Lei de Fitts + precisão + overshoot). Módulo puro.

/**
 * Throughput de Fitts (bits/s) de uma tentativa.
 * @param {number} distDeg distância angular até o alvo
 * @param {number} radiusDeg raio angular do alvo
 * @param {number} timeS tempo até acertar
 */
export function throughput(distDeg, radiusDeg, timeS) {
  const id = Math.log2(distDeg / (2 * radiusDeg) + 1);
  return id / Math.max(timeS, 0.05);
}

/**
 * @param {{type:string, dist:number, radius:number, time:number, misses:number, hit:boolean, overshoot:number}[]} trials
 */
export function summarize(trials) {
  const hits = trials.filter((t) => t.hit);
  const misses = trials.reduce((s, t) => s + t.misses + (t.hit ? 0 : 1), 0);
  const clicks = hits.length + misses;
  const accuracy = clicks ? hits.length / clicks : 0;
  const tp = hits.length ? hits.reduce((s, t) => s + throughput(t.dist, t.radius, t.time), 0) / hits.length : 0;
  const flicks = trials.filter((t) => t.type !== 'micro');
  const overshootPct = flicks.length ? (100 * flicks.reduce((s, t) => s + t.overshoot / t.dist, 0)) / flicks.length : 0;
  const micro = trials.filter((t) => t.type === 'micro' && t.hit);
  const microTime = micro.length ? micro.reduce((s, t) => s + t.time, 0) / micro.length : 0;
  const flickHits = flicks.filter((t) => t.hit);
  const flickTime = flickHits.length ? flickHits.reduce((s, t) => s + t.time, 0) / flickHits.length : 0;
  return { score: tp * accuracy, throughput: tp, accuracy, overshootPct, microTime, flickTime, hits: hits.length, misses };
}

/**
 * Compara duas pontuações e devolve uma sugestão em português.
 * @param {{sens:number, kind:'low'|'high', stats:ReturnType<typeof summarize>}} a
 * @param {{sens:number, kind:'low'|'high', stats:ReturnType<typeof summarize>}} b
 */
export function compare(a, b) {
  const sa = a.stats.score;
  const sb = b.stats.score;
  const best = sa >= sb ? 'A' : 'B';
  const diff = Math.abs(sa - sb) / Math.max(sa, sb, 1e-9);
  const notes = [];
  const lowStats = a.kind === 'low' ? a.stats : b.stats;
  const highStats = a.kind === 'high' ? a.stats : b.stats;
  if (highStats.overshootPct > 18) notes.push('Na sens mais rápida você passou do alvo com frequência (overshoot alto).');
  if (lowStats.flickTime > highStats.flickTime * 1.35) notes.push('Na sens mais lenta os flicks demoraram bem mais.');
  if (diff < 0.04) return { pick: 'tie', confidence: 'baixa', diff, notes: ['Empate técnico: escolha pela sensação (controle e conforto).', ...notes] };
  return { pick: best, confidence: diff > 0.15 ? 'alta' : 'média', diff, notes };
}
