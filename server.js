'use strict';

/**
 * Задачник — сервер.
 * Node.js без внешних зависимостей: HTTP, JSON-база на диске, сессии в cookie.
 * Запуск: node server.js  (порт 3000, доступ из локальной сети)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const APP_DIR = __dirname;
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(APP_DIR, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY = 512 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
};

/* =========================================================
   База
   ========================================================= */
function emptyDb() {
  return { version: 1, users: [], sections: [], permissions: [], tasks: [], sessions: [] };
}

function normalizeDb(raw) {
  const db = emptyDb();
  if (!raw || typeof raw !== 'object') return db;
  for (const key of Object.keys(db)) {
    if (Array.isArray(raw[key])) db[key] = raw[key];
  }
  return db;
}

let db = loadDb();

function loadDb() {
  try {
    const text = fs.readFileSync(DB_FILE, 'utf8');
    return normalizeDb(JSON.parse(text));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Не удалось прочитать базу данных:', error.message);
    return emptyDb();
  }
}

function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

/* =========================================================
   Пароли и сессии
   ========================================================= */
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function checkPassword(password, user) {
  try {
    const hash = crypto.scryptSync(password, user.salt, 64);
    const stored = Buffer.from(user.hash, 'hex');
    return stored.length === hash.length && crypto.timingSafeEqual(hash, stored);
  } catch {
    return false;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function sessionCookie(token, maxAge) {
  return `sid=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie).sid;
  if (!token) return null;
  const session = db.sessions.find((s) => s.token === token);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    db.sessions = db.sessions.filter((s) => s.token !== token);
    saveDb();
    return null;
  }
  const user = db.users.find((u) => u.id === session.userId);
  if (!user || user.disabled) return null;
  return user;
}

function purgeSessions() {
  const now = Date.now();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
  if (db.sessions.length !== before) saveDb();
}

/* =========================================================
   Права
   ========================================================= */
const FULL = { read: true, create: true, edit: true };

function permsFor(user, sectionId) {
  if (user.role === 'admin') return { ...FULL };
  const p = db.permissions.find((x) => x.userId === user.id && x.sectionId === sectionId);
  const create = Boolean(p && p.create);
  const edit = Boolean(p && p.edit);
  return { read: Boolean(p && p.read) || create || edit, create, edit };
}

function canSeeSection(user, section) {
  if (user.role === 'admin') return true;
  if (section.createdBy === user.id) return true;
  const p = permsFor(user, section.id);
  return p.read || p.create || p.edit;
}

function visibleSections(user) {
  return db.sections
    .filter((section) => canSeeSection(user, section))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function sectionById(id) {
  return db.sections.find((s) => s.id === id) || null;
}

function taskById(id) {
  return db.tasks.find((t) => t.id === id) || null;
}

function publicUser(user) {
  return { id: user.id, login: user.login, name: user.name, role: user.role };
}

/* =========================================================
   HTTP-хелперы
   ========================================================= */
function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function fail(res, status, error) {
  sendJson(res, status, { error });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Слишком большой запрос'), { status: 413 }));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(Object.assign(new Error('Некорректный JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function textValue(value, { min = 0, max = 500, field = 'значение' } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < min) {
    throw Object.assign(new Error(`Поле «${field}» не заполнено`), { status: 400 });
  }
  if (text.length > max) {
    throw Object.assign(new Error(`Поле «${field}» слишком длинное (до ${max} символов)`), { status: 400 });
  }
  return text;
}

function dateValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw Object.assign(new Error('Некорректная дата'), { status: 400 });
  }
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) throw Object.assign(new Error('Некорректная дата'), { status: 400 });
  return value;
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) {
    fail(res, 401, 'Нужно войти в систему');
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    fail(res, 403, 'Недостаточно прав');
    return null;
  }
  return user;
}

function csrfOk(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  return String(req.headers['x-requested-with'] || '').toLowerCase() === 'fetch';
}

/* =========================================================
   API
   ========================================================= */
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;
  const route = parts.slice(1);

  if (!csrfOk(req)) return fail(res, 403, 'Запрос отклонён (CSRF)');

  /* --- сессия --- */
  if (route[0] === 'me' && method === 'GET') {
    const user = currentUser(req);
    const setup = db.users.length === 0;
    if (!user) return sendJson(res, 200, { setup, user: null, sections: [] });
    return sendJson(res, 200, {
      setup: false,
      user: publicUser(user),
      sections: sectionsForClient(user),
    });
  }

  if (route[0] === 'setup' && method === 'POST') {
    if (db.users.length > 0) return fail(res, 403, 'Система уже настроена');
    const body = await readJsonBody(req);
    const login = textValue(body.login, { min: 3, max: 32, field: 'Логин' }).toLowerCase();
    if (!/^[a-z0-9_.-]+$/.test(login)) return fail(res, 400, 'Логин: латиница, цифры, точка, дефис');
    const name = textValue(body.name, { min: 1, max: 80, field: 'Имя' });
    const password = textValue(body.password, { min: 6, max: 200, field: 'Пароль' });
    const { salt, hash } = hashPassword(password);
    const user = {
      id: newId('u'),
      login,
      name,
      role: 'admin',
      salt,
      hash,
      disabled: false,
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    const section = {
      id: newId('s'),
      name: 'Согласования с проектировщиками',
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    };
    db.sections.push(section);
    db.permissions.push({ userId: user.id, sectionId: section.id, ...FULL });
    saveDb();
    return startSession(req, res, user);
  }

  if (route[0] === 'login' && method === 'POST') {
    if (!allowLogin(req)) return fail(res, 429, 'Слишком много попыток входа. Подождите 15 минут.');
    const body = await readJsonBody(req);
    const login = String(body.login || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = db.users.find((u) => u.login === login);
    if (!user || user.disabled || !checkPassword(password, user)) {
      registerLoginFail(req);
      return fail(res, 401, 'Неверный логин или пароль');
    }
    clearLoginFails(req);
    return startSession(req, res, user);
  }

  if (route[0] === 'logout' && method === 'POST') {
    const token = parseCookies(req.headers.cookie).sid;
    if (token) {
      db.sessions = db.sessions.filter((s) => s.token !== token);
      saveDb();
    }
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  const user = requireUser(req, res);
  if (!user) return;

  /* --- разделы --- */
  if (route[0] === 'sections' && route.length === 1 && method === 'GET') {
    return sendJson(res, 200, { sections: sectionsForClient(user) });
  }

  if (route[0] === 'sections' && route.length === 1 && method === 'POST') {
    const body = await readJsonBody(req);
    const name = textValue(body.name, { min: 1, max: 120, field: 'Название раздела' });
    const section = {
      id: newId('s'),
      name,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    };
    db.sections.push(section);
    db.permissions.push({ userId: user.id, sectionId: section.id, ...FULL });
    if (user.role === 'admin') {
      // админ и так видит всё
    }
    saveDb();
    return sendJson(res, 201, { section: sectionForClient(user, section) });
  }

  if (route[0] === 'sections' && route.length === 2 && method === 'PATCH') {
    const section = sectionById(route[1]);
    if (!section) return fail(res, 404, 'Раздел не найден');
    if (user.role !== 'admin' && section.createdBy !== user.id) return fail(res, 403, 'Недостаточно прав');
    const body = await readJsonBody(req);
    section.name = textValue(body.name, { min: 1, max: 120, field: 'Название раздела' });
    saveDb();
    return sendJson(res, 200, { section: sectionForClient(user, section) });
  }

  if (route[0] === 'sections' && route.length === 2 && method === 'DELETE') {
    const section = sectionById(route[1]);
    if (!section) return fail(res, 404, 'Раздел не найден');
    if (user.role !== 'admin') return fail(res, 403, 'Удалять разделы может администратор');
    db.sections = db.sections.filter((s) => s.id !== section.id);
    db.permissions = db.permissions.filter((p) => p.sectionId !== section.id);
    db.tasks = db.tasks.filter((t) => t.sectionId !== section.id);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  /* --- задачи --- */
  if (route[0] === 'sections' && route.length === 3 && route[2] === 'tasks' && method === 'GET') {
    const section = sectionById(route[1]);
    if (!section) return fail(res, 404, 'Раздел не найден');
    const perms = permsFor(user, section.id);
    if (!perms.read && !perms.create && !perms.edit) return fail(res, 403, 'Нет доступа к разделу');
    const tasks = db.tasks
      .filter((t) => t.sectionId === section.id)
      .sort(compareTasks);
    return sendJson(res, 200, { tasks });
  }

  if (route[0] === 'sections' && route.length === 3 && route[2] === 'tasks' && method === 'POST') {
    const section = sectionById(route[1]);
    if (!section) return fail(res, 404, 'Раздел не найден');
    if (!permsFor(user, section.id).create) return fail(res, 403, 'Нет права создавать задачи в этом разделе');
    const body = await readJsonBody(req);
    const title = textValue(body.title, { min: 1, max: 300, field: 'Задача' });
    const dueDate = dateValue(body.dueDate);
    const now = new Date().toISOString();
    const task = {
      id: newId('t'),
      sectionId: section.id,
      title,
      dueDate,
      done: false,
      accepted: false,
      doneAt: null,
      doneBy: null,
      acceptedAt: null,
      acceptedBy: null,
      comments: [],
      createdBy: user.id,
      createdByName: user.name,
      createdAt: now,
      updatedAt: now,
    };
    db.tasks.push(task);
    saveDb();
    return sendJson(res, 201, { task });
  }

  if (route[0] === 'tasks' && route.length === 2) {
    const task = taskById(route[1]);
    if (!task) return fail(res, 404, 'Задача не найдена');
    const perms = permsFor(user, task.sectionId);

    if (method === 'PATCH') {
      if (!perms.edit) return fail(res, 403, 'Нет права редактировать задачи в этом разделе');
      const body = await readJsonBody(req);
      if (body.title !== undefined) {
        task.title = textValue(body.title, { min: 1, max: 300, field: 'Задача' });
      }
      if (body.dueDate !== undefined) {
        task.dueDate = dateValue(body.dueDate);
      }
      if (body.done !== undefined) {
        task.done = Boolean(body.done);
        task.doneAt = task.done ? new Date().toISOString() : null;
        task.doneBy = task.done ? user.name : null;
      }
      if (body.accepted !== undefined) {
        task.accepted = Boolean(body.accepted);
        task.acceptedAt = task.accepted ? new Date().toISOString() : null;
        task.acceptedBy = task.accepted ? user.name : null;
      }
      task.updatedAt = new Date().toISOString();
      saveDb();
      return sendJson(res, 200, { task });
    }

    if (method === 'DELETE') {
      if (!perms.edit) return fail(res, 403, 'Нет права удалять задачи в этом разделе');
      db.tasks = db.tasks.filter((t) => t.id !== task.id);
      saveDb();
      return sendJson(res, 200, { ok: true });
    }
  }

  if (route[0] === 'tasks' && route.length === 3 && route[2] === 'comments' && method === 'POST') {
    const task = taskById(route[1]);
    if (!task) return fail(res, 404, 'Задача не найдена');
    if (!permsFor(user, task.sectionId).edit) return fail(res, 403, 'Нет права комментировать в этом разделе');
    const body = await readJsonBody(req);
    const text = textValue(body.text, { min: 1, max: 2000, field: 'Комментарий' });
    const comment = {
      id: newId('c'),
      text,
      authorId: user.id,
      authorName: user.name,
      createdAt: new Date().toISOString(),
    };
    task.comments.push(comment);
    task.updatedAt = comment.createdAt;
    saveDb();
    return sendJson(res, 201, { comment, task });
  }

  if (route[0] === 'tasks' && route.length === 4 && route[2] === 'comments' && method === 'DELETE') {
    const task = taskById(route[1]);
    if (!task) return fail(res, 404, 'Задача не найдена');
    const comment = task.comments.find((c) => c.id === route[3]);
    if (!comment) return fail(res, 404, 'Комментарий не найден');
    const canDelete = user.role === 'admin' || comment.authorId === user.id || permsFor(user, task.sectionId).edit;
    if (!canDelete) return fail(res, 403, 'Недостаточно прав');
    task.comments = task.comments.filter((c) => c.id !== comment.id);
    task.updatedAt = new Date().toISOString();
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  /* --- пользователи (админ) --- */
  if (route[0] === 'users' && route.length === 1 && method === 'GET') {
    if (user.role !== 'admin') return fail(res, 403, 'Недостаточно прав');
    return sendJson(res, 200, {
      users: db.users.map((u) => ({
        id: u.id,
        login: u.login,
        name: u.name,
        role: u.role,
        disabled: Boolean(u.disabled),
        createdAt: u.createdAt,
        permissions: db.permissions
          .filter((p) => p.userId === u.id)
          .map((p) => ({ sectionId: p.sectionId, read: p.read, create: p.create, edit: p.edit })),
      })),
      sections: db.sections.map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt })),
    });
  }

  if (route[0] === 'users' && route.length === 1 && method === 'POST') {
    if (user.role !== 'admin') return fail(res, 403, 'Недостаточно прав');
    const body = await readJsonBody(req);
    const login = textValue(body.login, { min: 3, max: 32, field: 'Логин' }).toLowerCase();
    if (!/^[a-z0-9_.-]+$/.test(login)) return fail(res, 400, 'Логин: латиница, цифры, точка, дефис');
    if (db.users.some((u) => u.login === login)) return fail(res, 409, 'Такой логин уже занят');
    const name = textValue(body.name, { min: 1, max: 80, field: 'Имя' });
    const password = textValue(body.password, { min: 6, max: 200, field: 'Пароль' });
    const role = body.role === 'admin' ? 'admin' : 'user';
    const { salt, hash } = hashPassword(password);
    const created = {
      id: newId('u'),
      login,
      name,
      role,
      salt,
      hash,
      disabled: false,
      createdAt: new Date().toISOString(),
    };
    db.users.push(created);
    saveDb();
    return sendJson(res, 201, { user: publicUser(created) });
  }

  if (route[0] === 'users' && route.length === 2 && method === 'PATCH') {
    if (user.role !== 'admin') return fail(res, 403, 'Недостаточно прав');
    const target = db.users.find((u) => u.id === route[1]);
    if (!target) return fail(res, 404, 'Пользователь не найден');
    const body = await readJsonBody(req);
    if (body.disabled !== undefined && Boolean(body.disabled) && target.id === user.id) {
      return fail(res, 400, 'Нельзя отключить самого себя');
    }
    const otherAdmins = db.users.filter((u) => u.role === 'admin' && !u.disabled && u.id !== target.id).length;
    if (target.role === 'admin' && otherAdmins === 0) {
      if (body.role === 'user' || body.disabled) return fail(res, 400, 'В системе должен остаться хотя бы один администратор');
    }
    if (body.name !== undefined) target.name = textValue(body.name, { min: 1, max: 80, field: 'Имя' });
    if (body.role !== undefined) target.role = body.role === 'admin' ? 'admin' : 'user';
    if (body.disabled !== undefined) target.disabled = Boolean(body.disabled);
    if (body.password) {
      const password = textValue(body.password, { min: 6, max: 200, field: 'Пароль' });
      const { salt, hash } = hashPassword(password);
      target.salt = salt;
      target.hash = hash;
      db.sessions = db.sessions.filter((s) => s.userId !== target.id);
    }
    saveDb();
    return sendJson(res, 200, { user: publicUser(target) });
  }

  if (route[0] === 'users' && route.length === 2 && method === 'DELETE') {
    if (user.role !== 'admin') return fail(res, 403, 'Недостаточно прав');
    if (route[1] === user.id) return fail(res, 400, 'Нельзя удалить самого себя');
    const target = db.users.find((u) => u.id === route[1]);
    if (!target) return fail(res, 404, 'Пользователь не найден');
    db.users = db.users.filter((u) => u.id !== target.id);
    db.permissions = db.permissions.filter((p) => p.userId !== target.id);
    db.sessions = db.sessions.filter((s) => s.userId !== target.id);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  if (route[0] === 'users' && route.length === 3 && route[2] === 'permissions' && method === 'PUT') {
    if (user.role !== 'admin') return fail(res, 403, 'Недостаточно прав');
    const target = db.users.find((u) => u.id === route[1]);
    if (!target) return fail(res, 404, 'Пользователь не найден');
    const body = await readJsonBody(req);
    if (!Array.isArray(body.permissions)) return fail(res, 400, 'Некорректный список прав');
    const sectionIds = new Set(db.sections.map((s) => s.id));
    const cleaned = [];
    for (const item of body.permissions) {
      if (!item || !sectionIds.has(item.sectionId)) continue;
      const read = Boolean(item.read);
      const create = Boolean(item.create);
      const edit = Boolean(item.edit);
      if (!read && !create && !edit) continue;
      cleaned.push({
        userId: target.id,
        sectionId: item.sectionId,
        read: read || create || edit,
        create,
        edit,
      });
    }
    db.permissions = db.permissions.filter((p) => p.userId !== target.id);
    db.permissions.push(...cleaned);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  return fail(res, 404, 'Метод не найден');
}

function compareTasks(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const ad = a.dueDate || '9999-12-31';
  const bd = b.dueDate || '9999-12-31';
  if (ad !== bd) return ad < bd ? -1 : 1;
  return a.createdAt < b.createdAt ? 1 : -1;
}

function sectionForClient(user, section) {
  const perms = permsFor(user, section.id);
  const tasks = db.tasks.filter((t) => t.sectionId === section.id);
  return {
    id: section.id,
    name: section.name,
    createdBy: section.createdBy,
    createdAt: section.createdAt,
    can: perms,
    taskCount: tasks.length,
    openCount: tasks.filter((t) => !t.done).length,
  };
}

function sectionsForClient(user) {
  return visibleSections(user).map((section) => sectionForClient(user, section));
}

function startSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL).toISOString();
  db.sessions.push({ token, userId: user.id, expiresAt: expires });
  purgeSessions();
  saveDb();
  const secure = req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket.encrypted);
  const cookie = sessionCookie(token, Math.floor(SESSION_TTL / 1000)) + (secure ? '; Secure' : '');
  return sendJson(
    res,
    200,
    { user: publicUser(user), sections: sectionsForClient(user) },
    { 'Set-Cookie': cookie },
  );
}

/* --- защита от перебора пароля --- */
const loginFails = new Map();

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function allowLogin(req) {
  const key = clientIp(req);
  const entry = loginFails.get(key);
  if (!entry) return true;
  if (Date.now() > entry.resetAt) {
    loginFails.delete(key);
    return true;
  }
  return entry.count < 20;
}

function registerLoginFail(req) {
  const key = clientIp(req);
  const entry = loginFails.get(key) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
  entry.count += 1;
  loginFails.set(key, entry);
}

function clearLoginFails(req) {
  loginFails.delete(clientIp(req));
}

/* =========================================================
   Статика
   ========================================================= */
function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Не найдено');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'",
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
}

/* =========================================================
   Сервер
   ========================================================= */
const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  res.on('finish', () => {
    if (url.pathname.startsWith('/api/')) {
      console.log(`${req.method} ${url.pathname} → ${res.statusCode} (${Date.now() - started} мс)`);
    }
  });

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(req, res, url);
    } else {
      res.writeHead(405);
      res.end('Method Not Allowed');
    }
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    if (!res.headersSent) fail(res, status, error.message || 'Внутренняя ошибка');
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  console.log('');
  console.log('  Задачник запущен');
  console.log(`  Локально:  http://localhost:${PORT}`);
  for (const address of addresses) console.log(`  В сети:    http://${address}:${PORT}`);
  console.log(`  База:      ${DB_FILE}`);
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\nОстановка сервера…');
  saveDb();
  process.exit(0);
});
process.on('SIGTERM', () => {
  saveDb();
  process.exit(0);
});
