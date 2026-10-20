import * as V from './valorant.js';
import { SensFinder } from './finder.js';
import { summarize, compare } from './scoring.js';
import { makeBlockPlan, TYPE_INFO } from './targets.js';
import { diagnose, sensTendency, sensTrends, sessionTrend, trialMetrics, movementProfile } from './analysis.js';
import { fitCurve, equilibrium, combineEstimates, rangeVerdict, combineSessions, CURVE_WEIGHT } from './model.js';
import { mean } from './stats.js';
import { Drill, CountMeter } from './drill.js';
import { ReplayPlayer } from './replay.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const num = (n, d = 3) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const readNum = (el) => parseFloat(String(el.value).replace(',', '.'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HISTORY_KEY = 'sensfinder.history';
const SESSIONS_KEY = 'sensfinder.sessions';
const SCOPED_KEY = 'sensfinder.scoped';
const CAL_KEY = 'sensfinder.cal';
const hasMouse = window.matchMedia('(pointer: fine)').matches;

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* sem armazenamento */ }
  return null;
}

// ---------------- Abas ----------------
$$('.tab').forEach((b) => b.addEventListener('click', () => {
  $$('.tab').forEach((t) => { t.classList.toggle('active', t === b); t.setAttribute('aria-selected', t === b); });
  $$('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${b.dataset.tab}`; });
}));

// ---------------- Navegação entre passos ----------------
const STEPS = ['profile', 'start', 'calibrate', 'test', 'range', 'choice', 'result', 'scoped', 'replay'];
let current = 'profile';
function show(step) {
  if (current === 'replay' && step !== 'replay') player.stop();
  current = step;
  STEPS.forEach((s) => { $(`#step-${s}`).hidden = s !== step; });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));

// ---------------- Perfil ----------------
for (const [key, g] of Object.entries(V.GAMES)) {
  $('#f-game').add(new Option(g.name, key));
  $('#c3-game').add(new Option(g.name, key));
}
$('#f-game').addEventListener('change', () => { $('#f-game-sens').disabled = !$('#f-game').value; });
if (!hasMouse) {
  $('#mode-browser input').disabled = true;
  $('#mode-browser').classList.add('disabled');
  $('#mobile-note').hidden = false;
}
const syncMode = () => { $('#attempts-wrap').hidden = document.querySelector('input[name=mode]:checked').value !== 'range'; };
$$('input[name=mode]').forEach((r) => r.addEventListener('change', syncMode));
syncMode();

const st = { kind: 'sens', profile: null, finder: null, mode: 'range', results: null, warmup: false, trials: [], points: [], clock: 0, rangeQueue: [], rangeLog: { A: [], B: [] } };

function readProfile() {
  const dpi = readNum($('#f-dpi'));
  let currentSens = readNum($('#f-sens'));
  const game = $('#f-game').value;
  const gameSens = readNum($('#f-game-sens'));
  let converted = null;
  if (!(currentSens > 0) && game && gameSens > 0) {
    currentSens = V.fromOtherGame(gameSens, V.GAMES[game].yaw, dpi);
    converted = { game: V.GAMES[game].name, gameSens, sens: currentSens };
  }
  return {
    dpi,
    currentSens: currentSens > 0 ? currentSens : undefined,
    converted,
    style: document.querySelector('input[name=style]:checked').value,
    grip: document.querySelector('input[name=grip]:checked').value || undefined,
    padWidthCm: +$('#f-pad').value,
    role: $('#f-role').value,
    mode: document.querySelector('input[name=mode]:checked').value,
    attempts: +$('#f-attempts').value,
  };
}

function statLine(sens, dpi) {
  const e = sens * dpi;
  return `<div class="stats">
    <div><span>Sens</span><strong>${num(sens)}</strong></div>
    <div><span>eDPI</span><strong>${Math.round(e)}</strong></div>
    <div><span>cm/360</span><strong>${num(V.cm360(sens, dpi), 1)}</strong></div>
    <div><span>vs. pros</span><strong>${Math.round(V.proPercentile(e))}º pct</strong></div>
  </div>`;
}

function calibration() {
  const c = store(CAL_KEY);
  return c && st.profile && c.dpi === st.profile.dpi ? c : null;
}

function renderCalStatus() {
  const c = calibration();
  const el = $('#cal-status');
  if (!c) {
    el.className = 'note warn';
    el.innerHTML = 'Mouse ainda não calibrado. Leva 30 segundos e evita a diferença de sensação entre o site e o jogo.';
  } else if (c.ok) {
    el.className = 'note ok';
    el.textContent = `Calibrado: o navegador recebe ~${Math.round(c.measuredDpi)} DPI (você informou ${c.dpi}). Sem correção necessária.`;
  } else {
    el.className = 'note ok';
    el.textContent = `Calibrado: o navegador recebe ~${Math.round(c.measuredDpi)} DPI em vez de ${c.dpi}. O teste corrige isso automaticamente (×${num(c.factor, 2)}).`;
  }
}

$('#profile-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const p = readProfile();
  if (!(p.dpi >= 100)) return;
  st.profile = p;
  const s = V.suggestStart(p);
  st.startSens = s.sens;
  const tc = V.turnCheck(s.sens, p.dpi, p.padWidthCm);
  $('#start-summary').innerHTML = `
    ${p.converted ? `<p>${esc(p.converted.game)} ${num(p.converted.gameSens)} equivale a <strong>${num(p.converted.sens)}</strong> no Valorant com ${p.dpi} DPI.</p>` : ''}
    ${statLine(s.sens, p.dpi)}
    <p>Faixa <strong>${V.edpiLabel(s.edpi)}</strong>. A busca começa testando ~40% abaixo e acima e vai trocando de sens até convergir. Em geral leva de 5 a 8 rodadas.</p>
    <ul class="reasons">${s.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    ${tc ? `<p class="${tc.ok ? 'ok' : 'warn'}">Giro de 180° = ${num(tc.cm180, 1)} cm. ${tc.msg}</p>` : ''}
    ${p.mode === 'range' ? '<p class="note">Antes da rodada 1, faça 2 Testes de tiro com a sua sens atual sem anotar. O começo da sessão é aquecimento e distorce a comparação.</p>' : ''}`;
  const browser = p.mode === 'browser';
  $('#browser-opts').hidden = !browser;
  $('#btn-calibrate').hidden = !browser;
  if (browser) renderCalStatus();
  show('start');
});

