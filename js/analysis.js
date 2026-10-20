// Análise do movimento da mira: descobre o que o jogador está errando. Módulo puro (sem DOM).
//
// Cada tentativa gravada tem:
//   path:   [[ms, yaw, pitch], ...]   posição da mira desde o surgimento do alvo
//   clicks: [[ms, yaw, pitch, 'head'|'body'|'miss'], ...]
//   target: { spec, yaw0, pitch0 }    (ver targets.js)
//   at:     instante em que a tentativa terminou (ordem na sessão)
//
// Cada problema traz confiança (alta/média) calculada pelo tamanho da amostra (intervalo de Wilson
// para taxas, erro padrão para médias), para não dar alarme falso com poucos alvos.

import { targetAt, velocityAt, offset, wrap, hitTest } from './targets.js';
import { wilson, mean, sd, lstsq } from './stats.js';
import { trialScore } from './scoring.js';

const STEP = 10; // ms entre amostras reamostradas
const dec = (x, d = 1) => x.toFixed(d).replace('.', ',');
const pct = (x) => `${Math.round(x * 100)}%`;
const BALLISTIC = ['flick', 'turn'];

/** Reamostra o caminho em passos fixos (o mouse manda eventos em ritmo irregular). */
export function resample(path, step = STEP) {
  if (!path.length) return [];
  const out = [];
  const end = path[path.length - 1][0];
  let j = 0;
  for (let t = 0; t <= end; t += step) {
    while (j < path.length - 1 && path[j + 1][0] < t) j++;
    const a = path[j], b = path[Math.min(j + 1, path.length - 1)];
    if (t <= a[0] || a === b) { out.push([t, a[1], a[2]]); continue; }
    const k = (t - a[0]) / Math.max(1e-9, b[0] - a[0]);
    out.push([t, a[1] + (b[1] - a[1]) * Math.min(1, k), a[2] + (b[2] - a[2]) * Math.min(1, k)]);
  }
  return out;
}

/** Velocidade angular (°/s) em cada amostra reamostrada. */
export function speeds(rs) {
  return rs.map((p, i) => {
    if (i === 0) return 0;
    const q = rs[i - 1];
    return (Math.hypot(wrap(p[1] - q[1]), p[2] - q[2]) / (p[0] - q[0])) * 1000;
  });
}

function speedAt(sp, ms) {
  const i = Math.min(sp.length - 1, Math.max(0, Math.round(ms / STEP)));
  return mean(sp.slice(Math.max(0, i - 2), i + 1));
}

/**
 * Métricas de uma tentativa.
 * @param {{type:string, dist:number, radius:number, hit:boolean, time:number, path:number[][], clicks:any[][], target:object, startYaw:number, startPitch:number}} tr
 */
