/* Клиент API. */

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'fetch',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Нет связи с сервером. Проверьте, запущен ли он.', 0, null);
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new ApiError((data && data.error) || `Ошибка ${response.status}`, response.status, data);
  }
  return data;
}

export const api = {
  me: () => request('/api/me'),
  setup: (body) => request('/api/setup', { method: 'POST', body }),
  login: (body) => request('/api/login', { method: 'POST', body }),
  logout: () => request('/api/logout', { method: 'POST' }),

  sections: () => request('/api/sections'),
  createSection: (name) => request('/api/sections', { method: 'POST', body: { name } }),
  renameSection: (id, name) => request(`/api/sections/${id}`, { method: 'PATCH', body: { name } }),
  deleteSection: (id) => request(`/api/sections/${id}`, { method: 'DELETE' }),

  tasks: (sectionId) => request(`/api/sections/${sectionId}/tasks`),
  createTask: (sectionId, body) => request(`/api/sections/${sectionId}/tasks`, { method: 'POST', body }),
  updateTask: (id, body) => request(`/api/tasks/${id}`, { method: 'PATCH', body }),
  deleteTask: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),
  addComment: (taskId, text) => request(`/api/tasks/${taskId}/comments`, { method: 'POST', body: { text } }),
  deleteComment: (taskId, commentId) => request(`/api/tasks/${taskId}/comments/${commentId}`, { method: 'DELETE' }),

  users: () => request('/api/users'),
  createUser: (body) => request('/api/users', { method: 'POST', body }),
  updateUser: (id, body) => request(`/api/users/${id}`, { method: 'PATCH', body }),
  deleteUser: (id) => request(`/api/users/${id}`, { method: 'DELETE' }),
  setPermissions: (id, permissions) => request(`/api/users/${id}/permissions`, { method: 'PUT', body: { permissions } }),
};
