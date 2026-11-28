/**
 * [INPUT]: 依赖 api.js 读取 SQLite 后端。
 * [OUTPUT]: 导出 loadIndex、loadEvents、loadSearchIndex、loadWork、loadPerformance、
 *           loadEnsembles、loadEnsemble、loadVenues、loadVenue、getUpcoming、getPast、
 *           eventsForWork、formatDateParts、formatDateLong、formatMonth、formatUpdated、
 *           localToday、relativeDay、eventPeople、ensembleText、performanceTitle、pinyinCompare、
 *           pinyinInitial、groupByPinyinInitial、deletePerformance、deleteWork、deleteEnsemble、deleteVenue、clearDataCache、loadHealth。
 * [POS]: 站点唯一的数据访问层。它把 API 的演出对象归一化成视图可消费的形状，
 *        多乐团保留 ensembles 数组，同时把首个乐团写回 ensemble 兼容旧视图；
 *        并集中处理日期边界；视图不直接 fetch，也不自己判断“未来演出”。
 * [PROTOCOL]: Update this header on change, then check CLAUDE.md
 */

import { api } from './api.js';

const cache = new Map();

function remember(key, factory) {
  if (!cache.has(key)) {
    const pending = factory().catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, pending);
  }
  return cache.get(key);
}

/** 清空 API 缓存；写操作成功后由 app.js 调用，让下一次渲染重新取数。 */
export function loadHealth() {
  return api.health();
}

/** 删除演出后清空缓存，下一次页面渲染重新取数。 */
export function deletePerformance(id) {
  return api.deletePerformance(id).then((data) => {
    clearDataCache();
    return data;
  });
}

/** 删除曲目；仍被演出引用时服务端会拒绝。 */
export function deleteWork(slug) {
  return api.deleteWork(slug).then((data) => {
    clearDataCache();
    return data;
  });
}

/** 删除乐团；仍被演出引用时服务端会拒绝。 */
export function deleteEnsemble(slug) {
  return api.deleteEnsemble(slug).then((data) => {
    clearDataCache();
    return data;
  });
}

/** 删除场馆；仍被演出引用时服务端会拒绝。 */
export function deleteVenue(slug) {
  return api.deleteVenue(slug).then((data) => {
    clearDataCache();
    return data;
  });
}

export function clearDataCache() {
  cache.clear();
}

export function loadIndex() {
  return remember('works', () => api.works().then((data) => ({
    works: data.items || [],
    updated: data.meta?.updated || '',
    demo: Boolean(data.meta?.demo),
  })));
}

export function loadEvents() {
  return remember('events', () => api.performances().then((data) => ({
    events: (data.items || []).map(normalizePerformance),
    updated: data.meta?.updated || '',
    demo: Boolean(data.meta?.demo),
  })));
}

export function loadSearchIndex() {
  return remember('search', () => api.searchIndex().then((data) => ({
    docs: data.docs || [],
  })));
}

export function loadWork(slug) {
  return remember(`work:${slug}`, () => api.work(slug).then((data) => data.item));
}

export function loadPerformance(id) {
  return remember(`performance:${id}`, () => api.performance(id).then((data) => ({
    event: data.item ? normalizePerformance(data.item) : null,
    updated: data.meta?.updated || '',
    demo: Boolean(data.meta?.demo),
  })));
}

export function loadEnsembles() {
  return remember('ensembles', () => api.ensembles().then((data) => ({
    ensembles: data.items || [],
    updated: data.meta?.updated || '',
    demo: Boolean(data.meta?.demo),
  })));
}

export function loadEnsemble(slug) {
  return remember(`ensemble:${slug}`, () => api.ensemble(slug).then((data) => {
    const item = data.item || {};
    return {
      ...item,
      updated: data.meta?.updated || '',
      demo: Boolean(data.meta?.demo),
      performances: (item.performances || []).map(normalizePerformance),
    };
  }));
}