export function trialMetrics(tr) {
  const rs = resample(tr.path);
  const sp = speeds(rs);
  const rh = tr.radius;
  const start = targetAt(tr.target, 0);
  const dy0 = wrap(start.yaw - tr.startYaw), dp0 = start.pitch - tr.startPitch;
  const m = {
    type: tr.type, hit: tr.hit, reactionMs: null, endpoint: null, corrections: 0, clickSpeeds: [], strafeLag: [],
    side: dy0 < 0 ? 'esquerda' : 'direita',
    placement: tr.type === 'micro' ? null : Math.abs(dp0),
    curve: null, dwell: null,
  };
  if (rs.length < 3) return m;

  // Reação: primeiro instante em que a mira saiu 0,4° do lugar.
  const moved = rs.find((p) => Math.hypot(wrap(p[1] - tr.startYaw), p[2] - tr.startPitch) > 0.4);
  if (moved) m.reactionMs = moved[0];

  // Movimento principal: do pico de velocidade até a primeira desaceleração forte.
  let peakI = 0;
  for (let i = 1; i < sp.length; i++) if (sp[i] > sp[peakI]) peakI = i;
  const peak = sp[peakI];
  if (peak > 20) {
    let endI = sp.length - 1;
    for (let i = peakI; i < sp.length; i++) if (sp[i] < peak * 0.2) { endI = i; break; }
    const p = rs[endI];
    const tgt = targetAt(tr.target, p[0]);
    const len = Math.hypot(dy0, dp0) || 1;
    const along = (wrap(p[1] - tr.startYaw) * dy0 + (p[2] - tr.startPitch) * dp0) / len;
    const off = offset(tgt, p[1], p[2]);
    m.endpoint = { ms: p[0], along: along - len, alongPct: (along - len) / len, vertical: off.y / rh, dist: len };

    // Flick torto: quanto a mira saiu da linha reta até o alvo durante o 1º movimento.
    if (BALLISTIC.includes(tr.type)) {
      let maxDev = 0, signed = 0;
      for (let i = 0; i <= endI; i++) {
        const q = rs[i];
        const ux = wrap(q[1] - tr.startYaw), uy = q[2] - tr.startPitch;
        const perp = (ux * dp0 - uy * dy0) / len; // distância à linha (sinal: lado da linha)
        if (Math.abs(perp) > Math.abs(maxDev)) { maxDev = perp; signed = uy - (dp0 * (ux * dy0 + uy * dp0)) / (len * len); }
      }
      m.curve = { pct: Math.abs(maxDev) / len, up: signed > 0 };
    }

    // Correções: quantas vezes a mira parou e acelerou de novo depois do movimento principal.
    const lo = Math.max(8, peak * 0.15), hi = Math.max(25, peak * 0.35);
    let slow = true;
    for (let i = endI; i < sp.length; i++) {
      if (slow && sp[i] > hi) { m.corrections++; slow = false; }
      else if (!slow && sp[i] < lo) slow = true;
    }
  }

  // Hesitação: tempo entre a mira chegar na cabeça (pela última vez) e o clique que matou.
  if (tr.hit && tr.type !== 'strafe' && tr.clicks.length) {
    const killMs = tr.clicks[tr.clicks.length - 1][0];
    let enter = null;
    for (const q of rs) {
      if (q[0] > killMs) break;
      const onHead = hitTest(targetAt(tr.target, q[0]), rh, q[1], q[2]) === 'head';
      if (onHead && enter == null) enter = q[0];
      else if (!onHead) enter = null;
    }
    if (enter != null) m.dwell = (killMs - enter) / 1000;
  }

  for (const [ms, yaw, pitch, res] of tr.clicks) {
    m.clickSpeeds.push({ res, speed: speedAt(sp, ms) });
    if (tr.type === 'strafe') {
      const v = velocityAt(tr.target, ms);
      if (v !== 0) m.strafeLag.push((offset(targetAt(tr.target, ms), yaw, pitch).x * Math.sign(v)) / rh);
    }
  }
  return m;
}

/** Confiança de uma taxa k/n acima de um limite. */
function rateConf(k, n, thr) {
  const w = wilson(k, n);
  if (w.p < thr) return null;
  return w.lo >= thr * 0.8 ? 'alta' : 'média';
}

/** Confiança de uma média acima (dir=1) ou abaixo (dir=-1) de um limite. */
function meanConf(xs, thr, dir = 1) {
  const m = mean(xs);
  if ((m - thr) * dir <= 0) return null;
  const se = xs.length > 1 ? sd(xs) / Math.sqrt(xs.length) : Infinity;
  return (m - dir * se - thr) * dir > 0 ? 'alta' : 'média';
}

/**
 * Diagnóstico de um conjunto de tentativas: lista de problemas em ordem de gravidade.
 * sensHint: -1 = indica sens alta, +1 = indica sens baixa, 0 = técnica (não é a sens).
 * @param {object[]} trials
 * @param {{baseline?: object[]}} [opts] baseline: todas as tentativas da sessão, para comparar com você mesmo
 * @returns {{id:string, title:string, detail:string, tip:string, severity:'alta'|'média'|'baixa', confidence:'alta'|'média', n:number, sensHint:number}[]}
 */
