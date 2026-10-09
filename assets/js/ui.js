/* Только поведение интерфейса. Разметка и контент находятся в HTML. */
(() => {
  'use strict';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ease = 'cubic-bezier(.22, 1, .36, 1)';
  const animations = new Set();
  const animate = (element, frames, duration) => {
    const animation = element.animate(frames, { duration, easing: ease, fill: 'both' });
    animations.add(animation);
    animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
    return animation;
  };
  reduced.addEventListener('change', () => {
    if (!reduced.matches) return;
    animations.forEach(animation => { try { animation.finish(); } catch { animation.cancel(); } });
    document.querySelectorAll('.scroll-reveal').forEach(element => element.classList.remove('scroll-reveal'));
  });
  document.querySelectorAll('[data-year]').forEach(element => { element.textContent = new Date().getFullYear(); });

  // Меню работает мышью, нажатием, клавиатурой и на сенсорном экране.
  document.querySelectorAll('.account-dropdown').forEach(menu => {
    const trigger = menu.querySelector('summary');
    const panel = menu.querySelector('.account-menu');
    let expanded = menu.open;
    let active;
    let timer;
    const setOpen = value => {
      clearTimeout(timer);
      if (expanded === value) return;
      expanded = value;
      const closed = !menu.open;
      if (value) menu.open = true;
      trigger.setAttribute('aria-expanded', String(value));
      const style = getComputedStyle(panel);
      const from = { opacity: closed ? 0 : style.opacity, transform: closed ? 'translateY(-7px)' : style.transform };
      active?.cancel();
      panel.style.pointerEvents = value ? '' : 'none';
      if (reduced.matches || !panel.animate) { menu.open = value; panel.style.pointerEvents = ''; return; }
      const animation = animate(panel, [from, { opacity: value ? 1 : 0, transform: value ? 'translateY(0)' : 'translateY(-5px)' }], value ? 300 : 220);
      active = animation;
      animation.finished.then(() => {
        if (active !== animation) return;
        menu.open = expanded; panel.style.pointerEvents = ''; animation.cancel(); active = null;
      }, () => {});
    };
    trigger.addEventListener('click', event => { event.preventDefault(); setOpen(!expanded); });
    menu.addEventListener('pointerenter', event => { clearTimeout(timer); if (event.pointerType === 'mouse' && matchMedia('(hover: hover)').matches) timer = setTimeout(() => setOpen(true), 80); });
    menu.addEventListener('pointerleave', () => { clearTimeout(timer); if (!menu.contains(document.activeElement)) timer = setTimeout(() => setOpen(false), 140); });
    menu.addEventListener('focusout', event => { if (!menu.contains(event.relatedTarget)) setOpen(false); });
    document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) setOpen(false); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu.open) { setOpen(false); trigger.focus(); } });
  });

  // FAQ остаётся читаемым и без JavaScript: это обычные details/summary.
  document.querySelectorAll('.faq-item').forEach(item => {
    const summary = item.querySelector('summary');
    const answer = item.querySelector('p');
    let expanded = item.open;
    let active;
    summary.addEventListener('click', event => {
      event.preventDefault(); expanded = !expanded;
      const start = item.getBoundingClientRect().height;
      active?.cancel();
      if (reduced.matches || !item.animate) { item.open = expanded; item.style.overflow = ''; return; }
      item.open = true;
      const end = summary.getBoundingClientRect().height + (expanded ? answer.getBoundingClientRect().height : 0) + 1;
      item.style.overflow = 'hidden';
      const animation = animate(item, [{ height: `${start}px` }, { height: `${end}px` }], expanded ? 360 : 280);
      active = animation;
      animation.finished.then(() => {
        if (active !== animation) return;
        item.open = expanded; item.style.overflow = ''; animation.cancel(); active = null;
      }, () => {});
    });
  });

  // Плавное появление один раз. Колесо мыши и обычный скролл не перехватываются.
  if (!reduced.matches && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting) return;
        target.classList.remove('scroll-reveal'); observer.unobserve(target);
        if (!reduced.matches && target.animate) {
          const animation = animate(target, [{ opacity: 0, translate: '0 12px' }, { opacity: 1, translate: '0 0' }], 560);
          animation.finished.then(() => animation.cancel(), () => {});
        }
      });
    }, { threshold: 0, rootMargin: '0px 0px -16px 0px' });
    document.querySelectorAll('[data-reveal]').forEach(element => {
      if (element.getBoundingClientRect().top > innerHeight && !element.parentElement.closest('[data-reveal]')) {
        element.classList.add('scroll-reveal'); observer.observe(element);
      }
    });
  }

  // Заглушка выдачи: никаких имитаций скачивания или ссылок на несуществующий ZIP.
  const dialog = document.getElementById('notice-dialog');
  let returnFocus;
  document.querySelectorAll('[data-unavailable]').forEach(button => button.addEventListener('click', () => {
    returnFocus = button;
    dialog.showModal();
  }));
  dialog?.querySelector('[data-close-dialog]')?.addEventListener('click', () => dialog.close());
  dialog?.addEventListener('close', () => returnFocus?.focus());

  // Формы — UI-шаблоны. Без JS поля выключены; отправки по умолчанию нет.
  // Событие hydra:form-submit — точка подключения клиентского backend.
  document.querySelectorAll('[data-demo-form]').forEach(form => {
    form.querySelector('[data-demo-fields]').disabled = false;
    form.addEventListener('submit', event => event.preventDefault());
    const feedback = form.querySelector('[data-form-status]');
    form.querySelector('[data-demo-submit]').addEventListener('click', () => {
      feedback.textContent = '';
      if (!form.reportValidity()) return;
      const password = form.elements.namedItem('password');
      const confirmation = form.elements.namedItem('password-confirm');
      if (confirmation && password.value !== confirmation.value) { feedback.textContent = 'Пароли не совпадают.'; confirmation.focus(); return; }
      const action = new CustomEvent('hydra:form-submit', { bubbles: true, cancelable: true, detail: { formId: form.id } });
      if (!form.dispatchEvent(action)) return;
      feedback.textContent = 'Это пример формы. Данные не отправлены и не сохранены. Подключение сервера ещё не настроено.';
      form.querySelectorAll('input[type="password"]').forEach(input => { input.value = ''; });
    });
  });
})();
