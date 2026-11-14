// AI 圆桌 & 辩论厅 — app shell: discovery, realtime long-poll, snapshot fallback, replay, submit.
import { createStage, IS_MOBILE } from './stage3d.js';
import { esc, md, plain } from './mdlite.js';
import { formatAsiaShanghai, formatClockAsiaShanghai, formatRelativeAsiaShanghai, hasAuthoritativeEndField, selectSessionTime, sortSessionsByTime } from './session_time.js';

const PAGES = 'https://zzy1130.github.io/p-eq-np-room/';
const REPO_API = 'https://api.github.com/repos/zzy1130/p-eq-np-room/contents/tunnel.json?ref=main';
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = {
  claim: ['主张', '#3d7fe0'], rebuttal: ['反驳', '#e0483d'], retract: ['撤回', '#d79b16'], summary: ['总结', '#23a26b'],
  vote: ['投票', '#8a52d6'], proposal: ['提议', '#e0703f'], status: ['状态', '#8a7d70'],
  constructive: ['立论', '#3d7fe0'], cx_q: ['质询·问', '#b2459a'], cx_a: ['质询·答', '#2f9e84'],
  announce: ['主持', '#8a7d70'], verdict: ['判决', '#c9a13b'],
};
const DEBATE_TYPE_LABEL = { rebuttal: '驳论', summary: '总结' };
const typeMeta = (t, mode) => {
  const base = TYPES[t] || [t ? String(t).slice(0, 6) : '发言', '#8a7d70'];
  if (mode === 'debate' && DEBATE_TYPE_LABEL[t]) return [DEBATE_TYPE_LABEL[t], base[1]];
  return base;
};
const STATE_LABEL = { running: '进行中', allocating: '分配角色中', starting: '开场中', judging: '裁判评议中', judged: '已宣判',
  consensus: '已达成共识', ended: '已结束', stopped: '已停止', error: '出错', stalled: '已中断', unknown: '未知' };
const isActive = (st) => ['running', 'allocating', 'starting', 'judging'].includes(st);
const fmtClock = (s) => { if (s == null || !isFinite(s)) return '--:--'; const neg = s < 0; s = Math.abs(Math.round(s)); return (neg ? '-' : '') + String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const ago = (ms) => formatRelativeAsiaShanghai(ms).text;
function setHTML(el, html) { if (el && el._html !== html) { el.innerHTML = html; el._html = html; } }   // skip identical rebuilds (keeps tap/scroll/hover state)
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), ms); }

// =====================================================================================
// Connection: discover the current tunnel (stable entry = this GitHub Pages URL)
// =====================================================================================
const IS_DEBUG = /(^\?|&)debug(=|&|$)/.test(location.search) || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const Net = { mode: 'connecting', base: null, fails: 0, lat: [], lastLat: null, discovering: null, seek: (n) => current?.seek(n, true) };
if (IS_DEBUG) {
  Net.debugSetLive = (lv, opts) => current?.debugSetLive?.(lv, opts);
  Net.debugClearLive = () => current?.debugClearLive?.();
}
window.__arena = Net;

