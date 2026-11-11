/* Задачник — клиентское приложение. */

import { api } from './api.js';
import {
  h,
  icon,
  githubIcon,
  clear,
  fmtDate,
  fmtDateTime,
  relTime,
  dueLabel,
  isOverdue,
  initials,
  colorFor,
  debounce,
  truncate,
} from './util.js';
import { toast, openModal, confirmDialog } from './overlay.js';

const REPO_URL = 'https://github.com/ErvSed/zadachnik';

const state = {
  user: null,
  setup: false,
  sections: [],
  currentSectionId: null,
  tasks: [],
  loading: false,
  filter: 'open',
  query: '',
  view: 'tasks',
  admin: null,
};

const els = {};
const THEMES = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: 'как в системе', light: 'светлая', dark: 'тёмная' };

const FILTERS = [
  { key: 'open', label: 'В работе' },
  { key: 'review', label: 'На приёмке' },
  { key: 'done', label: 'Готово' },
  { key: 'all', label: 'Все' },
  { key: 'overdue', label: 'Просрочено' },
];

try {
  const savedTheme = localStorage.getItem('zadachnik.theme');
  if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme;
} catch {
  /* приватный режим */
}

/* =========================================================
   Запуск
   ========================================================= */
boot();

async function boot() {
  try {
    const me = await api.me();
    if (me.setup) return renderSetup();
    if (!me.user) return renderLogin();
    applySession(me);
    renderShell();
    const hashId = decodeURIComponent(location.hash.replace(/^#/, ''));
    const initial = state.sections.some((s) => s.id === hashId) ? hashId : state.sections[0] && state.sections[0].id;
    if (initial) await selectSection(initial, { skipHash: true });
    else renderNoSections();
  } catch (error) {
    renderFatal(error);
  }
}

function applySession(payload) {
  state.user = payload.user;
  state.sections = payload.sections || [];
}

/* =========================================================
   Вход и первый запуск
   ========================================================= */
function authLayout({ title, subtitle, form, note }) {
  const root = document.getElementById('root');
  clear(root);
  root.append(
    h('div', { class: 'auth' },
      h('div', { class: 'auth-card' },
        h('div', { class: 'auth-brand' },
          h('span', { class: 'brand-mark' }, icon('check')),
          h('div', {},
            h('div', { class: 'auth-title' }, 'Задачник'),
            h('div', { class: 'auth-sub' }, 'задачи, сроки и согласования'),
          ),
        ),
        h('h1', { class: 'auth-heading' }, title),
        subtitle ? h('p', { class: 'auth-text' }, subtitle) : null,
        form,
        note || null,
      ),
      h('div', { class: 'auth-footer' },
        h('span', {}, `Сервер: ${location.host}`),
        h('span', { class: 'auth-sep' }, '·'),
        h('a', { class: 'auth-link', href: REPO_URL, target: '_blank', rel: 'noopener' }, 'github.com/ErvSed/zadachnik'),
      ),
    ),
  );
}

function formErrorBox() {
  return h('div', { class: 'auth-error', hidden: true });
}

function showFormError(box, message) {
  box.textContent = message;
  box.hidden = false;
}

function renderLogin(message = '') {
  const login = h('input', { class: 'input', type: 'text', placeholder: 'ivanov', autocomplete: 'username', 'data-autofocus': '' });
  const password = h('input', { class: 'input', type: 'password', placeholder: '••••••', autocomplete: 'current-password' });
  const errorBox = formErrorBox();
  if (message) showFormError(errorBox, message);
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Войти');

  const form = h('form', {
    class: 'auth-form',
    onSubmit: async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      submit.disabled = true;
      submit.textContent = 'Проверяем…';
      try {
        const payload = await api.login({ login: login.value.trim(), password: password.value });
        applySession(payload);
        renderShell();
        if (state.sections[0]) await selectSection(state.sections[0].id, { skipHash: true });
        else renderNoSections();
      } catch (error) {
        showFormError(errorBox, error.message);
      } finally {
        submit.disabled = false;
        submit.textContent = 'Войти';
      }
    },
  },
    h('label', { class: 'field' }, h('span', {}, 'Логин'), login),
    h('label', { class: 'field' }, h('span', {}, 'Пароль'), password),
    errorBox,
    submit,
  );

  authLayout({
    title: 'Вход в задачник',
    subtitle: 'Введите логин и пароль, которые выдал администратор.',
    form,
    note: h('div', { class: 'auth-note' }, 'Забыли пароль? Попросите администратора сбросить его в разделе «Администрирование».'),
  });
}

function renderSetup() {
  const login = h('input', { class: 'input', type: 'text', placeholder: 'admin', autocomplete: 'username', 'data-autofocus': '' });
  const name = h('input', { class: 'input', type: 'text', placeholder: 'Иванов И.И.' });
  const password = h('input', { class: 'input', type: 'password', placeholder: 'не короче 6 символов', autocomplete: 'new-password' });
  const confirm = h('input', { class: 'input', type: 'password', placeholder: 'ещё раз', autocomplete: 'new-password' });
  const errorBox = formErrorBox();
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Создать администратора');

  const form = h('form', {
    class: 'auth-form',
    onSubmit: async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      if (password.value !== confirm.value) return showFormError(errorBox, 'Пароли не совпадают');
      submit.disabled = true;
      submit.textContent = 'Создаём…';
      try {
        const payload = await api.setup({
          login: login.value.trim(),
          name: name.value.trim(),
          password: password.value,
        });
        applySession(payload);
        renderShell();
        if (state.sections[0]) await selectSection(state.sections[0].id, { skipHash: true });
        toast('Готово! Можно добавлять задачи.', { tone: 'ok' });
      } catch (error) {
        showFormError(errorBox, error.message);
      } finally {
        submit.disabled = false;
        submit.textContent = 'Создать администратора';
      }
    },
  },
    h('label', { class: 'field' }, h('span', {}, 'Логин'), login),
    h('label', { class: 'field' }, h('span', {}, 'Имя и фамилия'), name),
    h('label', { class: 'field' }, h('span', {}, 'Пароль'), password),
    h('label', { class: 'field' }, h('span', {}, 'Пароль ещё раз'), confirm),
    errorBox,
    submit,
  );

  authLayout({
    title: 'Первый запуск',
    subtitle: 'Создайте учётную запись администратора. Она сможет добавлять пользователей и настраивать доступ к разделам.',
    form,
  });
}

