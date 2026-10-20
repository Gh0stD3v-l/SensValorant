// Alvos do teste de mira: agentes (cabeça + corpo), tipos de exercício, movimento de strafe
// e detecção de acerto. Módulo puro (sem DOM).

import { clamp } from './valorant.js';

const DEG = Math.PI / 180;

/** Proporções do agente em múltiplos do raio da cabeça (rh). Cabeça centrada em (0, 0). */
export const BODY = {
  torso: { halfWidth: 2.4, top: -1.2, bottom: -8 },
  legs: { halfWidth: 1.5, top: -8, bottom: -15 },
};

export const TYPE_INFO = {
  flick: { name: 'Flick', desc: 'alvo parado a 15–45°' },
  turn: { name: 'Virada', desc: 'alvo fora da tela, 90–150°' },
  micro: { name: 'Micro-ajuste', desc: 'cabeça pequena a 2–6°' },
  strafe: { name: 'Strafe', desc: 'alvo andando de um lado para o outro' },
  peek: { name: 'Peek', desc: 'alvo que aparece e some rápido' },
};

export const TIMEOUT_MS = 5000;

/** Diferença de yaw em [-180, 180). */
export const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

function strafeSegments(rng, speed) {
  // ADAD: troca de direção a cada 250–650 ms, às vezes para (contra-strafe).
  const segs = [];
  let t = 0;
  let dir = rng() < 0.5 ? -1 : 1;
  while (t < TIMEOUT_MS) {
    const stop = segs.length > 0 && rng() < 0.2;
    segs.push({ t, v: stop ? 0 : dir * speed });
    t += stop ? 150 : 250 + rng() * 400;
    if (!stop) dir = -dir;
  }
  return segs;
}

/**
 * Um bloco de 8 alvos com todos os tipos. Blocos gerados com o mesmo rng têm a mesma composição.
 * @param {() => number} rng
 */
export function makeBlockPlan(rng = Math.random) {
  const side = () => (rng() < 0.5 ? 0 : 180);
  const plan = [
    { type: 'flick', dist: 15 + rng() * 30, angle: side() + (rng() - 0.5) * 24, head: 0.75 },
    { type: 'flick', dist: 15 + rng() * 30, angle: side() + (rng() - 0.5) * 24, head: 0.75 },
    { type: 'turn', dist: 90 + rng() * 60, angle: side() + (rng() - 0.5) * 6, head: 0.9 },
    { type: 'micro', dist: 2 + rng() * 4, angle: rng() * 360, head: 0.42 },
    { type: 'micro', dist: 2 + rng() * 4, angle: rng() * 360, head: 0.42 },
    { type: 'strafe', dist: 3 + rng() * 8, angle: side() + (rng() - 0.5) * 20, head: 0.6, speed: 14 + rng() * 10, segments: null },
    { type: 'strafe', dist: 3 + rng() * 8, angle: side() + (rng() - 0.5) * 20, head: 0.6, speed: 14 + rng() * 10, segments: null },
    { type: 'peek', dist: 4 + rng() * 10, angle: side() + (rng() - 0.5) * 30, head: 0.6, life: 1000 },
  ];
  for (const s of plan) if (s.type === 'strafe') s.segments = strafeSegments(rng, s.speed);
  for (let i = plan.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [plan[i], plan[j]] = [plan[j], plan[i]];
  }
  return plan;
}

/** Posiciona o alvo em relação à mira atual. Cabeças ficam perto da linha do horizonte, como no jogo. */
export function spawn(spec, yaw, pitch) {
  return {
    spec,
    yaw0: yaw + spec.dist * Math.cos(spec.angle * DEG),
    pitch0: clamp(pitch + spec.dist * Math.sin(spec.angle * DEG), -8, 8),
  };
}

function displacement(segments, ms) {
  let d = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (ms <= s.t) break;
    const end = Math.min(ms, segments[i + 1]?.t ?? Infinity);
    d += (s.v * (end - s.t)) / 1000;
  }
  return d;
}

/** Posição da cabeça no instante ms (desde o surgimento). */
export function targetAt(target, ms) {
  const yaw = target.spec.type === 'strafe' ? target.yaw0 + displacement(target.spec.segments, ms) : target.yaw0;
  return { yaw, pitch: target.pitch0 };
}

/** Velocidade horizontal (°/s) do alvo no instante ms. */
export function velocityAt(target, ms) {
  if (target.spec.type !== 'strafe') return 0;
  let v = 0;
  for (const s of target.spec.segments) if (s.t <= ms) v = s.v;
  return v;
}

export function visibleAt(target, ms) {
  return target.spec.type !== 'peek' || ms <= target.spec.life;
}

export function lifetime(spec) {
  return spec.type === 'peek' ? spec.life : TIMEOUT_MS;
}

/** Offset da mira em relação à cabeça, em graus (x para a direita, y para cima). */
export function offset(pos, yaw, pitch) {
  return { x: wrap(yaw - pos.yaw) * Math.cos(pos.pitch * DEG), y: pitch - pos.pitch };
}

/** @returns {'head'|'body'|null} */
export function hitTest(pos, rh, yaw, pitch) {
  const { x, y } = offset(pos, yaw, pitch);
  if (Math.hypot(x, y) <= rh) return 'head';
  const ax = Math.abs(x) / rh, ry = y / rh;
  const { torso, legs } = BODY;
  if (ax <= torso.halfWidth && ry <= torso.top && ry >= torso.bottom) return 'body';
  if (ax <= legs.halfWidth && ry <= legs.top && ry >= legs.bottom) return 'body';
  return null;
}