async function fetchJSON(url, { timeout = 8000, signal, ...opt } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  if (signal) signal.addEventListener('abort', () => ac.abort(), { once: true });
  try {
    const r = await fetch(url, { cache: 'no-store', ...opt, signal: ac.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; e.body = j; throw e; }
    return j;
  } finally { clearTimeout(t); }
}
async function probe(base) {
  if (!base || !/^https?:\/\//.test(base)) throw new Error('bad');
  const j = await fetchJSON(base.replace(/\/$/, '') + '/api/health', { timeout: 8000 });
  if (!j.ok) throw new Error('unhealthy');
  return base.replace(/\/$/, '');
}
async function tunnelFromPages() { const j = await fetchJSON(PAGES + 'tunnel.json?t=' + Date.now(), { timeout: 6000 }); return j.url; }
async function tunnelFromApi() {
  const j = await fetchJSON(REPO_API, { timeout: 6000, headers: { Accept: 'application/vnd.github.raw+json' } });
  return (j.url) || JSON.parse(atob(j.content || '')).url;
}
function setConn(mode, text, title) {
  Net.mode = mode;
  const c = $('conn'); c.className = 'conn ' + mode; c.querySelector('span').textContent = text; c.title = title || '';
  const c2 = $('conn2'); if (c2) { c2.className = 'conn-dot ' + mode; c2.title = text + (title ? '：' + title : ''); c2.setAttribute('aria-label', '连接状态：' + text); }
  const b = $('banner');
  if (mode === 'snap') { b.textContent = IS_MOBILE ? '实时通道连不上，已切到快照模式（约 1 分钟延迟），自动重连中…' : '实时通道暂时连不上，已切换到快照模式（约每分钟更新，可能有 1–2 分钟延迟）。正在后台自动重连…'; b.classList.remove('hidden'); }
  else b.classList.add('hidden');
  document.body.classList.toggle('banner-on', mode === 'snap');
  $('newBtn').disabled = $('newBtn2').disabled = mode === 'snap';
  if (mode !== 'connecting' && !$('home').classList.contains('hidden')) loadHomeSys();
}
async function discover() {
  if (Net.discovering) return Net.discovering;
  Net.discovering = (async () => {
    if (Net.mode !== 'live') setConn('connecting', '连接中…', '正在发现实时隧道地址');
    const tries = [];
    const sameOrigin = !/github\.io$/.test(location.hostname) && location.protocol.startsWith('http') ? location.origin : null;
    if (sameOrigin) tries.push(probe(sameOrigin));
    const saved = localStorage.getItem('arenaBase');
    if (saved && saved !== sameOrigin) tries.push(probe(saved));
    tries.push(tunnelFromPages().then(probe));
    try {
      const base = await Promise.any(tries).catch(async () => {   // one quick retry before giving up
        await sleep(1500);
        return Promise.any([tunnelFromApi().then(probe), tunnelFromPages().then(probe), ...(saved ? [probe(saved)] : [])]);   // GitHub API = fresher copy
      });
      Net.base = base; Net.fails = 0;
      localStorage.setItem('arenaBase', base);
      setConn('live', '实时', '实时通道：' + base);
      return true;
    } catch {
      Net.base = null;
      setConn('snap', '快照模式', '实时通道不可用，使用 GitHub Pages 上的快照');
      return false;
    } finally { Net.discovering = null; }
  })();
  return Net.discovering;
}
function noteFailure() {
  Net.fails++;
  if (Net.fails >= 3 && Net.mode === 'live') { Net.fails = 0; discover(); }
}
setInterval(() => { if (Net.mode === 'snap') discover().then((ok) => ok && route(true)); }, 10000);
function recordLatency(m) {
  if (!m.ts_ms) return;
  const lat = Date.now() - m.ts_ms;
  if (lat < 0 || lat > 120000) return;
  Net.lat.push({ idx: m.idx, sid: m.session, lat, recv_ms: Date.now(), ts_ms: m.ts_ms });
  Net.lastLat = lat;
  if (Net.mode === 'live') $('conn').querySelector('span').textContent = '实时 · ' + (lat / 1000).toFixed(1) + 's';
}

const API = {
  async sessions() {
    if (Net.mode === 'live') {
      try { const j = await fetchJSON(Net.base + '/api/sessions' + (homeTest ? '?test=1' : '')); Net.fails = 0; return j.sessions; } catch (e) { noteFailure(); throw e; }
    }
    const j = await fetchJSON(PAGES + 'snap/sessions.json?t=' + Date.now());
    Net.snapMs = j.snapshot_ms || null;
    return j.sessions;
  },
  async bundle(sid, opt = {}) {
    if (Net.mode === 'live') {
      try { const j = await fetchJSON(Net.base + '/api/s/' + encodeURIComponent(sid), { signal: opt.signal }); Net.fails = 0; return j; } catch (e) { if (e.status !== 404 && e.name !== 'AbortError') noteFailure(); throw e; }
    }
    return fetchJSON(PAGES + 'snap/s/' + encodeURIComponent(sid) + '.json?t=' + Date.now(), { signal: opt.signal });
  },
  async final(sid, opt = {}) {
    if (Net.mode === 'live') return fetchJSON(Net.base + '/api/s/' + encodeURIComponent(sid) + '/final', { signal: opt.signal });
    const b = await fetchJSON(PAGES + 'snap/s/' + encodeURIComponent(sid) + '.json?t=' + Date.now(), { signal: opt.signal });
    return { exists: !!b.final_text, text: b.final_text || '' };
  },
  async submit(body) {
    return fetchJSON(Net.base + '/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeout: 15000 });
  },
};

// =====================================================================================
// Router
// =====================================================================================
let current = null;   // session controller
let sessionEpoch = 0;
let homeEpoch = 0;
async function route(force) {
  const m = location.hash.match(/^#\/s\/([^/?]+)/);
  if (m) {
    const sid = decodeURIComponent(m[1]);
    if (!current || current.sid !== sid || force) {
      current?.close(); current = null;
      try { current = openSession(sid); } catch (e) { console.error(e); }
    }
    $('home').classList.add('hidden'); $('session').classList.remove('hidden');
    document.body.classList.add('in-session');
    stage?.setRunning(!document.hidden);
    stopHome();
  } else {
    current?.close(); current = null;
    $('session').classList.add('hidden'); $('home').classList.remove('hidden');
    document.body.classList.remove('in-session');
    stage?.setRunning(false);   // no 3D frames while the lobby is shown
    startHome();
  }
}
addEventListener('hashchange', () => route());

// =====================================================================================
// Home
// =====================================================================================
let homeTimer = 0, homeFilter = 'all', homeData = null, homeTest = /[?&]test=1/.test(location.search);
const HOME_META_CONCURRENCY = 3;
const HOME_META_RETRY_MS = 30000;
const homeMetaCache = new Map();
let homeMetaAC = null;
let homeMetaInFlight = 0;
const homeMetaQueue = [];

function homeMetaVersion(s) {
  return `${Net.mode}:${s.state || ''}:${s.updated_ms || 0}:${s.n_msgs || 0}:${s.winner || ''}:${s.judge_label || ''}:${Net.mode === 'snap' ? (Net.snapMs || 0) : ''}`;
}
function homeMetaFor(s) {
  if (!s?.sid) return null;
  const e = homeMetaCache.get(s.sid);
  if (!e || e.version !== homeMetaVersion(s)) return null;
  if (e.status === 'loading') return { _loading: true };
  return e.meta || null;
}
function extractTimeMeta(j) {
  if (!j || typeof j !== 'object') return {};
  return {
    decided_at: j.verdict?.decided_at ?? j.decided_at ?? null,
    ended_at: j.ended_at ?? j.status?.ended_at ?? null,
    ended_ms: j.ended_ms ?? j.status?.ended_ms ?? null,
    finished_at: j.finished_at ?? j.status?.finished_at ?? null,
    finished_ms: j.finished_ms ?? j.status?.finished_ms ?? null,
  };
}
async function fetchHomeMeta(s, signal) {
  const sid = s.sid;
  if (Net.mode === 'live') {
    if (!Net.base) throw new Error('no live base');
    const since = Math.max(0, Number(s.n_msgs) || 0);
    const j = await fetchJSON(`${Net.base}/api/s/${encodeURIComponent(sid)}/poll?since=${since}&sv=-1`, { timeout: 8000, signal });
    return extractTimeMeta(j);
  }
  const b = await fetchJSON(`${PAGES}snap/s/${encodeURIComponent(sid)}.json?v=${encodeURIComponent(Net.snapMs || 0)}`, { timeout: 8000, signal });
  return extractTimeMeta(b);
}
function pumpHomeMeta(epoch) {
  if (epoch !== homeEpoch || current || location.hash.startsWith('#/s/')) return;
  const ac = homeMetaAC;
  if (!ac || ac.signal.aborted) return;
  while (homeMetaInFlight < HOME_META_CONCURRENCY && homeMetaQueue.length) {
    const item = homeMetaQueue.shift();
    if (item.epoch !== homeEpoch || ac.signal.aborted) continue;
    const cur = homeMetaCache.get(item.sid);
    if (cur && cur.version === item.version && (cur.status === 'done' || cur.status === 'loading')) continue;
    homeMetaCache.set(item.sid, { version: item.version, status: 'loading', meta: null, retryAfter: 0 });
    homeMetaInFlight++;
    fetchHomeMeta(item.session, ac.signal)
      .then((meta) => {
        if (item.epoch !== homeEpoch || ac.signal.aborted || current || location.hash.startsWith('#/s/')) {
          const latest = homeMetaCache.get(item.sid);
          if (latest && latest.status === 'loading' && latest.version === item.version) homeMetaCache.delete(item.sid);
          return;
        }
        homeMetaCache.set(item.sid, { version: item.version, status: 'done', meta, retryAfter: 0 });
        renderHome();
      })
      .catch((err) => {
        const latest = homeMetaCache.get(item.sid);
        if (item.epoch !== homeEpoch || ac.signal.aborted || current || location.hash.startsWith('#/s/')) {
          if (latest && latest.status === 'loading' && latest.version === item.version) homeMetaCache.delete(item.sid);
          return;
        }
        const retryAfter = err?.status === 404 ? Infinity : Date.now() + HOME_META_RETRY_MS;
        homeMetaCache.set(item.sid, { version: item.version, status: 'error', meta: null, retryAfter });
        renderHome();
      })
      .finally(() => {
        homeMetaInFlight = Math.max(0, homeMetaInFlight - 1);
        pumpHomeMeta(epoch);
      });
  }
}
function refreshHomeMeta(list, epoch) {
  if (epoch !== homeEpoch || current || location.hash.startsWith('#/s/')) return;
  if (!homeMetaAC || homeMetaAC.signal.aborted) homeMetaAC = new AbortController();
  const nowMs = Date.now();
  const ordered = sortSessionsByTime(list, homeMetaFor, nowMs);
  for (const s of ordered) {
    if (!s?.sid || isActive(s.state) || hasAuthoritativeEndField(s)) continue;
    if (Net.mode === 'live' && !Net.base) continue;
    const version = homeMetaVersion(s);
    const prev = homeMetaCache.get(s.sid);
    if (prev && prev.version === version) {
      if (prev.status === 'done' || prev.status === 'loading') continue;
      if (prev.status === 'error' && nowMs < prev.retryAfter) continue;
    }
    const qIdx = homeMetaQueue.findIndex((q) => q.sid === s.sid);
    if (qIdx >= 0) {
      homeMetaQueue[qIdx] = { sid: s.sid, session: s, version, epoch };
      continue;
    }
    homeMetaQueue.push({ sid: s.sid, session: s, version, epoch });
  }
  pumpHomeMeta(epoch);
}

function startHome() {
  clearTimeout(homeTimer);
  const epoch = ++homeEpoch;
  homeMetaAC?.abort();
  homeMetaAC = new AbortController();
  homeMetaQueue.length = 0;
  loadHome(epoch);
  loadHomeSys(epoch);
}
function stopHome() {
  homeEpoch++;
  clearTimeout(homeTimer);
  homeMetaAC?.abort();
  homeMetaAC = null;
  homeMetaQueue.length = 0;
  for (const [sid, entry] of homeMetaCache) {
    if (entry.status === 'loading') homeMetaCache.delete(sid);
  }
}
async function loadHome(epoch = homeEpoch) {
  try {
    const list = await API.sessions();
    if (epoch !== homeEpoch || current || location.hash.startsWith('#/s/')) return;
    homeData = list;
    renderHome();
    refreshHomeMeta(list, epoch);
  }
  catch (e) {
    if (epoch !== homeEpoch || current || location.hash.startsWith('#/s/')) return;
    if (!homeData) {
      setHTML($('cards'), `<div class="empty">暂时取不到场次列表（${esc(e.message)}），稍后自动重试。</div>`);
      setHTML($('homeNow'), `<div class="now-empty"><p class="now-k">暂时取不到场次状态</p><p class="now-note">${esc(e.message)}。正在自动重试。</p></div>`);
    }
  }
  if (epoch !== homeEpoch || current || location.hash.startsWith('#/s/')) return;
  clearTimeout(homeTimer);
  homeTimer = setTimeout(() => loadHome(epoch), Net.mode === 'live' ? 4000 : 30000);
}
// model / judge line under "怎么运作": only from the live server's own /api/health — never guessed
let homeSysFor = null;
function loadHomeSys(epoch = homeEpoch) {
  const el = $('homeSys'); if (!el) return;
  if (Net.mode !== 'live' || !Net.base) { el.textContent = Net.mode === 'snap' ? '快照模式：模型与裁判配置需连上实时服务后显示。' : ''; homeSysFor = null; return; }
  if (homeSysFor === Net.base) return;
  homeSysFor = Net.base;
  fetchJSON(Net.base + '/api/health', { timeout: 6000 }).then((h) => {
    if (epoch !== homeEpoch || current || location.hash.startsWith('#/s/')) return;
    const backend = h.model_backend === 'agy' ? 'pi-agy' : (h.model_backend || '');
    const model = h.model ? String(h.model) : '';
    const judgeS = h.judge_wait_s ? `${h.judge_wait_s} 秒` : '超时';
    el.textContent = (backend || model ? `辩手模型：${[backend, model].filter(Boolean).join(' / ')}。` : '') +
      `裁判：Gemini 传令官主判，${judgeS}未到由 Claude Code CLI 兜底；晚到的主裁决会自动替换兜底结果。`;
  }).catch(() => { homeSysFor = null; });
}
const sideTxt = (w) => (w === 'aff' ? '正方' : w === 'neg' ? '反方' : '');
const fmtTime = (ms) => formatAsiaShanghai(ms);
function stateText(s) {
  let st = STATE_LABEL[s.state] || s.state;
  if (s.state === 'judged' && s.winner) st = `已宣判 · ${sideTxt(s.winner)}胜${s.judge_label === '兜底裁判' ? '（兜底）' : ''}`;
  if (s.state === 'running' && s.phase_label) st = '进行中 · ' + s.phase_label;
  return st;
}
function renderHomeNow(all) {
  const el = $('homeNow'); if (!el) return;
  const nowMs = Date.now();
  const snapNote = Net.mode === 'snap' ? `<p class="now-snap">快照数据${Net.snapMs ? '，生成于 ' + esc(fmtTime(Net.snapMs)) : ''}；实时通道恢复后自动刷新。</p>` : '';
  const active = sortSessionsByTime(all.filter((s) => isActive(s.state)), homeMetaFor, nowMs);
  if (active.length) {
    setHTML(el, snapNote + active.slice(0, 2).map((s) => {
      const deb = s.mode === 'debate';
      const t = selectSessionTime(s, homeMetaFor(s), nowMs);
      return `<a class="now-card" href="#/s/${encodeURIComponent(s.sid)}">
        <span class="now-row"><span class="badge ${deb ? 'db' : 'rt'}">${deb ? '美式辩论' : '圆桌讨论'}</span><span class="state ${esc(s.state)}">${esc(stateText(s))}</span>${s.test ? '<span class="state">测试</span>' : ''}</span>
        <span class="now-topic">${esc(s.topic || s.sid)}</span>
        <span class="now-meta">${s.n_msgs || 0} 条发言 · ${esc(t.listText)}</span>
        <span class="btn now-go">进入观战</span></a>`;
    }).join(''));
    return;
  }
  const done = sortSessionsByTime(all.filter((s) => !isActive(s.state)), homeMetaFor, nowMs);
  const last = done[0];
  const lastTime = last ? selectSessionTime(last, homeMetaFor(last), nowMs) : null;
  setHTML(el, snapNote + `<div class="now-empty"><p class="now-k">现在没有进行中的场次</p>${last ? `
    <a class="now-latest" href="#/s/${encodeURIComponent(last.sid)}">
      <span class="now-l">${esc(lastTime.cardLabel)}</span>
      <span class="now-topic">${esc(last.topic || last.sid)}</span>
      <span class="now-res">${last.mode === 'debate' && last.winner ? `<b class="win-${esc(last.winner)}">${sideTxt(last.winner)}胜</b><span>${esc(last.judge_label || '')}</span>` : `<b>${esc(STATE_LABEL[last.state] || last.state || '')}</b>`}</span>
      <span class="now-go-l">${last.mode === 'debate' ? '查看判决与报告' : '查看讨论'}</span></a>` : '<p class="now-note">还没有场次，发起第一场吧。</p>'}</div>`);
}
function renderHomeStats(all) {
  const el = $('homeStats'); if (!el) return;
  const deb = all.filter((s) => s.mode === 'debate' && !s.test && !s.mock && s.state === 'judged');
  if (!deb.length) { el.textContent = ''; return; }
  const a = deb.filter((s) => s.winner === 'aff').length, n = deb.filter((s) => s.winner === 'neg').length;
  el.innerHTML = `已宣判 <b>${deb.length}</b> 场辩论：<span class="win-aff">正方 ${a} 胜</span>，<span class="win-neg">反方 ${n} 胜</span>。`;
}
function renderHome() {
  const all = homeData || [];
  const nowMs = Date.now();
  renderHomeNow(all); renderHomeStats(all);
  const list = sortSessionsByTime(
    all.filter((s) => homeFilter === 'all' || (homeFilter === 'running' ? isActive(s.state) : s.mode === homeFilter)),
    homeMetaFor,
    nowMs,
  );
  const cnt = $('homeCount'); if (cnt) cnt.textContent = list.length ? `${list.length} 场` : '';
  if (!list.length) {
    setHTML($('cards'), `<div class="empty">${homeFilter === 'running' ? '现在没有进行中的场次。' : '还没有场次。'}${Net.mode === 'live' ? '点「发起」开一场。' : ''}</div>`);
    return;
  }
  const html = list.map((s) => {
    const deb = s.mode === 'debate';
    const win = s.state === 'judged' && s.winner ? ` win-${esc(s.winner)}` : '';
    const t = selectSessionTime(s, homeMetaFor(s), nowMs);
    const createdExtra = !t.active && t.status !== 'ok' && t.createdAbsText ? `<span>创建于 ${esc(t.createdAbsText)}</span>` : '';
    return `<a class="card row-card${win}" href="#/s/${encodeURIComponent(s.sid)}" data-sid="${esc(s.sid)}">
      <div class="row"><span class="badge ${deb ? 'db' : 'rt'}">${deb ? '美式辩论' : '圆桌讨论'}</span>
        <span class="state ${esc(s.state)}">${esc(stateText(s))}</span>${s.mock ? '<span class="state">演练·mock</span>' : ''}${s.test ? '<span class="state">测试</span>' : ''}${s.legacy ? '<span class="state">存档</span>' : ''}</div>
      <h3>${esc(s.topic || s.sid)}</h3>
      <div class="meta"><span>${s.n_roles || '—'} 位${deb ? '辩手' : '角色'}</span><span>${s.n_msgs || 0} 条发言</span><span>${esc(t.listText)}</span>${createdExtra}</div>
    </a>`;
  }).join('');
  setHTML($('cards'), html);
}
$('filters').addEventListener('click', (e) => {
  if (e.target.closest('#testToggle')) { homeTest = !homeTest; $('testToggle').classList.toggle('on', homeTest); loadHome(); return; }
  const b = e.target.closest('[data-f]'); if (!b) return;
  homeFilter = b.dataset.f;
  for (const x of $('filters').children) x.classList.toggle('on', x === b);
  renderHome();
});

// =====================================================================================
// Submit modal
// =====================================================================================
var openModal = function () {
  if (Net.mode !== 'live') { toast('快照模式下不能提交，请等实时通道恢复'); return; }
  $('modal').classList.remove('hidden'); document.body.classList.add('modal-open'); $('mErr').textContent = '';
  const saved = localStorage.getItem('arenaPass'); if (saved) $('fPass').value = saved;
  fetchJSON(Net.base + '/api/health', { timeout: 5000 }).then((h) => {
    if (h.quota_blocked_until_ms) $('mErr').textContent = `注意：上游免费额度今日已用尽，约 ${formatClockAsiaShanghai(h.quota_blocked_until_ms)} 重置，之前提交会被拒绝。`;
    if (h.running >= 2) $('mErr').textContent = '当前已有 2 场在进行，请稍后再试。';
  }).catch(() => {});
  if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => $('fTopic').focus(), 50);   // phones: don't pop the keyboard over the form on open
};
function closeModal() { $('modal').classList.add('hidden'); $('ppick').classList.add('hidden'); document.body.classList.remove('modal-open'); }
// keyboard / address bar: the sheet follows the *visual* viewport so the action bar stays above the on-screen keyboard
function syncVV() {
  const vv = window.visualViewport;
  document.documentElement.style.setProperty('--vvh', Math.round(vv ? vv.height : innerHeight) + 'px');
}
syncVV();
window.visualViewport?.addEventListener('resize', syncVV);
addEventListener('resize', syncVV);
$('newBtn').addEventListener('click', () => openModal());
$('newBtn2').addEventListener('click', () => openModal());
$('cancelBtn').addEventListener('click', closeModal);
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
// ---- persona picker (人格辩手，带头像)
const Personas = { list: [], byId: new Map(), pick: { aff: [null, null], neg: [null, null], roundtable: [] }, loaded: null, data: new Map(), version: 0 };
// avatars are inlined as data: URIs (fetched once) — <img> tags created inside the live timeline could stall behind the
// page's long-lived connections, and data URIs also make the avatars independent of where the page is hosted.
function assetUrl(p) { return Personas.data.get(p) || new URL(p, location.href).href; }
function mimeForAvatar(path, ct) {
  if (ct && ct.startsWith('image/') && !ct.includes('octet-stream')) return ct.split(';')[0];
  const ext = String(path).split('?')[0].split('.').pop().toLowerCase();
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml' })[ext] || 'image/jpeg';
}
function blobToDataUrl(blob, mime) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob.type === mime ? blob : new Blob([blob], { type: mime }));
  });
}
function avatarCreditLine(c, asLink) {
  if (!c) return '';
  if (c.type === 'photo') {
    const label = `📷 ${c.author || 'Unknown'} · ${c.license || ''}`;
    if (asLink && (c.file_page || c.source_url)) {
      return `<a class="src avcred" href="${esc(c.file_page || c.source_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="${esc(c.attribution_text || label)}">${esc(label)}</a>`;
    }
    return `<span class="avcred" title="${esc(c.attribution_text || label)}">${esc(label)}</span>`;
  }
  return `<span class="avcred" title="${esc(c.attribution_text || '')}">🎨 原创卡通 · ${esc(c.license || 'MIT')}</span>`;
}
function loadPersonas() {
  if (!Personas.loaded) Personas.loaded = fetch(new URL('assets/personas.json', location.href).href + '?v=' + Date.now(), { cache: 'no-store' })
    .then((r) => r.json()).then(async (j) => {
      Personas.list = j.personas || []; Personas.byId = new Map(Personas.list.map((p) => [p.id, p]));
      await Promise.all(Personas.list.map(async (p) => {
        try {
          const url = new URL(p.avatar, location.href).href;
          const r = await fetch(url);
          if (!r.ok) return;
          if (/\.svg(\?|$)/i.test(p.avatar)) {
            const t = await r.text();
            Personas.data.set(p.avatar, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(t));
          } else {
            const blob = await r.blob();
            const mime = mimeForAvatar(p.avatar, r.headers.get('content-type'));
            Personas.data.set(p.avatar, await blobToDataUrl(blob, mime));
          }
        } catch {}
      }));
      Personas.version++;
    })
    .catch(() => { Personas.loaded = null; });
  return Personas.loaded;
}
loadPersonas();
window.__personas = Personas;
const formMode = () => (new FormData($('form')).get('mode')) || 'debate';
function chosenIds() { return [...Personas.pick.aff, ...Personas.pick.neg, ...Personas.pick.roundtable].filter(Boolean); }
function slotHtml(side, i) {
  const p = Personas.byId.get(Personas.pick[side][i]);
  const lab = (side === 'aff' ? '正方' : '反方') + (i ? '二辩' : '一辩');
  const tip = p ? (p.blurb + (p.avatar_credit?.attribution_text ? ' | 头像：' + p.avatar_credit.attribution_text : '')) : '点击选择人格辩手';
  return `<button type="button" class="pslot ${p ? 'on' : ''}" data-side="${side}" data-i="${i}" title="${esc(tip)}">
    ${p ? `<img src="${esc(assetUrl(p.avatar))}" alt="${esc(p.name)}">` : '<span class="auto">AI</span>'}
    <b>${lab}</b><span>${p ? esc(p.name) : '自动生成'}</span></button>`;
}
function renderPickers() {
  const box = $('pickers'); if (!box) return;
  if (formMode() === 'debate') {
    $('pickLabel').textContent = '选辩手（可选：每方最多 2 位人格辩手，没选的位置由 AI 自动生成）';
    box.innerHTML = ['aff', 'neg'].map((side) => `<div class="prow"><span class="pside ${side}">${side === 'aff' ? '正方' : '反方'}</span>${slotHtml(side, 0)}${slotHtml(side, 1)}</div>`).join('');
  } else {
    $('pickLabel').textContent = '选参与者（可选，最多 6 位人格角色；主持人、定稿人和其余角色由 AI 自动生成）';
    box.innerHTML = `<div class="pgrid small">${Personas.list.map((p) => `<div class="pcard ${Personas.pick.roundtable.includes(p.id) ? 'on' : ''}">
      <button type="button" class="pcard-btn" data-rt="${esc(p.id)}" title="${esc(p.avatar_credit?.attribution_text || '')}">
        <img src="${esc(assetUrl(p.avatar))}" alt="${esc(p.name)}"><b>${esc(p.name)}</b><span>${esc(p.blurb)}</span>
      </button>
      <details class="pcard-lic"><summary>来源与授权</summary>${avatarCreditLine(p.avatar_credit, false)}</details>
    </div>`).join('')}</div>`;
  }
}
let ppickTarget = null;
function openPicker(side, i) {
  ppickTarget = { side, i };
  const used = new Set(chosenIds()); const cur = Personas.pick[side][i];
  const el = $('ppick');
  el.innerHTML = `<div class="pphead"><b>选择${side === 'aff' ? '正方' : '反方'}${i ? '二辩' : '一辩'}</b><button type="button" class="btn ghost small pp-close" data-close>关闭</button></div>
    <div class="pgrid"><button type="button" class="pcard auto ${cur ? '' : 'on'}" data-pid=""><span class="autoav">AI</span><b>AI 自动生成</b><span>由分配官按议题生成</span></button>
    ${Personas.list.map((p) => `<div class="pcard ${cur === p.id ? 'on' : ''} ${used.has(p.id) && cur !== p.id ? 'disabled' : ''}">
      <button type="button" class="pcard-btn" data-pid="${esc(p.id)}" ${used.has(p.id) && cur !== p.id ? 'disabled' : ''} title="${esc(p.avatar_credit?.attribution_text || '')}">
        <img src="${esc(assetUrl(p.avatar))}" alt="${esc(p.name)}"><b>${esc(p.name)}</b><span>${esc(p.blurb)}</span>
      </button>
      <details class="pcard-lic"><summary>来源与授权</summary>
        <a class="src" href="${esc(p.source.url)}" target="_blank" rel="noopener">${esc(p.source.repo)} · ${esc(p.source.license)}</a>
        ${avatarCreditLine(p.avatar_credit, true)}
      </details>
    </div>`).join('')}</div>`;
  el.classList.remove('hidden');
}
$('ppick').addEventListener('click', (e) => {
  if (!ppickTarget) return;
  if (e.target.closest('.pp-close')) { $('ppick').classList.add('hidden'); return; }
  const c = e.target.closest('.pcard-btn, .pcard.auto'); if (!c || c.disabled) return;
  Personas.pick[ppickTarget.side][ppickTarget.i] = c.dataset.pid || null;
  $('ppick').classList.add('hidden');
  renderPickers();
});
$('pickers').addEventListener('click', (e) => {
  const s = e.target.closest('.pslot'); if (s) { openPicker(s.dataset.side, +s.dataset.i); return; }
  const c = e.target.closest('.pcard-btn');
  if (c && c.dataset.rt) {
    const id = c.dataset.rt, l = Personas.pick.roundtable;
    if (l.includes(id)) l.splice(l.indexOf(id), 1); else if (l.length < 6) l.push(id); else toast('最多选 6 位');
    renderPickers();
  }
});
const _openModal = openModal;
openModal = function () { _openModal(); loadPersonas().then(renderPickers); };
$('newBtn').onclick = $('newBtn2').onclick = openModal;
$('form').addEventListener('change', (e) => {
  if (e.target.name === 'mode') renderPickers();
});
$('form').addEventListener('change', (e) => {
  if (e.target.name !== 'mode') return;
  const deb = e.target.value === 'debate';
  $('topicLabel').textContent = deb ? '辩题（正方支持此命题）' : '话题';
  $('fTopic').placeholder = deb ? '例如：应当禁止宠物猫外出' : '例如：远程办公会让团队更有创造力吗？';
});
$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData($('form'));
  const body = { mode: fd.get('mode'), topic: String(fd.get('topic') || '').trim(), notes: String(fd.get('notes') || '').trim(), passcode: String(fd.get('passcode') || '') };
  if (fd.get('mock')) { body.mock = true; body.judge_wait_s = 300; }
  if (fd.get('test')) body.test = true;
  if (body.mode === 'debate') { if (chosenIds().length) body.personas = { aff: [...Personas.pick.aff], neg: [...Personas.pick.neg] }; }
  else if (Personas.pick.roundtable.length) body.personas = [...Personas.pick.roundtable];
  $('submitBtn').disabled = true; $('mErr').textContent = '';
  try {
    const r = await API.submit(body);
    if ($('remember').checked) localStorage.setItem('arenaPass', body.passcode); else localStorage.removeItem('arenaPass');
    closeModal(); $('form').reset();
    Personas.pick = { aff: [null, null], neg: [null, null], roundtable: [] }; renderPickers();
    toast('已开场！分配官正在安排角色…');
    location.hash = '#/s/' + encodeURIComponent(r.sid);
  } catch (err) {
    $('mErr').textContent = err.body?.error || err.message || '提交失败';
  } finally { $('submitBtn').disabled = false; }
});
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('ppick').classList.contains('hidden')) { $('ppick').classList.add('hidden'); return; }   // picker first, then the form
  if (!$('modal').classList.contains('hidden')) { closeModal(); return; }
  if ($('verdict').classList.contains('on')) { $('verdict').classList.remove('on'); return; }
  $('drawer').classList.add('hidden');
});