function renderFatal(error) {
  const root = document.getElementById('root');
  clear(root);
  root.append(
    h('div', { class: 'auth' },
      h('div', { class: 'auth-card' },
        h('div', { class: 'auth-brand' },
          h('span', { class: 'brand-mark' }, icon('alert')),
          h('div', {}, h('div', { class: 'auth-title' }, 'Нет связи с сервером')),
        ),
        h('p', { class: 'auth-text' }, error && error.message ? error.message : 'Не удалось загрузить данные.'),
        h('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: () => location.reload() }, 'Обновить'),
      ),
    ),
  );
}

/* =========================================================
   Каркас
   ========================================================= */
function renderShell() {
  const root = document.getElementById('root');
  clear(root);

  const userChip = h('div', { class: 'user-chip' },
    h('span', { class: 'avatar', style: colorFor(state.user.name) }, initials(state.user.name)),
    h('div', { class: 'user-meta' },
      h('div', { class: 'user-name' }, state.user.name),
      h('div', { class: 'user-role' }, state.user.role === 'admin' ? 'администратор' : 'пользователь'),
    ),
  );

  const adminBtn = state.user.role === 'admin'
    ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', id: 'adminBtn', onClick: showAdmin }, icon('shield'), 'Администрирование')
    : null;

  els.sectionsNav = h('nav', { class: 'sections' });
  els.sectionTitle = h('h1', { class: 'section-title' });
  els.sectionSub = h('div', { class: 'section-sub' });
  els.sectionActions = h('div', { class: 'section-actions' });
  els.filterChips = h('div', { class: 'chips' });
  els.taskList = h('div', { class: 'task-list' });
  els.legend = h('div', { class: 'list-legend' },
    h('span', { class: 'legend-item' }, h('span', { class: 'legend-box legend-done' }, icon('check')), 'Выполнено'),
    h('span', { class: 'legend-item' }, h('span', { class: 'legend-box legend-accept' }, icon('check')), 'Принято'),
    h('span', { class: 'legend-hint' }, 'две отметки на каждую задачу'),
  );
  els.addFormWrap = h('div', { class: 'add-wrap' });
  els.adminView = h('div', { class: 'admin-view', hidden: true });
  els.tasksView = h('div', { class: 'tasks-view' });

  els.searchInput = h('input', {
    class: 'search-input',
    type: 'search',
    placeholder: 'Поиск по задачам и комментариям',
    onInput: debounce((event) => {
      state.query = event.target.value;
      renderTasks();
    }, 160),
  });

  const toolbar = h('div', { class: 'toolbar' },
    h('label', { class: 'search' }, icon('search'), els.searchInput),
    els.filterChips,
  );

  els.tasksView.append(
    h('div', { class: 'section-head' },
      h('div', { class: 'section-head-main' }, els.sectionTitle, els.sectionSub),
      els.sectionActions,
    ),
    toolbar,
    els.addFormWrap,
    els.legend,
    els.taskList,
  );

  const shell = h('div', { class: 'shell' },
    h('header', { class: 'topbar' },
      h('div', { class: 'brand' },
        h('span', { class: 'brand-mark' }, icon('check')),
        h('span', { class: 'brand-name' }, 'Задачник'),
      ),
      h('div', { class: 'topbar-spacer' }),
      h('button', {
        class: 'icon-btn',
        type: 'button',
        title: 'Сменить тему',
        'aria-label': 'Сменить тему',
        onClick: (event) => toggleTheme(event.currentTarget),
      }, themeIcon()),
      h('a', {
        class: 'icon-btn',
        href: REPO_URL,
        target: '_blank',
        rel: 'noopener',
        title: 'Репозиторий на GitHub',
        'aria-label': 'Репозиторий на GitHub',
      }, githubIcon()),
      adminBtn,
      userChip,
      h('button', { class: 'icon-btn', type: 'button', title: 'Выйти', 'aria-label': 'Выйти', onClick: logout }, icon('logout')),
    ),
    h('div', { class: 'layout' },
      h('aside', { class: 'sidebar' },
        h('div', { class: 'sidebar-head' },
          h('span', {}, 'Разделы'),
          h('button', { class: 'icon-btn', type: 'button', title: 'Новый раздел', 'aria-label': 'Новый раздел', onClick: () => openSectionModal(null) }, icon('plus')),
        ),
        els.sectionsNav,
      ),
      h('main', { class: 'main' }, els.tasksView, els.adminView),
    ),
  );

  root.append(shell);

  renderSections();
  renderSectionHeader();
  renderAddForm();
  renderFilterChips();
  renderTasks();
}

function currentSection() {
  return state.sections.find((s) => s.id === state.currentSectionId) || null;
}

async function selectSection(id, { skipHash = false } = {}) {
  state.currentSectionId = id;
  state.view = 'tasks';
  state.admin = null;
  els.adminView.hidden = true;
  els.tasksView.hidden = false;
  if (!skipHash) history.replaceState(null, '', `#${id}`);
  renderSections();
  renderSectionHeader();
  renderAddForm();
  renderFilterChips();
  await loadTasks();
}

async function loadTasks() {
  const section = currentSection();
  if (!section) {
    state.tasks = [];
    renderTasks();
    return;
  }
  state.loading = true;
  renderTasks();
  try {
    const { tasks } = await api.tasks(section.id);
    if (state.currentSectionId !== section.id) return;
    state.tasks = tasks;
  } catch (error) {
    handleError(error);
    state.tasks = [];
  } finally {
    state.loading = false;
    renderTasks();
    renderFilterChips();
    renderSectionHeader();
  }
}

/* =========================================================
   Разделы
   ========================================================= */
function renderSections() {
  clear(els.sectionsNav);
  if (!state.sections.length) {
    els.sectionsNav.append(h('div', { class: 'sections-empty' }, 'Пока нет разделов'));
  }
  for (const section of state.sections) {
    const active = section.id === state.currentSectionId;
    els.sectionsNav.append(
      h('button', {
        class: 'section-item' + (active ? ' is-active' : ''),
        type: 'button',
        onClick: () => { if (!active) selectSection(section.id); },
      },
        h('span', { class: 'section-name', title: section.name }, section.name),
        section.openCount ? h('span', { class: 'section-count' }, String(section.openCount)) : null,
      ),
    );
  }
}

function renderSectionHeader() {
  const section = currentSection();
  clear(els.sectionActions);
  if (!section) {
    els.sectionTitle.textContent = 'Задачник';
    els.sectionSub.textContent = 'Выберите раздел слева или создайте новый';
    return;
  }
  els.sectionTitle.textContent = section.name;

  const total = state.tasks.length;
  const open = state.tasks.filter((t) => !t.done).length;
  const review = state.tasks.filter((t) => t.done && !t.accepted).length;
  const overdue = state.tasks.filter(isOverdue).length;
  const parts = [`${total} ${plural(total, 'задача', 'задачи', 'задач')}`, `в работе ${open}`];
  if (review) parts.push(`на приёмке ${review}`);
  if (overdue) parts.push(`просрочено ${overdue}`);
  els.sectionSub.textContent = parts.join(' · ');

  const can = section.can || {};
  let accessNote = '';
  if (!can.create && !can.edit) accessNote = 'только чтение';
  else if (!can.create) accessNote = 'без создания';
  else if (!can.edit) accessNote = 'без правки';
  if (accessNote) {
    els.sectionSub.append(' ', h('span', { class: 'access-note' }, accessNote));
  }

  if (state.user.role === 'admin' || section.createdBy === state.user.id) {
    els.sectionActions.append(
      h('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        title: 'Переименовать раздел',
        onClick: () => openSectionModal(section),
      }, icon('edit'), 'Переименовать'),
    );
  }
  if (state.user.role === 'admin') {
    els.sectionActions.append(
      h('button', {
        class: 'icon-btn danger',
        type: 'button',
        title: 'Удалить раздел',
        'aria-label': 'Удалить раздел',
        onClick: () => deleteSection(section),
      }, icon('trash')),
    );
  }
}

