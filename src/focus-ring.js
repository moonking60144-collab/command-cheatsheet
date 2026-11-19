const motion = matchMedia("(prefers-reduced-motion: no-preference) and (forced-colors: none)");
const regions = ".filter-bar,.category-picker,.inspector,.sticky-search-bar,.hero,.results-section";
let last = null;
let ring = null;

function settle() {
  last?.removeAttribute("data-ring-arriving");
  ring?.remove();
  ring = null;
}

function reset() {
  settle();
  last = null;
}

function visibleIn(rect, bounds) {
  return rect.width > 0 && rect.height > 0 &&
    rect.left >= Math.max(0, bounds.left) - 1 && rect.right <= Math.min(innerWidth, bounds.right) + 1 &&
    rect.top >= Math.max(0, bounds.top) - 1 && rect.bottom <= Math.min(innerHeight, bounds.bottom) + 1;
}

function setFrame(element, prefix, rect, radius) {
  for (const [name, value] of [["x",rect.left],["y",rect.top],["w",rect.width],["h",rect.height]]) {
    element.style.setProperty("--" + prefix + "-" + name, value + "px");
  }
  element.style.setProperty("--" + prefix + "-r",radius);
}

document.addEventListener("focusin", ({target}) => {
  if (!motion.matches || !target.matches("button:focus-visible,input:focus-visible,summary:focus-visible,.command-card:focus-visible")) {
    reset();
    return;
  }
  const group = target.closest(regions);
  const origin = ring || last;
  const sharedGroup = group && last?.isConnected && last.closest(regions) === group;
  const start = sharedGroup && origin.getBoundingClientRect();
  const startRadius = start && getComputedStyle(origin).borderTopLeftRadius;
  settle();
  last = target;
  if (!start) return;
  const end = target.getBoundingClientRect();
  const bounds = group.getBoundingClientRect();
  const distance = Math.hypot(start.left + start.width / 2 - end.left - end.width / 2,
                              start.top + start.height / 2 - end.top - end.height / 2);
  if (distance < 1 || distance > 310 || !visibleIn(start,bounds) || !visibleIn(end,bounds)) return;

  // Only the travelling frame is shared. At rest the real control draws its own outline.
  const next = document.createElement("span");
  next.className = "travelling-focus-ring";
  if (group.classList.contains("filter-bar")) next.classList.add("sidebar-focus-ring");
  next.setAttribute("aria-hidden","true");
  setFrame(next,"from",start,startRadius);
  setFrame(next,"to",end,getComputedStyle(target).borderTopLeftRadius);
  next.style.setProperty("--travel-time",Math.round(Math.min(200,155 + distance * .18)) + "ms");
  const finish = () => { if (ring === next) settle(); };
  next.addEventListener("animationend",finish,{once:true});
  next.addEventListener("animationcancel",finish,{once:true});
  ring = next;
  document.body.append(next);
  target.setAttribute("data-ring-arriving","");
});

document.addEventListener("focusout", event => {
  if (!event.relatedTarget) reset();
});
document.addEventListener("pointerdown",reset,true);
window.addEventListener("blur",reset);
window.addEventListener("resize",settle);
document.addEventListener("scroll",settle,{capture:true,passive:true});
document.addEventListener("visibilitychange",() => { if (document.hidden) reset(); });
motion.addEventListener("change",reset);
