// Matemática de sensibilidade exclusiva do Valorant.
// Módulo puro (sem DOM) para poder ser testado com `node --test`.

/** Graus girados por contagem do mouse com sens 1,0. */
export const YAW = 0.07;
export const CM_PER_INCH = 2.54;
/** cm/360 = CM360_CONST / eDPI */
export const CM360_CONST = (360 / YAW) * CM_PER_INCH; // ≈ 13062,857

/** FOV horizontal fixo do Valorant em 16:9. */
export const HFOV_16_9 = 103;
/** FOV vertical equivalente (o jogo mantém o vertical e ajusta o horizontal ao aspecto). */
export const VFOV = (2 * Math.atan(Math.tan((HFOV_16_9 / 2) * Math.PI / 180) * 9 / 16) * 180) / Math.PI;

export const SENS_MIN = 0.01;
export const SENS_MAX = 10;
export const EDPI_MIN = 100;
export const EDPI_MAX = 700;

export const edpi = (sens, dpi) => sens * dpi;
export const cm360 = (sens, dpi) => CM360_CONST / (sens * dpi);
export const inch360 = (sens, dpi) => cm360(sens, dpi) / CM_PER_INCH;
export const sensFromCm360 = (cm, dpi) => CM360_CONST / (cm * dpi);
export const sensFromEdpi = (e, dpi) => e / dpi;
/** Mesma sensação (mesmo eDPI) com outro DPI. */
export const convertDpi = (sens, fromDpi, toDpi) => (sens * fromDpi) / toDpi;
export const roundSens = (s) => Math.round(s * 1000) / 1000;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Jogos com yaw conhecido e confiável. Para os demais, converter via cm/360. */
export const GAMES = {
  cs2: { name: 'CS2 / CS:GO', yaw: 0.022 },
  apex: { name: 'Apex Legends', yaw: 0.022 },
  source: { name: 'Jogos Source / Quake (yaw 0,022)', yaw: 0.022 },
  ow2: { name: 'Overwatch 2', yaw: 0.0066 },
};

/** Converte a sens de outro jogo para o Valorant (360° igual). */
export function fromOtherGame(sens, gameYaw, dpiFrom, dpiTo = dpiFrom) {
  return (sens * gameYaw * dpiFrom) / (YAW * dpiTo);
}

/** Converte a sens do Valorant para outro jogo (360° igual, mesmo DPI). */
export function toOtherGame(sens, gameYaw) {
  return (sens * YAW) / gameYaw;
}

/**
 * Zoom de cada mira (para referência). O multiplicador padrão 1,0 já escala pelo zoom.
 */
export const ZOOMS = [
  { zoom: 1.15, weapons: 'Stinger, Spectre, Ares, Odin' },
  { zoom: 1.25, weapons: 'Bulldog, Phantom, Vandal' },
  { zoom: 1.5, weapons: 'Guardian, Headhunter' },
  { zoom: 2.5, weapons: 'Operator (1º zoom), Tour de Force' },
  { zoom: 3.5, weapons: 'Marshal, Outlaw' },
  { zoom: 5, weapons: 'Operator (2º zoom)' },
];

// ---------------------------------------------------------------------------
// Distribuição de eDPI dos profissionais (aproximação log-normal).
// Base: ProSettings (701 pros, out/2026: média 267, mediana 240),
// ValDB (set/2026: média 247, mediana 224) e Turbosmurfs (699 pros, mai/2026).
// Mediana usada: 235. Sigma 0,34 reproduz o intervalo interquartil ~185–295.
// ---------------------------------------------------------------------------
export const PRO_MEDIAN_EDPI = 235;
export const PRO_SIGMA = 0.34;
export const PRO_AVG_EDPI = 267;

