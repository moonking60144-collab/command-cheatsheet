const motion = matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
const results = document.getElementById("results");
let active = null;
let point = null;
let frame = 0;

function clearSurface() {
  if (!active) return;
  active.classList.remove("pointer-lit");
  active.style.removeProperty("--light-x");
  active.style.removeProperty("--light-y");
  active.style.removeProperty("--light-h");
  active = null;
}

function stop() {
  cancelAnimationFrame(frame);
  frame = 0;
  point = null;
  clearSurface();
}

function paint() {
  frame = 0;
  if (!point) return;
  const { x, y } = point;
  const next = document.elementFromPoint(x, y)?.closest("#results .command-card");
  const rect = next?.getBoundingClientRect();
  if (next !== active) clearSurface();
  if (next) {
    active = next;
    next.style.setProperty("--light-x", `${x - rect.left}px`);
    next.style.setProperty("--light-y", `${y - rect.top}px`);
    next.style.setProperty("--light-h", `${rect.height}px`);
    next.classList.add("pointer-lit");
  }
}

function schedule() {
  if (point && !frame) frame = requestAnimationFrame(paint);
}
function move(event) {
  if (event.pointerType !== "mouse") { stop(); return; }
  point = { x:event.clientX, y:event.clientY };
  schedule();
}

function configure() {
  stop();
  results.removeEventListener("pointermove", move);
  if (motion.matches) results.addEventListener("pointermove", move, { passive:true });
}
configure();
motion.addEventListener("change", configure);
results.addEventListener("pointerleave", stop);
document.addEventListener("pointercancel", stop);
document.addEventListener("keydown", stop);
document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
window.addEventListener("blur", stop);
window.addEventListener("resize", schedule);
document.addEventListener("scroll", schedule, { capture:true, passive:true });
new ResizeObserver(schedule).observe(results);
new MutationObserver(schedule).observe(results, { childList: true });