export function diagnose(trials, { baseline = null } = {}) {
  const ms = trials.map(trialMetrics);
  const base = baseline && baseline.length > trials.length ? baseline.map(trialMetrics) : null;
  const out = [];
  const push = (d) => d.confidence && out.push(d);
  const vsBase = (fn) => {
    if (!base) return '';
    const v = fn(base);
    return v == null ? '' : ` Na sessão toda: ${v}.`;
  };

  const ballistic = ms.filter((m) => BALLISTIC.includes(m.type) && m.endpoint);
  const ballisticRate = (list, f) => {
    const b = list.filter((m) => BALLISTIC.includes(m.type) && m.endpoint);
    return b.length ? b.filter(f).length / b.length : null;
  };
  const isOver = (m) => m.endpoint.alongPct > 0.06;
  const isUnder = (m) => m.endpoint.alongPct < -0.15;
  if (ballistic.length >= 3) {
    const n = ballistic.length;
    const kOver = ballistic.filter(isOver).length;
    const kUnder = ballistic.filter(isUnder).length;
    const corr = mean(ballistic.map((m) => m.corrections));
    push({
      id: 'overshoot', severity: kOver / n >= 0.55 ? 'alta' : 'média', sensHint: -1, n, confidence: rateConf(kOver, n, 0.35),
      title: 'Você passa do alvo nos flicks',
      detail: `Em ${pct(kOver / n)} dos flicks (${kOver} de ${n}) a mira atravessou a cabeça e precisou voltar.${vsBase((b) => { const r = ballisticRate(b, isOver); return r == null ? null : pct(r); })}`,
      tip: 'Pode ser sens alta ou braço tenso. Pense em "chegar" na cabeça, não em atravessar. Se acontecer em todas as sens, é técnica.',
    });
    if (corr >= 1) push({
      id: 'undershoot', severity: kUnder / n >= 0.65 ? 'alta' : 'média', sensHint: 1, n, confidence: rateConf(kUnder, n, 0.45),
      title: 'Você chega curto e corrige em etapas',
      detail: `Em ${pct(kUnder / n)} dos flicks o primeiro movimento parou antes do alvo (${dec(corr)} correções em média).${vsBase((b) => { const r = ballisticRate(b, isUnder); return r == null ? null : pct(r); })}`,
      tip: 'Parar um pouco antes é natural, mas parar muito antes é sinal de sens baixa ou de movimento hesitante. Deixe o braço ir até o fim.',
    });
    const verts = ballistic.map((m) => m.endpoint.vertical);
    const vert = mean(verts);
    push({
      id: vert < 0 ? 'low' : 'high', severity: Math.abs(vert) > 2 ? 'alta' : 'média', sensHint: 0, n,
      confidence: meanConf(verts.map((v) => v * Math.sign(vert)), 1.2),
      title: vert < 0 ? 'Sua mira chega abaixo da cabeça' : 'Sua mira chega acima da cabeça',
      detail: `No fim do flick a mira fica em média ${dec(Math.abs(vert))} cabeças ${vert < 0 ? 'abaixo' : 'acima'}.`,
      tip: 'É posicionamento de mira, não sens. Deixe a mira sempre na altura da cabeça e faça flicks retos na horizontal.',
    });
    const curves = ballistic.filter((m) => m.curve);
    if (curves.length >= 3) {
      const ups = curves.filter((m) => m.curve.up).length;
      push({
        id: 'curve', severity: 'média', sensHint: 0, n: curves.length,
        confidence: meanConf(curves.map((m) => m.curve.pct), 0.1),
        title: `Seus flicks saem tortos (${ups >= curves.length / 2 ? 'sobem' : 'descem'} no meio do caminho)`,
        detail: `No meio do flick a mira sai em média ${pct(mean(curves.map((m) => m.curve.pct)))} da distância fora da linha reta.`,
        tip: 'Comum em quem mira só com o pulso: o arco do pulso entorta o movimento. Use mais o braço nos flicks longos e mantenha o mouse reto no mousepad.',
      });
    }
  }

  // Lado fraco: um lado bem mais lento que o outro.
  const sided = ms.map((m, i) => ({ m, t: trials[i] })).filter(({ m, t }) => BALLISTIC.includes(m.type) && t.hit);
  const left = sided.filter((x) => x.m.side === 'esquerda').map((x) => x.t.time);
  const right = sided.filter((x) => x.m.side === 'direita').map((x) => x.t.time);
  if (left.length >= 3 && right.length >= 3) {
    const slowL = mean(left) > mean(right);
    const ratio = slowL ? mean(left) / mean(right) : mean(right) / mean(left);
    if (ratio > 1.25) out.push({
      id: 'side', severity: ratio > 1.5 ? 'alta' : 'média', sensHint: 0, n: left.length + right.length,
      confidence: ratio > 1.4 && left.length + right.length >= 8 ? 'alta' : 'média',
      title: `Flicks para a ${slowL ? 'esquerda' : 'direita'} são mais lentos`,
      detail: `Para a ${slowL ? 'esquerda' : 'direita'} você leva ${dec(slowL ? mean(left) : mean(right), 2)} s; para o outro lado, ${dec(slowL ? mean(right) : mean(left), 2)} s.`,
      tip: `Treine flicks para a ${slowL ? 'esquerda' : 'direita'} no Campo de Tiro. Confira se o mousepad tem espaço livre desse lado.`,
    });
  }

  // Posicionamento: a mira estava longe da altura da cabeça quando o alvo apareceu.
  const placements = ms.filter((m) => m.placement != null).map((m) => m.placement);
  if (placements.length >= 5) push({
    id: 'placement', severity: mean(placements) > 4 ? 'alta' : 'média', sensHint: 0, n: placements.length,
    confidence: meanConf(placements, 2.2),
    title: 'Sua mira fica fora da altura da cabeça entre os alvos',
    detail: `Quando o alvo aparece, você precisa corrigir em média ${dec(mean(placements))}° na vertical.`,
    tip: 'Crosshair placement: deixe a mira na altura da cabeça o tempo todo. Assim o flick é só horizontal, e no Valorant isso vale mais que qualquer sens.',
  });

  const allClicks = ms.flatMap((m) => m.clickSpeeds);
  const bad = allClicks.filter((c) => c.res !== 'head');
  const moving = bad.filter((c) => c.speed > 60);
  if (bad.length >= 3) push({
    id: 'clickmoving', severity: moving.length / bad.length >= 0.6 ? 'alta' : 'média', sensHint: 0, n: bad.length,
    confidence: rateConf(moving.length, bad.length, 0.4),
    title: 'Você atira com a mira ainda em movimento',
    detail: `${pct(moving.length / bad.length)} dos seus erros (${moving.length} de ${bad.length}) foram com a mira passando rápido (> 60°/s).`,
    tip: 'No Valorant o tiro sai onde a mira está no instante do clique. Faça a micro-pausa: pare a mira na cabeça e só então atire.',
  });

  const bodies = allClicks.filter((c) => c.res === 'body').length;
  if (allClicks.length >= 6) push({
    id: 'body', severity: bodies / allClicks.length >= 0.35 ? 'alta' : 'média', sensHint: 0, n: allClicks.length,
    confidence: rateConf(bodies, allClicks.length, 0.2),
    title: 'Muitos tiros no corpo',
    detail: `${pct(bodies / allClicks.length)} dos cliques acertaram o corpo em vez da cabeça.`,
    tip: 'Mire na cabeça desde o começo do movimento. No Valorant, cabeça com Vandal mata com 1 tiro.',
  });

  const dwells = ms.filter((m) => m.dwell != null).map((m) => m.dwell);
  if (dwells.length >= 4) push({
    id: 'hesitation', severity: mean(dwells) > 0.3 ? 'alta' : 'média', sensHint: 0, n: dwells.length,
    confidence: meanConf(dwells, 0.2),
    title: 'Você demora para atirar com a mira já na cabeça',
    detail: `Entre a mira chegar na cabeça e o tiro passam em média ${Math.round(mean(dwells) * 1000)} ms.`,
    tip: 'Confie na mira: quando ela parar na cabeça, atire. A micro-pausa é curta, não uma conferência.',
  });

  const reactions = ms.filter((m) => m.reactionMs != null && m.type !== 'micro').map((m) => m.reactionMs);
  if (reactions.length >= 4) push({
    id: 'reaction', severity: mean(reactions) > 420 ? 'alta' : 'média', sensHint: 0, n: reactions.length,
    confidence: meanConf(reactions, 330),
    title: 'Reação lenta para começar a mirar',
    detail: `Você leva ${Math.round(mean(reactions))} ms em média para começar a mexer a mira.`,
    tip: 'Fique com a mão relaxada e pronta. Aquecer 5 minutos antes de jogar costuma baixar esse tempo.',
  });

  const micro = ms.filter((m) => m.type === 'micro');
  const microCorr = micro.filter((m) => m.endpoint).map((m) => m.corrections);
  if (microCorr.length >= 3) push({
    id: 'jitter', severity: mean(microCorr) > 2.5 ? 'alta' : 'média', sensHint: -1, n: microCorr.length,
    confidence: meanConf(microCorr, 1.5),
    title: 'Mira tremendo nos ajustes pequenos',
    detail: `Nos micro-ajustes a mira para e recomeça ${dec(mean(microCorr))} vezes em média antes de acertar.`,
    tip: 'Mira que "dança" em volta da cabeça é o sinal mais típico de sens alta. Também ajuda segurar o mouse com menos força.',
  });
  const microTimes = trials.filter((t) => t.type === 'micro' && t.hit).map((t) => t.time);
  if (microTimes.length >= 3) push({
    id: 'micro', severity: mean(microTimes) > 1.2 ? 'alta' : 'média', sensHint: 0, n: microTimes.length,
    confidence: meanConf(microTimes, 0.85),
    title: 'Micro-ajuste lento',
    detail: `Ajustes pequenos (2–6°) levam ${dec(mean(microTimes), 2)} s em média.`,
    tip: 'Treine ajustes curtos com o pulso, parando a mira na cabeça sem passar.',
  });

  const lags = ms.flatMap((m) => m.strafeLag);
  if (lags.length >= 3) {
    const lag = mean(lags);
    if (lag < 0) push({
      id: 'strafe-behind', severity: lag < -1.2 ? 'alta' : 'média', sensHint: 1, n: lags.length,
      confidence: meanConf(lags, -0.6, -1),
      title: 'Você fica atrás do alvo que se move',
      detail: `Nos alvos em strafe a mira ficou em média ${dec(Math.abs(lag))} cabeças atrás.`,
      tip: 'Acompanhe o alvo em vez de esperar ele parar. Se ficar atrás sempre, a sens pode estar baixa.',
    });
    else push({
      id: 'strafe-ahead', severity: lag > 1.2 ? 'alta' : 'média', sensHint: -1, n: lags.length,
      confidence: meanConf(lags, 0.6),
      title: 'Você passa na frente do alvo que se move',
      detail: `Nos alvos em strafe a mira ficou em média ${dec(lag)} cabeças à frente.`,
      tip: 'Espere o alvo entrar na mira em vez de correr atrás dele. No Valorant os inimigos param para atirar.',
    });
  }

  const peeks = trials.filter((t) => t.type === 'peek');
  if (peeks.length >= 2) {
    const lost = peeks.filter((t) => !t.hit).length;
    push({
      id: 'peek', severity: lost / peeks.length >= 0.75 ? 'alta' : 'média', sensHint: 0, n: peeks.length,
      confidence: rateConf(lost, peeks.length, 0.5),
      title: 'Você perde os peeks',
      detail: `${pct(lost / peeks.length)} dos alvos que aparecem rápido sumiram antes do seu tiro.`,
      tip: 'Mantenha a mira onde o inimigo vai aparecer (pre-aim) para precisar só de um ajuste pequeno.',
    });
  }

  const flickTimes = trials.filter((t) => t.type === 'flick' && t.hit).map((t) => t.time);
  if (flickTimes.length >= 4) {
    const cv = sd(flickTimes) / mean(flickTimes);
    if (cv > 0.55) out.push({
      id: 'inconsistent', severity: 'baixa', sensHint: 0, n: flickTimes.length, confidence: flickTimes.length >= 8 ? 'alta' : 'média',
      title: 'Tempo de flick inconsistente',
      detail: `Seus flicks variam bastante (de ${dec(Math.min(...flickTimes), 2)} s a ${dec(Math.max(...flickTimes), 2)} s).`,
      tip: 'Normal no começo. Aqueça antes e mantenha a mesma pegada no mouse.',
    });
  }

  const order = { alta: 0, 'média': 1, baixa: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity] || (a.confidence === 'alta' ? -1 : 1));
}