export function loadVenues() {
  return remember('venues', () => api.venues().then((data) => ({
    venues: data.items || [],
    updated: data.meta?.updated || '',
    demo: Boolean(data.meta?.demo),
  })));
}

export function loadVenue(slug) {
  return remember(`venue:${slug}`, () => api.venue(slug).then((data) => {
    const item = data.item || {};
    return {
      ...item,
      updated: data.meta?.updated || '',
      demo: Boolean(data.meta?.demo),
      performances: (item.performances || []).map(normalizePerformance),
    };
  }));
}

/**
 * API 的演出对象带嵌套的 ensemble / venue / works。这里把它压平，
 * 同时保留 workItems 与 *Slug 字段，供新的乐团/场馆链接使用。
 */
function normalizePerformance(performance) {
  const venue = performance.venue || null;
  const sourceEnsembles = Array.isArray(performance.ensembles) && performance.ensembles.length
    ? performance.ensembles
    : performance.ensemble ? [performance.ensemble] : [];
  const ensembles = sourceEnsembles
    .filter((item) => item && item.name)
    .map((item) => ({
      id: item.id,
      slug: item.slug || '',
      name: item.name,
      city: item.city || '',
      country: item.country || '',
    }));
  const ensemble = ensembles[0] || null;
  const works = Array.isArray(performance.works) ? performance.works : [];

  return {
    ...performance,
    ensembles,
    ensemble: ensemble?.name || '',
    ensembleSlug: ensemble?.slug || '',
    ensembleCity: ensemble?.city || '',
    venue: venue?.name || '',
    venueSlug: venue?.slug || '',
    city: venue?.city || '',
    country: venue?.country || '',
    works: works.map((work) => work.slug),
    workItems: works,
  };
}

/** 多乐团显示文本：按 API 顺序用 | 连接；旧数据回退到单乐团字段。 */
export function ensembleText(event) {
  const list = Array.isArray(event?.ensembles) ? event.ensembles : [];
  if (list.length) return list.map((item) => item?.name).filter(Boolean).join(' | ');
  return typeof event?.ensemble === 'string' ? event.ensemble.trim() : '';
}

/* 日期与演出 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const pinyinCollator = new Intl.Collator('zh-Hans-u-co-pinyin', {
  numeric: true,
  sensitivity: 'base',
});

/** 中文名统一按拼音排序；曲目、乐团、场馆共用同一把尺。 */
export function pinyinCompare(a, b) {
  return pinyinCollator.compare(String(a ?? ''), String(b ?? ''));
}

/*
 * 每个拼音首段取一个最小音节做边界。中文名的首个汉字落在相邻边界之间时，
 * 就归入前一个字母；这样无需引入拼音词典，也能把 ICU 的拼音排序折成 A–Z 分区。
 */
const INITIAL_BOUNDARIES = [
  ['A', '阿'], ['B', '八'], ['C', '擦'], ['D', '搭'], ['E', '鹅'], ['F', '发'],
  ['G', '噶'], ['H', '哈'], ['J', '击'], ['K', '喀'], ['L', '拉'], ['M', '妈'],
  ['N', '拿'], ['O', '哦'], ['P', '啪'], ['Q', '期'], ['R', '然'], ['S', '撒'],
  ['T', '塌'], ['W', '挖'], ['X', '昔'], ['Y', '压'], ['Z', '匝'],
];

const hanPattern = /^\p{Script=Han}$/u;
const markPattern = /\p{M}/gu;

/** 名称的拼音首字母：A–Z；拉丁字母取首字母；无法判断时归入 #。 */
export function pinyinInitial(value) {
  const text = String(value ?? '').trim();
  if (!text) return '#';

  const first = [...text][0];
  if (hanPattern.test(first)) {
    let letter = '#';
    for (const [key, anchor] of INITIAL_BOUNDARIES) {
      if (pinyinCollator.compare(text, anchor) >= 0) letter = key;
      else break;
    }
    return letter;
  }

  const latin = first.normalize('NFD').replace(markPattern, '').toUpperCase();
  return /^[A-Z]$/.test(latin) ? latin : '#';
}

