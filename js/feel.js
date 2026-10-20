// Sensação de velocidade da mira (Campo de Tiro). Módulo puro.
//
// Escala "no ponto" (Just-About-Right, ASTM MNL 63) com 5 níveis, de -2 (muito lenta) a +2 (muito rápida).
// Ela diz a DIREÇÃO, que é o que importa para achar a sens:
//   - "lenta" numa sens s  → a sens ideal é MAIOR que s (limite de baixo);
//   - "rápida" numa sens s → a sens ideal é MENOR que s (limite de cima).
// O ponto ideal fica onde a resposta vira de lenta para rápida (ponto de igualdade subjetiva, PSE).

import { lstsq, mean } from './stats.js';

export const JAR = [
  { v: -2, label: 'Muito lenta', hint: 'chega bem atrasado no alvo' },
  { v: -1, label: 'Um pouco lenta', hint: 'chega um pouco atrasado' },
  { v: 0, label: 'No ponto', hint: 'chega certo no alvo' },
  { v: 1, label: 'Um pouco rápida', hint: 'passa um pouco do alvo' },
  { v: 2, label: 'Muito rápida', hint: 'passa muito do alvo, mira treme' },
];
export const jarLabel = (v) => JAR.find((x) => x.v === Math.round(v))?.label ?? '–';

/**
 * Limites da sens ideal a partir dos julgamentos.
 * @param {{sens:number, j:number}[]} js
 * @returns {{lo:number|null, hi:number|null, conflict:boolean}}
 */
export function bracket(js) {
  const slow = js.filter((x) => x.j < 0).map((x) => x.sens);
  const fast = js.filter((x) => x.j > 0).map((x) => x.sens);
  const lo = slow.length ? Math.max(...slow) : null;
  const hi = fast.length ? Math.min(...fast) : null;
  // Lenta numa sens mais alta que outra que achou rápida: respostas contraditórias.
  const conflict = lo != null && hi != null && lo >= hi;
  return { lo, hi, conflict };
}

/**
 * Ponto de igualdade subjetiva: a sens em que você responderia "no ponto".
 * Regressão do julgamento contra ln(sens) (o julgamento tem que subir com a sens).
 * @param {{sens:number, j:number}[]} js
 */
export function pse(js) {
  const distinct = new Set(js.map((x) => x.sens.toFixed(3))).size;
  if (js.length < 2 || distinct < 2) return null;
  const ref = Math.exp(mean(js.map((x) => Math.log(x.sens))));
  const b = lstsq(js.map((x) => [1, Math.log(x.sens / ref)]), js.map((x) => x.j));
  if (!b || b[1] <= 0.3) return null; // não sobe com a sens: sem direção confiável
  const sens = ref * Math.exp(-b[0] / b[1]);
  const smin = Math.min(...js.map((x) => x.sens)), smax = Math.max(...js.map((x) => x.sens));
  // Extrapolar um pouco é ok (todas lentas → ideal acima da mais alta), muito não.
  const clamped = Math.min(smax * 1.3, Math.max(smin / 1.3, sens));
  return { sens: clamped, slope: b[1], extrapolated: sens < smin || sens > smax };
}

/**
 * Qual lado escolher pela sensação, comparando a média dos julgamentos de A e B.
 * @param {{sens:number, kind:'low'|'high', j:number|null}} A
 * @param {{sens:number, kind:'low'|'high', j:number|null}} B
 * @returns {{pick:'A'|'B'|'tie', target?:number, reason:string}|null}
 */
export function feelPick(A, B) {
  const side = (s) => (s === A ? 'A' : 'B');
  const low = A.kind === 'low' ? A : B, high = A.kind === 'high' ? A : B;
  if (low.j == null && high.j == null) return null;
  if (low.j != null && high.j != null) {
    if (low.j < 0 && high.j > 0) {
      // Uma lenta e outra rápida: o ideal está entre as duas, no ponto em que a resposta vira.
      const k = -low.j / (high.j - low.j);
      const target = Math.exp(Math.log(low.sens) + k * (Math.log(high.sens) - Math.log(low.sens)));
      return { pick: 'tie', target, reason: `Você sentiu ${jarLabel(low.j).toLowerCase()} a ${fmt(low.sens)} e ${jarLabel(high.j).toLowerCase()} a ${fmt(high.sens)}: o ideal está entre as duas, perto de ${fmt(target)}.` };
    }
    if (low.j < 0 && high.j < 0) return { pick: side(high), reason: 'As duas pareceram lentas: o ideal está acima da mais alta. A busca vai subir.' };
    if (low.j > 0 && high.j > 0) return { pick: side(low), reason: 'As duas pareceram rápidas: o ideal está abaixo da mais baixa. A busca vai descer.' };
    if (low.j === 0 && high.j !== 0) return { pick: side(low), reason: `A ${fmt(low.sens)} ficou no ponto e a outra não.` };
    if (high.j === 0 && low.j !== 0) return { pick: side(high), reason: `A ${fmt(high.sens)} ficou no ponto e a outra não.` };
    if (low.j > 0 && high.j < 0) return null; // contraditório: decide pelos abates
    return null; // as duas no ponto: decide pelos abates
  }
  // Só um lado respondido.
  const known = low.j != null ? low : high;
  if (known.j < 0) return { pick: side(high), reason: `A ${fmt(known.sens)} pareceu lenta: o ideal está acima dela.` };
  if (known.j > 0) return { pick: side(low), reason: `A ${fmt(known.sens)} pareceu rápida: o ideal está abaixo dela.` };
  return null;
}

const fmt = (s) => s.toFixed(3).replace('.', ',');
