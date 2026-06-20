/* ============================================================
   BRAWL STARS TROPHY TRACKER v6 — script.js

   ✅ Utilise le même Worker Cloudflare que Tark
   (proxy vers l'API officielle Brawl Stars, gère le CORS,
   pas de clé à configurer côté client).
   ============================================================ */

'use strict';

/* ──────────────────────────────────────────────
   API (via le Worker de Tark)
────────────────────────────────────────────── */
const BS_WORKER = 'https://tark.alex-usagi84.workers.dev/';

/* ──────────────────────────────────────────────
   CONSTANTES
────────────────────────────────────────────── */
const TOTAL_DAYS = 30;
const LS_CONFIG  = 'bs_v6_config';
const LS_DAYS    = 'bs_v6_days';
const LS_START   = 'bs_v6_start';

/* ──────────────────────────────────────────────
   ÉTAT
────────────────────────────────────────────── */
let config   = null;
let daysData = [];
let startTr  = null;

/* ──────────────────────────────────────────────
   DOM
────────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const el = {
  screenSetup:    $('screenSetup'),
  inputTag:       $('inputPlayerTag'),
  inputGoal:      $('inputDailyGoal'),
  btnStart:       $('btnStart'),
  btnStartLabel:  $('btnStartLabel'),
  setupLoader:    $('setupLoader'),
  screenTracker:  $('screenTracker'),
  headerSub:      $('headerSub'),
  apiDot:         $('apiDot'),
  apiLabel:       $('apiLabel'),
  playerAvatar:   $('playerAvatar'),
  playerName:     $('playerName'),
  playerTag:      $('playerTag'),
  playerTrLive:   $('playerTrophiesLive'),
  lastSync:       $('lastSyncLabel'),
  btnRefresh:     $('btnRefresh'),
  statCurrentDay: $('statCurrentDay'),
  statDays:       $('statDaysCompleted'),
  statGain:       $('statTotalGain'),
  statAvg:        $('statAvgPerDay'),
  progressFill:   $('progressBarFill'),
  progressLabel:  $('progressBarLabel'),
  goalRecap:      $('goalRecapValue'),
  goalTotal:      $('goalTotalValue'),
  calendarList:   $('calendarList'),
  bilanSection:   $('bilanSection'),
  bilanBody:      $('bilanBody'),
  resetBtn:       $('resetBtn'),
  resetModal:     $('resetModal'),
  cancelReset:    $('cancelResetBtn'),
  confirmReset:   $('confirmResetBtn'),
  toast:          $('toast'),
};

/* ──────────────────────────────────────────────
   UTILITAIRES
────────────────────────────────────────────── */
const pad      = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const daysDiff = (a, b) => Math.round((new Date(b).setHours(0,0,0,0) - new Date(a).setHours(0,0,0,0)) / 86400000);
const fmtDate  = s => { if (!s) return '—'; const [,m,d] = s.split('-'); return `${d}/${m}`; };
const fmtTime  = ts => { if (!ts) return '—'; const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function cleanTag(raw) {
  // Retire #, majuscules, remplace O→0 (Brawl Stars n'utilise pas la lettre O)
  return raw.replace(/^#/, '').toUpperCase().replace(/O/g, '0').replace(/[^A-Z0-9]/g, '');
}

/* ──────────────────────────────────────────────
   LOCALSTORAGE
────────────────────────────────────────────── */
function loadStorage() {
  const c = localStorage.getItem(LS_CONFIG);
  const d = localStorage.getItem(LS_DAYS);
  const s = localStorage.getItem(LS_START);
  config   = c ? JSON.parse(c) : null;
  daysData = d ? JSON.parse(d) : new Array(TOTAL_DAYS).fill(null);
  startTr  = s !== null ? parseInt(s, 10) : null;
}
const saveConfig = () => localStorage.setItem(LS_CONFIG, JSON.stringify(config));
const saveDays   = () => localStorage.setItem(LS_DAYS,   JSON.stringify(daysData));
const saveStart  = () => localStorage.setItem(LS_START,  String(startTr));
function clearAll() {
  [LS_CONFIG, LS_DAYS, LS_START].forEach(k => localStorage.removeItem(k));
  config = null; daysData = new Array(TOTAL_DAYS).fill(null); startTr = null;
}

/* ──────────────────────────────────────────────
   FETCH API BRAWL STARS — VIA LE WORKER DE TARK
   Le worker fait le proxy vers l'API officielle
   et gère le CORS → marche dans n'importe quel
   navigateur, pas besoin de WebView ni de clé.
────────────────────────────────────────────── */
async function fetchPlayer(rawTag) {
  const tag = cleanTag(rawTag);
  if (tag.length < 3) throw new Error('Tag trop court. Exemple : 2QJ880V9P');

  let res, data;
  try {
    res  = await fetch(`${BS_WORKER}?tag=${encodeURIComponent(tag)}`, { headers: { Accept: 'application/json' } });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    throw new Error('Impossible de joindre l\'API Brawl Stars.');
  }

  if (res.ok && !data.error && typeof data.trophies === 'number') {
    return { trophies: data.trophies, name: data.name || 'Joueur', tag: data.tag || ('#' + tag) };
  }
  if (res.status === 404 || data.error) {
    throw new Error(`Tag "#${tag}" introuvable. Vérifie ton tag dans Brawl Stars → Profil → #TAG`);
  }
  throw new Error(`Erreur API ${res.status}`);
}

/* ──────────────────────────────────────────────
   LOGIQUE DÉFI
────────────────────────────────────────────── */
function getTodayIndex() {
  if (!config) return -1;
  const diff = daysDiff(config.startDate, todayStr());
  if (diff < 0) return -1;
  return Math.min(diff, TOTAL_DAYS - 1);
}

/* ──────────────────────────────────────────────
   AUTO-SYNC
────────────────────────────────────────────── */
async function autoSync() {
  if (!config) return;
  setApiStatus('loading', '🔄 Sync…');

  let player;
  try {
    player = await fetchPlayer(config.playerTag);
  } catch (e) {
    setApiStatus('error', '❌ Erreur');
    showToast(`❌ ${e.message}`, 'fail');
    return;
  }

  if (player.name !== config.playerName) { config.playerName = player.name; saveConfig(); }

  const idx   = getTodayIndex();
  const today = todayStr();

  if (idx >= 0) {
    const slot = daysData[idx];
    if (!slot || slot.date !== today) {
      daysData[idx] = { trophies: player.trophies, date: today, syncedAt: Date.now() };
    } else {
      daysData[idx].trophies = player.trophies;
      daysData[idx].syncedAt = Date.now();
    }
    saveDays();
  }

  updatePlayerUI(player);
  setApiStatus('ok', '✅ À jour');
  renderAll();
}

/* ──────────────────────────────────────────────
   UI
────────────────────────────────────────────── */
function setApiStatus(state, label) {
  el.apiDot.className     = `api-dot ${state}`;
  el.apiLabel.textContent = label;
}

function updatePlayerUI(player) {
  el.playerName.textContent   = player.name;
  el.playerTag.textContent    = player.tag;
  el.playerTrLive.textContent = player.trophies.toLocaleString('fr-FR');
  el.playerAvatar.textContent = (player.name || '?')[0].toUpperCase();
  let latestTs = 0;
  daysData.forEach(d => { if (d?.syncedAt > latestTs) latestTs = d.syncedAt; });
  el.lastSync.textContent = latestTs ? `Dernière sync : ${fmtTime(latestTs)}` : 'Jamais synchronisé';
}

/* ──────────────────────────────────────────────
   CALCULS
────────────────────────────────────────────── */
function getPrev(i)     { if (i===0) return startTr; for (let j=i-1;j>=0;j--) if (daysData[j]) return daysData[j].trophies; return startTr; }
function getDiff(i)     { if (!daysData[i]||startTr===null) return null; const p=getPrev(i); return p===null?null:daysData[i].trophies-p; }
function getTotalGain() { if (startTr===null) return null; for (let i=TOTAL_DAYS-1;i>=0;i--) if (daysData[i]) return daysData[i].trophies-startTr; return 0; }
function countSucc()    { const g=config?.dailyGoal??1000; return daysData.reduce((n,_,i)=>{ const d=getDiff(i); return n+(d!==null&&d>=g?1:0); },0); }

/* ──────────────────────────────────────────────
   RENDUS
────────────────────────────────────────────── */
function renderStats() {
  const todayIdx  = getTodayIndex();
  const completed = daysData.filter(d=>d!==null).length;
  const gain      = getTotalGain();
  const goal      = config?.dailyGoal ?? 1000;
  const totalGoal = goal * TOTAL_DAYS;

  el.statCurrentDay.textContent = todayIdx >= 0 ? `J${todayIdx+1}` : '—';
  el.statDays.textContent       = `${completed} / ${TOTAL_DAYS}`;

  if (gain !== null && completed > 0) {
    el.statGain.textContent = (gain>=0?'+':'')+gain.toLocaleString('fr-FR');
    el.statGain.style.color = gain >= totalGoal ? 'var(--green)' : 'var(--text-primary)';
  } else { el.statGain.textContent='+0'; el.statGain.style.color=''; }

  if (completed > 0 && gain !== null) {
    const avg = Math.round(gain/completed);
    el.statAvg.textContent = (avg>=0?'+':'')+avg.toLocaleString('fr-FR');
    el.statAvg.style.color = avg >= goal ? 'var(--green)' : 'var(--red)';
  } else { el.statAvg.textContent='—'; el.statAvg.style.color=''; }

  const pct = gain!==null&&totalGoal>0 ? Math.min(100,Math.max(0,Math.round(gain/totalGoal*100))) : 0;
  el.progressFill.style.width  = `${pct}%`;
  el.progressLabel.textContent = `${pct}%`;
  el.goalRecap.textContent     = goal.toLocaleString('fr-FR');
  el.goalTotal.textContent     = `+${totalGoal.toLocaleString('fr-FR')}`;
}

function renderCalendar() {
  const todayIdx = getTodayIndex();
  const goal     = config?.dailyGoal ?? 1000;
  el.calendarList.innerHTML = '';

  for (let i = 0; i < TOTAL_DAYS; i++) {
    const slot    = daysData[i];
    const diff    = getDiff(i);
    const filled  = slot !== null;
    const isToday = i === todayIdx;
    const future  = todayIdx >= 0 && i > todayIdx;
    const skipped = !filled && todayIdx >= 0 && i < todayIdx;

    let cls = 'day-row';
    if (filled && diff !== null) cls += diff >= goal ? ' success' : ' fail';
    if (isToday)  cls += ' today';
    if (skipped)  cls += ' skipped';

    let icon = '⬜';
    if (filled && diff !== null) icon = diff >= goal ? '✅' : '❌';
    else if (isToday)  icon = '📡';
    else if (skipped)  icon = '⏭️';
    else if (future)   icon = '🔒';

    let mainHTML;
    if (filled) {
      mainHTML = `<div class="day-trophies">${slot.trophies.toLocaleString('fr-FR')} 🏆</div>
                  <div class="day-date">${fmtDate(slot.date)}</div>`;
    } else if (isToday)  mainHTML = `<div class="day-placeholder">En attente de sync…</div>`;
    else if (future)     mainHTML = `<div class="day-placeholder">À venir</div>`;
    else if (skipped)    mainHTML = `<div class="day-placeholder">Jour manqué</div>`;
    else                 mainHTML = `<div class="day-placeholder">—</div>`;

    let diffText = '', diffCls = 'day-diff neutral';
    if (filled && diff !== null) {
      diffText = (diff>=0?'+':'')+diff.toLocaleString('fr-FR');
      diffCls  = `day-diff ${diff >= goal ? 'positive' : 'negative'}`;
    }

    let calDate = '';
    if (config?.startDate) {
      const d = new Date(config.startDate); d.setDate(d.getDate()+i);
      calDate = `<small style="font-size:9px;color:var(--text-muted);font-weight:600;display:block;margin-top:2px">${fmtDate(d.toISOString().split('T')[0])}</small>`;
    }

    const row = document.createElement('div');
    row.className = cls;
    row.innerHTML = `
      <span class="day-status-icon">${icon}</span>
      <span class="day-number">J${i+1}${calDate}</span>
      <div class="day-main">${mainHTML}</div>
      <span class="${diffCls}">${diffText}</span>`;
    el.calendarList.appendChild(row);
  }
}

function renderBilan() {
  if (!config || startTr===null || !daysData[TOTAL_DAYS-1]) {
    el.bilanSection.classList.add('hidden'); return;
  }
  const gain = getTotalGain(), goal = config.dailyGoal, tot = goal*TOTAL_DAYS;
  const ok = gain >= tot, cls = ok ? 'success' : 'fail';
  el.bilanSection.classList.remove('hidden');
  el.bilanBody.innerHTML = `
    <span class="bilan-emoji">${ok?'🎉':'😤'}</span>
    <div class="bilan-result ${cls}">${gain>=0?'+':''}${gain.toLocaleString('fr-FR')}</div>
    <div class="bilan-label ${cls}">${ok?'OBJECTIF ATTEINT !':'OBJECTIF NON ATTEINT'}</div>
    <div class="bilan-details">
      <div class="bilan-row"><span class="b-label">Trophées départ</span><span class="b-value">${startTr.toLocaleString('fr-FR')} 🏆</span></div>
      <div class="bilan-row"><span class="b-label">Trophées J30</span><span class="b-value">${daysData[TOTAL_DAYS-1].trophies.toLocaleString('fr-FR')} 🏆</span></div>
      <div class="bilan-row"><span class="b-label">Gain total</span><span class="b-value ${cls}">${gain>=0?'+':''}${gain.toLocaleString('fr-FR')}</span></div>
      <div class="bilan-row"><span class="b-label">Objectif visé</span><span class="b-value">+${tot.toLocaleString('fr-FR')}</span></div>
      <div class="bilan-row"><span class="b-label">Écart</span><span class="b-value ${(gain-tot)>=0?'success':'fail'}">${(gain-tot)>=0?'+':''}${(gain-tot).toLocaleString('fr-FR')}</span></div>
      <div class="bilan-row"><span class="b-label">Jours réussis</span><span class="b-value">${countSucc()} / ${TOTAL_DAYS}</span></div>
    </div>`;
}

function renderAll() { renderStats(); renderCalendar(); renderBilan(); }

/* ──────────────────────────────────────────────
   NAVIGATION
────────────────────────────────────────────── */
function showScreen(name) {
  el.screenSetup.classList.toggle('hidden',   name !== 'setup');
  el.screenTracker.classList.toggle('hidden', name !== 'tracker');
}

/* ──────────────────────────────────────────────
   TOAST
────────────────────────────────────────────── */
let _tt = null;
function showToast(msg, type='info') {
  const t = el.toast;
  t.textContent = msg; t.className = `toast ${type}`;
  t.classList.remove('hidden'); void t.offsetWidth; t.classList.add('show');
  clearTimeout(_tt);
  _tt = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.add('hidden'), 350); }, 3200);
}

