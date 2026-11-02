import { getUser, request } from "./api.js";

async function initializeAccountMenu() {
  const navigation = document.querySelector("[data-account-nav]");
  if (!navigation) return;
  const user = await getUser();
  if (!user) return;
  navigation.querySelector("[data-guest-links]").hidden = true;
  const menu = navigation.querySelector("details");
  menu.hidden = false;
  menu.querySelector("[data-username]").textContent = user.username;
  menu.querySelector("[data-avatar]").textContent =
    user.username[0].toUpperCase();
  menu.querySelector("[data-admin-link]").hidden = user.role === "user";
  let closeTimer;
  menu.addEventListener("pointerenter", (event) => {
    clearTimeout(closeTimer);
    if (event.pointerType === "mouse") menu.open = true;
  });
  menu.addEventListener("pointerleave", () => {
    closeTimer = setTimeout(() => {
      if (!menu.contains(document.activeElement)) menu.open = false;
    }, 180);
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      menu.open = false;
      menu.querySelector("summary").focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target)) menu.open = false;
  });
  menu.addEventListener("focusout", (event) => {
    if (!menu.contains(event.relatedTarget)) menu.open = false;
  });
  const logout = menu.querySelector("[data-logout]");
  logout.addEventListener("click", async () => {
    logout.disabled = true;
    const status = menu.querySelector('[role="status"]');
    try {
      await request("/auth/logout", { method: "POST", body: {} });
      location.assign("/index.html");
    } catch (error) {
      status.textContent = error.message;
      logout.disabled = false;
    }
  });
}

initializeAccountMenu().catch(() => {});
