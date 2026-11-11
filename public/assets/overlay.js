/* Окна, уведомления, подтверждения. */

import { h, icon } from './util.js';

export function toast(message, { tone = 'info', duration = 4200, action = null } = {}) {
  const root = document.getElementById('toasts');
  if (!root) return;
  while (root.children.length >= 4) root.firstElementChild.remove();

  const iconName = tone === 'error' ? 'alert' : tone === 'ok' ? 'check' : 'clock';
  const el = h('div', { class: 'toast', dataset: { tone }, role: 'status' },
    h('span', { class: 'toast-icon' }, icon(iconName)),
    h('span', { class: 'toast-text' }, message),
  );
  if (action && action.label) {
    el.appendChild(h('button', {
      class: 'btn btn-sm toast-action',
      type: 'button',
      onClick: () => { dismiss(); action.onClick(); },
    }, action.label));
  }

  const dismiss = () => {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 200);
  };

  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  const timer = setTimeout(dismiss, duration);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => setTimeout(dismiss, 1500));
  return dismiss;
}

export function openModal(content, { className = '', onClose = null, autofocus = true } = {}) {
  const dialog = h('dialog', { class: (`modal ${className}`).trim() });
  dialog.appendChild(content);
  document.getElementById('modalRoot').appendChild(dialog);

  const close = () => {
    if (dialog.open) dialog.close();
  };

  dialog.addEventListener('close', () => {
    dialog.remove();
    if (onClose) onClose();
  });

  dialog.addEventListener('mousedown', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right &&
      event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) close();
  });

  dialog.showModal();
  if (autofocus) {
    requestAnimationFrame(() => {
      const target = dialog.querySelector('[data-autofocus]') || dialog.querySelector('input, textarea, select, button');
      if (target) target.focus();
    });
  }
  return { dialog, close };
}

export function confirmDialog({ title, message, confirmText = 'Удалить', cancelText = 'Отмена', tone = 'danger' }) {
  return new Promise((resolve) => {
    let result = false;
    const content = h('div', {},
      h('div', { class: 'modal-head' },
        h('h2', { class: 'modal-title' }, title),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть', onClick: () => close() }, icon('close')),
      ),
      h('div', { class: 'modal-body' }, h('p', { class: 'confirm-text' }, message)),
      h('div', { class: 'modal-foot' },
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => close() }, cancelText),
        h('button', {
          class: tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary',
          type: 'button',
          'data-autofocus': '',
          onClick: () => { result = true; close(); },
        }, confirmText),
      ),
    );
    const { close } = openModal(content, { className: 'modal-sm', onClose: () => resolve(result) });
  });
}
