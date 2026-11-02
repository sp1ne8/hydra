import { formatDate, getUser, request, roles, submitForm } from "./api.js";

const form = document.querySelector("[data-auth-form]");
if (form) {
  const action = form.dataset.authForm;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitForm(form, async (values) => {
      await request(`/auth/${action}`, { method: "POST", body: values });
      form.reset();
      location.assign("/account.html");
    });
  });
  getUser()
    .then((user) => {
      if (user) location.replace("/account.html");
    })
    .catch(() => {});
}

const account = document.querySelector("[data-profile]");
if (account) {
  const status = document.querySelector("[data-profile-status]");
  getUser()
    .then((user) => {
      if (!user) {
        location.replace("/login.html");
        return;
      }
      account.hidden = false;
      status.hidden = true;
      for (const key of ["username", "email"])
        account.querySelector(`[data-${key}]`).textContent = user[key];
      account.querySelector("[data-role]").textContent = roles[user.role];
      account.querySelector("[data-created]").textContent = formatDate(
        user.createdAt,
      );
      account.querySelector("[data-admin-link]").hidden = user.role === "user";
    })
    .catch((error) => {
      status.textContent = error.message;
    });

  const passwordForm = document.getElementById("password-form");
  passwordForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitForm(passwordForm, async (values, feedback) => {
      await request("/auth/password", { method: "POST", body: values });
      passwordForm.reset();
      feedback.textContent = "Пароль изменён. Остальные сеансы завершены.";
    });
  });
}