function renderAddForm() {
  const section = currentSection();
  clear(els.addFormWrap);
  if (!section) return;

  if (!section.can.create) {
    els.addFormWrap.append(
      h('div', { class: 'locked-note' }, icon('lock'), 'В этом разделе можно только просматривать задачи.'),
    );
    return;
  }

  const input = h('input', {
    class: 'input add-input',
    type: 'text',
    placeholder: 'Что нужно сделать?',
    maxlength: '300',
    'aria-label': 'Новая задача',
  });
  const date = h('input', { class: 'input add-date', type: 'date', 'aria-label': 'Срок исполнения' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus'), 'Добавить');

  const form = h('form', {
    class: 'add-form',
    onSubmit: async (event) => {
      event.preventDefault();
      const title = input.value.trim();
      if (!title) { input.focus(); return; }
      submit.disabled = true;
      try {
        const { task } = await api.createTask(section.id, { title, dueDate: date.value || '' });
        state.tasks.push(task);
        state.tasks.sort(sortTasks);
        input.value = '';
        date.value = '';
        input.focus();
        renderTasks();
        renderSectionHeader();
        renderFilterChips();
        refreshSectionCounts();
      } catch (error) {
        handleError(error);
      } finally {
        submit.disabled = false;
      }
    },
  }, input, date, submit);

  els.addFormWrap.append(form);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { input.value = ''; }
  });
}

function refreshSectionCounts() {
  const section = currentSection();
  if (!section) return;
  section.openCount = state.tasks.filter((t) => !t.done).length;
  section.taskCount = state.tasks.length;
  renderSections();
}

function openSectionModal(section) {
  const isNew = !section;
  const input = h('input', {
    class: 'input',
    type: 'text',
    value: section ? section.name : '',
    placeholder: 'Например: Задания для цеха',
    maxlength: '120',
    'data-autofocus': '',
  });
  const errorBox = formErrorBox();
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, isNew ? 'Создать раздел' : 'Сохранить');

  async function save() {
    const name = input.value.trim();
    if (!name) return showFormError(errorBox, 'Введите название раздела');
    saveBtn.disabled = true;
    try {
      if (isNew) {
        const { section: created } = await api.createSection(name);
        state.sections.push(created);
        close();
        renderSections();
        await selectSection(created.id);
        toast('Раздел создан. Вы получили к нему полный доступ.', { tone: 'ok' });
      } else {
        const { section: updated } = await api.renameSection(section.id, name);
        Object.assign(section, updated);
        close();
        renderSections();
        renderSectionHeader();
      }
    } catch (error) {
      showFormError(errorBox, error.message);
    } finally {
      saveBtn.disabled = false;
    }
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); save(); }
  });

  const content = h('div', {},
    h('div', { class: 'modal-head' },
      h('h2', { class: 'modal-title' }, isNew ? 'Новый раздел' : 'Переименовать раздел'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть', onClick: () => close() }, icon('close')),
    ),
    h('div', { class: 'modal-body' },
      h('label', { class: 'field' }, h('span', {}, 'Название'), input),
      isNew ? h('div', { class: 'hint' }, 'Например: «Согласования с проектировщиками», «Задания для цеха», «Закупки». Новый раздел сразу будет доступен вам, а другим пользователям — после настройки прав администратором.') : null,
      errorBox,
    ),
    h('div', { class: 'modal-foot' },
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => close() }, 'Отмена'),
      saveBtn,
    ),
  );

  const { close } = openModal(content, { className: 'modal-sm' });
}

