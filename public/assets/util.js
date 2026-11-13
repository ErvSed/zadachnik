/* Общие помощники: DOM, даты, иконки. */

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

const ICON_PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  comment: '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 5.2a3.5 3.5 0 0 1 0 6.6"/><path d="M18.5 14.4A6.5 6.5 0 0 1 22 20"/>',
  shield: '<path d="M12 3l8 3v6c0 4.4-3.2 7.8-8 9-4.8-1.2-8-4.6-8-9V6z"/>',
  logout: '<path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  alert: '<path d="M12 8v5"/><path d="M12 16.5v.01"/><circle cx="12" cy="12" r="9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  dots: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  flame: '<path d="M12 22c4 0 7-2.7 7-6.5 0-2.5-1.4-4.6-3-6.5-.7 1.2-1.5 2-2.6 2.6.3-2.6-.9-5.3-3.4-7.1.2 3-1.2 4.5-2.7 6.2C6.2 12 5 13.7 5 15.5 5 19.3 8 22 12 22Z"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
};

export function icon(name, cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  svg.innerHTML = ICON_PATHS[name] || '';
  return svg;
}

/** Логотип GitHub — заливка, а не обводка. */
export function githubIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.55v-2.1c-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.08 0 4.41-2.7 5.39-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .3.21.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z"/>';
  return svg;
}

/* ---------- даты ---------- */
const MONTHS = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

export function parseDateOnly(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function fmtDate(value, withYear = false) {
  const d = parseDateOnly(value);
  if (!d) return '';
  const showYear = withYear || d.getFullYear() !== new Date().getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${showYear ? ' ' + d.getFullYear() : ''}`;
}

export function fmtDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${fmtDate(dateStr, true)}, ${time}`;
}

export function dayDiff(dateStr) {
  const d = parseDateOnly(dateStr);
  if (!d) return null;
  return Math.round((d.getTime() - startOfToday().getTime()) / 86400000);
}

export function dueLabel(dateStr) {
  const diff = dayDiff(dateStr);
  if (diff === null) return '';
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === -1) return 'вчера';
  if (diff < 0) return `просрочено ${Math.abs(diff)} дн.`;
  if (diff <= 7) return `через ${diff} дн.`;
  return fmtDate(dateStr);
}

export function isOverdue(task) {
  if (!task || !task.dueDate || task.done || task.canceled) return false;
  const diff = dayDiff(task.dueDate);
  return diff !== null && diff < 0;
}

export function relTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  if (d.toDateString() === new Date().toDateString()) return `${Math.floor(min / 60)} ч назад`;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'вчера';
  return fmtDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}

export function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ---------- прочее ---------- */
export function initials(name) {
  const clean = String(name || '').trim();
  if (!clean) return '—';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function colorFor(name) {
  let hash = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return { background: `hsl(${hue} 70% 92%)`, color: `hsl(${hue} 55% 30%)` };
}

export function debounce(fn, wait = 160) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function truncate(text, max = 120) {
  const s = String(text || '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