/** Soma das dicas de sens dos problemas mais graves: <0 sugere baixar, >0 sugere subir. */
export function sensTendency(diags) {
  return diags.reduce((s, d) => s + d.sensHint * (d.severity === 'alta' ? 2 : 1) * (d.confidence === 'alta' ? 1 : 0.5), 0);
}

/**
 * O que muda quando a sens muda: regressão de cada métrica contra ln(sens), ponderada pelo número
 * de alvos. Responde "passar do alvo é culpa da sens ou é técnica?" comparando você com você mesmo.
 */
export function sensTrends(trials) {
  const groups = new Map();
  trials.forEach((t, i) => {
    const key = t.sens.toFixed(3);
    if (!groups.has(key)) groups.set(key, { sens: t.sens, trials: [], metrics: [] });
    groups.get(key).trials.push(t);
  });
  for (const g of groups.values()) g.metrics = g.trials.map(trialMetrics);
  const gs = [...groups.values()].filter((g) => g.trials.length >= 4);
  if (gs.length < 3) return [];
  const smin = Math.min(...gs.map((g) => g.sens)), smax = Math.max(...gs.map((g) => g.sens));
  const ref = Math.sqrt(smin * smax);

  const metrics = [
    { id: 'overshoot', label: 'Passar do alvo', unit: 'pts', scale: 100, thr: 15, f: (g) => {
      const b = g.metrics.filter((m) => BALLISTIC.includes(m.type) && m.endpoint);
      return b.length ? { v: b.filter((m) => m.endpoint.alongPct > 0.06).length / b.length, n: b.length } : null;
    } },
    { id: 'undershoot', label: 'Parar antes do alvo', unit: 'pts', scale: 100, thr: 15, f: (g) => {
      const b = g.metrics.filter((m) => BALLISTIC.includes(m.type) && m.endpoint);
      return b.length ? { v: b.filter((m) => m.endpoint.alongPct < -0.15).length / b.length, n: b.length } : null;
    } },
    { id: 'jitter', label: 'Correções no micro-ajuste', unit: '', scale: 1, thr: 0.6, f: (g) => {
      const c = g.metrics.filter((m) => m.type === 'micro' && m.endpoint).map((m) => m.corrections);
      return c.length ? { v: mean(c), n: c.length } : null;
    } },
    { id: 'flick', label: 'Tempo de flick', unit: 's', scale: 1, thr: 0.12, f: (g) => {
      const c = g.trials.filter((t) => BALLISTIC.includes(t.type) && t.hit).map((t) => t.time);
      return c.length ? { v: mean(c), n: c.length } : null;
    } },
    { id: 'accuracy', label: 'Acerto na cabeça', unit: 'pts', scale: 100, thr: 10, f: (g) => {
      const clicks = g.trials.reduce((s, t) => s + t.misses + (t.body || 0) + 1, 0);
      return { v: g.trials.filter((t) => t.hit).length / clicks, n: g.trials.length };
    } },
  ];
  const out = [];
  for (const mt of metrics) {
    const rows = gs.map((g) => ({ g, r: mt.f(g) })).filter((x) => x.r);
    if (rows.length < 3) continue;
    const b = lstsq(rows.map((x) => [1, Math.log(x.g.sens / ref)]), rows.map((x) => x.r.v), rows.map((x) => x.r.n));
    if (!b) continue;
    const delta = b[1] * Math.log(smax / smin) * mt.scale;
    if (Math.abs(delta) < mt.thr) continue;
    out.push({ id: mt.id, label: mt.label, delta, unit: mt.unit, from: smin, to: smax });
  }
  return out;
}

/** Aquecimento ou cansaço: compara o primeiro e o último terço da sessão. */
export function sessionTrend(trials) {
  const sorted = [...trials].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  if (sorted.length < 24) return null;
  const k = Math.floor(sorted.length / 3);
  const first = mean(sorted.slice(0, k).map(trialScore));
  const last = mean(sorted.slice(-k).map(trialScore));
  if (!first) return null;
  const change = last / first - 1;
  if (change < -0.15) return { kind: 'fatigue', change };
  if (change > 0.15) return { kind: 'warmup', change };
  return { kind: 'stable', change };
}
