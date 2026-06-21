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
const BS_ICON_CDN = 'https://cdn.brawlify.com/profile-icons/regular/';

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
  app:            $('app'),
  apiDot:         $('apiDot'),
  apiLabel:       $('apiLabel'),
  playerAvatar:   $('playerAvatar'),
  playerAvatarLg: $('playerAvatarLg'),
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
  bilanEmptyCard: $('bilanEmptyCard'),
  bilanBody:      $('bilanBody'),
  resetBtn:       $('resetBtn'),
  resetModal:     $('resetModal'),
  cancelReset:    $('cancelResetBtn'),
  confirmReset:   $('confirmResetBtn'),
  toast:          $('toast'),
  pages:          document.querySelectorAll('.page'),
  bnavBtns:       document.querySelectorAll('.bnav-btn'),
};

/* ──────────────────────────────────────────────
   UTILITAIRES
────────────────────────────────────────────── */
const pad      = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const daysDiff = (a, b) => Math.round((new Date(b).setHours(0,0,0,0) - new Date(a).setHours(0,0,0,0)) / 86400000);
const addDays  = (dateStr, n) => { const d = new Date(dateStr); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
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
    return {
      trophies: data.trophies,
      name: data.name || 'Joueur',
      tag: data.tag || ('#' + tag),
      iconId: data.icon?.id ?? null,
    };
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
  if (player.iconId && player.iconId !== config.playerIconId) { config.playerIconId = player.iconId; saveConfig(); }

  const idx   = getTodayIndex();
  const today = todayStr();

  if (idx >= 0) {
    // Trouve le dernier jour pour lequel on a un solde de trophées connu.
    let lastKnownIdx   = -1;
    let lastKnownValue = startTr;
    for (let i = 0; i < idx; i++) {
      if (daysData[i] && typeof daysData[i].trophies === 'number') {
        lastKnownIdx   = i;
        lastKnownValue = daysData[i].trophies;
      }
    }

    // Comble les jours sautés entre le dernier point connu et aujourd'hui :
    // on ne peut pas reconstituer le détail jour par jour, donc on les marque
    // comme "manqués" en reportant le dernier solde connu (gain = 0 ce jour-là),
    // pour éviter de comptabiliser plusieurs jours de gains sur le jour courant.
    for (let i = lastKnownIdx + 1; i < idx; i++) {
      if (!daysData[i]) {
        daysData[i] = { trophies: lastKnownValue, date: addDays(config.startDate, i), syncedAt: Date.now(), missed: true };
      }
    }

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

  const initial = (player.name || '?')[0].toUpperCase();
  setAvatar(el.playerAvatar, player.iconId, initial);
  setAvatar(el.playerAvatarLg, player.iconId, initial);

  let latestTs = 0;
  daysData.forEach(d => { if (d?.syncedAt > latestTs) latestTs = d.syncedAt; });
  el.lastSync.textContent = latestTs ? `Dernière sync : ${fmtTime(latestTs)}` : 'Jamais synchronisé';
}

/* Affiche l'icône de profil Brawl Stars réelle (via la CDN Brawlify),
   avec repli sur l'initiale du pseudo si l'icône est indisponible. */
function setAvatar(node, iconId, fallbackInitial) {
  if (!node) return;
  if (iconId) {
    node.textContent = '';
    node.style.backgroundImage = `url(${BS_ICON_CDN}${iconId}.png)`;
    node.classList.add('has-icon');
  } else {
    node.style.backgroundImage = '';
    node.classList.remove('has-icon');
    node.textContent = fallbackInitial;
  }
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
    el.statGain.style.color = gain >= totalGoal ? 'var(--green)' : 'var(--text)';
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
    if (slot?.missed) cls += ' skipped';

    let icon = '⬜';
    if (slot?.missed)              icon = '⏭️';
    else if (filled && diff !== null) icon = diff >= goal ? '✅' : '❌';
    else if (isToday)  icon = '📡';
    else if (skipped)  icon = '⏭️';
    else if (future)   icon = '🔒';

    let mainHTML;
    if (slot?.missed) {
      mainHTML = `<div class="day-placeholder">Jour manqué (non synchronisé)</div>`;
    } else if (filled) {
      mainHTML = `<div class="day-trophies">${slot.trophies.toLocaleString('fr-FR')} 🏆</div>
                  <div class="day-date">${fmtDate(slot.date)}</div>`;
    } else if (isToday)  mainHTML = `<div class="day-placeholder">En attente de sync…</div>`;
    else if (future)     mainHTML = `<div class="day-placeholder">À venir</div>`;
    else if (skipped)    mainHTML = `<div class="day-placeholder">Jour manqué</div>`;
    else                 mainHTML = `<div class="day-placeholder">—</div>`;

    let diffText = '', diffCls = 'day-diff neutral';
    if (slot?.missed) {
      diffText = '—';
    } else if (filled && diff !== null) {
      diffText = (diff>=0?'+':'')+diff.toLocaleString('fr-FR');
      diffCls  = `day-diff ${diff >= goal ? 'positive' : 'negative'}`;
    }

    let calDate = '';
    if (config?.startDate) {
      const d = new Date(config.startDate); d.setDate(d.getDate()+i);
      calDate = `<small style="font-size:9px;color:var(--text3);font-weight:600;display:block;margin-top:2px">${fmtDate(d.toISOString().split('T')[0])}</small>`;
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
    el.bilanSection.classList.add('hidden');
    el.bilanEmptyCard.classList.remove('hidden');
    return;
  }
  el.bilanEmptyCard.classList.add('hidden');
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
  el.screenSetup.classList.toggle('hidden', name !== 'setup');
  el.app.classList.toggle('hidden',        name !== 'tracker');
}

function showPage(name) {
  el.pages.forEach(p => p.classList.toggle('active', p.id === `page-${name}`));
  el.bnavBtns.forEach(b => b.classList.toggle('active', b.id === `bnav-${name}`));
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

  config   = { playerTag: player.tag, playerName: player.name, playerIconId: player.iconId ?? null, dailyGoal: goal, startDate: todayStr() };
  startTr  = player.trophies;
  daysData = new Array(TOTAL_DAYS).fill(null);
  daysData[0] = { trophies: player.trophies, date: todayStr(), syncedAt: Date.now() };

  saveConfig(); saveDays(); saveStart();

  el.setupLoader.classList.add('hidden');
  setApiStatus('ok', '✅ Lancé !');
  showScreen('tracker');
  showPage('accueil');
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
   RÉPARATION RÉTROACTIVE
   Avant ce correctif, un jour non synchronisé restait
   vide (null) au lieu d'être comblé : à la prochaine
   sync, le gain de plusieurs jours se retrouvait crédité
   d'un coup sur le jour de la reprise. Cette fonction
   comble après coup les trous laissés dans l'historique,
   en reportant le dernier solde connu sur les jours
   manqués (gain = 0 ce jour-là, comme le fait autoSync).
   Idempotente : ne touche jamais un jour déjà rempli.
────────────────────────────────────────────── */
function repairShiftedDays() {
  if (!config || startTr === null) return;
  const todayIdx = getTodayIndex();
  if (todayIdx < 0) return;

  let lastKnownValue = startTr;
  let changed = false;

  for (let i = 0; i < todayIdx; i++) {
    if (daysData[i] && typeof daysData[i].trophies === 'number') {
      lastKnownValue = daysData[i].trophies;
    } else if (!daysData[i]) {
      daysData[i] = { trophies: lastKnownValue, date: addDays(config.startDate, i), syncedAt: Date.now(), missed: true };
      changed = true;
      // lastKnownValue reste inchangé : ce jour n'apporte aucun gain réel.
    }
  }

  if (changed) saveDays();
}
async function init() {
  loadStorage();

  if (!config) { showScreen('setup'); return; }

  repairShiftedDays();

  showScreen('tracker');
  showPage('accueil');
  renderAll();

  const idx          = getTodayIndex();
  const slot         = idx >= 0 ? daysData[idx] : null;
  const alreadyToday = slot?.date === todayStr();

  if (!alreadyToday) {
    showToast('📡 Nouveau jour — synchronisation…', 'info');
    await autoSync();
  } else {
    updatePlayerUI({ trophies: slot.trophies, name: config.playerName, tag: config.playerTag, iconId: config.playerIconId });
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

$('bnav-accueil').addEventListener('click', () => showPage('accueil'));
$('bnav-calendrier').addEventListener('click', () => showPage('calendrier'));
$('bnav-bilan').addEventListener('click', () => showPage('bilan'));

init();