async function deleteSection(section) {
  const ok = await confirmDialog({
    title: 'Удалить раздел?',
    message: `Раздел «${section.name}» и все задачи в нём будут удалены без возможности восстановления.`,
    confirmText: 'Удалить раздел',
  });
  if (!ok) return;
  try {
    await api.deleteSection(section.id);
    state.sections = state.sections.filter((s) => s.id !== section.id);
    if (state.currentSectionId === section.id) {
      state.currentSectionId = null;
      state.tasks = [];
    }
    renderSections();
    if (state.currentSectionId) {
      renderSectionHeader();
      renderAddForm();
      renderFilterChips();
      renderTasks();
    } else if (state.sections[0]) {
      await selectSection(state.sections[0].id);
    } else {
      renderNoSections();
    }
    toast('Раздел удалён', { tone: 'ok' });
  } catch (error) {
    handleError(error);
  }
}

function renderNoSections() {
  if (!els.tasksView) return;
  state.sections = state.sections || [];
  clear(els.taskList);
  els.sectionTitle.textContent = 'Добро пожаловать';
  els.sectionSub.textContent = 'Разделов пока нет';
  clear(els.sectionActions);
  clear(els.addFormWrap);
  els.addFormWrap.append(
    h('div', { class: 'empty' },
      h('div', { class: 'empty-icon' }, icon('folder')),
      h('h3', {}, 'Создайте первый раздел'),
      h('p', {}, 'Разделы помогают разделить задачи: согласования с проектировщиками, задания для цеха, закупки и так далее.'),
      h('button', { class: 'btn btn-primary', type: 'button', onClick: () => openSectionModal(null) }, icon('plus'), 'Новый раздел'),
    ),
  );
}

/* =========================================================
   Задачи
   ========================================================= */
function sortTasks(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const ad = a.dueDate || '9999-12-31';
  const bd = b.dueDate || '9999-12-31';
  if (ad !== bd) return ad < bd ? -1 : 1;
  return a.createdAt < b.createdAt ? 1 : -1;
}

function taskCounts() {
  return {
    all: state.tasks.length,
    open: state.tasks.filter((t) => !t.done).length,
    review: state.tasks.filter((t) => t.done && !t.accepted).length,
    done: state.tasks.filter((t) => t.done).length,
    overdue: state.tasks.filter(isOverdue).length,
  };
}

