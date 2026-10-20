import * as V from './valorant.js';
import { SensFinder } from './finder.js';
import { summarize, compare } from './scoring.js';
import { Drill, makePlan } from './drill.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const num = (n, d = 3) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const readNum = (el) => parseFloat(String(el.value).replace(',', '.'));
const HISTORY_KEY = 'sensfinder.history';

// ---------------- Abas ----------------
$$('.tab').forEach((b) => b.addEventListener('click', () => {
  $$('.tab').forEach((t) => { t.classList.toggle('active', t === b); t.setAttribute('aria-selected', t === b); });
  $$('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${b.dataset.tab}`; });
}));

// ---------------- Finder ----------------
const STEPS = ['profile', 'start', 'test', 'game', 'choice', 'result'];
function show(step) {
  STEPS.forEach((s) => { $(`#step-${s}`).hidden = s !== step; });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));

for (const [key, g] of Object.entries(V.GAMES)) {
  $('#f-game').add(new Option(g.name, key));
  $('#c3-game').add(new Option(g.name, key));
}
$('#f-game').addEventListener('change', () => { $('#f-game-sens').disabled = !$('#f-game').value; });

const st = { profile: null, finder: null, mode: 'browser', phase: 'A', results: {}, warmup: false };
const drill = new Drill($('#drill-canvas'), { onFinish: onDrillFinish, onState: onDrillState });

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
    padWidthCm: +$('#f-pad').value,
    role: $('#f-role').value,
    mode: document.querySelector('input[name=mode]:checked').value,
    rounds: +$('#f-rounds').value,
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

$('#profile-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const p = readProfile();
  if (!(p.dpi >= 100)) return;
  st.profile = p;
  const s = V.suggestStart(p);
  st.startSens = s.sens;
  const tc = V.turnCheck(s.sens, p.dpi, p.padWidthCm);
  $('#start-summary').innerHTML = `
    ${p.converted ? `<p>${p.converted.game} ${num(p.converted.gameSens)} equivale a <strong>${num(p.converted.sens)}</strong> no Valorant com ${p.dpi} DPI.</p>` : ''}
    ${statLine(s.sens, p.dpi)}
    <p>Faixa: <strong>${V.edpiLabel(s.edpi)}</strong>. A busca começa aqui e testa valores de ~50% abaixo até ~50% acima, estreitando a cada rodada.</p>
    <ul class="reasons">${s.reasons.map((r) => `<li>${r}</li>`).join('')}</ul>
    ${tc ? `<p class="${tc.ok ? 'ok' : 'warn'}">Giro de 180° = ${num(tc.cm180, 1)} cm. ${tc.msg}</p>` : ''}`;
  $('#warmup-wrap').hidden = p.mode !== 'browser';
  show('start');
});

$('#btn-begin').addEventListener('click', () => {
  const p = st.profile;
  st.mode = p.mode;
  st.finder = new SensFinder({ startSens: st.startSens, dpi: p.dpi, rounds: p.rounds });
  if (st.mode === 'browser' && $('#f-warmup').checked) {
    st.warmup = true;
    show('test');
    $('#test-title').textContent = 'Aquecimento';
    $('#test-sub').textContent = '· não conta na pontuação';
    drill.start({ sens: st.startSens, plan: makePlan(Math.random, 'warmup'), label: 'Aquecimento' });
  } else {
    startRound();
  }
});

function roundLabel() {
  const f = st.finder;
  return `Rodada ${f.round + 1}/${f.totalRounds}`;
}

function startRound() {
  st.results = {};
  st.roundPlan = makePlan();
  runPhase('A');
}

function runPhase(phase) {
  st.phase = phase;
  const cand = st.finder.pair[phase];
  if (st.mode === 'browser') {
    show('test');
    $('#test-title').textContent = `${roundLabel()} · Sens ${phase}`;
    $('#test-sub').textContent = phase === 'A' ? '· depois vem a B' : '· última desta rodada';
    const plan = phase === 'A' ? st.roundPlan : [...st.roundPlan].sort(() => Math.random() - 0.5);
    drill.start({ sens: cand.sens, plan, label: `Sens ${phase}` });
  } else {
    show('game');
    $('#game-title').textContent = `${roundLabel()} · Sens ${phase}`;
    $('#game-sens').textContent = num(cand.sens);
    $('#game-kills').value = '';
  }
}

