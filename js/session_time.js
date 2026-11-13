// Pure Asia/Shanghai session time normalization, selection, formatting, and sorting.

export const TZ_SHANGHAI = 'Asia/Shanghai';

const ACTIVE_STATES = new Set(['running', 'allocating', 'starting', 'judging']);
const NUMERIC_RE = /^[+-]?\d+(?:\.\d+)?$/;
const ISO_EXPLICIT_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})$/i;
const NAIVE_DATE_RE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s]+\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;

const FMT_MD_HM = new Intl.DateTimeFormat('zh-CN', {
  timeZone: TZ_SHANGHAI,
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const FMT_YMD = new Intl.DateTimeFormat('zh-CN', {
  timeZone: TZ_SHANGHAI,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

const FMT_HM = new Intl.DateTimeFormat('zh-CN', {
  timeZone: TZ_SHANGHAI,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function partsMap(fmt, ms) {
  const out = {};
  for (const p of fmt.formatToParts(ms)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return out;
}

/**
 * Normalize epoch seconds, epoch milliseconds, numeric strings, or ISO-8601 strings
 * with explicit timezone offset (`Z` or `±HH:MM` / `±HHMM`) to UTC epoch milliseconds.
 * Rejects missing, invalid, and timezone-less (naive) date strings without guessing.
 */
export function parseTimestamp(input) {
  if (input === null || input === undefined || input === '' || typeof input === 'boolean') {
    return { ok: false, ms: null, reason: 'missing' };
  }
  if (input instanceof Date) {
    const t = input.getTime();
    return Number.isFinite(t) ? { ok: true, ms: t, reason: null } : { ok: false, ms: null, reason: 'invalid' };
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { ok: false, ms: null, reason: 'invalid' };
    if (input === 0) return { ok: false, ms: null, reason: 'missing' };
    if (input < 0) return { ok: false, ms: null, reason: 'invalid' };
    const ms = Math.abs(input) < 1e12 ? Math.round(input * 1000) : Math.round(input);
    return { ok: true, ms, reason: null };
  }
  if (typeof input !== 'string') {
    return { ok: false, ms: null, reason: 'invalid' };
  }
  const s = input.trim();
  if (!s) return { ok: false, ms: null, reason: 'missing' };

  if (NUMERIC_RE.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return { ok: false, ms: null, reason: 'invalid' };
    if (n === 0) return { ok: false, ms: null, reason: 'missing' };
    if (n < 0) return { ok: false, ms: null, reason: 'invalid' };
    const ms = Math.abs(n) < 1e12 ? Math.round(n * 1000) : Math.round(n);
    return { ok: true, ms, reason: null };
  }

  const m = ISO_EXPLICIT_RE.exec(s);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = m[6] ? Number(m[6]) : 0;
    const msPart = m[7] ? Number(m[7].padEnd(3, '0').slice(0, 3)) : 0;
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
      return { ok: false, ms: null, reason: 'invalid' };
    }
    const utcWall = Date.UTC(year, month - 1, day, hour, minute, second, msPart);
    const check = new Date(utcWall);
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day ||
      check.getUTCHours() !== hour ||
      check.getUTCMinutes() !== minute ||
      check.getUTCSeconds() !== second
    ) {
      return { ok: false, ms: null, reason: 'invalid' };
    }
    let offsetMin = 0;
    const tz = m[8];
    if (tz.toUpperCase() !== 'Z') {
      const sign = tz[0] === '-' ? -1 : 1;
      const digits = tz.slice(1).replace(':', '');
      const oh = Number(digits.slice(0, 2));
      const om = Number(digits.slice(2, 4));
      if (oh > 23 || om > 59) return { ok: false, ms: null, reason: 'invalid' };
      offsetMin = sign * (oh * 60 + om);
    }
    return { ok: true, ms: utcWall - offsetMin * 60000, reason: null };
  }

  if (NAIVE_DATE_RE.test(s)) {
    return { ok: false, ms: null, reason: 'ambiguous' };
  }
  return { ok: false, ms: null, reason: 'invalid' };
}

/** Format timestamp as `M/D HH:mm` in Asia/Shanghai. */
export function formatAsiaShanghai(input) {
  const p = parseTimestamp(input);
  if (!p.ok) return '';
  const parts = partsMap(FMT_MD_HM, p.ms);
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

/** Format timestamp as `YYYY/M/D` in Asia/Shanghai. */
export function formatDateAsiaShanghai(input) {
  const p = parseTimestamp(input);
  if (!p.ok) return '';
  const parts = partsMap(FMT_YMD, p.ms);
  return `${parts.year}/${parts.month}/${parts.day}`;
}

/** Format timestamp as `HH:mm` in Asia/Shanghai. */
export function formatClockAsiaShanghai(input) {
  const p = parseTimestamp(input);
  if (!p.ok) return '';
  const parts = partsMap(FMT_HM, p.ms);
  return `${parts.hour}:${parts.minute}`;
}

function statusTextFor(kind, reason) {
  const prefix = kind === 'started' ? '开始时间' : '结束时间';
  if (reason === 'loading') return `${prefix}读取中…`;
  if (reason === 'invalid') return `${prefix}无效`;
  if (reason === 'ambiguous') return `${prefix}时区不明`;
  if (reason === 'future') return `${prefix}异常（未来时间）`;
  return `${prefix}未知`;
}

/** Format relative time from `nowInput` in Asia/Shanghai, preserving hour+minute granularity under 24h. */
export function formatRelativeAsiaShanghai(input, nowInput = Date.now()) {
  const p = parseTimestamp(input);
  if (!p.ok) return { ok: false, ms: null, reason: p.reason, text: statusTextFor('ended', p.reason) };
  const nowP = parseTimestamp(nowInput);
  const nowMs = nowP.ok ? nowP.ms : Date.now();
  const diffMs = nowMs - p.ms;
  if (diffMs < 0) return { ok: false, ms: p.ms, reason: 'future', text: '未来时间' };

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return { ok: true, ms: p.ms, reason: null, text: '刚刚' };
  const totalMin = Math.floor(diffSec / 60);
  if (totalMin < 60) return { ok: true, ms: p.ms, reason: null, text: `${totalMin} 分钟前` };
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours < 24) {
    return {
      ok: true,
      ms: p.ms,
      reason: null,
      text: mins > 0 ? `${hours} 小时 ${mins} 分钟前` : `${hours} 小时前`,
    };
  }
  return { ok: true, ms: p.ms, reason: null, text: formatDateAsiaShanghai(p.ms) };
}

function explicitEndedCandidate(session, meta) {
  const candidates = [
    ['verdict.decided_at', meta?.verdict?.decided_at],
    ['verdict.decided_at', meta?.decided_at],
    ['verdict.decided_at', session?.verdict?.decided_at],
    ['verdict.decided_at', session?.verdict_decided_at],
    ['verdict.decided_at', session?.decided_at],
    ['ended_at', meta?.ended_at],
    ['ended_ms', meta?.ended_ms],
    ['finished_at', meta?.finished_at],
    ['finished_ms', meta?.finished_ms],
    ['ended_at', session?.ended_at],
    ['ended_ms', session?.ended_ms],
    ['finished_at', session?.finished_at],
    ['finished_ms', session?.finished_ms],
  ];
  for (const [source, val] of candidates) {
    if (val !== undefined && val !== null && val !== '') return [source, val];
  }
  return ['none', null];
}

export function hasAuthoritativeEndField(session) {
  const [source] = explicitEndedCandidate(session, null);
  return source !== 'none';
}

/**
 * Unified semantic time selector shared by the Home "最近结束" card and session list.
 * Never disguises `created_ms` or `updated_ms` as an ended timestamp.
 */
export function selectSessionTime(session, meta = null, nowInput = Date.now()) {
  const active = ACTIVE_STATES.has(session?.state);
  const nowP = parseTimestamp(nowInput);
  const nowMs = nowP.ok ? nowP.ms : Date.now();
  const createdParsed = parseTimestamp(session?.created_ms ?? session?.started_ms ?? meta?.created_ms);
  const updatedParsed = parseTimestamp(session?.updated_ms);
  const createdAbsText = createdParsed.ok && createdParsed.ms <= nowMs ? formatAsiaShanghai(createdParsed.ms) : '';

  if (active) {
    if (!createdParsed.ok) {
      const statusText = statusTextFor('started', createdParsed.reason);
      return {
        kind: 'started',
        active: true,
        status: createdParsed.reason,
        source: 'created_ms',
        ms: null,
        absText: statusText,
        relText: statusText,
        statusText,
        cardLabel: `进行中 · ${statusText}`,
        listText: statusText,
        createdAbsText: '',
        sortMs: updatedParsed.ok ? updatedParsed.ms : 0,
      };
    }
    if (createdParsed.ms > nowMs) {
      const statusText = statusTextFor('started', 'future');
      return {
        kind: 'started',
        active: true,
        status: 'future',
        source: 'created_ms',
        ms: null,
        absText: statusText,
        relText: statusText,
        statusText,
        cardLabel: `进行中 · ${statusText}`,
        listText: statusText,
        createdAbsText: '',
        sortMs: 0,
      };
    }
    const absText = formatAsiaShanghai(createdParsed.ms);
    const relText = formatRelativeAsiaShanghai(createdParsed.ms, nowMs).text;
    return {
      kind: 'started',
      active: true,
      status: 'ok',
      source: 'created_ms',
      ms: createdParsed.ms,
      absText,
      relText,
      statusText: '',
      cardLabel: `进行中 · 开始于 ${absText}（${relText}）`,
      listText: `开始于 ${absText}（${relText}）`,
      createdAbsText: absText,
      sortMs: createdParsed.ms,
    };
  }

  const [source, rawEnd] = explicitEndedCandidate(session, meta);
  if (source === 'none') {
    const reason = meta?._loading ? 'loading' : 'missing';
    const statusText = statusTextFor('ended', reason);
    return {
      kind: 'ended',
      active: false,
      status: reason,
      source: 'none',
      ms: null,
      absText: statusText,
      relText: statusText,
      statusText,
      cardLabel: `最近结束 · ${statusText}`,
      listText: statusText,
      createdAbsText,
      sortMs: createdParsed.ok ? createdParsed.ms : (updatedParsed.ok ? updatedParsed.ms : 0),
    };
  }

  const parsedEnd = parseTimestamp(rawEnd);
  if (!parsedEnd.ok) {
    const statusText = statusTextFor('ended', parsedEnd.reason);
    return {
      kind: 'ended',
      active: false,
      status: parsedEnd.reason,
      source,
      ms: null,
      absText: statusText,
      relText: statusText,
      statusText,
      cardLabel: `最近结束 · ${statusText}`,
      listText: statusText,
      createdAbsText,
      sortMs: createdParsed.ok ? createdParsed.ms : (updatedParsed.ok ? updatedParsed.ms : 0),
    };
  }

  if (parsedEnd.ms > nowMs) {
    const statusText = statusTextFor('ended', 'future');
    return {
      kind: 'ended',
      active: false,
      status: 'future',
      source,
      ms: null,
      absText: statusText,
      relText: statusText,
      statusText,
      cardLabel: `最近结束 · ${statusText}`,
      listText: statusText,
      createdAbsText,
      sortMs: createdParsed.ok ? createdParsed.ms : 0,
    };
  }

  const absText = formatAsiaShanghai(parsedEnd.ms);
  const relText = formatRelativeAsiaShanghai(parsedEnd.ms, nowMs).text;
  return {
    kind: 'ended',
    active: false,
    status: 'ok',
    source,
    ms: parsedEnd.ms,
    absText,
    relText,
    statusText: '',
    cardLabel: `最近结束 · ${absText}（${relText}）`,
    listText: `结束于 ${absText}（${relText}）`,
    createdAbsText,
    sortMs: parsedEnd.ms,
  };
}

/** Sort sessions consistently by active state and authoritative semantic timestamps. */
export function sortSessionsByTime(list, getMeta = null, nowInput = Date.now()) {
  const resolveMeta = typeof getMeta === 'function' ? getMeta : () => null;
  return [...(list || [])]
    .map((s, idx) => ({ s, idx, t: selectSessionTime(s, resolveMeta(s), nowInput) }))
    .sort((a, b) => {
      if (a.t.active !== b.t.active) return a.t.active ? -1 : 1;
      const aKnown = a.t.status === 'ok';
      const bKnown = b.t.status === 'ok';
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      if (b.t.sortMs !== a.t.sortMs) return b.t.sortMs - a.t.sortMs;
      return a.idx - b.idx;
    })
    .map((x) => x.s);
}