// =====================================================================================
// Session view
// =====================================================================================
let stage = null;
function syncCamToggleUI(on) {
  const btn = $('camToggle');
  if (!btn) return;
  on = !!on;
  // gestures below are exactly what stage3d.js wires into OrbitControls when camera control is on
  const touch = matchMedia('(pointer: coarse)').matches;
  const how = touch ? '单指拖动＝旋转 · 双指捏合＝缩放 · 双指拖动＝平移' : '拖动＝旋转 · 滚轮＝缩放 · 右键拖动或 Shift+拖动＝平移';
  btn.setAttribute('aria-pressed', String(on));
  const st = $('camState'); if (st) st.textContent = on ? '开' : '关';
  btn.setAttribute('aria-label', on ? `镜头操控：开（${how}；再点关闭）` : '镜头操控：关（点按开启旋转、缩放、平移）');
  btn.title = on ? `镜头操控已开：${how}。再点一次关闭${touch ? '，单指恢复滚动页面' : ''}；「复位」回到全员全景`
    : `镜头操控已关${touch ? '：单指在舞台上下滑动＝滚动页面' : ''}。点按开启旋转、缩放、平移`;
  const hint = $('camHint');
  if (hint) { hint.textContent = on ? how : ''; hint.classList.toggle('hidden', !on); }
}
function isScrollBlockedByOverlay() {
  const isShown = (id) => { const el = $(id); return el && !el.classList.contains('hidden'); };
  return isShown('drawer') || $('verdict')?.classList.contains('on') || isShown('modal') || isShown('ppick');
}
$('camReset')?.addEventListener('click', () => stage?.resetCamera());
$('camToggle')?.addEventListener('click', () => {
  const s = getStage();
  syncCamToggleUI(s.setCameraControl?.(!s.getCameraControl?.()));
});
function getStage() {
  if (!stage) stage = createStage($('stageHost'), $('overlay'), {
    onPickBot: (id) => current?.showRole(id),
    onPickMsg: (idx) => current?.seek(idx + 1, true),
    onCamControlChange: syncCamToggleUI,
    onScroll: (dy) => {
      if (!dy || isScrollBlockedByOverlay()) return;
      const pane = $('pane');
      if (pane && pane.scrollHeight > pane.clientHeight + 2) {
        const maxTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
        pane.scrollTop = Math.max(0, Math.min(maxTop, pane.scrollTop + dy));
        return;
      }
      const se = document.scrollingElement || document.documentElement;
      if (se) se.scrollTop = Math.max(0, se.scrollTop + dy);
    },
    reserved: () => {
      const host = $('stageWrap').getBoundingClientRect();
      const out = [];
      // HUD that floats over the canvas: bubbles must not cover it (elements outside the stage rect are ignored)
      for (const el of document.querySelectorAll('#timerCard:not(.hidden), #camReset, #camToggle, #camHint:not(.hidden), .votebar:not(.hidden), .drawer:not(.hidden), #subtitle:not(.hidden), .hud-top > *')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom <= host.top || r.top >= host.bottom || r.right <= host.left || r.left >= host.right) continue;
        out.push({ x: r.left - host.left, y: r.top - host.top, w: r.width, h: r.height });
      }
      return out;
    },
  });
  return stage;
}

// ---------------- debate rules (shared by live + snapshot; legacy rooms carry chars/q_chars/limit_chars)
const SPEECH_CPS = 5;   // 中文辩论语速 ≈ 300 字/分钟（与 roundtable/debate.py 一致）
const DEFAULT_DEBATE_PHASES = (() => {
  const P = [['1AC', 'constructive', '1AC 正方一辩立论', 480, 1], ['CX1', 'cx', 'CX 反方二辩质询正方一辩', 180, 4, 1], ['1NC', 'constructive', '1NC 反方一辩立论', 480, 3],
    ['CX2', 'cx', 'CX 正方一辩质询反方一辩', 180, 1, 3], ['2AC', 'constructive', '2AC 正方二辩立论', 480, 2], ['CX3', 'cx', 'CX 反方一辩质询正方二辩', 180, 3, 2],
    ['2NC', 'constructive', '2NC 反方二辩立论（negative block 第一篇）', 480, 4], ['CX4', 'cx', 'CX 正方二辩质询反方二辩', 180, 2, 4],
    ['1NR', 'rebuttal', '1NR 反方一辩反驳（negative block 第二篇）', 300, 3], ['1AR', 'rebuttal', '1AR 正方一辩反驳', 300, 1], ['2NR', 'rebuttal', '2NR 反方二辩反驳', 300, 4], ['2AR', 'rebuttal', '2AR 正方二辩反驳', 300, 2]];
  return P.map(([key, kind, label, secs, a, b]) => Object.assign({ key, kind, label, secs, budget_chars: secs * SPEECH_CPS }, kind === 'cx' ? { asker: a, answerer: b, max_pairs: 6 } : { speaker: a }));
})();
// stand-ins so the debate hall (podiums, judge bench, timer board) is drawn before the allocator has named anyone
const DEBATE_PLACEHOLDER_ROLES = [
  { id: 1, name: '正方一辩', side: 'aff', placeholder: true }, { id: 2, name: '正方二辩', side: 'aff', placeholder: true },
  { id: 3, name: '反方一辩', side: 'neg', placeholder: true }, { id: 4, name: '反方二辩', side: 'neg', placeholder: true },
  { id: 5, name: '主持·计时员', side: 'chair', placeholder: true }, { id: 6, name: 'Gemini 裁判', side: 'judge', placeholder: true }];