/* ──────────────────────────────────────────────
   DÉMARRER LE DÉFI
────────────────────────────────────────────── */
async function onStart() {
  const tag  = cleanTag(el.inputTag.value.trim());
  const goal = parseInt(el.inputGoal.value.trim(), 10) || 1000;

  if (tag.length < 3) { showToast('⚠️ Tag invalide.', 'fail'); return; }
  if (goal < 1)       { showToast('⚠️ Objectif invalide.', 'fail'); return; }

  el.btnStart.disabled         = true;
  el.btnStartLabel.textContent = '⏳ Connexion…';
  el.setupLoader.classList.remove('hidden');
  setApiStatus('loading', '🔄 Connexion…');

  let player;
  try {
    player = await fetchPlayer(tag);
  } catch (e) {
    el.btnStart.disabled         = false;
    el.btnStartLabel.textContent = '🚀 Démarrer le défi';
    el.setupLoader.classList.add('hidden');
    setApiStatus('error', '❌ Échec');
    showToast(`❌ ${e.message}`, 'fail');
    return;
  }

  config   = { playerTag: player.tag, playerName: player.name, dailyGoal: goal, startDate: todayStr() };
  startTr  = player.trophies;
  daysData = new Array(TOTAL_DAYS).fill(null);
  daysData[0] = { trophies: player.trophies, date: todayStr(), syncedAt: Date.now() };

  saveConfig(); saveDays(); saveStart();

  el.setupLoader.classList.add('hidden');
  setApiStatus('ok', '✅ Lancé !');
  showScreen('tracker');
  el.headerSub.textContent = `${player.name} · Défi 30 Jours`;
  updatePlayerUI(player);
  renderAll();
  showToast(`🚀 Défi lancé ! Départ : ${player.trophies.toLocaleString('fr-FR')} 🏆`, 'success');
}

