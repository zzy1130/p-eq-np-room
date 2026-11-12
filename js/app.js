// AI 圆桌 & 辩论厅 — app shell: discovery, realtime long-poll, snapshot fallback, replay, submit.
import { createStage, IS_MOBILE } from './stage3d.js';
import { esc, md, plain } from './mdlite.js';

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
const ago = (ms) => { if (!ms) return ''; const d = (Date.now() - ms) / 1000; if (d < 60) return '刚刚'; if (d < 3600) return Math.floor(d / 60) + ' 分钟前'; if (d < 86400) return Math.floor(d / 3600) + ' 小时前'; return new Date(ms).toLocaleDateString('zh-CN'); };
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), ms); }

// =====================================================================================
// Connection: discover the current tunnel (stable entry = this GitHub Pages URL)
// =====================================================================================
const Net = { mode: 'connecting', base: null, fails: 0, lat: [], lastLat: null, discovering: null, seek: (n) => current?.seek(n, true) };
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
  const b = $('banner');
  if (mode === 'snap') { b.textContent = IS_MOBILE ? '实时通道连不上，已切到快照模式（约 1 分钟延迟），自动重连中…' : '实时通道暂时连不上，已切换到快照模式（约每分钟更新，可能有 1–2 分钟延迟）。正在后台自动重连…'; b.classList.remove('hidden'); }
  else b.classList.add('hidden');
  document.body.classList.toggle('banner-on', mode === 'snap');
  $('newBtn').disabled = $('newBtn2').disabled = mode === 'snap';
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
    tries.push(tunnelFromApi().then(probe));
    tries.push(tunnelFromPages().then(probe));
    try {
      const base = await Promise.any(tries).catch(async () => {   // one quick retry before giving up
        await sleep(1500);
        return Promise.any([tunnelFromApi().then(probe), tunnelFromPages().then(probe), ...(saved ? [probe(saved)] : [])]);
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
      try { const j = await fetchJSON(Net.base + '/api/sessions'); Net.fails = 0; return j.sessions; } catch (e) { noteFailure(); throw e; }
    }
    const j = await fetchJSON(PAGES + 'snap/sessions.json?t=' + Date.now());
    return j.sessions;
  },
  async bundle(sid) {
    if (Net.mode === 'live') {
      try { const j = await fetchJSON(Net.base + '/api/s/' + encodeURIComponent(sid)); Net.fails = 0; return j; } catch (e) { if (e.status !== 404) noteFailure(); throw e; }
    }
    return fetchJSON(PAGES + 'snap/s/' + encodeURIComponent(sid) + '.json?t=' + Date.now());
  },
  async final(sid) {
    if (Net.mode === 'live') return fetchJSON(Net.base + '/api/s/' + encodeURIComponent(sid) + '/final');
    const b = await fetchJSON(PAGES + 'snap/s/' + encodeURIComponent(sid) + '.json?t=' + Date.now());
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
async function route(force) {
  const m = location.hash.match(/^#\/s\/([^/?]+)/);
  if (m) {
    const sid = decodeURIComponent(m[1]);
    if (!current || current.sid !== sid || force) { current?.close(); current = openSession(sid); }
    $('home').classList.add('hidden'); $('session').classList.remove('hidden');
    stopHome();
  } else {
    current?.close(); current = null;
    $('session').classList.add('hidden'); $('home').classList.remove('hidden');
    startHome();
  }
}
addEventListener('hashchange', () => route());

// =====================================================================================
// Home
// =====================================================================================
let homeTimer = 0, homeFilter = 'all', homeData = null;
function startHome() { clearTimeout(homeTimer); loadHome(); }
function stopHome() { clearTimeout(homeTimer); }
async function loadHome() {
  try { homeData = await API.sessions(); renderHome(); } catch (e) { if (!homeData) $('cards').innerHTML = `<div class="empty">暂时取不到场次列表（${esc(e.message)}），稍后自动重试…</div>`; }
  homeTimer = setTimeout(loadHome, Net.mode === 'live' ? 4000 : 30000);
}
function renderHome() {
  const list = (homeData || []).filter((s) => homeFilter === 'all' || (homeFilter === 'running' ? isActive(s.state) : s.mode === homeFilter));
  if (!list.length) { $('cards').innerHTML = `<div class="empty">还没有场次。点右上角「＋ 发起」开一场吧。</div>`; return; }
  $('cards').innerHTML = list.map((s) => {
    const deb = s.mode === 'debate';
    let st = STATE_LABEL[s.state] || s.state;
    if (s.state === 'judged' && s.winner) st = `已宣判 · ${s.winner === 'aff' ? '正方' : '反方'}胜`;
    if (s.state === 'running' && s.phase_label) st = '进行中 · ' + s.phase_label;
    return `<a class="card" href="#/s/${encodeURIComponent(s.sid)}">
      <div class="row"><span class="badge ${deb ? 'db' : 'rt'}">${deb ? '美式辩论' : '圆桌讨论'}</span>
        <span class="state ${esc(s.state)}">${esc(st)}</span></div>
      <h3>${esc(s.topic || s.sid)}</h3>
      <div class="meta"><span>🤖 ${s.n_roles || '—'} 个 bot</span><span>💬 ${s.n_msgs || 0} 条</span><span>${esc(ago(s.created_ms))}</span>${s.legacy ? '<span>存档</span>' : ''}</div>
    </a>`;
  }).join('');
}
$('filters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-f]'); if (!b) return;
  homeFilter = b.dataset.f;
  for (const x of $('filters').children) x.classList.toggle('on', x === b);
  renderHome();
});

// =====================================================================================
// Submit modal
// =====================================================================================
function openModal() {
  if (Net.mode !== 'live') { toast('快照模式下不能提交，请等实时通道恢复'); return; }
  $('modal').classList.remove('hidden'); $('mErr').textContent = '';
  const saved = localStorage.getItem('arenaPass'); if (saved) $('fPass').value = saved;
  fetchJSON(Net.base + '/api/health', { timeout: 5000 }).then((h) => {
    if (h.quota_blocked_until_ms) $('mErr').textContent = `注意：上游免费额度今日已用尽，约 ${new Date(h.quota_blocked_until_ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 重置，之前提交会被拒绝。`;
    if (h.running >= 2) $('mErr').textContent = '当前已有 2 场在进行，请稍后再试。';
  }).catch(() => {});
  setTimeout(() => $('fTopic').focus(), 50);
}
$('newBtn').onclick = $('newBtn2').onclick = openModal;
$('cancelBtn').onclick = () => $('modal').classList.add('hidden');
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').classList.add('hidden'); });
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
  $('submitBtn').disabled = true; $('mErr').textContent = '';
  try {
    const r = await API.submit(body);
    if ($('remember').checked) localStorage.setItem('arenaPass', body.passcode); else localStorage.removeItem('arenaPass');
    $('modal').classList.add('hidden'); $('form').reset();
    toast('已开场！分配官正在安排角色…');
    location.hash = '#/s/' + encodeURIComponent(r.sid);
  } catch (err) {
    $('mErr').textContent = err.body?.error || err.message || '提交失败';
  } finally { $('submitBtn').disabled = false; }
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') $('modal').classList.add('hidden'); });

// =====================================================================================
// Session view
// =====================================================================================
let stage = null;
function getStage() {
  if (!stage) stage = createStage($('stageHost'), $('overlay'), {
    onPickBot: (id) => current?.showRole(id),
    onPickMsg: (idx) => current?.seek(idx + 1, true),
    reserved: () => {
      const host = $('stageWrap').getBoundingClientRect();
      const out = [];
      for (const el of document.querySelectorAll('.hud-top > *, .replay, .votebar:not(.hidden), .drawer:not(.hidden)')) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height) out.push({ x: r.left - host.left, y: r.top - host.top, w: r.width, h: r.height });
      }
      return out;
    },
  });
  return stage;
}