function onDrillFinish(trials) {
  if (st.warmup) {
    st.warmup = false;
    startRound();
    return;
  }
  st.results[st.phase] = { ...st.finder.pair[st.phase], stats: summarize(trials) };
  if (st.phase === 'A') runPhase('B');
  else showChoice();
}

function onDrillState({ raw }) {
  const b = $('#raw-badge');
  if (raw === null) return;
  b.hidden = false;
  b.textContent = raw ? 'Entrada crua: ativa' : 'Entrada crua: indisponível';
  b.className = `badge ${raw ? 'ok' : 'warn'}`;
  b.title = raw ? '' : 'Seu navegador aplica a aceleração do sistema. Desligue "Aumentar precisão do ponteiro" no Windows ou use o Chrome.';
}

$('#btn-game-done').addEventListener('click', () => {
  const k = readNum($('#game-kills'));
  st.results[st.phase] = { ...st.finder.pair[st.phase], kills: Number.isFinite(k) ? k : null };
  if (st.phase === 'A') runPhase('B');
  else showChoice();
});

function showChoice() {
  const { A, B } = st.results;
  $('#choice-title').textContent = `${roundLabel()}: qual foi melhor?`;
  let suggestion = null;
  if (st.mode === 'browser') {
    const row = (label, f) => `<tr><th>${label}</th><td>${f(A.stats)}</td><td>${f(B.stats)}</td></tr>`;
    $('#choice-table').innerHTML = `<table class="tbl ab"><thead><tr><th></th><th>Sens A</th><th>Sens B</th></tr></thead><tbody>
      ${row('Pontuação', (s) => num(s.score, 2))}
      ${row('Precisão', (s) => `${Math.round(s.accuracy * 100)}%`)}
      ${row('Tempo médio no flick', (s) => `${num(s.flickTime, 2)} s`)}
      ${row('Tempo médio no micro-ajuste', (s) => `${num(s.microTime, 2)} s`)}
      ${row('Overshoot (passou do alvo)', (s) => `${Math.round(s.overshootPct)}%`)}
    </tbody></table>`;
    suggestion = compare(A, B);
  } else {
    $('#choice-table').innerHTML = `<table class="tbl ab"><thead><tr><th></th><th>Sens A</th><th>Sens B</th></tr></thead><tbody>
      <tr><th>Sens</th><td>${num(A.sens)}</td><td>${num(B.sens)}</td></tr>
      <tr><th>Abates</th><td>${A.kills ?? '–'}</td><td>${B.kills ?? '–'}</td></tr></tbody></table>`;
    if (A.kills != null && B.kills != null) {
      const d = A.kills - B.kills;
      suggestion = Math.abs(d) < 2
        ? { pick: 'tie', confidence: 'baixa', notes: ['Diferença pequena de abates: decida pela sensação.'] }
        : { pick: d > 0 ? 'A' : 'B', confidence: Math.abs(d) >= 5 ? 'alta' : 'média', notes: [] };
    }
  }
  $$('[data-pick]').forEach((b) => b.classList.toggle('suggested', suggestion?.pick === b.dataset.pick));
  $('#choice-suggest').innerHTML = suggestion
    ? `<p><strong>Sugestão pelos dados: ${suggestion.pick === 'tie' ? 'empate' : `Sens ${suggestion.pick}`}</strong> (confiança ${suggestion.confidence}).</p>${suggestion.notes.map((n) => `<p>${n}</p>`).join('')}`
    : '';
  show('choice');
}

$$('[data-pick]').forEach((b) => b.addEventListener('click', () => {
  st.finder.choose(b.dataset.pick);
  if (st.finder.done) showResult();
  else startRound();
}));