function visibleTasks() {
  const query = state.query.trim().toLowerCase();
  return state.tasks.filter((task) => {
    if (state.filter === 'open' && task.done) return false;
    if (state.filter === 'done' && !task.done) return false;
    if (state.filter === 'review' && !(task.done && !task.accepted)) return false;
    if (state.filter === 'overdue' && !isOverdue(task)) return false;
    if (query) {
      const haystack = [task.title, ...(task.comments || []).map((c) => c.text)].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }).sort(sortTasks);
}

function renderFilterChips() {
  const counts = taskCounts();
  clear(els.filterChips);
  for (const filter of FILTERS) {
    const count = counts[filter.key] || 0;
    els.filterChips.append(
      h('button', {
        class: 'chip' + (state.filter === filter.key ? ' is-active' : ''),
        type: 'button',
        'aria-pressed': state.filter === filter.key ? 'true' : 'false',
        onClick: () => {
          state.filter = filter.key;
          renderFilterChips();
          renderTasks();
        },
      },
        filter.label,
        h('span', { class: 'chip-count' }, String(count)),
      ),
    );
  }
}

function renderTasks() {
  if (!els.taskList) return;
  clear(els.taskList);

  if (state.loading) {
    els.legend.hidden = true;
    for (let i = 0; i < 3; i += 1) {
      els.taskList.append(h('div', { class: 'task is-skeleton' },
        h('div', { class: 'skel-check' }),
        h('div', { class: 'skel-lines' }, h('div', { class: 'skel-line' }), h('div', { class: 'skel-line short' })),
      ));
    }
    return;
  }

  const section = currentSection();
  if (!section) return;

  const tasks = visibleTasks();
  if (!tasks.length) {
    els.legend.hidden = true;
    const noTasks = state.tasks.length === 0;
    const hasQuery = Boolean(state.query.trim());
    els.taskList.append(
      h('div', { class: 'empty' },
        h('div', { class: 'empty-icon' }, icon(noTasks ? 'check' : 'search')),
        h('h3', {}, noTasks ? 'Задач пока нет' : 'Ничего не найдено'),
        h('p', {}, noTasks
          ? (section.can.create ? 'Добавьте первую задачу в поле выше — она появится в этом списке.' : 'В этом разделе ещё нет задач.')
          : 'Попробуйте изменить фильтр или поисковый запрос.'),
        !noTasks
          ? h('button', {
              class: 'btn btn-ghost',
              type: 'button',
              onClick: () => {
                state.filter = 'all';
                state.query = '';
                els.searchInput.value = '';
                renderFilterChips();
                renderTasks();
              },
            }, hasQuery || state.filter !== 'all' ? 'Сбросить фильтры' : 'Показать все')
          : null,
      ),
    );
    return;
  }

  const editable = Boolean(section.can.edit);
  els.legend.hidden = false;
  for (const task of tasks) {
    els.taskList.append(taskRow(task, editable));
  }
}

function checkButton(field, value, label, onToggle, disabled) {
  const modifier = field === 'accepted' ? 'accept' : 'done';
  const btn = h('button', {
    class: `tcheck tcheck-${modifier}` + (value ? ' is-on' : ''),
    type: 'button',
    title: disabled ? `${label} (нет прав на изменение)` : label,
    'aria-label': label,
    'aria-pressed': value ? 'true' : 'false',
    disabled: disabled || undefined,
    onClick: (event) => {
      event.stopPropagation();
      if (disabled) return;
      onToggle(btn);
    },
  }, icon('check'));
  return btn;
}

function taskRow(task, editable) {
  const overdue = isOverdue(task);
  const last = task.comments && task.comments.length ? task.comments[task.comments.length - 1] : null;

  return h('article', {
    class: 'task' + (task.done ? ' is-done' : '') + (task.accepted ? ' is-accepted' : ''),
    dataset: { id: task.id },
    tabindex: '0',
    role: 'button',
    onClick: () => openTaskModal(task),
    onKeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openTaskModal(task);
      }
    },
  },
    h('div', { class: 'task-checks' },
      checkButton('done', task.done, 'Выполнено', (btn) => toggleTask(task, 'done', btn), !editable),
      checkButton('accepted', task.accepted, 'Принято', (btn) => toggleTask(task, 'accepted', btn), !editable),
    ),
    h('div', { class: 'task-main' },
      h('div', { class: 'task-title' }, task.title),
      h('div', { class: 'task-meta' },
        task.dueDate
          ? h('span', { class: 'task-due' + (overdue ? ' is-overdue' : '') + (task.done ? ' is-muted' : '') },
              icon('calendar'), dueLabel(task.dueDate))
          : null,
        task.createdByName ? h('span', { class: 'task-author' }, task.createdByName) : null,
        task.comments && task.comments.length
          ? h('span', { class: 'task-comments' }, icon('comment'), String(task.comments.length))
          : null,
        task.accepted && task.acceptedBy ? h('span', { class: 'task-accepted-by' }, 'принял ' + task.acceptedBy) : null,
      ),
      last
        ? h('div', { class: 'task-last' },
            h('span', { class: 'task-last-author' }, last.authorName + ':'), ' ' + truncate(last.text, 150))
        : null,
    ),
    h('span', { class: 'task-open', title: 'Открыть' }, icon('dots')),
  );
}

async function toggleTask(task, field, btn) {
  const next = !task[field];
  btn.classList.toggle('is-on', next);
  btn.setAttribute('aria-pressed', next ? 'true' : 'false');
  btn.disabled = true;
  try {
    const { task: updated } = await api.updateTask(task.id, { [field]: next });
    Object.assign(task, updated);
    renderTasks();
    renderSectionHeader();
    renderFilterChips();
    refreshSectionCounts();
  } catch (error) {
    btn.classList.toggle('is-on', !next);
    btn.setAttribute('aria-pressed', next ? 'false' : 'true');
    handleError(error);
  } finally {
    btn.disabled = false;
  }
}

/* =========================================================
   Карточка задачи
   ========================================================= */
