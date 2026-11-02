export async function request(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "HYDRA",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "Нет соединения с сервером. Проверьте подключение и повторите попытку.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const error = new Error(
      data?.message ||
        "Сервис аккаунтов недоступен. Запустите сайт через npm start.",
    );
    error.status = response.status;
    throw error;
  }
  return data;
}

let userPromise;
export function getUser() {
  userPromise ||= request("/auth/me")
    .then(({ user }) => user)
    .catch((error) => {
      if (error.status === 401) return null;
      throw error;
    });
  return userPromise;
}

export const roles = {
  user: "Пользователь",
  admin: "Администратор",
  owner: "Главный администратор",
};
export const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat("ru", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

export async function submitForm(form, action) {
  const status = form.querySelector('[role="status"]');
  const fields = form.querySelector("fieldset");
  const values = Object.fromEntries(new FormData(form));
  status.textContent = "";
  fields.disabled = true;
  form.setAttribute("aria-busy", "true");
  try {
    await action(values, status);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    fields.disabled = false;
    form.removeAttribute("aria-busy");
  }
}