function showResult() {
  const f = st.finder;
  const p = st.profile;
  const sens = f.result;
  const e = sens * p.dpi;
  const tc = V.turnCheck(sens, p.dpi, p.padWidthCm);
  $('#result-main').innerHTML = `${statLine(sens, p.dpi)}
    <p>Sens <strong>${V.edpiLabel(e)}</strong>. Mais alta que a de ${Math.round(V.proPercentile(e))}% dos pros.</p>
    ${tc ? `<p class="${tc.ok ? 'ok' : 'warn'}">Giro de 180° = ${num(tc.cm180, 1)} cm. ${tc.msg}</p>` : ''}`;
  const dpis = [400, 800, 1600, 3200];
  $('#result-extra').innerHTML = `
    <div class="mini card"><h3>Mesma sens em outros DPIs</h3><table class="tbl">${dpis.map((d) => `<tr><th>${d} DPI</th><td>${num(V.roundSens(V.convertDpi(sens, p.dpi, d)))}</td></tr>`).join('')}</table></div>
    <div class="mini card"><h3>Configurações do Valorant</h3><table class="tbl">
      <tr><th>Sensibilidade</th><td>${num(sens)}</td></tr>
      <tr><th>Multiplicador ADS</th><td>1,000</td></tr>
      <tr><th>Multiplicador com mira</th><td>1,000</td></tr>
      <tr><th>Velocidade do ponteiro do Windows</th><td>6/11, sem precisão aprimorada</td></tr></table></div>
    <div class="mini card"><h3>Em outros jogos (mesmo DPI)</h3><table class="tbl">
      <tr><th>CS2</th><td>${num(V.toOtherGame(sens, V.GAMES.cs2.yaw))}</td></tr>
      <tr><th>Apex Legends</th><td>${num(V.toOtherGame(sens, V.GAMES.apex.yaw))}</td></tr>
      <tr><th>Overwatch 2</th><td>${num(V.toOtherGame(sens, V.GAMES.ow2.yaw), 2)}</td></tr></table></div>`;
  $('#result-history').innerHTML = f.history.map((h) => {
    const chosen = h.pick === 'tie' ? 'empate' : `${h.pick} (${h[h.pick].kind === 'low' ? 'mais baixa' : 'mais alta'})`;
    return `<li>A ${num(h.A.sens)} vs. B ${num(h.B.sens)} → escolheu ${chosen} → <strong>${num(h.result)}</strong></li>`;
  }).join('');
  saveHistory({ date: new Date().toISOString(), sens, dpi: p.dpi, mode: st.mode });
  show('result');
}

$('#btn-refine').addEventListener('click', () => { st.finder.extend(3); startRound(); });
$('#btn-restart').addEventListener('click', () => { renderPast(); show('profile'); });
$('#btn-copy').addEventListener('click', async () => {
  const p = st.profile, s = st.finder.result;
  const txt = `Minha sens no Valorant: ${num(s)} @ ${p.dpi} DPI | eDPI ${Math.round(s * p.dpi)} | ${num(V.cm360(s, p.dpi), 1)} cm/360`;
  try { await navigator.clipboard.writeText(txt); $('#btn-copy').textContent = 'Copiado!'; } catch { prompt('Copie:', txt); }
  setTimeout(() => { $('#btn-copy').textContent = 'Copiar resultado'; }, 1500);
});

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}
function saveHistory(entry) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify([entry, ...loadHistory()].slice(0, 10))); } catch { /* sem armazenamento */ }
}
function renderPast() {
  const h = loadHistory();
  const el = $('#past');
  el.hidden = !h.length;
  el.innerHTML = `<h3>Seus resultados anteriores</h3><ul>${h.map((x) =>
    `<li>${new Date(x.date).toLocaleDateString('pt-BR')}: <strong>${num(x.sens)}</strong> @ ${x.dpi} DPI (eDPI ${Math.round(x.sens * x.dpi)})</li>`).join('')}</ul>`;
}
renderPast();

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