const durTxt = (s) => { s = Math.round(Number(s) || 0); return s % 60 ? `${Math.floor(s / 60)} 分 ${s % 60} 秒` : `${s / 60} 分钟`; };
const phaseBudget = (p) => p.budget_chars || (p.secs ? p.secs * SPEECH_CPS : 0);
function phaseRuleTxt(p) {   // e.g. "8 分钟 · 约 2400 字"
  if (p.chars || p.q_chars) return p.kind === 'cx' ? `${p.rounds} 问 · 问≤${p.q_chars} 答≤${p.a_chars} 字 · ${fmtClock(p.secs)}` : `≤${p.chars} 字 · ${fmtClock(p.secs)}`;   // legacy rooms
  return p.kind === 'cx' ? `${durTxt(p.secs)} · 问答共用约 ${phaseBudget(p)} 字 · 最多 ${p.max_pairs || 6} 组` : `${durTxt(p.secs)} · 约 ${phaseBudget(p)} 字`;
}
function msgRuleTxt(m) {     // one finished utterance: spoken length vs. its time
  if (m.limit_chars) return `${m.chars ?? 0}/${m.limit_chars} 字 · 用时 ${m.elapsed_s ?? '–'}s${m.limit_s ? ' / ' + m.limit_s + 's' : ''}${m.truncated ? ' · 超字截断' : ''}${m.overtime ? ' · 超时' : ''}`;   // legacy
  const spoken = m.spoken_s ?? (m.chars || 0) / SPEECH_CPS;
  const cx = m.type === 'cx_q' || m.type === 'cx_a';
  return `${m.chars ?? 0} 字 ≈ ${fmtClock(spoken)}${cx ? '（质询共 ' + fmtClock(m.limit_s) + '）' : ' / ' + fmtClock(m.limit_s)}${m.truncated ? ' · 超时，已截断' : ''}${m.forfeited ? ' · 生成超时作废' : ''}`;
}

function setStageMask(state, msg, canRetry) {
  const m = $('stageMask'), txt = $('stageMaskTxt'), retry = $('stageMaskRetry');
  if (!m) return;
  m.dataset.state = state || 'idle';
  if (txt && msg != null) txt.textContent = msg;
  if (retry) retry.classList.toggle('hidden', !canRetry);
  m.classList.toggle('hidden', state === 'ready' || state === 'idle');
}
$('stageMaskRetry')?.addEventListener('click', () => current?.retry?.());
$('roleStrip')?.addEventListener('click', (e) => { const b = e.target.closest('.rchip'); if (b?.dataset?.rid) current?.showRole?.(+b.dataset.rid); });
$('verdictStrip')?.addEventListener('click', (e) => { if (e.target.closest('.vs-more')) current?.setTab?.('verdict'); });

function resetSessionUI() {
  $('verdict').classList.remove('on');
  $('vbox').innerHTML = '';
  $('confetti').innerHTML = '';
  $('drawer').classList.add('hidden');
  $('drawer').innerHTML = '';
  $('votebar').classList.add('hidden');
  $('votebar').innerHTML = '';
  const rs = $('roleStrip');
  if (rs) { rs.classList.add('hidden'); rs.innerHTML = ''; rs._rk = undefined; }
  const vs = $('verdictStrip');
  if (vs) { vs.classList.add('hidden'); vs.innerHTML = ''; vs._vk = undefined; }
  const pb = $('phasebar');
  pb.innerHTML = ''; pb._k = undefined; pb.classList.add('hidden');
  $('timerCard').classList.add('hidden');
  $('tPh').textContent = ''; $('tClk').textContent = '--:--'; $('tClk').className = 'clk'; $('tSub').textContent = '';
  $('nMsgs').textContent = '0';
  $('pos').textContent = '0/0';
  $('scrub').max = '0'; $('scrub').value = '0';
  $('tabFmt').classList.add('hidden');
  $('tabVerdict').classList.add('hidden');
  $('liveBtn').classList.remove('on'); $('liveBtn').textContent = '最新';
  $('playBtn').textContent = '▶'; $('playBtn').setAttribute('aria-label', '从头回放');
  $('tlNew')?.classList.add('hidden');
  $('subtitle').classList.add('hidden'); $('subtitle').innerHTML = '';
  $('pane').innerHTML = '';
}