/* ──────────────────────────────────────────────
   ACTUALISER
────────────────────────────────────────────── */
async function onRefresh() {
  el.btnRefresh.disabled = true;
  await autoSync();
  el.btnRefresh.disabled = false;
  if (el.apiDot.className.includes('ok')) showToast('🔄 Trophées mis à jour !', 'info');
}

/* ──────────────────────────────────────────────
   RESET
────────────────────────────────────────────── */
function onReset() {
  clearAll();
  showScreen('setup');
  el.apiDot.className     = 'api-dot';
  el.apiLabel.textContent = 'En attente';
  el.inputTag.value       = '';
  el.inputGoal.value      = '1000';
  el.btnStart.disabled         = false;
  el.btnStartLabel.textContent = '🚀 Démarrer le défi';
  showToast('🔄 Mois réinitialisé.', 'info');
}

/* ──────────────────────────────────────────────
   INIT
────────────────────────────────────────────── */
async function init() {
  loadStorage();

  if (!config) { showScreen('setup'); return; }

  showScreen('tracker');
  el.headerSub.textContent = `${config.playerName} · Défi 30 Jours`;
  renderAll();

  const idx          = getTodayIndex();
  const slot         = idx >= 0 ? daysData[idx] : null;
  const alreadyToday = slot?.date === todayStr();

  if (!alreadyToday) {
    showToast('📡 Nouveau jour — synchronisation…', 'info');
    await autoSync();
  } else {
    updatePlayerUI({ trophies: slot.trophies, name: config.playerName, tag: config.playerTag });
    setApiStatus('ok', '✅ Données en cache');
  }
}

/* ──────────────────────────────────────────────
   ÉVÉNEMENTS
────────────────────────────────────────────── */
el.btnStart.addEventListener('click', onStart);
el.btnRefresh.addEventListener('click', onRefresh);
el.resetBtn.addEventListener('click', () => el.resetModal.classList.remove('hidden'));
el.cancelReset.addEventListener('click', () => el.resetModal.classList.add('hidden'));
el.confirmReset.addEventListener('click', () => { el.resetModal.classList.add('hidden'); onReset(); });
el.resetModal.addEventListener('click', e => { if (e.target === el.resetModal) el.resetModal.classList.add('hidden'); });

init();