// ---------------- Calibração ----------------
for (const [k, r] of Object.entries(V.CAL_REFS)) $('#cal-ref').add(new Option(`${r.name}: ${num(r.cm, 2)} cm`, k));
const cal = { swipes: [] };
const SWIPE_SPEEDS = ['lento', 'rapido'];
function calLabel() {
  const i = cal.swipes.length;
  if (i >= 2) return 'Pronto. Confira o resultado abaixo.';
  return `Movimento ${i + 1} de 2: ${i === 0 ? 'devagar' : 'rápido'}. Clique para começar`;
}
function resetCal() {
  cal.swipes = [];
  $('#cal-counts').textContent = '0';
  $('#cal-label').textContent = calLabel();
  $('#cal-result').innerHTML = '';
  $('#cal-save').disabled = true;
}
new CountMeter($('#cal-pad'), (counts, final) => {
  $('#cal-counts').textContent = Math.abs(counts).toLocaleString('pt-BR');
  if (!final) {
    $('#cal-label').textContent = 'Medindo… arraste até a outra ponta e clique para parar';
    return;
  }
  if (cal.swipes.length >= 2) return;
  if (Math.abs(counts) < 50) { $('#cal-label').textContent = 'Movimento muito curto. ' + calLabel(); return; }
  cal.swipes.push({ counts, speed: SWIPE_SPEEDS[cal.swipes.length] });
  $('#cal-label').textContent = calLabel();
  if (cal.swipes.length === 2) {
    const ref = V.CAL_REFS[$('#cal-ref').value];
    const r = V.calibrationResult(cal.swipes, ref.cm, st.profile.dpi);
    cal.result = r;
    $('#cal-result').innerHTML = `
      <div class="stats">
        <div><span>DPI informado</span><strong>${st.profile.dpi}</strong></div>
        <div><span>Recebido (devagar)</span><strong>${Math.round(r.dpis[0])}</strong></div>
        <div><span>Recebido (rápido)</span><strong>${Math.round(r.dpis[1])}</strong></div>
      </div>
      ${r.accel ? '<p class="warn">A diferença entre devagar e rápido indica <strong>aceleração do mouse</strong>. Desligue "Aumentar precisão do ponteiro" no Windows e a aceleração do software do mouse. No Valorant isso não pesa, mas aqui no navegador pode pesar.</p>' : ''}
      ${r.ok ? '<p class="ok">O navegador recebe o mouse igual ao jogo. Nenhuma correção necessária.</p>'
        : `<p class="warn">O navegador recebe ${Math.round(r.measuredDpi)} DPI em vez de ${st.profile.dpi} (${r.ratio < 1 ? 'provavelmente a escala de tela do Windows' : 'o DPI real do mouse pode ser diferente do informado; confira no software do mouse'}). O teste vai corrigir com ×${num(r.factor, 2)}.</p>`}
      <p class="muted small">Se o número ficou muito diferente, confira se o objeto não escorregou e refaça.</p>`;
    $('#cal-save').disabled = false;
  }
});
$('#btn-calibrate').addEventListener('click', () => { resetCal(); show('calibrate'); });
$('#cal-redo').addEventListener('click', resetCal);
$('#cal-ref').addEventListener('change', resetCal);
$('#cal-back').addEventListener('click', () => show('start'));
$('#cal-save').addEventListener('click', () => {
  const r = cal.result;
  store(CAL_KEY, { dpi: st.profile.dpi, measuredDpi: r.measuredDpi, factor: r.factor, ok: r.ok, accel: r.accel, date: new Date().toISOString() });
  renderCalStatus();
  show('start');
});

// ---------------- Busca ----------------
const drill = new Drill($('#stage'), $('#drill-canvas'), { onDone: onDrillDone, onState: onDrillState });

$('#btn-begin').addEventListener('click', () => {
  const p = st.profile;
  st.mode = p.mode;
  st.trials = [];
  st.points = [];
  st.clock = 0;
  st.stoppedByUser = false;
  st.kind = 'sens';
  st.sessionId = Date.now().toString(36);
  st.finder = new SensFinder({ startSens: st.startSens, dpi: p.dpi });
  if (st.mode === 'browser' && $('#f-warmup').checked) {
    st.warmup = true;
    show('test');
    $('#test-title').textContent = 'Aquecimento';
    $('#test-sub').textContent = '· não conta na pontuação';
    drill.run({ blocks: [{ label: 'Aquecimento', sens: st.startSens, plan: makeBlockPlan() }], ...drillOpts() });
  } else {
    startRound();
  }
});

function drillOpts() {
  return { countScale: calibration()?.factor ?? 1, fullscreen: $('#f-fullscreen').checked };
}

