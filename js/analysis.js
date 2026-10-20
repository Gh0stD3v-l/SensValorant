// Análise do movimento da mira: descobre o que o jogador está errando. Módulo puro (sem DOM).
//
// Cada tentativa gravada tem:
//   path:   [[ms, yaw, pitch], ...]   posição da mira desde o surgimento do alvo
//   clicks: [[ms, yaw, pitch, 'head'|'body'|'miss'], ...]
//   target: { spec, yaw0, pitch0 }    (ver targets.js)

import { targetAt, velocityAt, offset, wrap } from './targets.js';

const STEP = 10; // ms entre amostras reamostradas
const dec = (x, d = 1) => x.toFixed(d).replace('.', ',');
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

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

function speedAt(rs, sp, ms) {
  const i = Math.min(sp.length - 1, Math.max(0, Math.round(ms / STEP)));
  // média curta para reduzir ruído
  return mean(sp.slice(Math.max(0, i - 2), i + 1));
}

/**
 * Métricas de uma tentativa.
 * @param {{type:string, dist:number, radius:number, hit:boolean, path:number[][], clicks:any[][], target:object, startYaw:number, startPitch:number}} tr
 */
export function trialMetrics(tr) {
  const rs = resample(tr.path);
  const sp = speeds(rs);
  const rh = tr.radius;
  const m = { type: tr.type, hit: tr.hit, reactionMs: null, endpoint: null, corrections: 0, clickSpeeds: [], strafeLag: [] };
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
    const start = targetAt(tr.target, 0);
    const dy = wrap(start.yaw - tr.startYaw), dp = start.pitch - tr.startPitch;
    const len = Math.hypot(dy, dp) || 1;
    const along = (wrap(p[1] - tr.startYaw) * dy + (p[2] - tr.startPitch) * dp) / len;
    const off = offset(tgt, p[1], p[2]);
    m.endpoint = { ms: p[0], along: along - len, alongPct: (along - len) / len, vertical: off.y / rh, dist: len };

    // Correções: quantas vezes a mira parou e acelerou de novo depois do movimento principal.
    const lo = Math.max(8, peak * 0.15), hi = Math.max(25, peak * 0.35);
    let slow = true;
    for (let i = endI; i < sp.length; i++) {
      if (slow && sp[i] > hi) { m.corrections++; slow = false; }
      else if (!slow && sp[i] < lo) slow = true;
    }
  }

  for (const [ms, yaw, pitch, res] of tr.clicks) {
    const s = speedAt(rs, sp, ms);
    m.clickSpeeds.push({ res, speed: s });
    if (tr.type === 'strafe') {
      const v = velocityAt(tr.target, ms);
      if (v !== 0) {
        const pos = targetAt(tr.target, ms);
        m.strafeLag.push((offset(pos, yaw, pitch).x * Math.sign(v)) / rh);
      }
    }
  }
  return m;
}

/**
 * Diagnóstico de um conjunto de tentativas: lista de problemas em ordem de gravidade.
 * sensHint: -1 = indica sens alta, +1 = indica sens baixa, 0 = técnica (não é a sens).
 * @returns {{id:string, title:string, detail:string, tip:string, severity:'alta'|'média'|'baixa', sensHint:number}[]}
 */
