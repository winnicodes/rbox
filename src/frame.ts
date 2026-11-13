// frame.html: the recording ring, the delay countdown, the screenshot menu host
// (?pick) and the tooltip window (?tip). A module of its own, not inline in the
// HTML: Vite's html-proxy for inline code broke the build intermittently on
// Windows (drive letter case in its cache key).
export {};

const params = new URLSearchParams(location.search);

// Countdown before a delayed capture, ticking down to 1.
let count = Number(params.get("count"));
if (count > 0) {
  const el = document.getElementById("msg")!;
  el.classList.add("count");
  el.textContent = String(count);
  document.body.classList.add("counting");
  const id = setInterval(() => {
    if (--count > 0) el.textContent = String(count);
    else clearInterval(id);
  }, 1000);
}

// Tip mode (?tip): a click-through window holding one tooltip.
if (params.has("tip")) {
  document.querySelector(".ring")?.remove();
  document.body.classList.add("tip");
  const { runTipPage } = await import("./lib/tipWindow");
  await runTipPage();
}

// Pick mode (?pick): an invisible 1 px window that only opens the native
// menu after a screenshot. Loaded on demand so the ring stays light.
if (params.has("pick")) {
  document.querySelector(".ring")?.remove();
  const { popShotMenu } = await import("./lib/shotMenu");
  await popShotMenu();
}