function openTaskModal(task) {
  const section = currentSection();
  const canEdit = Boolean(section && section.can.edit);
  const canDeleteComment = (comment) => canEdit || state.user.role === 'admin' || comment.authorId === state.user.id;

  const titleInput = h('input', {
    class: 'title-input',
    type: 'text',
    value: task.title,
    maxlength: '300',
    disabled: !canEdit,
    'aria-label': 'Название задачи',
  });
  const dueInput = h('input', { class: 'input', type: 'date', value: task.dueDate || '', disabled: !canEdit });
  const doneCheck = h('input', { type: 'checkbox', checked: task.done, disabled: !canEdit });
  const acceptedCheck = h('input', { type: 'checkbox', checked: task.accepted, disabled: !canEdit });

  const commentsBox = h('div', { class: 'comments' });
  const commentsCount = h('span', { class: 'count' }, String(task.comments ? task.comments.length : 0));

  function renderComments() {
    clear(commentsBox);
    commentsCount.textContent = String(task.comments ? task.comments.length : 0);
    if (!task.comments || !task.comments.length) {
      commentsBox.append(h('div', { class: 'comments-empty' }, 'Комментариев пока нет'));
      return;
    }
    for (const comment of task.comments) {
      commentsBox.append(
        h('div', { class: 'comment' },
          h('span', { class: 'avatar avatar-sm', style: colorFor(comment.authorName) }, initials(comment.authorName)),
          h('div', { class: 'comment-body' },
            h('div', { class: 'comment-head' },
              h('span', { class: 'comment-author' }, comment.authorName),
              h('span', { class: 'comment-time', title: fmtDateTime(comment.createdAt) }, relTime(comment.createdAt)),
              canDeleteComment(comment)
                ? h('button', {
                    class: 'comment-delete',
                    type: 'button',
                    title: 'Удалить комментарий',
                    'aria-label': 'Удалить комментарий',
                    onClick: () => removeComment(comment),
                  }, icon('close'))
                : null,
            ),
            h('div', { class: 'comment-text' }, comment.text),
          ),
        ),
      );
    }
  }

  async function removeComment(comment) {
    const ok = await confirmDialog({ title: 'Удалить комментарий?', message: 'Комментарий будет удалён для всех пользователей.', confirmText: 'Удалить' });
    if (!ok) return;
    try {
      await api.deleteComment(task.id, comment.id);
      task.comments = task.comments.filter((c) => c.id !== comment.id);
      renderComments();
      renderTasks();
      renderSectionHeader();
      toast('Комментарий удалён', { tone: 'ok' });
    } catch (error) {
      handleError(error);
    }
  }

  const composerInput = h('textarea', { class: 'textarea', rows: '2', placeholder: 'Написать комментарий…' });
  const composerBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: addComment }, icon('comment'), 'Добавить');
  const composer = h('div', { class: 'composer' },
    composerInput,
    h('div', { class: 'composer-actions' }, composerBtn, h('span', { class: 'hint' }, 'Ctrl+Enter — отправить')),
  );

  async function addComment() {
    const text = composerInput.value.trim();
    if (!text) { composerInput.focus(); return; }
    composerBtn.disabled = true;
    try {
      const { comment } = await api.addComment(task.id, text);
      task.comments = task.comments || [];
      task.comments.push(comment);
      composerInput.value = '';
      renderComments();
      renderTasks();
      renderSectionHeader();
    } catch (error) {
      handleError(error);
    } finally {
      composerBtn.disabled = false;
    }
  }

  composerInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      addComment();
    }
  });

  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, 'Сохранить');

  async function save() {
    const title = titleInput.value.trim();
    const errorBox = content.querySelector('.form-error');
    if (!title) {
      errorBox.textContent = 'Название задачи не может быть пустым';
      errorBox.hidden = false;
      titleInput.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      const payload = { title, dueDate: dueInput.value || '' };
      const { task: updated } = await api.updateTask(task.id, payload);
      Object.assign(task, updated);
      renderTasks();
      renderSectionHeader();
      close();
      toast('Задача сохранена', { tone: 'ok', duration: 2000 });
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally {
      saveBtn.disabled = false;
    }
  }

  doneCheck.addEventListener('change', async () => {
    try {
      const { task: updated } = await api.updateTask(task.id, { done: doneCheck.checked });
      Object.assign(task, updated);
      renderTasks();
      renderSectionHeader();
      renderFilterChips();
      refreshSectionCounts();
    } catch (error) {
      doneCheck.checked = task.done;
      handleError(error);
    }
  });

  acceptedCheck.addEventListener('change', async () => {
    try {
      const { task: updated } = await api.updateTask(task.id, { accepted: acceptedCheck.checked });
      Object.assign(task, updated);
      renderTasks();
      renderSectionHeader();
      renderFilterChips();
      refreshSectionCounts();
    } catch (error) {
      acceptedCheck.checked = task.accepted;
      handleError(error);
    }
  });

  const deleteBtn = canEdit
    ? h('button', {
        class: 'btn btn-danger',
        type: 'button',
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Удалить задачу?',
            message: `«${task.title}» будет удалена вместе с комментариями.`,
            confirmText: 'Удалить',
          });
          if (!ok) return;
          try {
            await api.deleteTask(task.id);
            state.tasks = state.tasks.filter((t) => t.id !== task.id);
            close();
            renderTasks();
            renderSectionHeader();
            renderFilterChips();
            refreshSectionCounts();
            toast('Задача удалена', { tone: 'ok' });
          } catch (error) {
            handleError(error);
          }
        },
      }, icon('trash'), h('span', { class: 'btn-label' }, 'Удалить'))
    : null;

  const content = h('div', {},
    h('div', { class: 'modal-head' },
      h('div', { class: 'modal-head-main' },
        h('div', { class: 'modal-eyebrow' }, section ? section.name : '', ' · создано ', fmtDateTime(task.createdAt), task.createdByName ? ` · ${task.createdByName}` : ''),
        titleInput,
      ),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть', onClick: () => close() }, icon('close')),
    ),
    h('div', { class: 'modal-body task-modal-body' },
      h('div', { class: 'task-fields' },
        h('div', { class: 'checks-panel' },
          h('label', { class: 'big-check' },
            doneCheck,
            h('span', { class: 'big-check-box' }, icon('check')),
            h('span', { class: 'big-check-text' },
              h('span', { class: 'big-check-title' }, 'Выполнено'),
              task.done && task.doneBy ? h('span', { class: 'big-check-sub' }, `${task.doneBy} · ${relTime(task.doneAt)}`) : null,
            ),
          ),
          h('label', { class: 'big-check big-check-accept' },
            acceptedCheck,
            h('span', { class: 'big-check-box' }, icon('check')),
            h('span', { class: 'big-check-text' },
              h('span', { class: 'big-check-title' }, 'Принято'),
              task.accepted && task.acceptedBy ? h('span', { class: 'big-check-sub' }, `${task.acceptedBy} · ${relTime(task.acceptedAt)}`) : null,
            ),
          ),
        ),
        h('label', { class: 'field' }, h('span', {}, 'Дата исполнения'), dueInput),
        h('div', { class: 'form-error', hidden: true }),
      ),
      h('div', { class: 'comments-panel' },
        h('div', { class: 'panel-title' }, 'Комментарии', commentsCount),
        commentsBox,
        canEdit ? composer : h('div', { class: 'hint' }, 'Комментирование доступно пользователям с правом редактирования.'),
      ),
    ),
    h('div', { class: 'modal-foot' },
      deleteBtn,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => close() }, 'Закрыть'),
      canEdit ? saveBtn : null,
    ),
  );

  renderComments();

  const { close } = openModal(content, { className: 'modal-task' });
}