function roundLabel() {
  const f = st.finder;
  return `Rodada ${f.round + 1}`;
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startRound() {
  const { A, B } = st.finder.pair;
  if (st.mode === 'browser') {
    show('test');
    $('#test-title').textContent = roundLabel();
    $('#test-sub').textContent = '· 32 alvos, Sens A e Sens B alternadas';
    const p1 = makeBlockPlan(), p2 = makeBlockPlan();
    drill.run({
      blocks: [
        { label: 'Sens A', sens: A.sens, plan: p1 },
        { label: 'Sens B', sens: B.sens, plan: shuffled(p1) },
        { label: 'Sens B', sens: B.sens, plan: p2 },
        { label: 'Sens A', sens: A.sens, plan: shuffled(p2) },
      ],
      ...drillOpts(),
    });
  } else {
    st.rangeLog = { A: [], B: [] };
    st.roundPoints = [];
    queueRange(st.profile.attempts === 2 ? ['A', 'B', 'B', 'A'] : ['A', 'B']);
    nextRangeAttempt();
  }
}

function onDrillState({ raw, locked }) {
  const b = $('#raw-badge');
  if (raw === null) return;
  b.hidden = false;
  b.textContent = raw ? 'Entrada crua: ativa' : 'Entrada crua: indisponível';
  b.className = `badge ${raw ? 'ok' : 'warn'}`;
  b.title = raw ? '' : 'Seu navegador pode aplicar a aceleração do sistema. Use o Chrome ou o Edge e faça a calibração.';
  if (!locked && st.lowFps) b.title += ' FPS baixo detectado.';
}

function onDrillDone({ blocks, fps }) {
  st.fps = fps;
  if (st.warmup) {
    st.warmup = false;
    startRound();
    return;
  }
  const round = st.finder.round + 1;
  const tag = (t, side) => ({ ...t, round, side });
  const aTrials = [...blocks[0].trials, ...blocks[3].trials].map((t) => tag(t, 'A'));
  const bTrials = [...blocks[1].trials, ...blocks[2].trials].map((t) => tag(t, 'B'));
  st.roundTrials = [...aTrials, ...bTrials];
  // Cada bloco vira um ponto da curva desempenho × sens (t = ordem, para descontar aprendizado).
  st.roundPoints = blocks.map((b, i) => ({ sens: b.sens, value: summarize(b.trials).score, t: st.clock + i }));
  const baseline = [...st.trials, ...st.roundTrials];
  st.results = {
    A: { ...st.finder.pair.A, trials: aTrials, stats: summarize(aTrials), blocks: [summarize(blocks[0].trials), summarize(blocks[3].trials)], diags: diagnose(aTrials, { baseline }) },
    B: { ...st.finder.pair.B, trials: bTrials, stats: summarize(bTrials), blocks: [summarize(blocks[1].trials), summarize(blocks[2].trials)], diags: diagnose(bTrials, { baseline }) },
  };
  showChoice();
}

// ---------------- Campo de Tiro ----------------
function nextRangeAttempt() {
  const item = st.rangeQueue[0];
  const cand = st.finder.pair[item.side];
  show('range');
  const scoped = st.kind === 'scoped';
  $('#range-title').textContent = `${roundLabel()} · ${scoped ? 'Multiplicador' : 'Sens'} ${item.side}`;
  $('#range-sub').textContent = `tentativa ${item.n}`;
  $('#range-sens').textContent = scoped ? `${num(cand.sens)}×` : num(cand.sens);
  $('#range-what').textContent = scoped ? 'Coloque em "Multiplicador de sensibilidade com mira"' : 'Coloque no Valorant';
  $('#routine-sens').hidden = scoped;
  $('#routine-scoped').hidden = !scoped;
  $('#range-kills').value = '';
  $$('input[name=feel]').forEach((c) => { c.checked = false; });
  $$('input[name=rating]').forEach((c) => { c.checked = false; });
  const firstOfRound = !st.rangeLog.A.length && !st.rangeLog.B.length;
  $('#range-break').hidden = !(firstOfRound && st.finder.round > 0 && st.finder.round % 3 === 0);
  $('#range-kills').focus({ preventScroll: true });
}

function queueRange(order) {
  const done = { A: st.rangeLog.A.length, B: st.rangeLog.B.length };
  st.rangeQueue = order.map((side) => ({ side, n: ++done[side] }));
}

$('#btn-range-done').addEventListener('click', () => {
  const item = st.rangeQueue.shift();
  const k = readNum($('#range-kills'));
  const feel = $$('input[name=feel]:checked').map((c) => c.value);
  const r = document.querySelector('input[name=rating]:checked');
  const kills = Number.isFinite(k) ? k : null;
  st.rangeLog[item.side].push({ kills, feel, rating: r ? +r.value : null });
  if (kills != null) st.roundPoints.push({ sens: st.finder.pair[item.side].sens, value: kills, t: st.clock++ });
  if (st.rangeQueue.length) nextRangeAttempt();
  else {
    const side = (s) => {
      const log = st.rangeLog[s];
      const ks = log.map((x) => x.kills).filter((x) => x != null);
      const rs = log.map((x) => x.rating).filter((x) => x != null);
      const flags = {};
      for (const x of log) for (const f of x.feel) flags[f] = (flags[f] || 0) + 1;
      return { ...st.finder.pair[s], log, kills: ks, avg: ks.length ? mean(ks) : null, rating: rs.length ? mean(rs) : null, flags };
    };
    st.results = { A: side('A'), B: side('B') };
    showChoice();
  }
});

const FEEL_TEXT = { over: 'passou do alvo', under: 'chegou curto', shaky: 'mira tremendo', good: 'confortável' };
const LEVEL_TEXT = { real: 'diferença real', 'provável': 'provavelmente real', 'pode ser sorte': 'pode ser sorte' };

function rangeSuggestion(A, B) {
  const notes = [];
  const lowS = A.kind === 'low' ? A : B, highS = A.kind === 'high' ? A : B;
  if (highS.flags.over && !lowS.flags.over) notes.push('Você passou do alvo só na opção mais alta: o ideal deve estar entre as duas ou abaixo.');
  if (lowS.flags.under && !highS.flags.under) notes.push('Você chegou curto só na opção mais baixa: o ideal deve estar entre as duas ou acima.');
  if (A.flags.shaky && B.flags.shaky) notes.push('Mira tremendo nas duas: pode ser cansaço. Descanse 1 minuto antes da próxima rodada.');
  const v = rangeVerdict(A.kills, B.kills);
  const byRating = A.rating != null && B.rating != null && Math.abs(A.rating - B.rating) >= 1 ? (A.rating > B.rating ? 'A' : 'B') : null;
  if (!v) return byRating ? { pick: byRating, confidence: 'baixa', notes: ['Sem abates anotados: sugestão pela nota de controle.', ...notes] } : null;
  notes.unshift(`${num(Math.abs(v.d), 1)} abate${Math.abs(v.d) >= 1.5 ? 's' : ''} de diferença por tentativa: ${LEVEL_TEXT[v.level]} (chance de ${v.d >= 0 ? 'A' : 'B'} ser mesmo melhor: ${Math.round(100 * Math.max(v.pA, 1 - v.pA))}%).`);
  if (v.level === 'real') return { pick: v.d > 0 ? 'A' : 'B', confidence: 'alta', notes, verdict: v };
  if (v.level === 'provável') return { pick: v.d > 0 ? 'A' : 'B', confidence: 'média', notes: [...notes, 'Uma tentativa a mais de cada deixa a decisão mais segura.'], verdict: v };
  if (byRating) return { pick: byRating, confidence: 'baixa', notes: [...notes, `Abates empatados: a Sens ${byRating} teve nota de controle maior.`], verdict: v };
  return { pick: 'tie', confidence: 'baixa', notes: [...notes, 'Abates e controle empatados: escolha pela sensação ou faça mais 1 tentativa de cada.'], verdict: v };
}

/** Ajuste fino a partir das marcações: passou do alvo → desce 3%, chegou curto → sobe 3%. */
function rangeNudge(pick) {
  if (st.mode !== 'range' || (pick !== 'A' && pick !== 'B')) return 0;
  const f = st.results[pick].flags;
  return (f.under ? 0.03 : 0) - (f.over ? 0.03 : 0);
}

// ---------------- Modelo de desempenho ----------------
function currentFit(extra = []) {
  return fitCurve([...st.points, ...extra]);
}

function guideFrom(fit) {
  if (!fit?.ok || fit.edge || fit.confidence === 'baixa') return null;
  return { sens: fit.opt, weight: fit.confidence === 'alta' ? 0.5 : 0.3 };
}

// ---------------- Escolha ----------------
const confTag = (c) => `<span class="conf conf-${c === 'alta' ? 'alta' : 'media'}">${c === 'alta' ? 'certeza alta' : 'pode ser'}</span>`;

function diagList(diags, max = 3) {
  if (!diags.length) return '<p class="ok small">Nenhum problema claro nesta sens.</p>';
  return `<ul class="diag">${diags.slice(0, max).map((d) => `<li class="sev-${d.severity === 'média' ? 'media' : d.severity}"><strong>${esc(d.title)} ${confTag(d.confidence)}</strong><span>${esc(d.detail)}</span></li>`).join('')}</ul>`;
}

function showChoice() {
  const { A, B } = st.results;
  const f = st.finder;
  $('#choice-title').textContent = `${roundLabel()}: qual foi melhor?`;
  let suggestion = null;
  const noun = st.kind === 'scoped' ? 'Multiplicador' : 'Sens';
  const head = `<thead><tr><th></th><th>${noun} A</th><th>${noun} B</th></tr></thead>`;
  if (st.mode === 'browser') {
    const row = (label, fn) => `<tr><th>${label}</th><td>${fn(A.stats)}</td><td>${fn(B.stats)}</td></tr>`;
    $('#choice-table').innerHTML = `<table class="tbl ab">${head}<tbody>
      ${row('Pontuação', (s) => num(s.score, 2))}
      ${row('Precisão na cabeça', (s) => `${Math.round(s.accuracy * 100)}%`)}
      ${row('Tempo médio no flick', (s) => `${num(s.flickTime, 2)} s`)}
      ${row('Tempo no micro-ajuste', (s) => `${num(s.microTime, 2)} s`)}
      ${row('Tempo no strafe', (s) => `${num(s.strafeTime, 2)} s`)}
      ${row('Peeks pegos', (s) => (s.peekRate == null ? '–' : `${Math.round(s.peekRate * 100)}%`))}
      ${row('Passou do alvo', (s) => `${Math.round(s.overshootPct)}%`)}
    </tbody></table>`;
    suggestion = compare(A, B);
    $('#choice-diag').innerHTML = `<div><h3>O que você errou com A</h3>${diagList(A.diags)}</div><div><h3>O que você errou com B</h3>${diagList(B.diags)}</div>`;
    if (st.fps && st.fps < 90) suggestion.notes.push(`Seu navegador rodou a ~${Math.round(st.fps)} FPS. Abaixo de 90 a mira parece mais pesada que no jogo.`);
  } else {
    const att = (s) => s.log.map((x) => x.kills ?? '–').join(' + ');
    const feel = (s) => Object.keys(s.flags).map((k) => `${FEEL_TEXT[k]}${s.flags[k] > 1 ? ` (${s.flags[k]}×)` : ''}`).join(', ') || '–';
    $('#choice-table').innerHTML = `<table class="tbl ab">${head}<tbody>
      <tr><th>${st.kind === 'scoped' ? 'Multiplicador' : 'Sens'}</th><td>${num(A.sens)}</td><td>${num(B.sens)}</td></tr>
      <tr><th>Abates por tentativa</th><td>${att(A)}</td><td>${att(B)}</td></tr>
      <tr><th>Média</th><td>${A.avg == null ? '–' : num(A.avg, 1)}</td><td>${B.avg == null ? '–' : num(B.avg, 1)}</td></tr>
      <tr><th>Nota de controle</th><td>${A.rating == null ? '–' : `${num(A.rating, 1)}/5`}</td><td>${B.rating == null ? '–' : `${num(B.rating, 1)}/5`}</td></tr>
      <tr><th>Como sentiu</th><td>${feel(A)}</td><td>${feel(B)}</td></tr></tbody></table>`;
    suggestion = rangeSuggestion(A, B);
    $('#choice-diag').innerHTML = '';
  }
  $$('[data-pick]').forEach((b) => b.classList.toggle('suggested', suggestion?.pick === b.dataset.pick));
  $('#choice-suggest').innerHTML = suggestion
    ? `<p><strong>Sugestão pelos dados: ${suggestion.pick === 'tie' ? 'empate' : `${noun} ${suggestion.pick}`}</strong> (confiança ${suggestion.confidence}).</p>${suggestion.notes.map((n) => `<p>${esc(n)}</p>`).join('')}`
    : '';
  $('#btn-replays-round').hidden = st.mode !== 'browser';
  $('#btn-more').hidden = st.mode !== 'range';
  $('#btn-repeat').hidden = f.repeats >= 3;
  const fit = currentFit(st.roundPoints || []);
  const model = fit.ok
    ? ` Pelo seu desempenho em todas as rodadas, o pico está perto de ${num(fit.opt)} (${fit.confidence === 'alta' ? 'confiança alta' : fit.confidence === 'média' ? 'confiança média' : 'ainda incerto'}).`
    : fit.reason === 'sem pico' ? ` Seu desempenho ainda ${fit.direction > 0 ? 'sobe com sens mais alta' : 'sobe com sens mais baixa'}: a busca vai continuar nessa direção.` : '';
  $('#choice-progress').textContent = `Faltam cerca de ${f.remaining} rodada${f.remaining > 1 ? 's' : ''}.${model}`;
  show('choice');
}

function commitRound() {
  if (st.roundTrials) st.trials.push(...st.roundTrials);
  if (st.roundPoints) {
    st.points.push(...st.roundPoints);
    if (st.mode === 'browser') st.clock += st.roundPoints.length;
  }
  st.roundTrials = null;
  st.roundPoints = null;
}

$$('[data-pick]').forEach((b) => b.addEventListener('click', () => {
  const pick = b.dataset.pick;
  commitRound();
  st.finder.choose(pick, { nudge: rangeNudge(pick), guide: guideFrom(currentFit()), data: { mode: st.mode } });
  if (st.finder.done) finish();
  else startRound();
}));
$$('[data-stop]').forEach((b) => b.addEventListener('click', () => {
  commitRound();
  st.finder.finishWith(st.finder.pair[b.dataset.stop].sens);
  st.stoppedByUser = true;
  finish();
}));
$('#btn-repeat').addEventListener('click', () => {
  st.roundTrials = null;
  st.roundPoints = null;
  st.finder.repeat();
  startRound();
});
$('#btn-more').addEventListener('click', () => {
  queueRange(['A', 'B']);
  nextRangeAttempt();
});

// ---------------- Resultado ----------------
const confWord = { alta: 'alta', 'média': 'média', baixa: 'baixa' };

/** Junta preferência (A/B), curva de desempenho e equilíbrio do 1º movimento. */
function finalEstimate() {
  const f = st.finder;
  const fit = currentFit();
  const parts = [{ key: 'pref', label: 'Suas escolhas A/B', sens: f.result, weight: st.stoppedByUser ? 1.5 : 1 }];
  if (fit.ok) parts.push({ key: 'curve', label: 'Pico da curva de desempenho', sens: fit.opt, weight: fit.edge ? 0.2 : CURVE_WEIGHT[fit.confidence] });
  let eq = null;
  if (st.mode === 'browser' || st.trials.length) {
    const pts = st.trials.map((t) => ({ t, m: trialMetrics(t) }))
      .filter(({ t, m }) => (t.type === 'flick' || t.type === 'turn') && m.endpoint)
      .map(({ t, m }) => ({ sens: t.sens, along: m.endpoint.alongPct }));
    eq = equilibrium(pts);
    if (eq.ok) parts.push({ key: 'eq', label: 'Equilíbrio do 1º movimento', sens: eq.sens, weight: 0.5 });
  }
  const comb = combineEstimates(parts);
  return { fit, eq, comb, sens: V.roundSens(comb.sens) };
}

function chartSVG(points, fit, final, yLabel) {
  if (points.length < 3) return '';
  const W = 640, H = 260, L = 52, R = 16, T = 16, B = 44;
  const ss = points.map((p) => p.sens);
  const smin = Math.min(...ss, final) * 0.94, smax = Math.max(...ss, final) * 1.06;
  const vs = points.map((p) => p.value);
  let vmin = Math.min(...vs), vmax = Math.max(...vs);
  if (vmax === vmin) { vmax += 1; vmin -= 1; }
  const pad = (vmax - vmin) * 0.12;
  vmin -= pad; vmax += pad;
  const X = (s) => L + ((Math.log(s) - Math.log(smin)) / (Math.log(smax) - Math.log(smin))) * (W - L - R);
  const Y = (v) => T + (1 - (v - vmin) / (vmax - vmin)) * (H - T - B);
  const ticks = Array.from({ length: 5 }, (_, i) => smin * (smax / smin) ** ((i + 0.5) / 5));
  let band = '', curve = '';
  if (fit?.ok) {
    const [a, b] = fit.range;
    band = `<rect class="ch-band" x="${X(Math.max(a, smin))}" y="${T}" width="${Math.max(0, X(Math.min(b, smax)) - X(Math.max(a, smin)))}" height="${H - T - B}"><title>Faixa ótima: ${num(a)} a ${num(b)}</title></rect>`;
    const pts = Array.from({ length: 60 }, (_, i) => smin * (smax / smin) ** (i / 59)).map((s) => [X(s), Y(Math.min(vmax, Math.max(vmin, fit.predict(s))))]);
    curve = `<path class="ch-curve" d="M${pts.map((p) => p.map((x) => x.toFixed(1)).join(',')).join('L')}"/>`;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Desempenho por sens">
    ${band}
    <line class="ch-axis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/>
    ${ticks.map((s) => `<text class="ch-tick" x="${X(s)}" y="${H - B + 18}" text-anchor="middle">${num(s)}</text>`).join('')}
    <text class="ch-label" x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">sens (escala logarítmica)</text>
    <text class="ch-label" x="14" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(T + H - B) / 2})">${yLabel}</text>
    ${curve}
    ${points.map((p) => `<circle class="ch-dot" cx="${X(p.sens).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="5"><title>Sens ${num(p.sens)}: ${num(p.value, yLabel === 'abates' ? 0 : 2)}</title></circle>`).join('')}
    <line class="ch-final" x1="${X(final)}" y1="${T}" x2="${X(final)}" y2="${H - B}"/>
    <text class="ch-final-label" x="${Math.min(W - R - 4, X(final) + 6)}" y="${T + 12}" text-anchor="${X(final) > W - 120 ? 'end' : 'start'}">sua sens ${num(final)}</text>
  </svg>`;
}

function finish() {
  if (st.kind === 'scoped') showScopedResult();
  else showResult();
}

function showResult() {
  const f = st.finder;
  const p = st.profile;
  const est = finalEstimate();
  const sens = est.sens;
  st.finalSens = sens;
  const e = sens * p.dpi;
  const cm = V.cm360(sens, p.dpi);
  const tc = V.turnCheck(sens, p.dpi, p.padWidthCm);
  const fit = est.fit;
  $('#result-main').innerHTML = `${statLine(sens, p.dpi)}
    ${fit.ok && fit.confidence !== 'baixa' ? `<p>Sua <strong>faixa ótima</strong> vai de <strong>${num(fit.range[0])}</strong> a <strong>${num(fit.range[1])}</strong>: dentro dela seu desempenho fica a até 3% do melhor. Diferenças menores que essa você dificilmente sente.</p>`
      : fit.ok ? '<p class="note">A curva de desempenho ainda está incerta (resultados muito variados entre os blocos). Use "Re-checar" ou confirme no Campo de Tiro.</p>' : ''}
    <p>Sens <strong>${V.edpiLabel(e)}</strong>. Mais alta que a de ${Math.round(V.proPercentile(e))}% dos pros (dados de 2026).</p>
    ${cm < 20 || cm > 80 ? `<p class="warn">${num(cm, 1)} cm/360 está fora da faixa em que a maioria das pessoas mira melhor no estudo da NVIDIA (20–80 cm). Vale confirmar no Campo de Tiro.</p>` : ''}
    ${tc ? `<p class="${tc.ok ? 'ok' : 'warn'}">Giro de 180° = ${num(tc.cm180, 1)} cm. ${tc.msg}</p>` : ''}
    ${st.mode === 'browser' ? '<p class="note">Próximo passo: confirme no Campo de Tiro. O botão abaixo testa esta sens contra ±6%.</p>' : ''}`;

  const parts = est.comb.parts;
  const yLabel = st.mode === 'browser' ? 'pontuação por bloco' : 'abates';
  $('#result-how').innerHTML = `<h2>Como calculamos</h2>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Fonte</th><th>Sens</th><th>Peso</th></tr></thead><tbody>
    ${parts.map((x) => `<tr><th>${x.label}</th><td>${num(x.sens)}</td><td>${Math.round(x.share * 100)}%</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted small">Concordância entre as fontes: <strong>${est.comb.agreement}</strong>.
    ${fit.ok ? `Curva com ${fit.n} medições, confiança ${confWord[fit.confidence]} (80% de chance de o pico estar entre ${num(fit.ci[0])} e ${num(fit.ci[1])}).` : fit.reason === 'sem pico' ? `A curva ainda não tem pico: seu desempenho ${fit.direction > 0 ? 'subiu até a sens mais alta testada' : 'subiu até a sens mais baixa testada'}. Re-checar ajuda.` : 'Poucas medições para a curva.'}
    ${est.eq?.ok ? 'O equilíbrio do 1º movimento é a sens em que seus flicks nem passam nem param antes do alvo.' : ''}</p>
    ${chartSVG(st.points, fit, sens, yLabel)}`;

  // Diagnóstico com as tentativas perto do resultado, comparado com a sessão toda.
  const near = st.trials.filter((t) => Math.abs(t.sens - sens) / sens <= 0.15);
  const diags = near.length >= 12 ? diagnose(near, { baseline: st.trials }) : [];
  const trends = sensTrends(st.trials);
  const session = sessionTrend(st.trials);
  const diagEl = $('#result-diag');
  diagEl.hidden = !st.trials.length;
  if (st.trials.length) {
    const tend = sensTendency(diags);
    const tendTxt = tend <= -2 ? 'Seus erros apontam para sens um pouco <strong>alta</strong>. Se continuar passando do alvo no jogo, desça 3–5%.'
      : tend >= 2 ? 'Seus erros apontam para sens um pouco <strong>baixa</strong>. Se continuar chegando curto no jogo, suba 3–5%.'
        : 'Seus erros não apontam para a sens: o que sobra é técnica.';
    const unitTxt = (t) => (t.unit === 'pts' ? `${t.delta > 0 ? '+' : ''}${Math.round(t.delta)} pontos percentuais` : t.unit === 's' ? `${t.delta > 0 ? '+' : ''}${num(t.delta, 2)} s` : `${t.delta > 0 ? '+' : ''}${num(t.delta, 1)}`);
    diagEl.innerHTML = `<h2>O que você está errando</h2><p>${tendTxt}</p>
      ${diags.length ? `<ul class="diag big">${diags.map((d) => `<li class="sev-${d.severity === 'média' ? 'media' : d.severity}"><strong>${esc(d.title)} ${confTag(d.confidence)}</strong><span>${esc(d.detail)}</span><em>${esc(d.tip)}</em></li>`).join('')}</ul>` : '<p class="ok">Nenhum problema claro perto da sua sens.</p>'}
      ${trends.length ? `<h3>O que muda quando você sobe a sens (de ${num(trends[0].from)} para ${num(trends[0].to)})</h3><ul class="trend">${trends.map((t) => `<li><span>${t.label}</span><strong>${unitTxt(t)}</strong></li>`).join('')}</ul><p class="muted small">Comparando você com você mesmo: o que cresce junto com a sens é efeito dela; o que fica igual em todas é técnica.</p>` : ''}
      ${session && session.kind !== 'stable' ? `<p class="note ${session.kind === 'fatigue' ? 'warn' : ''}">${session.kind === 'fatigue' ? `Seu desempenho caiu ${Math.round(-session.change * 100)}% no fim da sessão (cansaço). O modelo desconta isso, mas teste descansado da próxima vez.` : `Seu desempenho subiu ${Math.round(session.change * 100)}% do começo para o fim (aquecimento). O modelo desconta isso; aqueça antes da próxima vez.`}</p>` : ''}`;
  }

  renderMovement(sens);

  const dpis = [400, 800, 1600, 3200];
  $('#result-extra').innerHTML = `
    <div class="card mini"><h3>Mesma sens em outros DPIs</h3><table class="tbl">${dpis.map((d) => `<tr><th>${d} DPI</th><td>${num(V.roundSens(V.convertDpi(sens, p.dpi, d)))}</td></tr>`).join('')}</table></div>
    <div class="card mini"><h3>Configurações do Valorant</h3><table class="tbl">
      <tr><th>Sensibilidade</th><td>${num(sens)}</td></tr>
      <tr><th>Multiplicador ADS</th><td>1,000</td></tr>
      <tr><th>Multiplicador com mira</th><td>1,000</td></tr>
      <tr><th>Ponteiro do Windows</th><td>6/11, sem precisão aprimorada</td></tr></table></div>
    <div class="card mini"><h3>Em outros jogos (mesmo DPI)</h3><table class="tbl">
      <tr><th>CS2</th><td>${num(V.toOtherGame(sens, V.GAMES.cs2.yaw))}</td></tr>
      <tr><th>Apex Legends</th><td>${num(V.toOtherGame(sens, V.GAMES.apex.yaw))}</td></tr>
      <tr><th>Overwatch 2</th><td>${num(V.toOtherGame(sens, V.GAMES.ow2.yaw), 2)}</td></tr></table></div>`;
  $('#result-history').innerHTML = f.history.map((h) => {
    if (h.pick === 'stop') return `<li>Você parou: confortável com <strong>${num(h.result)}</strong></li>`;
    const chosen = h.pick === 'tie' ? 'empate' : `${h.pick} (${h[h.pick].kind === 'low' ? 'mais baixa' : 'mais alta'})`;
    const nudge = h.nudge ? ` ${h.nudge > 0 ? '+' : ''}${Math.round(h.nudge * 100)}% pela sensação` : '';
    const guide = h.guide ? `, ajustada pela curva (${num(h.guide.sens)})` : '';
    return `<li>A ${num(h.A.sens)} vs. B ${num(h.B.sens)} → ${chosen}${nudge}${guide} → <strong>${num(h.result)}</strong></li>`;
  }).join('');
  $('#btn-replays-all').hidden = !st.trials.length;
  $('#btn-confirm-range').hidden = st.mode === 'range';
  saveSession({
    id: st.sessionId, date: new Date().toISOString(), dpi: p.dpi, mode: st.mode, final: sens,
    points: st.points.map((x) => ({ sens: x.sens, value: x.value, t: x.t })),
  });
  renderSessionsCard();
  show('result');
}

/** Estilo de mira real, medido pelos centímetros que o mouse andou nos flicks e viradas. */
function renderMovement(sens) {
  const el = $('#result-move');
  const p = st.profile;
  const mp = st.trials.length ? movementProfile(st.trials, p.dpi) : null;
  el.hidden = !mp;
  if (!mp) return;
  const label = V.STYLE_LABEL;
  const cm180 = V.cm360(sens, p.dpi) / 2;
  let verdict = '<p class="muted">Ainda não deu para saber seu estilo: você foi bem nos movimentos longos, mas nenhum passou de 15 cm, que é onde braço e pulso se separam. Com sens mais baixa ou mais rodadas isso aparece.</p>';
  if (mp.style) {
    const same = mp.style === p.style || (mp.style === 'pulso' && p.style === 'dedos');
    const alt = V.suggestStart({ ...p, style: mp.style });
    verdict = same
      ? `<p class="ok">Pelos seus movimentos você mira mesmo com <strong>${label[mp.style]}</strong>, como marcou: ${esc(mp.evidence)}.</p>`
      : `<p class="warn">Você marcou <strong>${label[p.style]}</strong>, mas pelos seus movimentos você mira com <strong>${label[mp.style]}</strong>: ${esc(mp.evidence)}.</p>
         <p>Com esse estilo, o ponto de partida seria <strong>${num(alt.sens)}</strong> (eDPI ${Math.round(alt.edpi)}). Na próxima busca, marque <strong>${label[mp.style]}</strong> para começar mais perto.</p>`;
  }
  const tips = [];
  if (mp.liftRate >= 0.3) tips.push(`Seu giro de 180° pede ${num(cm180, 1)} cm, mais do que você alcança sem levantar o mouse. Use o braço nas viradas grandes ou suba um pouco a sens.`);
  if (mp.style === 'pulso' && cm180 > 20) tips.push(`Para quem mira de pulso, ${num(cm180, 1)} cm por 180° é bastante. Se as viradas te incomodam no jogo, a ponta de cima da sua faixa ótima é a melhor escolha.`);
  if (mp.style === 'braco' && p.padWidthCm && p.padWidthCm < 40) tips.push('Você mira com o braço num mousepad pequeno: um mousepad maior deixa você usar sens mais baixa com conforto.');
  el.innerHTML = `<h2>Seu movimento</h2>
    <div class="stats">
      <div><span>Flick típico</span><strong>${num(mp.medianCm, 1)} cm</strong></div>
      <div><span>Maior sem levantar</span><strong>${num(mp.maxSmooth, 1)} cm</strong></div>
      <div><span>Levantou o mouse</span><strong>${mp.longCount ? `${Math.round(mp.liftRate * 100)}%` : '–'}</strong></div>
      <div><span>Giro de 180°</span><strong>${num(cm180, 1)} cm</strong></div>
    </div>
    ${verdict}
    ${tips.map((t) => `<p class="note">${esc(t)}</p>`).join('')}
    <p class="muted small">Medido pelos centímetros que o mouse andou em ${mp.n} flicks e viradas (${mp.longCount} com 12 cm ou mais). Movimento longo sem perder eficiência é sinal de braço; levantar o mouse ou ficar bem mais lento nos longos é sinal de pulso.</p>`;
}

$('#btn-recheck').addEventListener('click', () => {
  st.finder.center = st.finalSens;
  st.stoppedByUser = false;
  st.finder.recheck(0.1);
  startRound();
});
$('#btn-confirm-range').addEventListener('click', () => {
  st.mode = 'range';
  st.confirming = true;
  st.stoppedByUser = false;
  st.sessionId = Date.now().toString(36);
  // Pontos do navegador e abates não estão na mesma escala: a curva recomeça no Campo de Tiro.
  st.points = [];
  st.clock = 0;
  if (!st.profile.attempts) st.profile.attempts = 2;
  st.finder = new SensFinder({ startSens: st.finalSens, dpi: st.profile.dpi, spread: 0.06, minSpread: 0.03, maxRounds: 3 });
  startRound();
});
$('#btn-restart').addEventListener('click', () => { st.confirming = false; renderPast(); show('profile'); });
$('#btn-copy').addEventListener('click', async () => {
  const p = st.profile, s = st.finalSens;
  const txt = `Minha sens no Valorant: ${num(s)} @ ${p.dpi} DPI | eDPI ${Math.round(s * p.dpi)} | ${num(V.cm360(s, p.dpi), 1)} cm/360`;
  try {
    await navigator.clipboard.writeText(txt);
    $('#btn-copy').textContent = 'Copiado';
  } catch {
    $('#btn-copy').textContent = txt;
  }
  setTimeout(() => { $('#btn-copy').textContent = 'Copiar resultado'; }, 2500);
});

function loadSessions() {
  let list = store(SESSIONS_KEY);
  if (!Array.isArray(list)) {
    // Migra resultados antigos (sem pontos da curva).
    const old = store(HISTORY_KEY) || [];
    list = old.map((x, i) => ({ id: `old${i}`, date: x.date, dpi: x.dpi, mode: x.mode, final: x.sens, points: [] }));
  }
  return list;
}
function saveSession(sess) {
  const list = loadSessions().filter((x) => x.id !== sess.id);
  store(SESSIONS_KEY, [sess, ...list].slice(0, 20));
}
const daysAgo = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);

/** Bloco com a sens consolidada de todas as sessões. */
function sessionsSummary(list, dpi) {
  const c = combineSessions(list, dpi);
  if (!c) return '';
  const last = daysAgo(list[0].date);
  const reminder = list.length < 2
    ? '<p class="note">Faça outra sessão em outro dia. A sens perfeita é a que vence em dias diferentes, não só num dia bom.</p>'
    : !c.stable ? `<p class="note warn">Seus resultados variaram ${Math.round(c.spread * 100)}% entre as sessões. Faça mais uma em outro dia, descansado, para fechar.</p>`
      : last >= 7 ? `<p class="note">Sua última sessão foi há ${last} dias. Refaça para confirmar que a sens continua certa.</p>` : '';
  return `<div class="stats">
      <div><span>Sens consolidada</span><strong>${num(V.roundSens(c.sens))}</strong></div>
      <div><span>eDPI</span><strong>${Math.round(c.sens * dpi)}</strong></div>
      <div><span>cm/360</span><strong>${num(V.cm360(c.sens, dpi), 1)}</strong></div>
      <div><span>Sessões</span><strong>${c.n}</strong></div>
    </div>
    ${c.n >= 2 ? `<p>${c.stable ? `<span class="ok">Estável:</span> suas sessões ficaram a até ${Math.round(c.spread * 100)}% uma da outra.` : `Ainda variando entre as sessões (${Math.round(c.spread * 100)}%).`}
    ${c.fit.ok && c.fit.confidence !== 'baixa' ? ` Faixa ótima somando todas: <strong>${num(c.fit.range[0])}</strong> a <strong>${num(c.fit.range[1])}</strong>.` : ''}</p>` : ''}
    ${reminder}
    <p class="muted small">Valores em ${dpi} DPI. Sessões com outro DPI são convertidas pelo eDPI. Cada dia é normalizado, então um dia ruim não puxa o resultado para baixo.</p>`;
}

function renderPast() {
  const list = loadSessions();
  const el = $('#past');
  el.hidden = !list.length;
  if (!list.length) return;
  const dpi = readNum($('#f-dpi')) || list[0].dpi;
  const scoped = store(SCOPED_KEY);
  el.innerHTML = `<h3>Suas sessões</h3>
    ${sessionsSummary(list, dpi)}
    ${scoped ? `<p>Multiplicador com mira: <strong>${num(scoped.mult)}×</strong> (${new Date(scoped.date).toLocaleDateString('pt-BR')}).</p>` : ''}
    <ul>${list.map((x) => `<li>${new Date(x.date).toLocaleDateString('pt-BR')}: <strong>${num(x.final)}</strong> @ ${x.dpi} DPI (eDPI ${Math.round(x.final * x.dpi)}, ${x.mode === 'range' ? 'Campo de Tiro' : 'navegador'})</li>`).join('')}</ul>
    <button class="btn link" type="button" id="btn-clear">Apagar histórico</button>
    <p class="muted small">O histórico fica salvo só neste navegador.</p>`;
  $('#btn-clear').addEventListener('click', (e) => {
    if (e.target.dataset.armed) {
      store(SESSIONS_KEY, []);
      try { localStorage.removeItem(HISTORY_KEY); } catch { /* sem armazenamento */ }
      renderPast();
    } else {
      e.target.dataset.armed = '1';
      e.target.textContent = 'Clique de novo para apagar tudo';
    }
  });
}
renderPast();
$('#f-dpi').addEventListener('change', renderPast);

function renderSessionsCard() {
  const list = loadSessions();
  const el = $('#result-sessions');
  el.hidden = list.length < 2;
  if (list.length < 2) return;
  el.innerHTML = `<h2>Todas as suas sessões</h2>${sessionsSummary(list, st.profile.dpi)}`;
}

// ---------------- Multiplicador com mira ----------------
function startScoped() {
  st.saved = { finder: st.finder, points: st.points, clock: st.clock, mode: st.mode, stoppedByUser: st.stoppedByUser };
  st.kind = 'scoped';
  st.mode = 'range';
  st.points = [];
  st.clock = 0;
  st.stoppedByUser = false;
  if (!st.profile.attempts) st.profile.attempts = 2;
  st.finder = new SensFinder({ startSens: 1, dpi: 1, spread: 0.15, minSpread: 0.03, maxRounds: 6, min: 0.5, max: 1.6 });
  startRound();
}

function showScopedResult() {
  const f = st.finder;
  const fit = currentFit();
  const parts = [{ key: 'pref', label: 'Suas escolhas A/B', sens: f.result, weight: st.stoppedByUser ? 1.5 : 1 }];
  if (fit.ok) parts.push({ key: 'curve', label: 'Pico da curva de abates', sens: fit.opt, weight: fit.edge ? 0.2 : CURVE_WEIGHT[fit.confidence] });
  const comb = combineEstimates(parts);
  const mult = V.roundSens(comb.sens);
  store(SCOPED_KEY, { mult, date: new Date().toISOString() });
  const diff = Math.round((mult - 1) * 100);
  $('#scoped-main').innerHTML = `<div class="stats">
      <div><span>Multiplicador com mira</span><strong>${num(mult)}×</strong></div>
      <div><span>vs. padrão 1,000</span><strong>${diff > 0 ? '+' : ''}${diff}%</strong></div>
    </div>
    ${fit.ok && fit.confidence !== 'baixa' ? `<p>Faixa ótima: <strong>${num(fit.range[0])}×</strong> a <strong>${num(fit.range[1])}×</strong>.</p>` : ''}
    <p>${Math.abs(diff) <= 3 ? 'Ficou praticamente no padrão: mantenha 1,000, como ~79% dos pros.' : diff < 0 ? 'Com mira você controla melhor um pouco mais devagar: comum em quem passa do alvo com o Operator.' : 'Com mira você controla melhor um pouco mais rápido: comum em quem chega curto nos flicks com o Operator.'}</p>
    <p class="muted small">Referência: 1,000 iguala a sensação na borda da tela (padrão do jogo). Calculadoras da comunidade dão ~0,747 para igualar no centro da mira. O multiplicador vale para todas as armas com mira (Operator, Marshal, Outlaw); o de ADS (rifles) fica em 1,000.</p>`;
  $('#scoped-how').innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Fonte</th><th>Multiplicador</th><th>Peso</th></tr></thead><tbody>
    ${comb.parts.map((x) => `<tr><th>${x.label}</th><td>${num(x.sens)}×</td><td>${Math.round(x.share * 100)}%</td></tr>`).join('')}</tbody></table></div>
    <ol class="history">${f.history.map((h) => h.pick === 'stop' ? `<li>Você parou: confortável com <strong>${num(h.result)}×</strong></li>`
      : `<li>A ${num(h.A.sens)}× vs. B ${num(h.B.sens)}× → ${h.pick === 'tie' ? 'empate' : h.pick} → <strong>${num(h.result)}×</strong></li>`).join('')}</ol>`;
  show('scoped');
}

function restoreMain() {
  Object.assign(st, st.saved);
  st.kind = 'sens';
}

$('#btn-scoped').addEventListener('click', startScoped);
$('#scoped-back').addEventListener('click', () => { restoreMain(); show('result'); });

// ---------------- Replay ----------------
const rp = { list: [], i: 0, back: 'result', filter: 'all', blind: false };
const player = new ReplayPlayer($('#replay-canvas'), $('#replay-plot'), (t, end, playing) => {
  $('#rp-seek').value = Math.round((t / end) * 1000);
  $('#rp-play').textContent = playing ? 'Pausar' : 'Assistir';
});

function openReplays(trials, back, blind) {
  rp.all = trials;
  rp.back = back;
  rp.blind = blind;
  rp.filter = 'all';
  $$('[data-filter]').forEach((b) => b.classList.toggle('active', b.dataset.filter === 'all'));
  applyFilter();
  show('replay');
  // Começa pela pior tentativa: é a que mais ensina.
  const worst = rp.list.reduce((w, t, i) => (score(t) < score(rp.list[w]) ? i : w), 0);
  selectReplay(worst);
}
const score = (t) => (t.hit ? 1 / t.time : 0) - t.misses * 0.2 - (t.body || 0) * 0.2;

function applyFilter() {
  let l = rp.all;
  if (rp.filter === 'miss') l = l.filter((t) => !t.hit || t.misses || t.body);
  if (rp.filter === 'slow') l = [...l].filter((t) => t.hit).sort((a, b) => b.time - a.time).slice(0, 10);
  rp.list = l.length ? l : rp.all;
  $('#replay-list').innerHTML = rp.list.map((t, i) => {
    const res = t.hit ? (t.misses || t.body ? 'warn' : 'ok') : 'bad';
    const who = rp.blind ? `Sens ${t.side}` : `${num(t.sens)}${t.round ? ` · rodada ${t.round}` : ''}`;
    return `<li><button type="button" data-i="${i}" class="rp-item ${res}">
      <span>${TYPE_INFO[t.type].name}</span><span class="muted">${who}</span>
      <strong>${t.hit ? `${num(t.time, 2)} s` : 'errou'}</strong></button></li>`;
  }).join('');
  $$('#replay-list [data-i]').forEach((b) => b.addEventListener('click', () => selectReplay(+b.dataset.i)));
}

function selectReplay(i) {
  rp.i = (i + rp.list.length) % rp.list.length;
  const t = rp.list[rp.i];
  $$('#replay-list [data-i]').forEach((b) => b.classList.toggle('active', +b.dataset.i === rp.i));
  player.load(t);
  const m = player.metrics;
  const parts = [`<strong>${TYPE_INFO[t.type].name}</strong> (${TYPE_INFO[t.type].desc})`,
    `distância ${num(t.dist, 1)}°`,
    t.hit ? `acertou em ${num(t.time, 2)} s` : 'não acertou a cabeça',
    `${t.misses} erro${t.misses === 1 ? '' : 's'}, ${t.body || 0} no corpo`];
  if (m.reactionMs != null) parts.push(`reação ${Math.round(m.reactionMs)} ms`);
  if (m.endpoint && (t.type === 'flick' || t.type === 'turn')) {
    const pct = Math.round(m.endpoint.alongPct * 100);
    parts.push(pct > 6 ? `1º movimento passou ${pct}% do alvo` : pct < -15 ? `1º movimento parou ${-pct}% antes` : '1º movimento certeiro');
    if (m.corrections) parts.push(`${m.corrections} correç${m.corrections === 1 ? 'ão' : 'ões'}`);
  }
  $('#replay-info').innerHTML = parts.join(' · ');
}

$('#rp-play').addEventListener('click', () => player.toggle());
$('#rp-prev').addEventListener('click', () => selectReplay(rp.i - 1));
$('#rp-next').addEventListener('click', () => selectReplay(rp.i + 1));
$('#rp-seek').addEventListener('input', (e) => {
  player.pause();
  player.t = (e.target.value / 1000) * player.end;
  player._draw();
});
$$('[data-speed]').forEach((b) => b.addEventListener('click', () => {
  player.speed = +b.dataset.speed;
  $$('[data-speed]').forEach((x) => x.classList.toggle('active', x === b));
}));
$$('[data-filter]').forEach((b) => b.addEventListener('click', () => {
  rp.filter = b.dataset.filter;
  $$('[data-filter]').forEach((x) => x.classList.toggle('active', x === b));
  applyFilter();
  selectReplay(0);
}));
$('#replay-back').addEventListener('click', () => show(rp.back));
$('#btn-replays-round').addEventListener('click', () => openReplays(st.roundTrials || [], 'choice', true));
$('#btn-replays-all').addEventListener('click', () => openReplays(st.trials, 'result', false));

// ---------------- Calculadora ----------------
function calc() {
  const d1 = readNum($('#c1-dpi')), s1 = readNum($('#c1-sens'));
  $('#c1-out').innerHTML = d1 > 0 && s1 > 0
    ? `eDPI <strong>${Math.round(d1 * s1)}</strong> · <strong>${num(V.cm360(s1, d1), 1)}</strong> cm/360 · ${num(V.inch360(s1, d1), 1)} pol/360<br>Faixa ${V.edpiLabel(d1 * s1)} · mais alta que ${Math.round(V.proPercentile(d1 * s1))}% dos pros`
    : '';
  const s2 = readNum($('#c2-sens')), f2 = readNum($('#c2-from')), t2 = readNum($('#c2-to'));
  $('#c2-out').innerHTML = s2 > 0 && f2 > 0 && t2 > 0 ? `Nova sens: <strong>${num(V.roundSens(V.convertDpi(s2, f2, t2)))}</strong> (mesmo eDPI: ${Math.round(s2 * f2)})` : '';
  const g = V.GAMES[$('#c3-game').value], s3 = readNum($('#c3-sens')), df = readNum($('#c3-dpi-from')), dt = readNum($('#c3-dpi-to'));
  $('#c3-out').innerHTML = g && s3 > 0 && df > 0 && dt > 0 ? `Sens no Valorant: <strong>${num(V.roundSens(V.fromOtherGame(s3, g.yaw, df, dt)))}</strong> @ ${dt} DPI` : '';
  const cm = readNum($('#c4-cm')), d4 = readNum($('#c4-dpi'));
  $('#c4-out').innerHTML = cm > 0 && d4 > 0 ? `Sens: <strong>${num(V.roundSens(V.sensFromCm360(cm, d4)))}</strong> · eDPI ${Math.round(V.CM360_CONST / cm)}` : '';
}
$$('#tab-calc input, #tab-calc select').forEach((el) => el.addEventListener('input', calc));
$('#zoom-table tbody').innerHTML = V.ZOOMS.map((z) => `<tr><td>${num(z.zoom, 2)}×</td><td>${z.weapons}</td></tr>`).join('');
calc();

// Acesso para depuração no console do navegador.
window.sensFinderDebug = { drill, st, player };
