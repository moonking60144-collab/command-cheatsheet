const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const layoutAnimations = new WeakMap();
const resultAnimations = new WeakMap();
const easing = "cubic-bezier(0.22, 1, 0.36, 1)";

// Measure each affected card once on either side of a synchronous mutation.
// Reversals start at the visible height, so repeated clicks never queue motion.
export function animateLayout(elements, update) {
  const heights = elements.map((element) => element.getBoundingClientRect().height);
  const transitions = elements.map((element) => element.style.transition);
  elements.forEach((element) => {
    layoutAnimations.get(element)?.cancel();
    // Measure the final padding as well as the content. A simultaneous CSS
    // padding transition would otherwise leave a jump at the end of the tween.
    element.style.transition = "none";
  });
  update();
  const nextHeights = elements.map((element) => element.getBoundingClientRect().height);
  elements.forEach((element, index) => {
    element.style.transition = transitions[index];
    if (reducedMotion.matches || Math.abs(heights[index] - nextHeights[index]) < 1) return;
    const animation = element.animate([
      { height: `${heights[index]}px`, overflow: "clip" },
      { height: `${nextHeights[index]}px`, overflow: "clip" }
    ], { duration: 240, easing });
    layoutAnimations.set(element, animation);
  });
}

// The new results are committed before animating. Motion never delays a query
// or retains an old render that could replace a more recent worker response.
export function animateResults(element, duration = 180) {
  resultAnimations.get(element)?.cancel();
  if (reducedMotion.matches) return;
  const animation = element.animate([
    { opacity: 0.65, transform: "translateY(4px)" },
    { opacity: 1, transform: "translateY(0)" }
  ], { duration, easing });
  resultAnimations.set(element, animation);
}