/* =========================================================
   Администрирование
   ========================================================= */
async function showAdmin() {
  state.view = 'admin';
  state.admin = null;
  els.tasksView.hidden = true;
  els.adminView.hidden = false;
  els.adminView.replaceChildren(h('div', { class: 'admin-loading' }, 'Загрузка данных…'));
  try {
    state.admin = await api.users();
    renderAdmin();
  } catch (error) {
    handleError(error);
  }
}

function renderAdmin() {
  const data = state.admin;
  if (!data) return;

  const back = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => { els.adminView.hidden = true; els.tasksView.hidden = false; state.view = 'tasks'; } },
    icon('arrowLeft'), 'К задачам');

  const addUser = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: () => openUserModal(null) }, icon('plus'), 'Пользователь');

  const usersTable = h('table', { class: 'table' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'Имя'),
      h('th', {}, 'Логин'),
      h('th', {}, 'Роль'),
      h('th', {}, 'Доступ к разделам'),
      h('th', {}, ''),
    )),
    h('tbody', {}, data.users.map((user) => {
      const access = user.role === 'admin'
        ? 'все разделы'
        : user.permissions.length
          ? `${user.permissions.length} из ${data.sections.length}`
          : 'нет доступа';
      return h('tr', {
        class: 'clickable',
        onClick: () => openUserModal(user),
      },
        h('td', {}, h('div', { class: 'cell-user' },
          h('span', { class: 'avatar avatar-sm', style: colorFor(user.name) }, initials(user.name)),
          h('span', {}, user.name),
        )),
        h('td', { class: 'mono' }, user.login),
        h('td', {}, user.role === 'admin' ? h('span', { class: 'badge badge-admin' }, 'администратор') : h('span', { class: 'badge' }, 'пользователь')),
        h('td', { class: 'muted' }, access),
        h('td', { class: 'right' }, icon('edit')),
      );
    })),
  );

  const sectionsTable = h('table', { class: 'table' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'Раздел'),
      h('th', {}, 'Задач'),
      h('th', {}, ''),
    )),
    h('tbody', {}, data.sections.map((section) => {
      const count = state.sections.find((s) => s.id === section.id);
      return h('tr', {},
        h('td', {}, section.name),
        h('td', { class: 'muted' }, count ? String(count.taskCount) : '—'),
        h('td', { class: 'right' },
          h('button', {
            class: 'icon-btn danger',
            type: 'button',
            title: 'Удалить раздел',
            'aria-label': 'Удалить раздел',
            onClick: async () => {
              const ok = await confirmDialog({
                title: 'Удалить раздел?',
                message: `Раздел «${section.name}» и все задачи в нём будут удалены.`,
                confirmText: 'Удалить',
              });
              if (!ok) return;
              try {
                await api.deleteSection(section.id);
                state.sections = state.sections.filter((s) => s.id !== section.id);
                state.admin = await api.users();
                renderAdmin();
                renderSections();
                if (!state.sections.some((s) => s.id === state.currentSectionId)) {
                  state.currentSectionId = state.sections[0] ? state.sections[0].id : null;
                  state.tasks = [];
                  renderSectionHeader();
                  renderAddForm();
                  renderFilterChips();
                  renderTasks();
                }
                toast('Раздел удалён', { tone: 'ok' });
              } catch (error) {
                handleError(error);
              }
            },
          }, icon('trash')),
        ),
      );
    })),
  );

  clear(els.adminView);
  els.adminView.append(
    h('div', { class: 'admin-head' },
      back,
      h('h1', { class: 'admin-title' }, 'Администрирование'),
    ),
    h('div', { class: 'admin-grid' },
      h('section', { class: 'panel' },
        h('div', { class: 'panel-head' },
          h('h2', { class: 'panel-title' }, 'Пользователи'),
          addUser,
        ),
        h('div', { class: 'panel-hint' }, 'Нажмите на пользователя, чтобы изменить имя, роль, пароль и доступ к разделам.'),
        usersTable,
      ),
      h('section', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Разделы')),
        h('div', { class: 'panel-hint' }, 'Разделы создают пользователи. Администратор может удалить раздел вместе с задачами.'),
        sectionsTable,
      ),
    ),
  );
}