function erf(x) {
  // Abramowitz & Stegun 7.1.26
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

/** Percentil (0–100) do eDPI em relação aos pros: % de pros com eDPI menor. */
export function proPercentile(e) {
  return 100 * normCdf((Math.log(e) - Math.log(PRO_MEDIAN_EDPI)) / PRO_SIGMA);
}

export function edpiLabel(e) {
  if (e < 160) return 'muito baixa';
  if (e < 210) return 'baixa';
  if (e < 260) return 'média-baixa';
  if (e < 310) return 'média';
  if (e < 380) return 'média-alta';
  if (e < 480) return 'alta';
  return 'muito alta';
}

// ---------------------------------------------------------------------------
// Ponto de partida a partir do perfil do jogador.
// ---------------------------------------------------------------------------
export const STYLE_FACTOR = { braco: 0.85, misto: 1.0, pulso: 1.12, dedos: 1.25 };
/**
 * Pegada: pesa menos que o estilo de mira (as duas andam juntas). Palm costuma ir com braço e sens
 * mais baixa; fingertip com pulso/dedos e sens mais alta. É tendência, não regra.
 */
export const GRIP_FACTOR = { palm: 0.95, claw: 1.0, fingertip: 1.06 };
export const GRIP_LABEL = { palm: 'palm', claw: 'claw', fingertip: 'fingertip' };
export const STYLE_LABEL = { braco: 'braço', misto: 'misto', pulso: 'pulso', dedos: 'dedos' };
export const ROLE_FACTOR = { duelista: 1.05, iniciador: 1.0, controlador: 0.95, sentinela: 0.95, flex: 1.0 };

export function padFactor(padWidthCm) {
  if (!padWidthCm) return 1;
  if (padWidthCm >= 80) return 0.92;
  if (padWidthCm >= 45) return 1.0;
  if (padWidthCm >= 35) return 1.1;
  return 1.2;
}

/**
 * Sugere a sens inicial da busca.
 * @param {{dpi:number, currentSens?:number, style?:string, grip?:string, role?:string, padWidthCm?:number}} p
 * @returns {{sens:number, edpi:number, profileEdpi:number, reasons:string[]}}
 */
export function suggestStart(p) {
  const reasons = [];
  let profile = PRO_MEDIAN_EDPI;
  reasons.push(`Base: mediana dos pros (~${PRO_MEDIAN_EDPI} de eDPI).`);
  const sf = STYLE_FACTOR[p.style] ?? 1;
  if (sf !== 1) reasons.push(`Estilo de mira (${STYLE_LABEL[p.style] ?? p.style}): ×${sf}.`);
  const gf = GRIP_FACTOR[p.grip] ?? 1;
  if (gf !== 1) reasons.push(`Pegada ${GRIP_LABEL[p.grip]}: ×${gf}.`);
  const pf = padFactor(p.padWidthCm);
  if (pf !== 1) reasons.push(`Mousepad de ${p.padWidthCm} cm: ×${pf}.`);
  const rf = ROLE_FACTOR[p.role] ?? 1;
  if (rf !== 1) reasons.push(`Função (${p.role}): ×${rf}.`);
  profile *= sf * gf * pf * rf;

  let e = profile;
  if (p.currentSens > 0) {
    const cur = p.currentSens * p.dpi;
    // Média geométrica com peso maior no hábito atual (memória muscular).
    e = Math.exp(0.6 * Math.log(cur) + 0.4 * Math.log(profile));
    reasons.push(`Mistura com o seu eDPI atual (${Math.round(cur)}): 60% atual + 40% perfil.`);
  }
  e = clamp(e, EDPI_MIN, EDPI_MAX);
  const sens = roundSens(e / p.dpi);
  return { sens, edpi: sens * p.dpi, profileEdpi: profile, reasons };
}

/** Objetos de tamanho padrão para medir uma distância real com o mouse. */
export const CAL_REFS = {
  cartao: { name: 'Cartão de banco (lado maior)', cm: 8.56 },
  a4: { name: 'Folha A4 (lado maior)', cm: 29.7 },
  regua: { name: 'Régua (10 cm)', cm: 10 },
};

/**
 * Calibração do mouse no navegador: compara as contagens recebidas num movimento de distância
 * conhecida com o DPI informado. Detecta escala do Windows/navegador e aceleração do mouse.
 * @param {{counts:number, speed:'lento'|'rapido'}[]} swipes
 * @param {number} refCm distância real percorrida
 * @param {number} dpi DPI informado pelo jogador
 * @returns {{measuredDpi:number, dpis:number[], ratio:number, factor:number, ok:boolean, accel:boolean}}
 */
export function calibrationResult(swipes, refCm, dpi) {
  const inch = refCm / CM_PER_INCH;
  const dpis = swipes.map((s) => Math.abs(s.counts) / inch);
  const accel = dpis.length >= 2 && Math.max(...dpis) / Math.min(...dpis) > 1.12;
  // Com aceleração, o movimento lento é o mais próximo do real.
  const slow = swipes.findIndex((s) => s.speed === 'lento');
  const measuredDpi = accel && slow >= 0 ? dpis[slow] : dpis.reduce((s, x) => s + x, 0) / dpis.length;
  const ratio = measuredDpi / dpi;
  // Medir com régua/cartão tem erro de alguns %: até 7% de diferença é considerado igual.
  const ok = Math.abs(ratio - 1) <= 0.07;
  return { measuredDpi, dpis, ratio, factor: ok ? 1 : dpi / measuredDpi, ok, accel };
}

/**
 * Checa se o jogador consegue virar 180° sem levantar o mouse.
 * @returns {{cm180:number, ratio:number, ok:boolean, msg:string}|null}
 */
export function turnCheck(sens, dpi, padWidthCm) {
  if (!padWidthCm) return null;
  const cm180 = cm360(sens, dpi) / 2;
  const ratio = cm180 / padWidthCm;
  if (ratio > 0.85) return { cm180, ratio, ok: false, msg: 'Um giro de 180° ocupa quase todo o mousepad (ou mais). Você vai precisar levantar o mouse em viradas rápidas.' };
  if (ratio > 0.6) return { cm180, ratio, ok: true, msg: 'O giro de 180° cabe no mousepad, mas fica no limite. Ok para quem mira com o braço.' };
  return { cm180, ratio, ok: true, msg: 'O giro de 180° cabe com folga no mousepad.' };
}