function openSession(sid) {
  const S = { sid, topic: null, roles: [], byId: new Map(), msgs: [], status: {}, verdict: null, finalExists: false,
    cursor: 0, follow: true, playing: false, tab: 'tl', closed: false, arrival: new Map(), verdictShownFor: -1, lastBundle: 0, openItems: new Set() };
  const ctl = { sid, close, showRole, seek };
  let pollAbort = null, playTimer = 0, uiTimer = 0, snapTimer = 0;
  $('pane').innerHTML = '<div class="tl-ann"><span>加载中…</span></div>';
  $('sTitle').textContent = '加载中…'; $('kicker').textContent = '';
  $('verdict').classList.remove('on'); $('drawer').classList.add('hidden');

  const mode = () => S.topic?.mode || S.status.mode || 'roundtable';
  const roleName = (id) => S.byId.get(id)?.name || (id ? '角色 ' + id : '');
  const colorOf = (id) => stage?.botColor(id) || '#8a7d70';
  const nameToId = (name) => { if (!name) return null; const base = String(name).replace(/\(.*$|（.*$/, ''); for (const r of S.roles) if (r.name === base || r.name === name) return r.id; return null; };
  const running = () => isActive(S.status.state);

  function applyTopic(t) {
    if (!t) return;
    const had = S.roles.length;
    S.topic = t; S.roles = t.roles || []; S.byId = new Map(S.roles.map((r) => [r.id, r]));
    if (S.roles.length && (!had || had !== S.roles.length)) {
      $('stageWrap').classList.toggle('debate', t.mode === 'debate');
      getStage().setup({ mode: t.mode, roles: S.roles, seed: sid });
    }
    renderHeader();
  }
  function applyBundle(b) {
    applyTopic(b.topic);
    S.status = b.status || {};
    S.verdict = b.verdict || null;
    S.finalExists = !!(b.final_exists || b.final_text);
    S.finalText = b.final_text;
    const before = S.msgs.length;
    S.msgs = b.messages || [];
    S.msgs.forEach((m, i) => { m.idx = i; });
    if (S.follow || S.cursor > S.msgs.length) S.cursor = S.msgs.length;
    if (!before && !running() && S.msgs.length) { S.follow = false; toast('本场已结束：可拖动时间轴或点 ▶ 从头回放', 4200); }
    renderAll();
  }
  function applyIncoming(j) {
    if (j.topic && (!S.topic || (j.topic.roles || []).length !== S.roles.length || S.topic.allocating)) applyTopic(j.topic);
    if (j.status) S.status = j.status;
    if (j.verdict) S.verdict = j.verdict;
    if (j.final_exists != null) S.finalExists = j.final_exists;
    let added = 0;
    for (const m of j.messages || []) {
      if (m.idx !== S.msgs.length) continue;      // dedupe / ordering guard
      S.msgs.push(m); S.arrival.set(m.idx, performance.now()); recordLatency(m); added++;
    }
    if (S.follow) S.cursor = S.msgs.length;
    if (added || j.status) renderAll();
  }

  async function load() {
    try {
      const b = await API.bundle(sid);
      if (S.closed) return;
      applyBundle(b); S.lastBundle = Date.now();
      if (Net.mode === 'live') pollLoop(); else snapLoop();
    } catch (e) {
      if (S.closed) return;
      $('sTitle').textContent = e.status === 404 ? '找不到这个场次' : '加载失败，重试中…';
      if (e.status !== 404) setTimeout(load, 3000);
    }
  }
  async function pollLoop() {
    while (!S.closed && Net.mode === 'live') {
      pollAbort = new AbortController();
      try {
        const j = await fetchJSON(`${Net.base}/api/s/${encodeURIComponent(sid)}/poll?since=${S.msgs.length}&sv=${S.status.updated_ms || 0}`,
          { timeout: 28000, signal: pollAbort.signal });
        Net.fails = 0;
        if (S.closed) return;
        applyIncoming(j);
        if (!running() && !j.messages?.length) await sleep(4000);
      } catch (e) {
        if (S.closed) return;
        noteFailure(); await sleep(1500);
      }
    }
    if (!S.closed) snapLoop();
  }
  async function snapLoop() {
    clearTimeout(snapTimer);
    if (S.closed) return;
    if (Net.mode === 'live') { pollLoop(); return; }
    try { const b = await API.bundle(sid); if (!S.closed) applyBundle(b); } catch {}
    snapTimer = setTimeout(snapLoop, 30000);
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
  function phaseDef(key) { return (S.topic?.phases || []).find((p) => p.key === key); }
  function computeFrame() {
    const shown = S.msgs.slice(0, S.cursor);
    const m = shown[shown.length - 1];
    const atTail = S.cursor >= S.msgs.length;
    const liveNow = atTail && running();
    const f = { bubbles: [], votes: null, consensus: false, busy: false };
    // bubbles: latest message per bot (max 4), newest is "main"
    const seen = new Set();
    for (let i = shown.length - 1; i >= 0 && f.bubbles.length < (IS_MOBILE ? 3 : 4); i--) {
      const x = shown[i];
      if (seen.has(x.role_id)) continue;
      if (S.arrival.has(i) && liveNow && performance.now() - S.arrival.get(i) > 90000) continue;
      seen.add(x.role_id);
      f.bubbles.push({ id: x.role_id, key: sid + ':' + i + (f.bubbles.length === 0 ? 'm' : ''), idx: i, type: x.type, html: bubbleHtml(x, f.bubbles.length === 0), main: f.bubbles.length === 0 });
    }
    if (mode() === 'debate') {
      const st = S.status;
      const curKey = liveNow ? st.phase_key : m?.phase;
      const ph = phaseDef(curKey);
      f.phases = S.topic?.phases || [];
      f.phaseIdx = liveNow ? (st.phase_idx ?? 0) : Math.max(0, f.phases.findIndex((p) => p.key === curKey));
      if (!liveNow && S.cursor >= S.msgs.length && S.verdict) f.phaseIdx = f.phases.length;
      if (liveNow && st.state !== 'judging') {
        f.speakerId = st.speaking_id || null; f.addressId = st.addressing || null;
        f.thinkingId = st.speaking_id || null;
      } else if (m && (m.side === 'aff' || m.side === 'neg')) {
        f.speakerId = m.role_id; f.addressId = m.reply_to || null;
      }
      if (liveNow && st.state === 'judging') f.thinkingId = 6;
      if (ph && f.speakerId) {
        f.atLectern = ph.kind !== 'cx' || f.speakerId === ph.answerer;
        f.speakKind = ph.kind === 'cx' && f.speakerId === ph.answerer ? 'answer' : ph.kind === 'rebuttal' ? 'rebut' : 'speak';
      }
      // timer
      const t = { label: ph?.label || (st.state === 'judging' ? '裁判评议中' : S.verdict ? '已宣判' : '赛前'), clock: '--:--', sub: '' };
      if (liveNow && st.phase_deadline_ms) {
        const remain = (st.phase_deadline_ms - Date.now()) / 1000;
        t.remain = remain; t.clock = fmtClock(Math.max(remain, -599)); t.over = remain < 0;
        if (st.paused) { t.remain = null; t.over = false; t.clock = '⏸ ' + fmtClock(Math.max(remain, 0)); }
        t.sub = st.paused ? '计时暂停：上游限流' : ph ? (ph.kind === 'cx' ? `问≤${ph.q_chars} 字 · 答≤${ph.a_chars} 字 · 共 ${ph.rounds} 问` : `限 ${ph.chars} 字 · 时限 ${fmtClock(ph.secs)}`) : '';
      } else if (m && m.limit_chars) {
        t.clock = fmtClock(m.elapsed_s); t.over = !!(m.overtime || m.truncated);
        t.sub = `用时 ${fmtClock(m.elapsed_s)} / ${fmtClock(m.limit_s || ph?.secs)} · ${m.chars ?? 0}/${m.limit_chars} 字${m.truncated ? ' · 超字截断' : ''}`;
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
        const recent = m && S.arrival.has(m.idx) ? performance.now() - S.arrival.get(m.idx) < 15000 : false;
        if (m && recent && m.type !== 'vote') { f.speakerId = m.role_id; f.addressId = m.reply_to ? Number(m.reply_to) : null; }
        else if (f.thinkingId && st.addressing) f.addressId = Number(st.addressing);
      } else if (m) {
        if (m.type !== 'vote') { f.speakerId = m.role_id; f.addressId = m.reply_to ? Number(m.reply_to) : null; }
        else f.addressId = m.reply_to ? Number(m.reply_to) : null;
      }
      f.speakKind = m?.type === 'rebuttal' && f.speakerId === m.role_id ? 'rebut' : 'speak';
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
    $('nMsgs').textContent = String(n);
  }
  let tlCount = -1, tlSid = null;
  function renderTimeline() {
    const pane = $('pane');
    if (S.tab !== 'tl') return;
    const st = S.status;
    const deb = mode() === 'debate';
    const tlKey = [S.msgs.length, st.speaking, st.paused, st.state, st.calls, S.topic?.allocator?.rationale].join('|');
    if (tlCount !== tlKey || tlSid !== sid || !pane.querySelector('.tl-list')) {
      const atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80;
      tlCount = tlKey; tlSid = sid;
      const items = S.msgs.map((m, i) => {
        if (m.type === 'announce') return `<div class="tl-ann" data-i="${i}"><span>${esc(m.text)}</span></div>`;
        const [lab, col] = typeMeta(m.type, mode());
        const r = S.byId.get(m.role_id);
        const to = m.reply_to && S.byId.get(Number(m.reply_to)) ? ` → ${esc(roleName(Number(m.reply_to)))}` : '';
        const ph = deb && m.phase ? `<span class="tp" style="--tc:#5a6380">${esc(m.phase)}</span>` : (m.round ? `<span style="color:var(--muted)">第${m.round}轮</span>` : '');
        const vote = m.type === 'vote' ? `<b style="color:${m.vote === 'disagree' ? 'var(--neg)' : 'var(--good)'}">${m.vote === 'disagree' ? '✗ 反对' : '✓ 赞成'}</b>` : '';
        const lim = m.limit_chars ? `<div class="lim ${m.truncated || m.overtime ? 'bad' : ''}">${m.chars ?? 0}/${m.limit_chars} 字 · 用时 ${m.elapsed_s ?? '–'}s${m.limit_s ? ' / ' + m.limit_s + 's' : ''}${m.truncated ? ' · 超字截断' : ''}${m.overtime ? ' · 超时' : ''}</div>` : '';
        const short = m.type === 'vote' ? (m.position || m.short) : m.type === 'proposal' ? '表决：' + (m.conclusion || m.short) : m.short;
        return `<div class="tl-item${S.openItems.has(i) ? ' open' : ''}" data-i="${i}" style="--c:${colorOf(m.role_id)}">
          <div class="av">${esc((r?.name || m.role || '?').replace(/^(正方|反方)/, '').replace(/^[一二]辩·?/, '').slice(0, 1))}</div>
          <div><div class="hd"><b>${esc(r?.name || m.role || '')}</b><span class="tp" style="--tc:${col}">${esc(lab)}</span>${ph}${vote}<span style="color:var(--muted)">${to}</span><span class="t">${esc((m.ts || '').slice(11, 19))}</span></div>
          <div class="sm">${esc(short || plain(m.text, 60))}</div>${lim}
          <div class="tx md">${md(m.text)}</div></div></div>`;
      }).join('');
      const paused = st.paused ? `<div class="tl-ann"><span style="background:#fff1d6;color:#7a5200">⏸ ${esc(st.paused)}</span></div>` : '';
      const thinking = running() && st.speaking ? `<div class="tl-ann"><span>💭 ${esc(st.speaking)} 正在${st.state === 'allocating' ? '分配角色' : st.state === 'judging' ? '评议' : '组织发言'}…</span></div>` : '';
      const head = `<div class="statusline"><span>状态 <b>${esc(STATE_LABEL[st.state] || st.state || '—')}</b></span><span>调用 <b>${st.calls ?? 0}</b></span><span>429 <b>${st.r429 ?? 0}</b></span>${S.topic?.allocator?.rationale ? `<span title="分配官的理由">🧭 ${esc(S.topic.allocator.rationale)}</span>` : ''}</div>`;
      pane.innerHTML = head + `<div class="tl-list">${items || '<div class="tl-ann"><span>还没有发言</span></div>'}</div>` + paused + thinking;
      if (S.follow && atBottom !== false) pane.scrollTop = pane.scrollHeight;
    }
    for (const el of pane.querySelectorAll('[data-i]')) {
      const i = +el.dataset.i;
      el.classList.toggle('cur', i === S.cursor - 1);
      el.classList.toggle('future', i >= S.cursor);
    }
    if (!S.follow) { const cur = pane.querySelector('.tl-item.cur, .tl-ann.cur'); if (cur && S.playing) cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }
  function kitHtml(k) {
    if (!k) return '<div class="kit"><div class="desc">脚本/外部角色，不加载 skill。</div></div>';
    return `<div class="kit"><div class="k">🧰 ${esc(k.label)} <span style="font-weight:500;color:var(--muted)">· ${esc(k.use_for)}</span></div>
      <div>Skill：<code>${esc(k.skill.name)}</code> <span class="desc">${esc(plain(k.skill.description, 140))}</span></div>
      <div class="src">来源 <a href="${esc(k.skill.url)}" target="_blank" rel="noopener">${esc(k.skill.repo)}</a><span class="star">★ ${Number(k.skill.stars).toLocaleString()}</span></div>
      <div style="margin-top:6px">AGENTS.md 上游：<code>${esc(k.agents.name)}</code></div>
      <div class="src">来源 <a href="${esc(k.agents.url)}" target="_blank" rel="noopener">${esc(k.agents.repo)}</a><span class="star">★ ${Number(k.agents.stars).toLocaleString()}</span></div></div>`;
  }
  function roleCard(r, withHist) {
    const side = { aff: '正方', neg: '反方', judge: '裁判', chair: '主持' }[r.side] || '';
    const mine = withHist ? S.msgs.filter((m) => m.role_id === r.id && m.type !== 'announce') : [];
    return `<div class="role" data-r="${r.id}" style="--c:${colorOf(r.id)}"><div class="rh"><span class="av"></span><b>${esc(r.name)}</b>${side ? `<span class="sd ${r.side}">${side}</span>` : ''}</div>
      <div class="ps">${esc(r.persona || '')}</div>${kitHtml(r.kit)}
      ${r.workdir ? `<div style="font-size:11.5px;color:var(--muted);margin-top:6px">独立工作目录：<code>${esc(r.workdir)}</code>（含 AGENTS.md 与 .pi/skills/）</div>` : ''}
      ${withHist ? `<details class="hist" ${mine.length ? 'open' : ''}><summary>发言历史（${mine.length}）</summary>${mine.map((m) => `<div class="tl-item" data-seek="${m.idx}" style="--c:${colorOf(r.id)};grid-template-columns:1fr"><div><div class="hd"><span class="tp" style="--tc:${typeMeta(m.type, mode())[1]}">${esc(typeMeta(m.type, mode())[0])}</span>${m.phase ? esc(m.phase) : ''}</div><div class="sm">${esc(m.short || plain(m.text, 60))}</div></div></div>`).join('')}</details>` : ''}</div>`;
  }
  function renderRoles() {
    if (!S.roles.length) { $('pane').innerHTML = '<div class="tl-ann"><span>分配官正在安排角色…</span></div>'; return; }
    const t = S.topic;
    $('pane').innerHTML = (t.allocator ? `<div class="statusline">🧭 分配官：${esc(t.allocator.rationale || '—')}${t.allocator.fallback ? '（模型输出不可解析，已用默认阵容）' : ''}</div>` : '') +
      S.roles.map((r) => roleCard(r, false)).join('') +
      (t.legacy ? '<div class="tl-ann"><span>旧场次（升级前创建），角色未配置 skill</span></div>' : '');
  }
  function renderFormat() {
    const t = S.topic || {}; const ph = t.phases || []; const st = S.status;
    let cur = S.cursor >= S.msgs.length && running() ? st.phase_idx : ph.findIndex((p) => p.key === S.msgs[S.cursor - 1]?.phase);
    if (S.msgs[S.cursor - 1]?.phase === 'JUDGE' || (S.verdict && S.cursor >= S.msgs.length)) cur = ph.length;
    $('pane').innerHTML = `<div class="fmt"><h3>${esc(t.format_name || 'Policy 辩论（简化版）')}</h3>
      <p>采用美式 <b>Policy 辩论</b>的结构并压缩为正反各 2 人：先立论、后质询（cross-examination），再驳论与总结；<b>正方最后发言</b>（与 Policy 惯例一致）。正方支持辩题，反方反对。</p>
      <ol class="phase-list">${ph.map((p, i) => `<li class="${i < cur ? 'done' : i === cur ? 'cur' : ''}"><span>${esc(p.label)}</span><span class="lm">${p.kind === 'cx' ? `${p.rounds} 问 · 问≤${p.q_chars} 答≤${p.a_chars} 字` : `≤${p.chars} 字`} · ${fmtClock(p.secs)}</span></li>`).join('')}
        <li class="${S.verdict && cur >= ph.length ? 'done' : st.state === 'judging' ? 'cur' : ''}"><span>裁判评议与宣判</span><span class="lm">${esc(st.judge_backend || S.verdict?.backend || '')}</span></li></ol>
      <h3>严格计时 / 限字</h3>
      <p>每个环节都有字数上限和发言时限（计时牌倒计时）。超出字数的部分<b>硬截断</b>并标注「超字截断」；模型在时限内没交出发言，该发言<b>作废</b>。质询的所有问答共享一个总时限，时间到即结束。违规会进入裁判「规则」分项扣分。等待上游模型（限流/额度/出错重试）的时间<b>不计入</b>发言时间，计时牌显示 ⏸。</p>
      <h3>裁判</h3>
      <p>可插拔裁判接口：默认调用本机 <b>Claude Code CLI</b>（<code>claude -p</code>，附评分量表）；若服务器设置了 <code>GEMINI_API_KEY</code> 则改用 <b>Gemini API</b>。不使用 Antigravity。量表五项各 10 分：论证、证据、交锋、质询、规则；另给辩手分（26–30）。按 flow 判，未回应的论点视为成立。</p></div>`;
  }
  function scoresHtml(v) {
    const rows = [['argument', '论证'], ['evidence', '证据'], ['clash', '交锋'], ['cross_ex', '质询'], ['rules', '规则']];
    return `<div class="scores"><span></span><b style="color:var(--aff)">正方 ${v.scores.aff.total}</b><b style="color:var(--neg)">反方 ${v.scores.neg.total}</b>` +
      rows.map(([k, l]) => `<span>${l}</span><div class="bar aff"><i data-w="${v.scores.aff[k] * 10}"></i></div><div class="bar neg"><i data-w="${v.scores.neg[k] * 10}"></i></div>`).join('') + '</div>';
  }
  function growBars(root) { requestAnimationFrame(() => setTimeout(() => root.querySelectorAll('.bar i').forEach((i) => { i.style.width = i.dataset.w + '%'; }), 60)); }
  function renderVerdictPane() {
    const v = S.verdict;
    if (!v) { $('pane').innerHTML = `<div class="tl-ann"><span>${S.status.state === 'judging' ? '⚖️ 裁判评议中…' : '比赛结束后由裁判宣判'}</span></div>`; return; }
    const w = v.winner === 'aff' ? '正方' : '反方';
    $('pane').innerHTML = `<div class="vcard"><div style="font-size:12px;letter-spacing:.2em;opacity:.7">VERDICT · 判决</div><div class="w ${v.winner}">🏆 ${w}胜</div>${scoresHtml(v)}</div>
      <h3 style="font-size:15px;margin:6px 0">判决理由（RFD）</h3><div class="rfd">${esc(v.rfd)}</div>
      ${v.key_clashes?.length ? `<h3 style="font-size:15px;margin:12px 0 6px">关键交锋</h3><ol class="pts">${v.key_clashes.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>` : ''}
      <h3 style="font-size:15px;margin:12px 0 6px">辩手分</h3><div class="pts">${(v.speaker_points || []).map((p) => `<div><b>${esc(p.name)}</b> ${p.points} <span style="color:var(--muted)">${esc(p.note || '')}</span></div>`).join('')}</div>
      <p style="font-size:12px;color:var(--muted);margin-top:12px">裁判后端：${esc(v.backend)}（${esc(v.model || '')}）· ${esc(v.decided_at || '')}${v.elapsed_s ? ' · 用时 ' + v.elapsed_s + 's' : ''}</p>`;
    growBars($('pane'));
  }
  async function renderFinal() {
    $('pane').innerHTML = '<div class="tl-ann"><span>读取终稿…</span></div>';
    try {
      const f = S.finalText != null && Net.mode !== 'live' ? { exists: !!S.finalText, text: S.finalText } : await API.final(sid);
      if (S.tab !== 'final' || S.closed) return;
      $('pane').innerHTML = f.exists ? `<div class="md" style="font-size:14px;line-height:1.7">${md(f.text)}</div>` : `<div class="tl-ann"><span>终稿尚未生成${running() ? '（结束时自动生成）' : ''}</span></div>`;
    } catch { $('pane').innerHTML = '<div class="tl-ann"><span>终稿尚未生成</span></div>'; }
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
      vb.innerHTML = `<span>🗳️ 表决</span><span class="c" title="${esc(f.voteInfo.conclusion)}">${esc(f.voteInfo.conclusion)}</span><b class="a">✓ ${f.voteInfo.a}</b><b class="d">✗ ${f.voteInfo.d}</b><span style="color:var(--muted)">/ ${f.voteInfo.n}</span>`;
    } else vb.classList.add('hidden');
  }
  function renderTimerCard(f) {
    if (mode() !== 'debate' || !f.timer) return;
    $('tPh').textContent = f.timer.label; $('tClk').textContent = f.timer.clock; $('tSub').textContent = f.timer.sub || '';
    $('tClk').className = 'clk' + (f.timer.over ? ' over' : f.timer.remain != null && f.timer.remain < 20 ? ' warn' : '');
  }
  function showVerdictOverlay() {
    const v = S.verdict; if (!v) return;
    const w = v.winner === 'aff' ? '正方' : '反方';
    $('vbox').innerHTML = `<div class="gavel">🔨</div><div class="k">裁 判 宣 判</div>
      <div class="win ${v.winner}">${w}胜！</div><div class="score">${v.scores.aff.total} : ${v.scores.neg.total}</div>
      ${scoresHtml(v)}<div class="rfd">${esc(v.rfd)}</div>
      <div class="by">裁判：${esc(v.backend)}（${esc(v.model || '')}）</div>
      <div class="mact" style="justify-content:center"><button class="btn small" id="vClose">关闭</button><button class="btn small ghost" id="vMore">查看判决详情</button></div>`;
    $('verdict').classList.add('on');
    growBars($('vbox'));
    const cf = $('confetti'); cf.innerHTML = '';
    const cols = v.winner === 'aff' ? ['#3d7fe0', '#8fb8ff', '#c9a13b', '#fff'] : ['#e0483d', '#ff9a90', '#c9a13b', '#fff'];
    for (let i = 0; i < (IS_MOBILE ? 40 : 90); i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%'; p.style.background = cols[i % cols.length];
      p.style.animationDuration = 2.4 + Math.random() * 2.4 + 's'; p.style.animationDelay = 1.1 + Math.random() * 1.2 + 's';
      cf.appendChild(p);
    }
    $('vClose').onclick = () => $('verdict').classList.remove('on');
    $('vMore').onclick = () => { $('verdict').classList.remove('on'); setTab('verdict'); };
  }
  function renderAll() {
    if (S.closed) return;
    renderHeader(); renderControls(); renderPane();
    const f = computeFrame();
    stage?.update(f);
    renderVoteBar(f); renderTimerCard(f);
    if (f.showVerdict && S.verdictShownFor !== sid + S.cursor && S.cursor === S.msgs.findIndex((x) => x.type === 'verdict') + 1) {
      S.verdictShownFor = sid + S.cursor; showVerdictOverlay();
    }
    if (!f.showVerdict) $('verdict').classList.remove('on');
  }
  // timer + live frame refresh (cheap)
  uiTimer = setInterval(() => { const f = computeFrame(); stage?.update(f); renderTimerCard(f); }, 500);

  // ---------------- replay controls
  function seek(n, fromUser) {
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
    clearTimeout(playTimer);
    if (!S.playing) return;
    if (S.cursor >= S.msgs.length) { S.playing = false; S.follow = running(); renderAll(); return; }
    seek(S.cursor + 1);
    playTimer = setTimeout(play, stepDelay());
  }
  $('scrub').oninput = () => { S.playing = false; clearTimeout(playTimer); seek(+$('scrub').value, true); };
  $('playBtn').onclick = () => {
    if (S.playing) { S.playing = false; clearTimeout(playTimer); renderAll(); return; }
    if (S.cursor >= S.msgs.length) S.cursor = 0;
    S.follow = false; S.playing = true; $('verdict').classList.remove('on'); renderAll(); playTimer = setTimeout(play, 600);
  };
  $('liveBtn').onclick = () => { S.playing = false; clearTimeout(playTimer); S.follow = true; seek(S.msgs.length); };

  // ---------------- tabs, timeline clicks, role drawer
  function setTab(t) {
    S.tab = t; tlCount = -1;
    for (const b of $('tabs').querySelectorAll('.tab')) b.classList.toggle('on', b.dataset.t === t);
    $('pane').scrollTop = 0;
    if (t === 'final') renderFinal(); else renderPane();
  }
  $('tabs').onclick = (e) => { const b = e.target.closest('.tab'); if (b) setTab(b.dataset.t); };
  $('pane').onclick = (e) => {
    const it = e.target.closest('.tl-item[data-i]');
    if (it && !e.target.closest('a')) {
      const i = +it.dataset.i;
      if (S.openItems.has(i)) S.openItems.delete(i); else S.openItems.add(i);
      it.classList.toggle('open');
      S.playing = false; clearTimeout(playTimer); seek(i + 1, true);
    }
  };
  function showRole(id) {
    const r = S.byId.get(id); if (!r) return;
    const d = $('drawer');
    d.innerHTML = `<div style="display:flex;justify-content:flex-end"><button class="iconbtn" style="width:30px;height:30px;font-size:14px" id="dClose">✕</button></div>` + roleCard(r, true);
    d.classList.remove('hidden');
    $('dClose').onclick = () => d.classList.add('hidden');
    d.onclick = (e) => { const s = e.target.closest('[data-seek]'); if (s) { S.playing = false; seek(+s.dataset.seek + 1, true); } };
  }

  function close() {
    S.closed = true; pollAbort?.abort(); clearTimeout(playTimer); clearInterval(uiTimer); clearTimeout(snapTimer);
    $('verdict').classList.remove('on'); $('drawer').classList.add('hidden');
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
  route();
})();
document.addEventListener('visibilitychange', () => { stage?.setRunning(!document.hidden); });