function openUserModal(user) {
  const isNew = !user;
  const sections = (state.admin && state.admin.sections) || [];
  const existing = new Map();
  if (user && Array.isArray(user.permissions)) {
    for (const perm of user.permissions) existing.set(perm.sectionId, { ...perm });
  }

  const login = h('input', { class: 'input', type: 'text', value: user ? user.login : '', disabled: !isNew, maxlength: '32', placeholder: 'ivanov' });
  const name = h('input', { class: 'input', type: 'text', value: user ? user.name : '', maxlength: '80', placeholder: 'Иванов И.И.', 'data-autofocus': '' });
  const password = h('input', { class: 'input', type: 'password', value: '', autocomplete: 'new-password', placeholder: isNew ? 'не короче 6 символов' : 'оставьте пустым, чтобы не менять' });
  const role = h('select', { class: 'input' },
    h('option', { value: 'user', selected: !user || user.role !== 'admin' }, 'Пользователь'),
    h('option', { value: 'admin', selected: Boolean(user && user.role === 'admin') }, 'Администратор'),
  );
  const disabled = h('input', { type: 'checkbox', checked: Boolean(user && user.disabled) });

  const permRows = [];
  const permsBox = h('div', { class: 'perms' });
  if (sections.length) {
    permsBox.append(
      h('div', { class: 'perm-head' },
        h('span', {}, 'Раздел'),
        h('span', {}, 'Чтение'),
        h('span', {}, 'Создание'),
        h('span', {}, 'Правка'),
      ),
    );
    for (const section of sections) {
      const perm = existing.get(section.id) || { read: false, create: false, edit: false };
      const read = h('input', { type: 'checkbox', checked: Boolean(perm.read) });
      const create = h('input', { type: 'checkbox', checked: Boolean(perm.create) });
      const edit = h('input', { type: 'checkbox', checked: Boolean(perm.edit) });
      const sync = () => {
        if (create.checked || edit.checked) read.checked = true;
        if (!read.checked) { create.checked = false; edit.checked = false; }
      };
      read.addEventListener('change', sync);
      create.addEventListener('change', sync);
      edit.addEventListener('change', sync);
      permRows.push({ sectionId: section.id, read, create, edit });
      permsBox.append(
        h('div', { class: 'perm-row' },
          h('span', { class: 'perm-name', title: section.name }, section.name),
          h('label', { class: 'perm-cell' }, read),
          h('label', { class: 'perm-cell' }, create),
          h('label', { class: 'perm-cell' }, edit),
        ),
      );
    }
  } else {
    permsBox.append(h('div', { class: 'hint' }, 'Разделов пока нет.'));
  }

  const errorBox = formErrorBox();
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, isNew ? 'Создать пользователя' : 'Сохранить');

  async function save() {
    errorBox.hidden = true;
    const payload = {
      name: name.value.trim(),
      role: role.value,
    };
    if (password.value) payload.password = password.value;
    if (!isNew) payload.disabled = disabled.checked;

    saveBtn.disabled = true;
    try {
      let userId = user ? user.id : null;
      if (isNew) {
        if (!login.value.trim()) throw new Error('Укажите логин');
        if (!payload.password) throw new Error('Задайте пароль');
        const created = await api.createUser({
          login: login.value.trim(),
          name: payload.name,
          password: payload.password,
          role: payload.role,
        });
        userId = created.user.id;
      } else {
        await api.updateUser(user.id, payload);
      }

      if (userId) {
        const permissions = permRows
          .filter((row) => row.read.checked || row.create.checked || row.edit.checked)
          .map((row) => ({
            sectionId: row.sectionId,
            read: row.read.checked,
            create: row.create.checked,
            edit: row.edit.checked,
          }));
        await api.setPermissions(userId, permissions);
      }

      close();
      state.admin = await api.users();
      renderAdmin();
      toast(isNew ? 'Пользователь добавлен' : 'Изменения сохранены', { tone: 'ok' });
    } catch (error) {
      showFormError(errorBox, error.message);
    } finally {
      saveBtn.disabled = false;
    }
  }

  const deleteBtn = !isNew && user.id !== state.user.id
    ? h('button', {
        class: 'btn btn-danger',
        type: 'button',
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Удалить пользователя?',
            message: `Учётная запись «${user.name}» будет удалена, доступ к задаче пропадёт.`,
            confirmText: 'Удалить',
          });
          if (!ok) return;
          try {
            await api.deleteUser(user.id);
            close();
            state.admin = await api.users();
            renderAdmin();
            toast('Пользователь удалён', { tone: 'ok' });
          } catch (error) {
            handleError(error);
          }
        },
      }, icon('trash'), h('span', { class: 'btn-label' }, 'Удалить'))
    : null;

  const content = h('div', {},
    h('div', { class: 'modal-head' },
      h('h2', { class: 'modal-title' }, isNew ? 'Новый пользователь' : user.name),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть', onClick: () => close() }, icon('close')),
    ),
    h('div', { class: 'modal-body' },
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', {}, 'Логин'), login),
        h('label', { class: 'field' }, h('span', {}, 'Имя и фамилия'), name),
        h('label', { class: 'field' }, h('span', {}, isNew ? 'Пароль' : 'Новый пароль'), password),
        h('label', { class: 'field' }, h('span', {}, 'Роль'), role),
        !isNew && user.id !== state.user.id ? h('label', { class: 'field field-inline' },
          h('span', {}, 'Доступ'),
          h('label', { class: 'switch' }, disabled, h('span', {}, 'Учётная запись отключена')),
        ) : null,
      ),
      h('div', { class: 'divider' }),
      h('div', { class: 'panel-title' }, 'Доступ к разделам'),
      h('div', { class: 'hint' }, 'Отметьте, что пользователь может делать в каждом разделе. «Создание» и «правка» включают чтение автоматически.'),
      permsBox,
      errorBox,
    ),
    h('div', { class: 'modal-foot' },
      deleteBtn,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => close() }, 'Отмена'),
      saveBtn,
    ),
  );

  const { close } = openModal(content, { className: 'modal-user' });
}

/* =========================================================
   Служебное
   ========================================================= */
function logout() {
  api.logout().catch(() => {});
  state.user = null;
  state.sections = [];
  state.tasks = [];
  state.currentSectionId = null;
  history.replaceState(null, '', location.pathname);
  renderLogin('Вы вышли из системы');
}

function handleAuthLost() {
  state.user = null;
  state.sections = [];
  state.tasks = [];
  renderLogin('Сессия истекла — войдите снова');
}

function handleError(error) {
  if (error && error.status === 401) return handleAuthLost();
  toast((error && error.message) || 'Что-то пошло не так', { tone: 'error' });
}

function themeIcon() {
  const theme = document.documentElement.dataset.theme || 'auto';
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return icon(dark ? 'sun' : 'moon');
}

function toggleTheme(button) {
  const current = document.documentElement.dataset.theme || 'auto';
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('zadachnik.theme', next); } catch { /* ignore */ }
  if (button) button.replaceChildren(themeIcon());
  toast(`Тема: ${THEME_LABEL[next]}`, { tone: 'info', duration: 1600 });
}

function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}
