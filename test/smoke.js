'use strict';

/**
 * Дымовой тест API: поднимает сервер на временной базе и проверяет
 * основные сценарии — первый запуск, разделы, задачи, права, комментарии.
 *
 * Запуск: node test/smoke.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 3399;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data');

let passed = 0;
let failed = 0;

function check(name, condition, info = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✘ ${name} ${info}`);
  }
}

function makeClient() {
  let cookie = '';
  return async function request(route, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(BASE + route, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'fetch',
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    if (setCookies.length) cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
  };
}

async function waitForServer(timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/me`);
      if (res.ok) return true;
    } catch {
      /* сервер ещё поднимается */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function main() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });

  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, HOST: '127.0.0.1' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  try {
    if (!(await waitForServer())) throw new Error('Сервер не запустился');

    const admin = makeClient();
    const guest = makeClient();

    console.log('\nПервый запуск');
    const me = await guest('/api/me');
    check('setup=true до создания администратора', me.json && me.json.setup === true);

    const setup = await admin('/api/setup', {
      method: 'POST',
      body: { login: 'admin', name: 'Администратор', password: 'secret123' },
    });
    check('администратор создан', setup.status === 200 && setup.json.user.role === 'admin');
    check('создан стартовый раздел', setup.json.sections.length === 1);

    const sectionId = setup.json.sections[0].id;

    console.log('\nРазделы и задачи');
    const createdSection = await admin('/api/sections', { method: 'POST', body: { name: 'Задания для цеха' } });
    check('раздел создан', createdSection.status === 201);
    const shopId = createdSection.json.section.id;

    const task1 = await admin(`/api/sections/${sectionId}/tasks`, {
      method: 'POST',
      body: { title: 'Согласовать утеплитель', dueDate: '2026-11-20' },
    });
    check('задача создана', task1.status === 201 && task1.json.task.dueDate === '2026-11-20');

    const task2 = await admin(`/api/sections/${shopId}/tasks`, { method: 'POST', body: { title: 'Изготовить каркас' } });
    check('задача без срока создана', task2.status === 201 && task2.json.task.dueDate === '');

    const patched = await admin(`/api/tasks/${task1.json.task.id}`, { method: 'PATCH', body: { done: true } });
    check('отметка «Выполнено» сохраняется', patched.json.task.done === true && patched.json.task.doneBy === 'Администратор');

    const accepted = await admin(`/api/tasks/${task1.json.task.id}`, { method: 'PATCH', body: { accepted: true } });
    check('отметка «Принято» сохраняется', accepted.json.task.accepted === true);

    const comment = await admin(`/api/tasks/${task1.json.task.id}/comments`, { method: 'POST', body: { text: 'Передано в работу' } });
    check('комментарий добавлен', comment.status === 201 && comment.json.task.comments.length === 1);

    const list = await admin(`/api/sections/${sectionId}/tasks`);
    check('список задач отдаётся', list.json.tasks.length === 1);

    console.log('\nПользователи и права');
    const createdUser = await admin('/api/users', {
      method: 'POST',
      body: { login: 'petrov', name: 'Петров П.П.', password: 'petrov123', role: 'user' },
    });
    check('пользователь создан', createdUser.status === 201);
    const userId = createdUser.json.user.id;

    const perms = await admin(`/api/users/${userId}/permissions`, {
      method: 'PUT',
      body: {
        permissions: [
          { sectionId, read: true, create: false, edit: false },
          { sectionId: shopId, read: true, create: true, edit: true },
        ],
      },
    });
    check('права сохранены', perms.status === 200);

    const users = await admin('/api/users');
    check('админ видит права пользователя', users.json.users.find((u) => u.id === userId).permissions.length === 2);

    const petrov = makeClient();
    const login = await petrov('/api/login', { method: 'POST', body: { login: 'petrov', password: 'petrov123' } });
    check('вход пользователя', login.status === 200 && login.json.user.login === 'petrov');
    check('пользователь видит 2 раздела', login.json.sections.length === 2);

    const forbiddenEdit = await petrov(`/api/tasks/${task1.json.task.id}`, { method: 'PATCH', body: { title: 'Взлом' } });
    check('чтение без правки запрещено (403)', forbiddenEdit.status === 403);

    const forbiddenCreate = await petrov(`/api/sections/${sectionId}/tasks`, { method: 'POST', body: { title: 'Нельзя' } });
    check('создание без права запрещено (403)', forbiddenCreate.status === 403);

    const allowedCreate = await petrov(`/api/sections/${shopId}/tasks`, { method: 'POST', body: { title: 'Задача от Петрова' } });
    check('создание с правом разрешено', allowedCreate.status === 201);

    const allowedEdit = await petrov(`/api/tasks/${task2.json.task.id}`, { method: 'PATCH', body: { done: true } });
    check('правка с правом разрешена', allowedEdit.status === 200);

    const usersForbidden = await petrov('/api/users');
    check('пользователь не видит админку', usersForbidden.status === 403);

    const hiddenSection = await petrov(`/api/sections/${shopId}/tasks`);
    check('свой раздел читается', hiddenSection.status === 200);

    console.log('\nБезопасность');
    const csrf = await admin(`/api/sections/${sectionId}/tasks`, {
      method: 'POST',
      body: { title: 'Без заголовка' },
      headers: { 'X-Requested-With': '' },
    });
    check('запрос без X-Requested-With отклонён', csrf.status === 403);

    const badLogin = await makeClient()('/api/login', { method: 'POST', body: { login: 'petrov', password: 'wrong' } });
    check('неверный пароль отклонён', badLogin.status === 401);

    const disabled = await admin(`/api/users/${userId}`, { method: 'PATCH', body: { disabled: true } });
    check('пользователь отключён', disabled.status === 200);
    const blocked = await petrov(`/api/sections/${shopId}/tasks`);
    check('отключённый пользователь теряет сессию', blocked.status === 401);

    const deletion = await admin(`/api/users/${userId}`, { method: 'DELETE' });
    check('пользователь удалён', deletion.status === 200);

    const restartDb = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'db.json'), 'utf8'));
    check('база записана на диск', restartDb.tasks.length === 3 && restartDb.users.length === 1);
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }

  console.log(`\nИтого: ${passed} успешно, ${failed} с ошибкой\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
