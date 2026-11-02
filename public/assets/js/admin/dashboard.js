import { formatDate, getUser, request, roles, submitForm } from "../api.js";

const login = document.getElementById("admin-login");
const dashboard = document.getElementById("admin-dashboard");
const pageStatus = document.getElementById("page-status");
const loginForm = document.getElementById("admin-login-form");
const usersBody = document.getElementById("users-body");
const eventsBody = document.getElementById("events-body");
const searchForm = document.getElementById("user-search");
let currentUser;
let usersPage = 1;
let eventsPage = 1;
let search = "";
let usersRequest = 0;

const eventNames = {
  register: "Регистрация",
  login: "Вход в аккаунт",
  logout: "Выход из аккаунта",
  owner_created: "Создан главный администратор",
  role_changed: "Изменение прав",
  password_changed: "Смена пароля",
};

function cell(row, text) {
  const element = document.createElement("td");
  element.textContent = text;
  row.append(element);
  return element;
}

function emptyRow(body, columns, message) {
  const row = document.createElement("tr");
  cell(row, message).colSpan = columns;
  body.replaceChildren(row);
}

function pagination(name, data) {
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  document.querySelector(`[data-${name}-page]`).textContent =
    `Страница ${data.page} из ${totalPages}`;
  document.querySelector(`[data-${name}-previous]`).disabled = data.page <= 1;
  document.querySelector(`[data-${name}-next]`).disabled =
    data.page >= totalPages;
}

async function loadUsers() {
  const sequence = ++usersRequest;
  const data = await request(
    `/admin/users?${new URLSearchParams({ page: usersPage, search })}`,
  );
  if (sequence !== usersRequest) return;
  document.getElementById("users-total").textContent = data.total;
  document.getElementById("admins-total").textContent = data.admins;
  usersBody.replaceChildren();
  for (const user of data.users) {
    const row = document.createElement("tr");
    const identity = cell(row, "");
    const name = document.createElement("strong");
    name.textContent = user.username;
    const email = document.createElement("span");
    email.className = "admin-email";
    email.textContent = user.email;
    identity.append(name, email);
    const role = cell(row, "");
    const badge = document.createElement("span");
    badge.className = `role-badge role-badge--${user.role}`;
    badge.textContent = roles[user.role];
    role.append(badge);
    cell(row, formatDate(user.createdAt));
    cell(row, formatDate(user.lastLoginAt));
    const action = cell(row, "—");
    if (currentUser.role === "owner" && user.role !== "owner") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary compact";
      button.textContent =
        user.role === "admin" ? "Снять права" : "Назначить админом";
      button.setAttribute(
        "aria-label",
        `${button.textContent}: ${user.username}`,
      );
      button.addEventListener("click", async () => {
        button.disabled = true;
        pageStatus.textContent = "";
        try {
          await request(`/admin/users/${user.id}/role`, {
            method: "PATCH",
            body: { role: user.role === "admin" ? "user" : "admin" },
          });
          await Promise.all([loadUsers(), loadEvents()]);
          pageStatus.textContent = `Права аккаунта ${user.username} обновлены.`;
        } catch (error) {
          showError(error);
          button.disabled = false;
        }
      });
      action.replaceChildren(button);
    }
    usersBody.append(row);
  }
  if (!data.users.length) emptyRow(usersBody, 5, "Аккаунты не найдены.");
  pagination("users", data);
}

async function loadEvents() {
  const data = await request(`/admin/events?page=${eventsPage}`);
  eventsBody.replaceChildren();
  for (const event of data.events) {
    const row = document.createElement("tr");
    cell(row, formatDate(event.createdAt));
    cell(row, eventNames[event.action] || event.action);
    cell(row, event.actorName || "—");
    cell(row, event.targetName || "—");
    cell(
      row,
      event.action === "role_changed"
        ? `${roles[event.previousRole]} → ${roles[event.newRole]}`
        : "—",
    );
    eventsBody.append(row);
  }
  if (!data.events.length)
    emptyRow(eventsBody, 5, "В журнале пока нет событий.");
  pagination("events", data);
}

function showError(error) {
  pageStatus.textContent = error.message;
  if (error.status === 401 || error.status === 403) {
    dashboard.hidden = true;
    login.hidden = false;
    usersBody.replaceChildren();
    eventsBody.replaceChildren();
  }
}

async function showDashboard(user) {
  currentUser = user;
  if (!user || user.role === "user") {
    login.hidden = false;
    if (user)
      pageStatus.textContent =
        "У этого аккаунта нет прав администратора. Войдите под другим аккаунтом.";
    return;
  }
  login.hidden = true;
  dashboard.hidden = false;
  document.getElementById("admin-identity").textContent =
    `${user.username} · ${roles[user.role]}`;
  document.getElementById("role-help").textContent =
    user.role === "owner"
      ? "Вы можете назначать и снимать администраторов."
      : "Назначать и снимать администраторов может только главный администратор.";
  await Promise.all([loadUsers(), loadEvents()]);
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitForm(loginForm, async (values) => {
    const { user } = await request("/auth/login", {
      method: "POST",
      body: values,
    });
    loginForm.reset();
    pageStatus.textContent = "";
    await showDashboard(user);
  });
});

document
  .getElementById("admin-logout")
  .addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await request("/auth/logout", { method: "POST", body: {} });
      location.reload();
    } catch (error) {
      showError(error);
      button.disabled = false;
    }
  });

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  search = new FormData(searchForm).get("search").trim();
  usersPage = 1;
  loadUsers().catch(showError);
});

for (const name of ["users", "events"]) {
  for (const direction of ["previous", "next"]) {
    document
      .querySelector(`[data-${name}-${direction}]`)
      .addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        const delta = direction === "next" ? 1 : -1;
        if (name === "users") usersPage += delta;
        else eventsPage += delta;
        try {
          await (name === "users" ? loadUsers() : loadEvents());
        } catch (error) {
          if (name === "users") usersPage -= delta;
          else eventsPage -= delta;
          button.disabled = false;
          showError(error);
        }
      });
  }
}

getUser()
  .then(showDashboard)
  .catch((error) => {
    login.hidden = false;
    showError(error);
  });
