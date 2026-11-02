const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const activeAnimations = new Set();

function animate(element, frames, duration) {
  const animation = element.animate(frames, {
    duration,
    easing: "cubic-bezier(.22, 1, .36, 1)",
    fill: "both",
  });
  activeAnimations.add(animation);
  animation.finished.then(
    () => activeAnimations.delete(animation),
    () => activeAnimations.delete(animation),
  );
  return animation;
}

function initializeFAQ() {
  document.querySelectorAll(".faq-item").forEach((item) => {
    const summary = item.querySelector("summary");
    const answer = item.querySelector("p");
    let expanded = item.open;
    let active;

    summary.addEventListener("click", (event) => {
      event.preventDefault();
      expanded = !expanded;
      const startHeight = item.getBoundingClientRect().height;
      active?.cancel();

      if (motionPreference.matches || !item.animate) {
        item.open = expanded;
        item.style.overflow = "";
        return;
      }

      item.open = true;
      const endHeight =
        summary.getBoundingClientRect().height +
        (expanded ? answer.getBoundingClientRect().height : 0) +
        1;
      item.style.overflow = "hidden";
      active = animate(
        item,
        [{ height: `${startHeight}px` }, { height: `${endHeight}px` }],
        expanded ? 360 : 280,
      );

      const animation = active;
      animation.finished.then(
        () => {
          if (active !== animation) return;
          item.open = expanded;
          item.style.overflow = "";
          animation.cancel();
          active = null;
        },
        () => {},
      );
    });
  });
}

function initializeReveals() {
  if (motionPreference.matches || !("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting) return;
        target.classList.remove("scroll-reveal");
        observer.unobserve(target);

        if (!motionPreference.matches && target.animate) {
          const animation = animate(
            target,
            [
              { opacity: 0, translate: "0 12px" },
              { opacity: 1, translate: "0 0" },
            ],
            560,
          );
          animation.finished.then(
            () => animation.cancel(),
            () => {},
          );
        }
      });
    },
    { threshold: 0, rootMargin: "0px 0px -16px 0px" },
  );

  document.querySelectorAll("[data-reveal]").forEach((element) => {
    if (
      element.getBoundingClientRect().top > innerHeight &&
      !element.parentElement.closest("[data-reveal]")
    ) {
      element.classList.add("scroll-reveal");
      observer.observe(element);
    }
  });
}

function initializeDownloadNotice() {
  const dialog = document.getElementById("notice-dialog");
  if (!dialog) return;
  let trigger;

  document.querySelectorAll("[data-unavailable]").forEach((button) => {
    button.addEventListener("click", () => {
      trigger = button;
      dialog.showModal();
    });
  });
  dialog
    .querySelector("[data-close-dialog]")
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => trigger?.focus());
}

motionPreference.addEventListener("change", () => {
  if (!motionPreference.matches) return;
  activeAnimations.forEach((animation) => animation.finish());
  document
    .querySelectorAll(".scroll-reveal")
    .forEach((element) => element.classList.remove("scroll-reveal"));
});

document.querySelectorAll("[data-year]").forEach((element) => {
  element.textContent = new Date().getFullYear();
});

initializeFAQ();
initializeReveals();
initializeDownloadNotice();