export function diagnose(trials) {
  const ms = trials.map(trialMetrics);
  const out = [];
  const pct = (x) => `${Math.round(x * 100)}%`;

  const ballistic = ms.filter((m) => (m.type === 'flick' || m.type === 'turn') && m.endpoint);
  if (ballistic.length >= 3) {
    const over = ballistic.filter((m) => m.endpoint.alongPct > 0.06).length / ballistic.length;
    const under = ballistic.filter((m) => m.endpoint.alongPct < -0.15).length / ballistic.length;
    const corr = mean(ballistic.map((m) => m.corrections));
    if (over >= 0.35) out.push({
      id: 'overshoot', severity: over >= 0.55 ? 'alta' : 'média', sensHint: -1,
      title: 'Você passa do alvo nos flicks',
      detail: `Em ${pct(over)} dos flicks a mira atravessou a cabeça e precisou voltar.`,
      tip: 'Pode ser sens alta ou braço tenso. Pense em "chegar" na cabeça, não em atravessar. Se acontecer em todas as sens, é técnica.',
    });
    if (under >= 0.45 && corr >= 1) out.push({
      id: 'undershoot', severity: under >= 0.65 ? 'alta' : 'média', sensHint: 1,
      title: 'Você chega curto e corrige em etapas',
      detail: `Em ${pct(under)} dos flicks o primeiro movimento parou antes do alvo (${dec(mean(ballistic.map((m) => m.corrections)), 1)} correções em média).`,
      tip: 'Sinal de sens baixa ou de movimento hesitante. Confie no primeiro movimento e deixe o braço ir até o fim.',
    });
    const vert = mean(ballistic.map((m) => m.endpoint.vertical));
    if (Math.abs(vert) > 1.2) out.push({
      id: vert < 0 ? 'low' : 'high', severity: Math.abs(vert) > 2 ? 'alta' : 'média', sensHint: 0,
      title: vert < 0 ? 'Sua mira chega abaixo da cabeça' : 'Sua mira chega acima da cabeça',
      detail: `No fim do flick a mira fica em média ${dec(Math.abs(vert), 1)} cabeças ${vert < 0 ? 'abaixo' : 'acima'}.`,
      tip: 'É posicionamento de mira, não sens. Deixe a mira sempre na altura da cabeça e faça flicks retos na horizontal.',
    });
  }

  const allClicks = ms.flatMap((m) => m.clickSpeeds);
  const bad = allClicks.filter((c) => c.res !== 'head');
  const moving = bad.filter((c) => c.speed > 60);
  if (bad.length >= 3 && moving.length / bad.length >= 0.4) out.push({
    id: 'clickmoving', severity: moving.length / bad.length >= 0.6 ? 'alta' : 'média', sensHint: 0,
    title: 'Você atira com a mira ainda em movimento',
    detail: `${pct(moving.length / bad.length)} dos seus erros foram com a mira passando rápido (> 60°/s).`,
    tip: 'No Valorant o tiro sai onde a mira está no instante do clique. Faça a micro-pausa: pare a mira na cabeça e só então atire.',
  });

  const bodies = allClicks.filter((c) => c.res === 'body').length;
  if (allClicks.length >= 6 && bodies / allClicks.length >= 0.2) out.push({
    id: 'body', severity: bodies / allClicks.length >= 0.35 ? 'alta' : 'média', sensHint: 0,
    title: 'Muitos tiros no corpo',
    detail: `${pct(bodies / allClicks.length)} dos cliques acertaram o corpo em vez da cabeça.`,
    tip: 'Mire na cabeça desde o começo do movimento. No Valorant, cabeça com Vandal mata com 1 tiro.',
  });

  const reactions = ms.filter((m) => m.reactionMs != null && m.type !== 'micro').map((m) => m.reactionMs);
  if (reactions.length >= 4 && mean(reactions) > 330) out.push({
    id: 'reaction', severity: mean(reactions) > 420 ? 'alta' : 'média', sensHint: 0,
    title: 'Reação lenta para começar a mirar',
    detail: `Você leva ${Math.round(mean(reactions))} ms em média para começar a mexer a mira.`,
    tip: 'Fique com a mão relaxada e pronta. Aquecer 5 minutos antes de jogar costuma baixar esse tempo.',
  });

  const micro = ms.filter((m) => m.type === 'micro');
  const microTimes = trials.filter((t) => t.type === 'micro' && t.hit).map((t) => t.time);
  if (microTimes.length >= 3 && mean(microTimes) > 0.85) out.push({
    id: 'micro', severity: mean(microTimes) > 1.2 ? 'alta' : 'média', sensHint: mean(micro.map((m) => m.corrections)) > 1.5 ? -1 : 0,
    title: 'Micro-ajuste lento',
    detail: `Ajustes pequenos (2–6°) levam ${dec(mean(microTimes), 2)} s em média.`,
    tip: 'Se a mira "treme" em volta da cabeça, a sens pode estar alta. Se é só lenta, treine ajustes curtos com o pulso.',
  });

  const lags = ms.flatMap((m) => m.strafeLag);
  if (lags.length >= 3) {
    const lag = mean(lags);
    if (lag < -0.6) out.push({
      id: 'strafe-behind', severity: lag < -1.2 ? 'alta' : 'média', sensHint: 1,
      title: 'Você fica atrás do alvo que se move',
      detail: `Nos alvos em strafe a mira ficou em média ${dec(Math.abs(lag), 1)} cabeças atrás.`,
      tip: 'Acompanhe o alvo em vez de esperar ele parar. Se ficar atrás sempre, a sens pode estar baixa.',
    });
    else if (lag > 0.6) out.push({
      id: 'strafe-ahead', severity: lag > 1.2 ? 'alta' : 'média', sensHint: -1,
      title: 'Você passa na frente do alvo que se move',
      detail: `Nos alvos em strafe a mira ficou em média ${dec(lag, 1)} cabeças à frente.`,
      tip: 'Espere o alvo entrar na mira em vez de correr atrás dele. No Valorant os bots e jogadores param para atirar.',
    });
  }

  const peeks = trials.filter((t) => t.type === 'peek');
  if (peeks.length >= 2) {
    const lost = peeks.filter((t) => !t.hit).length / peeks.length;
    if (lost >= 0.5) out.push({
      id: 'peek', severity: lost >= 0.75 ? 'alta' : 'média', sensHint: 0,
      title: 'Você perde os peeks',
      detail: `${pct(lost)} dos alvos que aparecem rápido sumiram antes do seu tiro.`,
      tip: 'Mantenha a mira onde o inimigo vai aparecer (pre-aim) para precisar só de um ajuste pequeno.',
    });
  }

  const flickTimes = trials.filter((t) => t.type === 'flick' && t.hit).map((t) => t.time);
  if (flickTimes.length >= 4) {
    const avg = mean(flickTimes);
    const sd = Math.sqrt(mean(flickTimes.map((x) => (x - avg) ** 2)));
    if (sd / avg > 0.55) out.push({
      id: 'inconsistent', severity: 'baixa', sensHint: 0,
      title: 'Tempo de flick inconsistente',
      detail: `Seus flicks variam bastante (de ${dec(Math.min(...flickTimes), 2)} s a ${dec(Math.max(...flickTimes), 2)} s).`,
      tip: 'Normal no começo. Aqueça antes e mantenha a mesma pegada no mouse.',
    });
  }

  const order = { alta: 0, 'média': 1, baixa: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Soma das dicas de sens dos problemas mais graves: <0 sugere baixar, >0 sugere subir. */
export function sensTendency(diags) {
  return diags.reduce((s, d) => s + d.sensHint * (d.severity === 'alta' ? 2 : 1), 0);
}
