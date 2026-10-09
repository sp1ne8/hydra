/*
 * МЕСТО ДЛЯ ВАШЕГО BACKEND
 * Сейчас этот файл не выполняет запросов и не читает поля форм.
 * UI работает самостоятельно: контент всегда находится в HTML.
 *
 * После появления настоящего API подключайте нужную форму так:
 *
 * document.addEventListener('hydra:form-submit', async (event) => {
 *   if (event.detail.formId !== 'login-form') return;
 *   event.preventDefault(); // Вы берёте обработку на себя ДО первого await.
 *   const form = event.target;
 *   const feedback = form.querySelector('[data-form-status]');
 *   // Здесь ваша валидация, запрос, обработка ошибок и переход после успеха.
 *   // Читайте значения из form.elements. Backend обязан повторить проверки.
 * });
 *
 * Пароли, секретные ключи и роли не храните в браузере.
 * admin.html — публичный макет, НЕ защищённая админка.
 * Для реальных аккаунтов нужны серверные сессии, проверка прав и защита запросов.
 * Исходный Express/Prisma backend сохранён в ../server основного проекта.
 */
