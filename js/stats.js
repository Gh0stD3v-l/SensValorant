// Estatística básica usada pelo finder. Módulo puro.

export const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

export function variance(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}

export const sd = (xs) => Math.sqrt(variance(xs));

/** Gerador pseudoaleatório com semente (para resultados reproduzíveis). */
export function seeded(seed = 1) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function erf(x) {
  // Abramowitz & Stegun 7.1.26
  const sign = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return sign * y;
}
export const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

/** Intervalo de Wilson (95%) para uma proporção k/n. */
export function wilson(k, n, z = 1.96) {
  if (!n) return { p: 0, lo: 0, hi: 1 };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

/**
 * Mínimos quadrados ponderados. X: linhas de preditores (já com a coluna 1), y: alvo, w: pesos.
 * @returns {number[]|null} coeficientes, ou null se o sistema for singular
 */
export function lstsq(X, y, w = null) {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  X.forEach((row, i) => {
    const wi = w ? w[i] : 1;
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < k; b++) A[a][b] += wi * row[a] * row[b];
      A[a][k] += wi * row[a] * y[i];
    }
  });
  // Eliminação de Gauss com pivoteamento parcial.
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-10) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((row, i) => row[k] / row[i]);
}

/** Percentil (0–1) de uma lista. */
export function quantile(xs, q) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/**
 * Teste z para diferença de médias (Welch). Retorna z e a probabilidade de A ser realmente melhor que B.
 */
export function compareMeans(a, b) {
  const se = Math.sqrt(variance(a) / Math.max(1, a.length) + variance(b) / Math.max(1, b.length));
  const d = mean(a) - mean(b);
  const z = se > 0 ? d / se : d === 0 ? 0 : Math.sign(d) * 10;
  return { d, z, pA: normCdf(z) };
}
