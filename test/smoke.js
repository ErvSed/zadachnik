'use strict';

/**
 * Дымовой тест API: поднимает сервер на временной базе и проверяет
 * основные сценарии — первый запуск, разделы и подразделы, задачи,
 * отметки, повторения, отмену, права, сводку и комментарии.
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
    const adminId = setup.json.user.id;
    const sectionA = setup.json.sections[0].id;

    console.log('\nРазделы и подразделы');
    const createdSection = await admin('/api/sections', { method: 'POST', body: { name: 'Цех' } });
    check('раздел создан', createdSection.status === 201);
    const sectionB = createdSection.json.section.id;

    const createdSub = await admin('/api/sections', { method: 'POST', body: { name: 'Смета', parentId: sectionB } });
    check('подраздел создан', createdSub.status === 201 && createdSub.json.section.parentId === sectionB);
    const subB = createdSub.json.section.id;

    const listSections = await admin('/api/sections');
    check('подраздел в списке разделов', listSections.json.sections.some((s) => s.id === subB && s.parentId === sectionB));

    console.log('\nЗадачи, отметки, ответственный');
    const t1 = await admin(`/api/sections/${sectionA}/tasks`, {
      method: 'POST',
      body: { title: 'Согласовать утеплитель', dueDate: '2026-11-20' },
    });
    check('задача создана', t1.status === 201 && t1.json.task.dueDate === '2026-11-20');
    const taskA = t1.json.task;

    const t2 = await admin(`/api/sections/${sectionB}/tasks`, { method: 'POST', body: { title: 'Изготовить каркас' } });
    check('задача без срока создана', t2.status === 201 && t2.json.task.dueDate === '');
    const taskB = t2.json.task;

    const t3 = await admin(`/api/sections/${subB}/tasks`, {
      method: 'POST',
      body: {
        title: 'Еженедельный обход',
        dueDate: '2026-11-20',
        assigneeId: adminId,
        recurrence: { freq: 'weekly', interval: 1 },
      },
    });
    check('ответственный сохранён', t3.json.task.assigneeId === adminId && t3.json.task.assigneeName === 'Администратор');
    check('повторение сохранено', t3.json.task.recurrence && t3.json.task.recurrence.freq === 'weekly');
    const taskC = t3.json.task;

    const parentTasks = await admin(`/api/sections/${sectionB}/tasks`);
    check('задачи подраздела видны в родительском разделе', parentTasks.json.tasks.length === 2);
    check('в ответе список разделов ветки', parentTasks.json.sectionIds.includes(subB));

    const sectionsWithCounts = await admin('/api/sections');
    const parentSection = sectionsWithCounts.json.sections.find((s) => s.id === sectionB);
    check('счётчик родителя включает подраздел', parentSection.openCount === 2);
    check('у родителя отмечены подразделы', parentSection.childCount === 1);

    const patched = await admin(`/api/tasks/${taskA.id}`, { method: 'PATCH', body: { done: true } });
    check('отметка «Выполнено» сохраняется', patched.json.task.done === true && patched.json.task.doneBy === 'Администратор');

    const accepted = await admin(`/api/tasks/${taskA.id}`, { method: 'PATCH', body: { accepted: true } });
    check('отметка «Принято» сохраняется', accepted.json.task.accepted === true);

    const comment = await admin(`/api/tasks/${taskA.id}/comments`, { method: 'POST', body: { text: 'Передано в работу' } });
    check('комментарий добавлен', comment.status === 201 && comment.json.task.comments.length === 1);

    console.log('\nПовторяющиеся задачи');
    const weeklyDone = await admin(`/api/tasks/${taskC.id}`, { method: 'PATCH', body: { done: true } });
    check('первая отметка не создаёт повтор', !weeklyDone.json.spawned);
    const weeklyAccepted = await admin(`/api/tasks/${taskC.id}`, { method: 'PATCH', body: { accepted: true } });
    check('после «выполнено + принято» создаётся следующая', Boolean(weeklyAccepted.json.spawned));
    check('следующая задача с новым сроком', weeklyAccepted.json.spawned.dueDate === '2026-11-27');
    check('серия сохраняется', weeklyAccepted.json.spawned.seriesId === weeklyAccepted.json.task.seriesId);

    console.log('\nОтмена задачи');
    const t4 = await admin(`/api/sections/${sectionB}/tasks`, { method: 'POST', body: { title: 'Отменить закупку' } });
    const canceled = await admin(`/api/tasks/${t4.json.task.id}`, { method: 'PATCH', body: { canceled: true } });
    check('задача отменена', canceled.json.task.canceled === true && canceled.json.task.canceledAt);
    const restored = await admin(`/api/tasks/${t4.json.task.id}`, { method: 'PATCH', body: { canceled: false } });
    check('задачу можно вернуть', restored.json.task.canceled === false);

    console.log('\nПеремещение задачи');
    const movable = await admin(`/api/sections/${sectionA}/tasks`, { method: 'POST', body: { title: 'Перемещаемая задача' } });
    const moved = await admin(`/api/tasks/${movable.json.task.id}`, { method: 'PATCH', body: { sectionId: subB } });
    check('задача перемещена в подраздел', moved.status === 200 && moved.json.task.sectionId === subB);
    const fromA = await admin(`/api/sections/${sectionA}/tasks`);
    check('в исходном разделе задачи нет', !fromA.json.tasks.some((t) => t.id === movable.json.task.id));
    const inSub = await admin(`/api/sections/${subB}/tasks`);
    check('в подразделе задача есть', inSub.json.tasks.some((t) => t.id === movable.json.task.id));

    console.log('\nСводка');
    const summary = await admin('/api/summary');
    check('сводка отдаётся', summary.status === 200 && summary.json.totals.total > 0);
    check('в сводке есть архив', summary.json.totals.archive >= 1);
    check('в сводке есть строки разделов', summary.json.sections.length >= 3);

    console.log('\nСправочник пользователей');
    const directory = await admin('/api/users/directory');
    check('справочник доступен', directory.status === 200 && directory.json.users.some((u) => u.id === adminId));

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
          { sectionId: sectionA, read: true, create: false, edit: false },
          { sectionId: subB, read: true, create: true, edit: true },
        ],
      },
    });
    check('права сохранены', perms.status === 200);

    const users = await admin('/api/users');
    check('админ видит права пользователя', users.json.users.find((u) => u.id === userId).permissions.length === 2);

    const petrov = makeClient();
    const login = await petrov('/api/login', { method: 'POST', body: { login: 'petrov', password: 'petrov123' } });
    check('вход пользователя', login.status === 200 && login.json.user.login === 'petrov');
    check('пользователь видит только доступные разделы', login.json.sections.length === 2);
    check('чужая ветка не видна', !login.json.sections.some((s) => s.id === sectionB));

    const forbiddenEdit = await petrov(`/api/tasks/${taskA.id}`, { method: 'PATCH', body: { title: 'Взлом' } });
    check('чтение без правки запрещено (403)', forbiddenEdit.status === 403);

    const forbiddenCreate = await petrov(`/api/sections/${sectionA}/tasks`, { method: 'POST', body: { title: 'Нельзя' } });
    check('создание без права запрещено (403)', forbiddenCreate.status === 403);

    const allowedCreate = await petrov(`/api/sections/${subB}/tasks`, { method: 'POST', body: { title: 'Задача от Петрова' } });
    check('создание в подразделе с правом разрешено', allowedCreate.status === 201);

    const forbiddenSub = await petrov('/api/sections', { method: 'POST', body: { name: 'Вложенный', parentId: sectionB } });
    check('подраздел без прав на родителя запрещён', forbiddenSub.status === 403);

    const usersForbidden = await petrov('/api/users');
    check('пользователь не видит админку', usersForbidden.status === 403);

    const parentForbidden = await petrov(`/api/sections/${sectionB}/tasks`);
    check('чужой родительский раздел закрыт', parentForbidden.status === 403);

    const moveForbidden = await petrov(`/api/tasks/${taskC.id}`, { method: 'PATCH', body: { sectionId: sectionA } });
    check('перемещение без прав на целевой раздел запрещено', moveForbidden.status === 403);

    const summaryForPetrov = await petrov('/api/summary');
    check('сводка пользователя только по его разделам', summaryForPetrov.status === 200 && summaryForPetrov.json.sections.length === 2);

    console.log('\nУдаление раздела с подразделами');
    const removed = await admin(`/api/sections/${sectionB}`, { method: 'DELETE' });
    check('ветка удалена', removed.status === 200 && removed.json.removed.includes(subB));
    const goneTasks = await admin(`/api/sections/${subB}/tasks`);
    check('задачи подраздела удалены', goneTasks.status === 404);

    console.log('\nБезопасность');
    const csrf = await admin(`/api/sections/${sectionA}/tasks`, {
      method: 'POST',
      body: { title: 'Без заголовка' },
      headers: { 'X-Requested-With': '' },
    });
    check('запрос без X-Requested-With отклонён', csrf.status === 403);

    const badLogin = await makeClient()('/api/login', { method: 'POST', body: { login: 'petrov', password: 'wrong' } });
    check('неверный пароль отклонён', badLogin.status === 401);

    const disabled = await admin(`/api/users/${userId}`, { method: 'PATCH', body: { disabled: true } });
    check('пользователь отключён', disabled.status === 200);
    const blocked = await petrov(`/api/sections/${sectionA}/tasks`);
    check('отключённый пользователь теряет сессию', blocked.status === 401);

    const deletion = await admin(`/api/users/${userId}`, { method: 'DELETE' });
    check('пользователь удалён', deletion.status === 200);

    const db = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'db.json'), 'utf8'));
    check('база записана на диск', db.users.length === 1 && db.tasks.length === 1);
    check('в базе новая схема', db.schema === 2);
    check('все задачи мигрированы', db.tasks.every((t) => typeof t.canceled === 'boolean' && 'recurrence' in t));
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