/** 按拼音首字母分组；组内保持传入顺序，字母 A–Z 升序，# 最后。 */
export function groupByPinyinInitial(
  items,
  getName = (item) => (typeof item === 'string' ? item : item?.name),
) {
  const groups = new Map();
  for (const item of items) {
    const letter = pinyinInitial(getName(item));
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(item);
  }

  return [...groups.entries()]
    .map(([letter, list]) => ({ letter, items: list }))
    .sort((a, b) => {
      if (a.letter === b.letter) return 0;
      if (a.letter === '#') return 1;
      if (b.letter === '#') return -1;
      return a.letter.localeCompare(b.letter);
    });
}

/**
 * 演出的显示名：优先用入库的 title，否则用“乐团 · 场次说明”。
 * 页面主标题、日历卡片、曲目页与实体页的场次行都调用它。
 */
export function performanceTitle(event) {
  const title = String(event?.title || '').trim();
  if (title) return title;
  const note = String(event?.note || '').trim();
  const ensemble = ensembleText(event);
  if (ensemble && note) return `${ensemble} · ${note}`;
  if (note) return note;
  if (ensemble) return `${ensemble} 音乐会`;
  return event?.venue ? `${event.venue} 音乐会` : '音乐会';
}

function parseLocalDate(date) {
  const [year, month, day] = String(date || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  const value = new Date(year, month - 1, day);
  if (Number.isNaN(value.getTime())) return null;
  return value;
}

export function localToday(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function eventKey(event) {
  return `${event.date || ''}T${event.time || '00:00'}`;
}

export function getUpcoming(events, today = localToday()) {
  return events
    .filter((event) => String(event.date || '') >= today)
    .sort((a, b) => eventKey(a).localeCompare(eventKey(b)));
}

export function getPast(events, today = localToday()) {
  return events
    .filter((event) => String(event.date || '') < today)
    .sort((a, b) => eventKey(b).localeCompare(eventKey(a)));
}

export function eventsForWork(events, slug) {
  return events.filter((event) => Array.isArray(event.works) && event.works.includes(slug));
}

export function formatDateParts(date) {
  const value = parseLocalDate(date);
  if (!value) return { year: '', month: '', day: '', weekday: '' };
  return {
    year: String(value.getFullYear()),
    month: String(value.getMonth() + 1).padStart(2, '0'),
    day: String(value.getDate()).padStart(2, '0'),
    weekday: WEEKDAYS[value.getDay()],
  };
}

export function formatDateLong(date) {
  const parts = formatDateParts(date);
  if (!parts.year) return '';
  return `${parts.year} 年 ${Number(parts.month)} 月 ${Number(parts.day)} 日 · ${parts.weekday}`;
}

export function formatMonth(monthKey) {
  const [year, month] = String(monthKey).split('-');
  if (!year || !month) return monthKey;
  return `${year} 年 ${Number(month)} 月`;
}

export function formatUpdated(date) {
  const parts = formatDateParts(date);
  if (!parts.year) return '';
  return `${parts.year}.${parts.month}.${parts.day}`;
}

export function relativeDay(date, today = localToday()) {
  const target = parseLocalDate(date);
  const base = parseLocalDate(today);
  if (!target || !base) return '';
  const diff = Math.round((target - base) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  return '';
}

export function eventPeople(event, options = {}) {
  const parts = [];
  if (options.withEnsemble !== false) {
    const ensembles = ensembleText(event);
    if (ensembles) parts.push(ensembles);
  }
  for (const person of event.soloists || []) {
    if (!person || !person.role) continue;
    parts.push(`${person.role} ${person.name || '待定'}`);
  }
  return parts.join(' · ');
}