function openSession(sid) {
  const myEpoch = ++sessionEpoch;
  const sessionAC = new AbortController();
  const S = { sid, topic: null, roles: [], byId: new Map(), msgs: [], status: {}, verdict: null, export: null, finalExists: false,
    cursor: 0, follow: true, playing: false, tab: 'tl', closed: false, arrival: new Map(), verdictShownFor: -1, lastBundle: 0, openItems: new Set(), live: null, ws: null, netMode: Net.mode };
  const ctl = { sid, close, showRole, seek, setTab, retry: () => { if (isCurrent()) load(); }, get netMode() { return S.netMode; } };
  let pollAbort = null, playTimer = 0, uiTimer = 0, snapTimer = 0, retryTimer = 0, subAbort = null, finalSeq = 0;
  let loadGen = 0, loadAC = null, transportStarted = false;
  let subDom = null, subFollow = true, subSpeakerKey = null, subLastBody = null, subLastMeta = '';
  const timers = new Set();
  const isCurrent = () => !S.closed && myEpoch === sessionEpoch && !sessionAC.signal.aborted;
  const trackTimer = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); if (isCurrent()) fn(); }, ms);
    timers.add(id);
    return id;
  };
  const cancelTimer = (id) => { clearTimeout(id); timers.delete(id); };
  resetSessionUI();
  stage?.clear?.();
  setStageMask('loading', '正在加载舞台…', false);
  $('pane').innerHTML = '<div class="tl-ann"><span>加载中…</span></div>';
  $('sTitle').textContent = '加载中…'; $('kicker').textContent = '';
  stage?.update({ bubbles: [], votes: null, consensus: false, busy: false });

  const mode = () => S.topic?.mode || S.status.mode || (String(sid).startsWith('db-') ? 'debate' : 'roundtable');
  const roleName = (id) => S.byId.get(id)?.name || (id ? '角色 ' + id : '');
  const colorOf = (id) => stage?.botColor(id) || '#8a7d70';
  const nameToId = (name) => { if (!name) return null; const base = String(name).replace(/\(.*$|（.*$/, ''); for (const r of S.roles) if (r.name === base || r.name === name) return r.id; return null; };
  const running = () => isActive(S.status.state);

  function applyTopic(t) {
    if (!t) return;
    S.topic = t; S.roles = t.roles || []; S.byId = new Map(S.roles.map((r) => [r.id, r]));
    if (!t.mode) t.mode = mode();
    normalizeRules();
    setupStage();
    renderHeader();
  }
  // the scene follows the mode from the first frame: a debate room draws the debate hall even while roles are being allocated
  // GitHub Pages snapshots can be built by a long-running process that still has the old (char-limit) rules loaded;
  // the room's own status.format (written by the debate process) tells which rules this room really runs with.
  function normalizeRules() {
    const t = S.topic;
    if (!t || mode() !== 'debate') return;
    const legacy = (t.phases || []).some((p) => p.chars || p.q_chars);
    if (!(t.phases || []).length || (legacy && /NSDA/.test(S.status.format || ''))) {
      t.phases = DEFAULT_DEBATE_PHASES;
      if (S.status.format) t.format_name = S.status.format;
    }
  }
  function setupStage() {
    const m = mode();
    const raw = S.roles.length ? S.roles : (m === 'debate' ? DEBATE_PLACEHOLDER_ROLES : []);
    const roles = raw.map((r) => {
      const pInfo = r.persona_id ? Personas.byId.get(r.persona_id) : null;
      return pInfo?.look ? { ...r, look: pInfo.look } : r;
    });
    $('stageWrap').classList.toggle('debate', m === 'debate');
    if (roles.length) getStage().setup({ mode: m, roles, seed: sid });   // setup() is a no-op when mode/roles are unchanged
  }
  function applyBundle(b) {
    S.status = b.status || {};
    applyTopic(b.topic || { mode: S.status.mode || mode(), topic: S.status.topic, roles: [], allocating: true });
    S.verdict = b.verdict || null;
    S.export = b.export || null;
    S.finalExists = !!(b.final_exists || b.final_text);
    S.finalText = b.final_text;
    S.live = b.live || null;
    const before = S.msgs.length;
    S.msgs = b.messages || [];
    S.msgs.forEach((m, i) => { m.idx = i; });
    if (S.follow || S.cursor > S.msgs.length) S.cursor = S.msgs.length;
    if (!before && !running() && S.msgs.length) { S.follow = false; toast('本场已结束：可拖动时间轴或点 ▶ 从头回放', 4200); }
    if (!before && running() && S.msgs.length > 2) {   // 补播最近几条，再接上直播
      S.cursor = Math.max(0, S.msgs.length - 3); S.follow = false; S.playing = true; S.catchup = true;
      cancelTimer(playTimer);
      playTimer = trackTimer(play, 900);
    }
    renderAll();
  }
  function applyIncoming(j) {
    if (!isCurrent()) return;
    if (j.topic && (!S.topic || (j.topic.roles || []).length !== S.roles.length || S.topic.allocating)) applyTopic(j.topic);
    if (j.status) { S.status = j.status; normalizeRules(); if (!S.roles.length) setupStage(); }
    if (j.verdict) S.verdict = j.verdict;
    if (j.export) S.export = j.export;
    if (j.final_exists != null) S.finalExists = j.final_exists;
    if ('live' in j) { S.live = j.live; renderLive(); }
    let added = 0;
    for (const m of j.messages || []) {
      if (m.idx !== S.msgs.length) continue;      // dedupe / ordering guard
      S.msgs.push(m); S.arrival.set(m.idx, performance.now()); recordLatency(m); added++;
    }
    if (S.follow) S.cursor = S.msgs.length;
    if (added || j.status || j.verdict) renderAll();
    else if (j.export) {
      if (S.tab === 'verdict') renderVerdictPane();
      else if (S.tab === 'final') renderFinal();
    }
  }

  function startTransport() {
    if (!isCurrent() || transportStarted) return;
    transportStarted = true;
    if (Net.mode === 'live') pollLoop(); else snapLoop();
  }

  async function load() {
    if (!isCurrent()) return;
    cancelTimer(retryTimer); retryTimer = 0;
    loadAC?.abort();
    const ac = new AbortController();
    loadAC = ac;
    const gen = ++loadGen;
    const onSessAbort = () => ac.abort();
    sessionAC.signal.addEventListener('abort', onSessAbort, { once: true });
    const isLoadCurrent = () => isCurrent() && gen === loadGen && !ac.signal.aborted;

    setStageMask('loading', '正在加载舞台…', false);
    try {
      const b = await API.bundle(sid, { signal: ac.signal });
      if (!isLoadCurrent()) return;
      applyBundle(b); S.lastBundle = Date.now();
      const stagePresentOk = typeof stage?.present === 'function' ? stage.present() : true;
      const stageReadyOk = typeof stage?.isReady === 'function' ? stage.isReady() : true;
      const allocatingNoRoles = !S.roles.length && (!!S.topic?.allocating || S.status?.state === 'allocating' || mode() === 'roundtable');
      if (!allocatingNoRoles && (!stagePresentOk || !stageReadyOk)) {
        const err = new Error(stage?.getError?.() || '舞台角色构建失败');
        err.stageBuildFailed = true;
        throw err;
      }
      setStageMask('ready');
      startTransport();
    } catch (e) {
      if (!isLoadCurrent()) return;
      if (IS_DEBUG) console.error('session load failed', e);
      if (e.status === 404) {
        $('sTitle').textContent = '找不到这个场次';
        setStageMask('error', '找不到这个场次', false);
      } else if (e.stageBuildFailed) {
        $('sTitle').textContent = '舞台加载失败，请重试';
        setStageMask('error', '舞台角色构建失败，请重试', true);
      } else {
        $('sTitle').textContent = '加载失败，重试中…';
        setStageMask('error', '加载失败，请重试', true);
        retryTimer = trackTimer(load, 3000);
      }
    } finally {
      sessionAC.signal.removeEventListener('abort', onSessAbort);
      if (loadAC === ac) loadAC = null;
    }
  }
  function wsLoop() {
    return new Promise((resolve) => {
      if (!isCurrent() || !('WebSocket' in window) || (Net.wsFails || 0) >= 2) return resolve(false);
      const url = Net.base.replace(/^http/, 'ws') + `/api/s/${encodeURIComponent(sid)}/ws?since=${S.msgs.length}`;
      let opened = false, ws;
      try { ws = new WebSocket(url); } catch { Net.wsFails = (Net.wsFails || 0) + 1; return resolve(false); }
      S.ws = ws;
      const closeWs = () => { try { ws.close(); } catch {} };
      sessionAC.signal.addEventListener('abort', closeWs, { once: true });
      const t = trackTimer(() => { if (!opened) { Net.wsFails = (Net.wsFails || 0) + 1; closeWs(); resolve(false); } }, 6000);
      ws.onopen = () => { if (!isCurrent()) { closeWs(); return; } opened = true; cancelTimer(t); Net.transport = 'WebSocket'; Net.wsFails = 0; setConn('live', '实时·WS', '实时通道（WebSocket）：' + Net.base); };
      ws.onmessage = (e) => {
        if (!isCurrent()) { closeWs(); return; }
        let ev; try { ev = JSON.parse(e.data); } catch { return; }
        const d = ev.data;
        if (ev.type === 'msg') applyIncoming({ messages: [d] });
        else if (ev.type === 'status') applyIncoming({ status: d });
        else if (ev.type === 'live') { S.live = d; recordLiveLatency(d); renderLive(); }
        else if (ev.type === 'verdict') applyIncoming({ verdict: d });
        else if (ev.type === 'export') applyIncoming({ export: d });
        else if (ev.type === 'topic') applyIncoming({ topic: d });
        else if (ev.type === 'final') S.finalExists = !!d.exists;
      };
      ws.onclose = () => {
        cancelTimer(t);
        if (!isCurrent()) return resolve(true);
        if (!opened) return resolve(false);
        trackTimer(() => { if (isCurrent()) pollLoop(); }, 1000);
        resolve(true);
      };
      ws.onerror = () => {};
    });
  }
  async function pollLoop() {
    if (!isCurrent()) return;
    if (Net.mode === 'live' && await wsLoop()) return;
    Net.transport = '长轮询';
    while (isCurrent() && Net.mode === 'live') {
      pollAbort = new AbortController();
      const abortPoll = () => pollAbort?.abort();
      sessionAC.signal.addEventListener('abort', abortPoll, { once: true });
      try {
        const j = await fetchJSON(`${Net.base}/api/s/${encodeURIComponent(sid)}/poll?since=${S.msgs.length}&sv=${S.status.updated_ms || 0}&lv=${S.live?.seq ?? ''}`,
          { timeout: 28000, signal: pollAbort.signal });
        Net.fails = 0;
        if (!isCurrent()) return;
        applyIncoming(j);
        if (!running() && !j.messages?.length) await sleep(4000);
      } catch (e) {
        if (!isCurrent()) return;
        noteFailure(); await sleep(1500);
      }
    }
    if (isCurrent()) snapLoop();
  }
  async function snapLoop() {
    cancelTimer(snapTimer);
    if (!isCurrent()) return;
    if (Net.mode === 'live') { pollLoop(); return; }
    try { const b = await API.bundle(sid, { signal: sessionAC.signal }); if (isCurrent()) applyBundle(b); } catch {}
    if (isCurrent()) snapTimer = trackTimer(snapLoop, 30000);
  }

  // ---------------- live subtitle (partial_text typed as it streams)
  function liveSpeakers() {
    const lv = S.live;
    if (!lv || !running() || S.cursor < S.msgs.length) return [];
    if (lv.speakers) return Object.values(lv.speakers).filter((x) => !x.done);
    return !lv.done && lv.role_id != null ? [lv] : [];
  }
  function ensureSubtitleDom(el) {
    if (subDom && subDom.root === el && el.contains(subDom.tx)) return subDom;
    subAbort?.abort();
    subAbort = new AbortController();
    const sig = { signal: subAbort.signal };
    el.innerHTML = `<div class="sub-head"><b class="sub-name"></b><span class="sp"></span><span class="more hidden"></span><button type="button" class="sub-latest hidden" aria-label="回到最新字幕">回到最新 ↓</button></div><div class="tx" role="region" aria-live="polite" aria-label="实时发言字幕"><span class="sub-body"></span><i class="caret"></i></div>`;
    const head = el.querySelector('.sub-head');
    const name = el.querySelector('.sub-name');
    const sp = el.querySelector('.sp');
    const more = el.querySelector('.more');
    const latestBtn = el.querySelector('.sub-latest');
    const tx = el.querySelector('.tx');
    const body = el.querySelector('.sub-body');
    const bodyText = document.createTextNode('');
    body.appendChild(bodyText);
    const stop = (e) => e.stopPropagation();
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'wheel', 'mousedown', 'click']) {
      el.addEventListener(ev, stop, { ...sig, passive: true });
    }
    tx.addEventListener('scroll', () => {
      const dist = tx.scrollHeight - tx.scrollTop - tx.clientHeight;
      const atBottom = dist <= 24;
      if (atBottom !== subFollow) {
        subFollow = atBottom;
        latestBtn.classList.toggle('hidden', subFollow);
      }
    }, { ...sig, passive: true });
    latestBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      subFollow = true;
      latestBtn.classList.add('hidden');
      tx.scrollTop = tx.scrollHeight;
    }, sig);
    subDom = { root: el, head, name, sp, more, latestBtn, tx, body, bodyText };
    return subDom;
  }
  function extractLiveBody(focus) {
    let txt = focus.partial_text || '';
    const cut = txt.indexOf('【发言】');
    const pre = cut >= 0 ? '' : (txt.includes('【评估】') || txt.includes('【自省】') ? '（思考中）' : '');
    if (cut >= 0) txt = txt.slice(cut + 4);
    else if (pre) txt = txt.slice(Math.max(txt.lastIndexOf('【评估】'), txt.lastIndexOf('【自省】')) + 4);
    txt = txt.replace(/^(SHORT|TYPE|REPLY_TO|VOTE|POSITION|CONCLUSION)\s*[:：].*$/gim, '').trim();
    return focus.thinking && !txt ? '思考中…' : (pre + txt);
  }
  function renderLive() {
    const el = $('subtitle');
    const sp = liveSpeakers();
    const lv = S.live;
    const focus = sp.find((x) => String(x.role_id) === String(lv?.role_id)) || sp[0];
    if (!focus) {
      el.classList.add('hidden');
      subSpeakerKey = null; subLastBody = null; subLastMeta = ''; subFollow = true;
      return;
    }
    const dom = ensureSubtitleDom(el);
    const rid = Number(focus.role_id);
    const name = S.byId.get(rid)?.name || focus.role || '';
    const speech = focus.speech || '';
    const moreTxt = sp.length > 1 ? `+${sp.length - 1} 人同时发言` : '';
    const color = colorOf(rid);
    const metaKey = `${rid}|${name}|${color}|${speech}|${moreTxt}`;
    const speakerKey = `${focus.role_id}|${speech}|${focus.started_ms || ''}`;
    const wasHidden = el.classList.contains('hidden');
    const bodyTxt = extractLiveBody(focus);
    const speakerChanged = wasHidden || speakerKey !== subSpeakerKey || (subLastBody != null && bodyTxt.length < subLastBody.length);

    if (speakerChanged) {
      subSpeakerKey = speakerKey;
      subFollow = true;
      dom.latestBtn.classList.add('hidden');
    } else if (subFollow && !wasHidden) {
      const distBefore = dom.tx.scrollHeight - dom.tx.scrollTop - dom.tx.clientHeight;
      if (dom.tx.scrollHeight > dom.tx.clientHeight + 24 && distBefore > 24) {
        subFollow = false;
        dom.latestBtn.classList.remove('hidden');
      }
    }

    if (metaKey !== subLastMeta) {
      subLastMeta = metaKey;
      dom.name.textContent = name;
      dom.name.style.color = color;
      dom.sp.textContent = speech;
      dom.sp.classList.toggle('hidden', !speech);
      dom.more.textContent = moreTxt;
      dom.more.classList.toggle('hidden', !moreTxt);
    }

    const bodyChanged = bodyTxt !== subLastBody;
    if (bodyChanged) {
      if (!speakerChanged && subLastBody && bodyTxt.startsWith(subLastBody)) {
        dom.bodyText.appendData(bodyTxt.slice(subLastBody.length));
      } else {
        dom.bodyText.nodeValue = bodyTxt;
      }
      subLastBody = bodyTxt;
    }
    if (wasHidden) el.classList.remove('hidden');
    if (subFollow && (bodyChanged || speakerChanged || wasHidden)) {
      dom.tx.scrollTop = dom.tx.scrollHeight;
    }
  }
  if (IS_DEBUG) {
    ctl.debugSetLive = (lv, opts = {}) => {
      if (opts.running !== false) S.status = { ...S.status, state: 'running' };
      if (opts.atTail !== false) { S.cursor = S.msgs.length; S.follow = true; }
      S.live = lv;
      renderLive();
      return {
        el: $('subtitle'),
        tx: $('subtitle')?.querySelector('.tx') || null,
        btn: $('subtitle')?.querySelector('.sub-latest') || null,
      };
    };
    ctl.debugClearLive = () => { S.live = null; renderLive(); };
  }
  function recordLiveLatency(lv) {
    if (lv && lv.ts_ms) { const l = Date.now() - lv.ts_ms; if (l >= 0 && l < 60000) (Net.liveLat = Net.liveLat || []).push(l); }
  }

  // ---------------- frame for the 3D stage
  function lastProposalVotes(shown) {
    let p = -1;
    for (let i = shown.length - 1; i >= 0; i--) if (shown[i].type === 'proposal') { p = i; break; }
    if (p < 0) return null;
    const votes = new Map(); let a = 0, d = 0, over = false;
    for (let i = p + 1; i < shown.length; i++) {
      const m = shown[i];
      if (m.type === 'vote' && Number(m.round) === Number(shown[p].round)) { votes.set(m.role_id, m.vote === 'disagree' ? 'disagree' : 'agree'); m.vote === 'disagree' ? d++ : a++; }
      else over = true;
    }
    if (over) return null;
    return { votes, a, d, conclusion: shown[p].conclusion || shown[p].short, n: S.roles.length };
  }
  function bubbleHtml(m, main) {
    const [lab, col] = typeMeta(m.type, mode());
    const to = m.reply_to && S.byId.get(Number(m.reply_to)) ? `<span class="who">→ ${esc(roleName(Number(m.reply_to)))}</span>` : '';
    const vote = m.type === 'vote' ? (m.vote === 'disagree' ? '✗ ' : '✓ ') : '';
    const txt = (m.short && !main) ? m.short : (main ? (m.short ? m.short + ' — ' : '') + plain(m.text, 70) : plain(m.text, 40));
    return `<span class="tp" style="--tc:${col}">${esc(lab)}</span>${to}<span class="bx">${esc(vote + txt)}</span>`;
  }
  function phaseDef(key) { return (S.topic?.phases?.length ? S.topic.phases : mode() === 'debate' ? DEFAULT_DEBATE_PHASES : []).find((p) => p.key === key); }
  function computeFrame() {
    const shown = S.msgs.slice(0, S.cursor);
    const m = shown[shown.length - 1];
    const atTail = S.cursor >= S.msgs.length;
    const liveNow = atTail && running();
    const f = { bubbles: [], votes: null, consensus: false, busy: false };
    // bubbles: latest message per bot (exclude verdict/announce; max 1 mobile / 2 desktop)
    const seen = new Set();
    for (let i = shown.length - 1; i >= 0 && f.bubbles.length < (IS_MOBILE ? 1 : 2); i--) {
      const x = shown[i];
      if (x.type === 'verdict' || x.type === 'announce') continue;
      if (seen.has(x.role_id)) continue;
      if (S.arrival.has(i) && liveNow && performance.now() - S.arrival.get(i) > 90000) continue;
      seen.add(x.role_id);
      f.bubbles.push({ id: x.role_id, key: sid + ':' + i + (f.bubbles.length === 0 ? 'm' : ''), idx: i, type: x.type, html: bubbleHtml(x, f.bubbles.length === 0), main: f.bubbles.length === 0 });
    }
    if (mode() === 'debate') {
      const st = S.status;
      const curKey = liveNow ? st.phase_key : m?.phase;
      const ph = phaseDef(curKey);
      f.phases = S.topic?.phases?.length ? S.topic.phases : DEFAULT_DEBATE_PHASES;
      f.phaseIdx = liveNow ? (st.phase_idx ?? 0) : Math.max(0, f.phases.findIndex((p) => p.key === curKey));
      if (!liveNow && S.cursor >= S.msgs.length && S.verdict) f.phaseIdx = f.phases.length;
      if (liveNow && st.state !== 'judging') {
        f.speakerId = st.speaking_id || null; f.addressId = st.addressing || null;
        f.thinkingId = st.speaking_id || null;
        if (st.cx_pair && ph?.kind === 'cx') f.cxPair = st.cx_pair;
      } else if (m && (m.side === 'aff' || m.side === 'neg')) {
        f.speakerId = m.role_id; f.addressId = m.reply_to || null;
      }
      if (!f.cxPair && ph?.kind === 'cx' && f.speakerId) f.cxPair = [ph.asker, ph.answerer];
      if (f.speakerId) f.spotlight = f.speakerId;
      if (liveNow && st.state === 'judging') { f.thinkingId = 6; f.spotlight = 6; }
      if (ph && f.speakerId) {
        f.atLectern = ph.kind !== 'cx' || f.speakerId === ph.answerer;
        f.speakKind = ph.kind === 'cx' && f.speakerId === ph.answerer ? 'answer' : ph.kind === 'rebuttal' ? 'rebut' : 'speak';
      }
      // timer
      const t = { label: ph?.label || (st.state === 'judging' ? '裁判评议中' : S.verdict ? '已宣判' : '赛前'), clock: '--:--', sub: '' };
      if (liveNow && st.state === 'judging' && st.judge_wait_until_ms && st.judge_status === 'waiting_herald') {
        t.label = '等待 Gemini 传令官'; t.clock = fmtClock(Math.max(0, (st.judge_wait_until_ms - Date.now()) / 1000));
        t.sub = '超时由 Claude Code CLI 兜底裁判';
      } else if (liveNow && st.judge_status === 'fallback_claude') { t.label = '兜底裁判评议中'; t.clock = '⚖'; t.sub = 'Claude Code CLI'; }
      else if (liveNow && st.phase_deadline_ms) {
        const remain = (st.phase_deadline_ms - Date.now()) / 1000;
        t.remain = remain; t.clock = fmtClock(Math.max(remain, -599)); t.over = remain < 0;
        if (st.paused) { t.remain = null; t.over = false; t.clock = '⏸ ' + fmtClock(Math.max(remain, 0)); }
        const legacy = ph && (ph.chars || ph.q_chars);
        if (ph && !legacy) {   // new rooms: the clock is the model's generation slot; the rule is the speaking time
          t.label = ph.label; t.sub = st.paused ? '计时暂停：上游限流' : `发言时长 ${durTxt(ph.secs)}（约 ${phaseBudget(ph)} 字）` +
            (ph.kind === 'cx' && st.cx_used_chars != null ? ` · 已用约 ${st.cx_used_chars} 字` : '') + ' · 生成倒计时';
        } else t.sub = st.paused ? '计时暂停：上游限流' : ph ? (ph.kind === 'cx' ? `问≤${ph.q_chars} 字 · 答≤${ph.a_chars} 字 · 共 ${ph.rounds} 问` : `限 ${ph.chars} 字 · 时限 ${fmtClock(ph.secs)}`) : '';
      } else if (m && (m.limit_chars || m.budget_chars)) {
        if (m.limit_chars) { t.clock = fmtClock(m.elapsed_s); t.sub = `用时 ${fmtClock(m.elapsed_s)} / ${fmtClock(m.limit_s || ph?.secs)} · ${m.chars ?? 0}/${m.limit_chars} 字${m.truncated ? ' · 超字截断' : ''}`; }
        else { t.clock = fmtClock(m.spoken_s ?? (m.chars || 0) / SPEECH_CPS); t.sub = msgRuleTxt(m); }
        t.over = !!(m.overtime || m.truncated);
      } else if (S.verdict && S.cursor >= S.msgs.length) {
        t.clock = S.verdict.winner === 'aff' ? '正方胜' : '反方胜';
        t.sub = `${S.verdict.scores.aff.total} : ${S.verdict.scores.neg.total}`;
      }
      f.timer = t;
      const vIdx = S.msgs.findIndex((x) => x.type === 'verdict');
      f.verdict = S.verdict; f.showVerdict = !!S.verdict && vIdx >= 0 && S.cursor > vIdx;
    } else {
      const st = S.status;
      if (liveNow) {
        f.thinkingId = nameToId(st.speaking);
        const sp = liveSpeakers();
        if (sp.length) {
          const fid = Number(S.live.role_id) || Number(sp[0].role_id);
          f.speakerId = fid; f.typingIds = sp.map((x) => Number(x.role_id));
          const o = sp.find((x) => Number(x.role_id) !== fid);
          f.thinkingId = o ? Number(o.role_id) : null;
        }
        const recent = m && S.arrival.has(m.idx) ? performance.now() - S.arrival.get(m.idx) < 15000 : false;
        if (!f.speakerId && m && recent && m.type !== 'vote') { f.speakerId = m.role_id; f.addressId = m.reply_to ? Number(m.reply_to) : null; }
        else if (f.thinkingId && st.addressing) f.addressId = Number(st.addressing);
      } else if (m) {
        if (m.type !== 'vote') { f.speakerId = m.role_id; f.addressId = m.reply_to ? Number(m.reply_to) : null; }
        else f.addressId = m.reply_to ? Number(m.reply_to) : null;
      }
      f.speakKind = m && f.speakerId === m.role_id ? ({ rebuttal: 'rebut', retract: 'retract' }[m.type] || 'speak') : 'speak';
      if (f.speakerId) f.spotlight = f.speakerId;
      const v = lastProposalVotes(shown);
      if (v) { f.votes = v.votes; f.voteInfo = v; }
      f.consensus = atTail && !!st.consensus;
      f.busy = !!(f.speakerId || f.thinkingId);
      const rnd = m?.round || st.round || 1;
      f.boardTitle = f.consensus ? '达成共识' : `第 ${rnd} 轮`;
      f.boardSub = f.votes ? `表决 ${v.a}✓ ${v.d}✗` : (STATE_LABEL[st.state] || '圆桌讨论');
    }
    return f;
  }

  // ---------------- rendering
  function renderHeader() {
    const t = S.topic || {}; const st = S.status;
    $('sTitle').textContent = t.topic || st.topic || sid;
    const deb = (t.mode || st.mode) === 'debate';
    let state = STATE_LABEL[st.state] || st.state || '';
    if (st.state === 'judged' && S.verdict) state = `已宣判 · ${S.verdict.winner === 'aff' ? '正方' : '反方'}胜`;
    const extra = deb ? (t.format_name || 'Policy 辩论（简化版）') : (t.max_rounds ? `最多 ${t.max_rounds} 轮` : '');
    $('kicker').innerHTML = `<span class="badge ${deb ? 'db' : 'rt'}">${deb ? '美式辩论' : '圆桌讨论'}</span><span class="state ${esc(st.state || '')}">${esc(state)}</span><span>${esc(extra)}</span><span>${S.roles.filter((r) => !['judge', 'chair'].includes(r.side)).length || '—'} bot · ${st.calls ?? 0} 次调用</span>`;
    $('tabFmt').classList.toggle('hidden', !deb);
    $('tabVerdict').classList.toggle('hidden', !deb);
    $('timerCard').classList.toggle('hidden', !deb);
  }
  function renderControls() {
    const n = S.msgs.length;
    $('scrub').max = String(n); $('scrub').value = String(S.cursor);
    $('pos').textContent = `${S.cursor}/${n}`;
    $('liveBtn').classList.toggle('on', S.follow);
    $('liveBtn').textContent = running() ? '直播' : '最新';
    $('playBtn').textContent = S.playing ? '❚❚' : '▶';
    $('playBtn').setAttribute('aria-label', S.playing ? '暂停回放' : '从头回放');
    $('nMsgs').textContent = String(n);
  }
  // timeline: built once, then *appended* — status / "thinking" lines live in their own nodes, so a status tick (calls,
  // speaking, state) no longer rebuilds the whole list (that used to reset scroll and collapse open 思考过程).
  let tlCount = -1, tlSid = null, tlLen = 0;
  function tlItemHtml(m, i) {
    const deb = mode() === 'debate';
    if (m.type === 'announce') return `<div class="tl-ann" data-i="${i}"><span>${esc(m.text)}</span></div>`;
    const [lab, col] = typeMeta(m.type, mode());
    const r = S.byId.get(m.role_id);
    const to = m.reply_to && S.byId.get(Number(m.reply_to)) ? ` → ${esc(roleName(Number(m.reply_to)))}` : '';
    const ph = deb && m.phase ? `<span class="tp" style="--tc:#5a6380">${esc(m.phase)}</span>` : (m.round ? `<span style="color:var(--muted)">第${m.round}轮</span>` : '');
    const vote = m.type === 'vote' ? `<b style="color:${m.vote === 'disagree' ? 'var(--neg)' : 'var(--good)'}">${m.vote === 'disagree' ? '✗ 反对' : '✓ 赞成'}</b>` : '';
    const lim = (m.limit_chars || m.budget_chars) ? `<div class="lim ${m.truncated || m.overtime ? 'bad' : ''}">${msgRuleTxt(m)}</div>` : '';
    const short = m.type === 'vote' ? (m.position || m.short) : m.type === 'proposal' ? '表决：' + (m.conclusion || m.short) : m.short;
    const av = (r?.persona_id && Personas.byId.get(r.persona_id)?.avatar) || r?.avatar;
    return `<div class="tl-item${S.openItems.has(i) ? ' open' : ''}" data-i="${i}" style="--c:${colorOf(m.role_id)}">
          <div class="av">${av ? `<img class="avimg" src="${esc(assetUrl(av))}" alt="">` : esc((r?.name || m.role || '?').replace(/^(正方|反方)/, '').replace(/^[一二]辩·?/, '').slice(0, 1))}</div>
          <div><div class="hd"><b>${esc(r?.name || m.role || '')}</b><span class="tp" style="--tc:${col}">${esc(lab)}</span>${ph}${vote}<span style="color:var(--muted)">${to}</span><span class="t">${esc((m.ts || '').slice(11, 19))}</span></div>
          <div class="sm">${esc(short || plain(m.text, 60))}</div>${lim}
          ${(m.assess || m.self_review) ? `<details class="think-proc"><summary>思考过程</summary>${m.assess ? `<div class="tp-h">评估别人的论据</div><div class="md">${md(m.assess)}</div>` : ''}${m.self_review ? `<div class="tp-h">对照自己上一轮</div><div class="md">${md(m.self_review)}</div>` : ''}</details>` : ''}
          <div class="tx md">${md(m.text)}</div></div></div>`;
  }
  const paneAtBottom = (pane) => pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80;
  function showTlNew(on) { const b = $('tlNew'); if (b) b.classList.toggle('hidden', !on); }
  function renderTimeline() {
    const pane = $('pane');
    if (S.tab !== 'tl') return;
    const st = S.status;
    const atBottom = paneAtBottom(pane);
    const listKey = [Personas.version, S.roles.length, stage ? 1 : 0].join('|');
    let list = pane.querySelector('.tl-list');
    let grew = false;
    if (tlCount !== listKey || tlSid !== sid || !list || S.msgs.length < tlLen) {
      tlCount = listKey; tlSid = sid;
      pane.innerHTML = `<div class="tl-status"></div><div class="tl-list"></div><div class="tl-tail"></div>`;
      list = pane.querySelector('.tl-list');
      list.innerHTML = S.msgs.length ? S.msgs.map(tlItemHtml).join('') : '<div class="tl-ann tl-empty"><span>还没有发言</span></div>';
      tlLen = S.msgs.length;
      if (S.follow) pane.scrollTop = pane.scrollHeight;
    } else if (S.msgs.length > tlLen) {
      list.querySelector('.tl-empty')?.remove();
      list.insertAdjacentHTML('beforeend', S.msgs.slice(tlLen).map((m, k) => tlItemHtml(m, tlLen + k)).join(''));
      tlLen = S.msgs.length; grew = true;
    }
    // status line + paused/thinking tail: own nodes, diff-guarded
    setHTML(pane.querySelector('.tl-status'), `<div class="statusline"><span>状态 <b>${esc(STATE_LABEL[st.state] || st.state || '—')}</b></span><span>调用 <b>${st.calls ?? 0}</b></span><span>429 <b>${st.r429 ?? 0}</b></span>${S.topic?.allocator?.rationale ? `<span title="分配官的理由">分配官：${esc(S.topic.allocator.rationale)}</span>` : ''}</div>`);
    const paused = st.paused ? `<div class="tl-ann"><span style="background:#fff1d6;color:#7a5200">⏸ ${esc(st.paused)}</span></div>` : '';
    const thinking = running() && st.speaking ? `<div class="tl-ann"><span>💭 ${esc(st.speaking)} 正在${st.state === 'allocating' ? '分配角色' : st.state === 'judging' ? '评议' : '组织发言'}…</span></div>` : '';
    setHTML(pane.querySelector('.tl-tail'), paused + thinking);
    if (grew) {
      if (S.follow && atBottom) pane.scrollTop = pane.scrollHeight;
      else if (!atBottom) showTlNew(true);
    }
    for (const el of pane.querySelectorAll('[data-i]')) {
      const i = +el.dataset.i;
      el.classList.toggle('cur', i === S.cursor - 1);
      el.classList.toggle('future', i >= S.cursor);
    }
    if (!S.follow && S.playing) {   // keep the replayed item in view without scrollIntoView (that also scrolls ancestors on mobile)
      const cur = pane.querySelector('.tl-item.cur, .tl-ann.cur');
      if (cur) {
        const pr = pane.getBoundingClientRect(), cr = cur.getBoundingClientRect();
        if (cr.top < pr.top || cr.bottom > pr.bottom) pane.scrollTo({ top: pane.scrollTop + (cr.top - pr.top) - pane.clientHeight / 3, behavior: 'smooth' });
      }
    }
  }
  $('pane').onscroll = () => { if (S.tab === 'tl' && paneAtBottom($('pane'))) showTlNew(false); };
  if ($('tlNew')) $('tlNew').onclick = () => { const pane = $('pane'); pane.scrollTop = pane.scrollHeight; showTlNew(false); };
  function srcLinks(list) {
    return (list || []).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.repo)}</a>${x.stars ? `<span class="star">★ ${Number(x.stars).toLocaleString()}</span>` : ''}`).join(' · ');
  }
  function kitHtml(r) {
    if (!r.kit) return `<div class="kit"><div class="desc">${r.side === 'judge' ? '裁判：主路径 Gemini 传令官（webhook → verdict.json），180 秒未到由 Claude Code CLI 兜底；Gemini 晚到则以 Gemini 为准。' : r.side === 'chair' ? '主持·计时：脚本角色，不调用模型。' : '旧场次角色（升级前创建），未配置 skill。'}</div></div>`;
    const skills = (r.skills || []).map((k) => `<div class="sk"><code>${esc(k.name)}</code> <span class="lic">${esc(k.license || '')}</span> <span class="desc">${esc(plain(k.description, 110))}</span>
      <div class="src">${k.sources?.length ? '出处 ' + srcLinks(k.sources) : '本库原创'}</div></div>`).join('');
    const a = r.agents_md;
    return `<div class="kit"><div class="k">🧰 ${esc(r.kit_label || r.kit)} <span style="font-weight:500;color:var(--muted)">· ${esc(r.kit_use_for || '')}</span></div>
      <div class="tp-h">Skills（pi --append-system-prompt 注入）</div>${skills}
      ${a ? `<div class="tp-h">AGENTS.md 上游</div><div class="sk"><code>${esc(a.name)}</code> <span class="lic">${esc(a.license || '')}</span><div class="src">出处 ${srcLinks([a])}</div></div>` : ''}</div>`;
  }
  function roleCard(r, withHist) {
    const side = { aff: '正方', neg: '反方', judge: 'Gemini 裁判', chair: '主持' }[r.side] || '';
    const mine = withHist ? S.msgs.filter((m) => m.role_id === r.id && m.type !== 'announce') : [];
    const pInfo = r.persona_id ? Personas.byId.get(r.persona_id) : null;
    const av = pInfo?.avatar || r.avatar;
    const cred = r.avatar_credit || pInfo?.avatar_credit;
    const credDesc = cred?.type === 'photo'
      ? `头像来源：<a href="${esc(cred.file_page || cred.source_url)}" target="_blank" rel="noopener">${esc(cred.author || 'Unknown')}</a> · ${esc(cred.license || '')}（Wikimedia Commons）`
      : '头像为本项目原创 SVG 卡通形象（MIT）。';
    return `<div class="role" data-r="${r.id}" style="--c:${colorOf(r.id)}"><div class="rh"><span class="av${av ? ' img' : ''}" ${av ? `style="background-image:url('${esc(assetUrl(av))}')"${cred?.attribution_text ? ` title="${esc(cred.attribution_text)}"` : ''}` : ''}></span><b>${esc(r.name)}</b>${side ? `<span class="sd ${r.side}">${side}</span>` : ''}${r.persona_id ? '<span class="persona-badge">人格辩手 · 风格模仿</span>' : ''}</div>
      ${r.persona_source ? `<div class="kit" style="margin-top:6px"><div class="k">🎭 ${esc(r.persona_name)}（${esc(r.persona_en || '')}）· 风格模仿</div><div class="desc">${esc(r.persona_blurb || '')}</div><div class="src">人格 skill 出处 <a href="${esc(r.persona_source.url)}" target="_blank" rel="noopener">${esc(r.persona_source.repo)}</a>${r.persona_source.stars ? `<span class="star">★ ${Number(r.persona_source.stars).toLocaleString()}</span>` : ''} · ${esc(r.persona_source.license)}</div><div class="desc">不代表本人观点，不作事实断言；${credDesc}</div></div>` : ''}
      <div class="ps">${esc(r.persona || '')}</div>${kitHtml(r)}
      ${r.dir ? `<div style="font-size:11.5px;color:var(--muted);margin-top:6px">独立工作目录 <code>${esc(r.dir)}</code>：AGENTS.md、skills/、session.jsonl（持久记忆）</div>` : ''}
      ${withHist ? `<details class="hist" ${mine.length ? 'open' : ''}><summary>发言历史（${mine.length}）</summary>${mine.map((m) => `<div class="tl-item" data-seek="${m.idx}" style="--c:${colorOf(r.id)};grid-template-columns:1fr"><div><div class="hd"><span class="tp" style="--tc:${typeMeta(m.type, mode())[1]}">${esc(typeMeta(m.type, mode())[0])}</span>${m.phase ? esc(m.phase) : ''}</div><div class="sm">${esc(m.short || plain(m.text, 60))}</div>${m.self_review ? `<div class="desc" style="font-size:12px;color:var(--muted)">自省：${esc(plain(m.self_review, 80))}</div>` : ''}</div></div>`).join('')}</details>` : ''}</div>`;
  }
  function renderRoles() {
    if (!S.roles.length) { $('pane').innerHTML = '<div class="tl-ann"><span>分配官正在安排角色…</span></div>'; return; }
    const t = S.topic;
    $('pane').innerHTML = (t.allocator ? `<div class="statusline">分配官：${esc(t.allocator.rationale || '—')}${t.allocator.fallback ? '（模型输出不可解析，已用默认阵容）' : ''}</div>` : '') +
      S.roles.map((r) => roleCard(r, false)).join('') +
      (t.legacy ? '<div class="tl-ann"><span>旧场次（升级前创建），角色未配置 skill</span></div>' : '');
  }
  function renderFormat() {
    const t = S.topic || {}; const ph = t.phases?.length ? t.phases : DEFAULT_DEBATE_PHASES; const st = S.status;
    const legacy = ph.some((p) => p.chars || p.q_chars);
    let cur = S.cursor >= S.msgs.length && running() ? st.phase_idx : ph.findIndex((p) => p.key === S.msgs[S.cursor - 1]?.phase);
    if (S.msgs[S.cursor - 1]?.phase === 'JUDGE' || (S.verdict && S.cursor >= S.msgs.length)) cur = ph.length;
    $('pane').innerHTML = `<div class="fmt"><h3>${esc(t.format_name || 'Policy 辩论（简化版）')}</h3>
      <p>美式 <b>Policy / CX</b> 赛制（按 NSDA 高中政策性辩论的标准时长）：正反各 2 人，4 篇建设性发言（1AC/1NC/2AC/2NC，各 8 分钟），每篇之后 3 分钟<b>质询</b>（由下一篇不发言的对方辩手提问、刚发言者作答），然后 4 篇反驳（1NR/1AR/2NR/2AR，各 5 分钟），<b>正方最后发言</b>。2NC 与 1NR 连着是反方的 <i>negative block</i>，属标准流程。准备时间（prep time）不模拟。每位辩手有自己的持久记忆（独立 pi 会话），质询时记得自己的立论。</p>
      <ol class="phase-list">${ph.map((p, i) => `<li class="${i < cur ? 'done' : i === cur ? 'cur' : ''}"><span>${esc(p.label)}</span><span class="lm">${esc(phaseRuleTxt(p))}</span></li>`).join('')}
        <li class="${S.verdict && cur >= ph.length ? 'done' : st.state === 'judging' ? 'cur' : ''}"><span>裁判评议与宣判</span><span class="lm">${esc(S.verdict ? ((S.verdict.judge || {}).label || '') : 'Gemini 传令官 / 兜底')}</span></li></ol>
      ${legacy ? `<h3>严格计时 / 限字（本场为旧规则）</h3>
      <p>本场创建于规则更新前：每个环节有字数上限和发言时限，超出字数的部分截断并标注「超字截断」；模型在时限内没交出发言，该发言<b>作废</b>。</p>` : `<h3>按时长计时</h3>
      <p>每个环节只规定<b>发言时长</b>，按中文辩论语速约 <b>${SPEECH_CPS * 60} 字/分钟</b>折算：立论 8 分钟≈2400 字，反驳 5 分钟≈1500 字，质询 3 分钟≈900 字。辩手被要求用满时间；只有超过时长 10% 的部分才算<b>超时</b>，截断并标注「超时，已截断」。质询的问答共用 3 分钟，一问一答交替，提问方掌控节奏，可提前结束，最多 6 组。计时牌倒数的是模型的<b>生成时限</b>，超过仍未交出的发言<b>作废</b>。违规会进入裁判「规则」分项扣分。等待上游模型（限流/出错重试）的时间<b>不计入</b>，计时牌显示 ⏸。</p>`}
      <h3>裁判</h3>
      <p>主路径是 <b>Gemini 传令官</b>：赛后写出 <code>judge_request.json</code> 并通过 webhook 发出，等待 <code>verdict.json</code> / <code>verdict_herald.json</code>；超过 180 秒未收到，则由本机 <b>Claude Code CLI</b>（<code>claude -p</code>，同一量表）<b>兜底裁判</b>（写 <code>verdict_fallback.json</code>），界面会标明。Gemini 裁决晚到时自动改为以它为准，兜底保留为第二意见。量表五项各 10 分：论证、证据、交锋、质询、规则；另给辩手分（26–30）。按 flow 判，未回应的论点视为成立。</p></div>`;
  }
  function scoresHtml(v) {
    const rows = [['argument', '论证'], ['evidence', '证据'], ['clash', '交锋'], ['cross_ex', '质询'], ['rules', '规则']];
    return `<div class="scores"><span></span><b style="color:var(--aff)">正方 ${v.scores.aff.total}</b><b style="color:var(--neg)">反方 ${v.scores.neg.total}</b>` +
      rows.map(([k, l]) => `<span>${l}</span><div class="bar aff"><i data-w="${v.scores.aff[k] * 10}"></i></div><div class="bar neg"><i data-w="${v.scores.neg[k] * 10}"></i></div>`).join('') + '</div>';
  }
  function growBars(root) { requestAnimationFrame(() => { if (!isCurrent()) return; trackTimer(() => { if (isCurrent()) root.querySelectorAll('.bar i').forEach((i) => { i.style.width = i.dataset.w + '%'; }); }, 60); }); }
  function exportBoxHtml() {
    if (mode() !== 'debate' || S.topic?.legacy || sid === 'pnp-20261112') return '';
    if (!S.verdict && !S.export) return '';
    const ex = S.export;
    if (Net.mode !== 'live' || !Net.base) {
      return '<div class="export-box"><div class="ex-title">赛后报告导出</div><div class="ex-note">快照模式无法直接下载动态报告，请连接实时服务端后下载 HTML / PDF。</div></div>';
    }
    if (ex?.ready) {
      const base = Net.base.replace(/\/$/, '') + '/api/s/' + encodeURIComponent(sid);
      return `<div class="export-box ready"><div class="ex-title">赛后裁判报告已就绪</div><div class="ex-actions"><a class="btn small" href="${esc(base + '/export.pdf')}" download>下载 PDF 报告</a><a class="btn small ghost" href="${esc(base + '/export.html')}" download>下载 HTML 报告</a></div></div>`;
    }
    const st = ex?.state || 'pending';
    let msg = '赛后报告正在生成中…';
    if (st === 'missing_report') msg = '该场旧裁决缺少结构化 report，需管理员运行 CLI 补产后方可下载。';
    else if (st === 'missing_data' || st === 'failed') msg = `赛后报告暂不可用：${esc(ex?.error || '数据校验未通过')}`;
    else if (st === 'stale') msg = '裁决已更新，正在重建最新 HTML / PDF 报告…';
    else if (st === 'not_applicable') return '';
    return `<div class="export-box"><div class="ex-title">赛后报告导出</div><div class="ex-note">${msg}</div></div>`;
  }
  function renderVerdictPane() {
    const v = S.verdict;
    if (!v) { $('pane').innerHTML = `<div class="tl-ann"><span>${S.status.state === 'judging' ? (S.status.judge_status === 'fallback_claude' ? '⚖️ 兜底裁判（Claude Code CLI）评议中…' : '⚖️ 已发出 judge_request，等待 Gemini 传令官…') : '比赛结束后由裁判宣判'}</span></div>`; return; }
    const w = v.winner === 'aff' ? '正方' : '反方';
    $('pane').innerHTML = `<div class="vcard ${v.winner}"><div class="vk">裁判判决</div><div class="w ${v.winner}">${w}胜</div>${scoresHtml(v)}</div>
      ${exportBoxHtml()}
      <h3 style="font-size:15px;margin:6px 0">判决理由（RFD）</h3><div class="rfd">${esc(v.rfd)}</div>
      ${v.key_clashes?.length ? `<h3 style="font-size:15px;margin:12px 0 6px">关键交锋</h3><ol class="pts">${v.key_clashes.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>` : ''}
      <h3 style="font-size:15px;margin:12px 0 6px">辩手分</h3><div class="pts">${(v.speaker_points || []).map((p) => `<div><b>${esc(p.name)}</b> ${p.points} <span style="color:var(--muted)">${esc(p.note || '')}</span></div>`).join('')}</div>
      <p style="font-size:12px;color:var(--muted);margin-top:12px">裁判：${(v.judge || {}).fallback ? '<b style="color:#b45309">兜底裁判</b>' : 'Gemini 传令官'} · ${esc((v.judge || {}).backend || v.backend || '')}（${esc((v.judge || {}).model || v.model || '')}）· ${esc(v.decided_at || '')}${v.elapsed_s ? ' · 用时 ' + v.elapsed_s + 's' : ''}</p>${v.second_opinion ? `<p style="font-size:12px;color:var(--muted)">第二意见：兜底裁判（${esc((v.second_opinion.judge || {}).backend || '')}）判${v.second_opinion.winner === 'aff' ? '正方' : '反方'}胜 ${v.second_opinion.aff_total} : ${v.second_opinion.neg_total}</p>` : ''}${v.primary === false ? '<p style="font-size:12px;color:#b45309">Gemini 主裁判尚未到达，当前为兜底裁决；到达后自动替换。</p>' : ''}`;
    growBars($('pane'));
  }
  async function renderFinal() {
    const seq = ++finalSeq;
    $('pane').innerHTML = '<div class="tl-ann"><span>读取终稿…</span></div>';
    try {
      const f = S.finalText != null && Net.mode !== 'live' ? { exists: !!S.finalText, text: S.finalText } : await API.final(sid, { signal: sessionAC.signal });
      if (!isCurrent() || S.tab !== 'final' || seq !== finalSeq) return;
      const exHtml = exportBoxHtml();
      $('pane').innerHTML = f.exists ? `${exHtml}<div class="md" style="font-size:14px;line-height:1.7">${md(f.text)}</div>` : `${exHtml}<div class="tl-ann"><span>终稿尚未生成${running() ? '（结束时自动生成）' : ''}</span></div>`;
    } catch {
      if (!isCurrent() || S.tab !== 'final' || seq !== finalSeq) return;
      $('pane').innerHTML = `${exportBoxHtml()}<div class="tl-ann"><span>终稿尚未生成</span></div>`;
    }
  }
  function renderPane() {
    if (S.tab === 'tl') renderTimeline();
    else if (S.tab === 'roles') renderRoles();
    else if (S.tab === 'fmt') renderFormat();
    else if (S.tab === 'verdict') renderVerdictPane();
  }
  function renderVoteBar(f) {
    const vb = $('votebar');
    if (f.voteInfo && mode() !== 'debate') {
      vb.classList.remove('hidden');
      vb.innerHTML = `<span>表决</span><span class="c" title="${esc(f.voteInfo.conclusion)}">${esc(f.voteInfo.conclusion)}</span><b class="a">✓ ${f.voteInfo.a}</b><b class="d">✗ ${f.voteInfo.d}</b><span style="color:var(--muted)">/ ${f.voteInfo.n}</span>`;
    } else vb.classList.add('hidden');
  }
  function renderPhaseBar(f) {
    const el = $('phasebar');
    if (mode() !== 'debate' || !f.phases?.length) { el.classList.add('hidden'); return; }
    const k = f.phaseIdx + '|' + f.phases.length + '|' + (S.verdict ? 1 : 0);
    if (el._k === k) return; el._k = k;
    el.innerHTML = f.phases.map((p, i) => `<span class="ps ${p.kind} ${i < f.phaseIdx ? 'done' : i === f.phaseIdx ? 'cur' : ''}" title="${esc(p.label)}">${esc(p.key.startsWith('CX') ? 'CX' : p.key)}</span>`).join('')
      + `<span class="ps judge ${S.verdict ? 'done' : f.phaseIdx >= f.phases.length ? 'cur' : ''}" title="裁判宣判">⚖</span>`;
    el.classList.remove('hidden');
  }
  function renderTimerCard(f) {
    if (mode() !== 'debate' || !f.timer) return;
    $('tPh').textContent = f.timer.label; $('tClk').textContent = f.timer.clock; $('tSub').textContent = f.timer.sub || '';
    $('tClk').className = 'clk' + (f.timer.over ? ' over' : f.timer.remain != null && f.timer.remain < 20 ? ' warn' : '');
  }
  function showVerdictOverlay() {
    const v = S.verdict; if (!v) return;
    const w = v.winner === 'aff' ? '正方' : '反方';
    $('vbox').innerHTML = `<div class="k">裁判宣判</div>
      <div class="win ${v.winner}">${w}胜！</div><div class="score">${v.scores.aff.total} : ${v.scores.neg.total}</div>
      ${scoresHtml(v)}<div class="rfd">${esc(v.rfd)}</div>
      <div class="by">${(v.judge || {}).fallback ? '<b class="fb">兜底裁判</b> ' : '<b>Gemini 裁判</b> '}${esc((v.judge || {}).backend || v.backend || '')}（${esc((v.judge || {}).model || v.model || '')}）${v.mock_debate ? ' · 本场为 mock 演练' : ''}${v.second_opinion ? ' · 第二意见：兜底判' + (v.second_opinion.winner === 'aff' ? '正方' : '反方') + '胜 ' + v.second_opinion.aff_total + ':' + v.second_opinion.neg_total : ''}${v.primary === false ? ' · 等待 Gemini 主裁判' : ''}</div>
      ${exportBoxHtml()}
      <div class="mact" style="justify-content:center"><button class="btn small" id="vClose">关闭</button><button class="btn small ghost" id="vMore">查看判决详情</button></div>`;
    $('verdict').classList.add('on');
    growBars($('vbox'));
    const cf = $('confetti'); cf.innerHTML = '';
    const cols = v.winner === 'aff' ? ['#3d7fe0', '#8fb8ff', '#c9a13b', '#fff'] : ['#e0483d', '#ff9a90', '#c9a13b', '#fff'];
    const nConf = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : IS_MOBILE ? 24 : 60;
    for (let i = 0; i < nConf; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%'; p.style.background = cols[i % cols.length];
      p.style.animationDuration = 2.4 + Math.random() * 2.4 + 's'; p.style.animationDelay = 1.1 + Math.random() * 1.2 + 's';
      cf.appendChild(p);
    }
    $('vClose').onclick = () => $('verdict').classList.remove('on');
    $('vMore').onclick = () => { $('verdict').classList.remove('on'); setTab('verdict'); };
  }
  function renderRoleStrip(f) {
    const el = $('roleStrip'); if (!el) return;
    if (!S.roles.length) { el.classList.add('hidden'); return; }
    const rk = sid + '|' + S.roles.map((r) => `${r.id}:${r.name}:${r.persona_id || ''}:${colorOf(r.id)}`).join('|');
    if (el._rk !== rk) {
      el._rk = rk;
      el.innerHTML = S.roles.map((r) => {
        const pInfo = r.persona_id ? Personas.byId.get(r.persona_id) : null;
        const av = pInfo?.avatar || r.avatar;
        return `<button type="button" class="rchip" data-rid="${r.id}" style="--c:${esc(colorOf(r.id))}" title="${esc(r.name)}">${av ? `<img class="rchip-av" src="${esc(assetUrl(av))}" alt="${esc(r.name)}" width="18" height="18" decoding="async">` : '<span class="rchip-dot" aria-hidden="true"></span>'}<span class="rchip-n">${esc(r.name)}</span></button>`;
      }).join('');
    }
    el.classList.remove('hidden');
    for (const c of el.querySelectorAll('.rchip')) {
      const rid = +c.dataset.rid;
      c.classList.toggle('active', f?.speakerId === rid || f?.thinkingId === rid);
    }
  }
  function renderVerdictStrip() {
    const el = $('verdictStrip'); if (!el) return;
    const v = S.verdict;
    const vIdx = S.msgs.findIndex((x) => x.type === 'verdict');
    const showV = !!v && (vIdx < 0 || S.cursor > vIdx);
    if (!showV) { el.classList.add('hidden'); return; }
    const vk = sid + '|' + v.winner + '|' + (v.scores?.aff?.total ?? '') + '|' + (v.scores?.neg?.total ?? '') + '|' + (v.rfd || '');
    if (el._vk !== vk) {
      el._vk = vk;
      const w = v.winner === 'aff' ? '正方胜' : '反方胜';
      el.innerHTML = `<div class="vs-row"><details class="verdict-fold"><summary><span class="vs-badge ${esc(v.winner)}">${w}</span><span class="vs-score">${esc(v.scores?.aff?.total ?? '—')} : ${esc(v.scores?.neg?.total ?? '—')}</span><span class="vs-hint">裁判摘要</span></summary><div class="vs-rfd">${esc(v.rfd || '')}</div></details><button type="button" class="btn ghost small vs-more" data-vtab>完整判决</button></div>`;
    }
    el.classList.remove('hidden');
  }
  function renderAll() {
    if (!isCurrent()) return;
    renderHeader(); renderControls(); renderPane();
    const f = computeFrame();
    stage?.update(f);
    renderVoteBar(f); renderTimerCard(f); renderLive(); renderRoleStrip(f); renderVerdictStrip();
    if (f.showVerdict && S.verdictShownFor !== sid + S.cursor && S.cursor === S.msgs.findIndex((x) => x.type === 'verdict') + 1) {
      S.verdictShownFor = sid + S.cursor; showVerdictOverlay();
    }
    if (!f.showVerdict) { $('verdict').classList.remove('on'); S.verdictShownFor = -1; }   // scrubbed before the verdict: re-arm so returning to it shows the overlay again
  }
  // timer + live frame refresh (cheap)
  uiTimer = setInterval(() => { if (!isCurrent()) { clearInterval(uiTimer); return; } const f = computeFrame(); stage?.update(f); renderTimerCard(f); renderLive(); renderPhaseBar(f); renderRoleStrip(f); }, 400);

  // ---------------- replay controls
  function seek(n, fromUser) {
    if (!isCurrent()) return;
    S.cursor = Math.max(0, Math.min(S.msgs.length, n));
    if (fromUser) { S.follow = false; }
    if (S.cursor >= S.msgs.length && running() && !S.playing) S.follow = true;
    renderAll();
  }
  function stepDelay() {
    const m = S.msgs[S.cursor - 1];
    if (!m) return 1200;
    if (m.type === 'announce') return 1300;
    if (m.type === 'verdict') return 6000;
    return Math.min(4200, 1700 + plain(m.short || m.text, 300).length * 12);
  }
  function play() {
    cancelTimer(playTimer);
    if (!isCurrent() || !S.playing) return;
    if (S.cursor >= S.msgs.length) { S.playing = false; S.follow = running() || S.catchup; S.catchup = false; renderAll(); return; }
    seek(S.cursor + 1);
    if (isCurrent() && S.playing) playTimer = trackTimer(play, stepDelay());
  }
  $('scrub').oninput = () => { if (!isCurrent()) return; S.playing = false; cancelTimer(playTimer); seek(+$('scrub').value, true); };
  $('playBtn').onclick = () => {
    if (!isCurrent()) return;
    if (S.playing) { S.playing = false; cancelTimer(playTimer); renderAll(); return; }
    if (S.cursor >= S.msgs.length) S.cursor = 0;
    S.follow = false; S.playing = true; $('verdict').classList.remove('on'); renderAll(); playTimer = trackTimer(play, 600);
  };
  $('liveBtn').onclick = () => { if (!isCurrent()) return; S.playing = false; cancelTimer(playTimer); S.follow = true; seek(S.msgs.length); };

  // ---------------- tabs, timeline clicks, role drawer
  function setTab(t) {
    if (!isCurrent()) return;
    S.tab = t; tlCount = -1;
    for (const b of $('tabs').querySelectorAll('.tab')) { b.classList.toggle('on', b.dataset.t === t); b.setAttribute('aria-selected', String(b.dataset.t === t)); }
    $('pane').scrollTop = 0; showTlNew(false);
    if (t === 'final') renderFinal(); else renderPane();
  }
  $('tabs').onclick = (e) => { if (!isCurrent()) return; const b = e.target.closest('.tab'); if (b) setTab(b.dataset.t); };
  $('pane').onclick = (e) => {
    if (!isCurrent()) return;
    const it = e.target.closest('.tl-item[data-i]');
    if (it && !e.target.closest('a') && !e.target.closest('details')) {
      const i = +it.dataset.i;
      if (S.openItems.has(i)) S.openItems.delete(i); else S.openItems.add(i);
      it.classList.toggle('open');
      S.playing = false; cancelTimer(playTimer); seek(i + 1, true);
    }
  };
  function showRole(id) {
    if (!isCurrent()) return;
    const r = S.byId.get(id); if (!r) return;
    const d = $('drawer');
    d.innerHTML = `<div class="drawer-head"><span class="grab" aria-hidden="true"></span><button class="iconbtn" id="dClose" aria-label="关闭角色详情">✕</button></div>` + roleCard(r, true);
    d.classList.remove('hidden');
    $('dClose').onclick = () => d.classList.add('hidden');
    d.onclick = (e) => { const s = e.target.closest('[data-seek]'); if (s && isCurrent()) { S.playing = false; seek(+s.dataset.seek + 1, true); } };
  }

  function close() {
    if (S.closed) return;
    S.closed = true;
    S.playing = false;
    loadGen++;
    loadAC?.abort();
    loadAC = null;
    cancelTimer(retryTimer); retryTimer = 0;
    sessionAC.abort();
    pollAbort?.abort();
    subAbort?.abort();
    for (const id of timers) clearTimeout(id);
    timers.clear();
    clearTimeout(playTimer);
    clearInterval(uiTimer);
    clearTimeout(snapTimer);
    try { S.ws?.close(); } catch {}   // old session's WebSocket must not keep driving the shared stage
    S.ws = null;
    subDom = null;
    $('scrub').oninput = null; $('playBtn').onclick = null; $('liveBtn').onclick = null;
    $('tabs').onclick = null; $('pane').onclick = null; $('drawer').onclick = null;
    stage?.clear?.();
    setStageMask('idle');
    resetSessionUI();
  }
  setTab('tl');
  load();
  return ctl;
}

// =====================================================================================
// boot
// =====================================================================================
(async () => {
  await discover();
  const m = location.hash.match(/^#\/s\/([^/?]+)/);
  if (m && current && current.sid === decodeURIComponent(m[1]) && current.netMode === Net.mode) return;
  route(true);
})();
document.addEventListener('visibilitychange', () => { stage?.setRunning(!document.hidden && !!current); });
