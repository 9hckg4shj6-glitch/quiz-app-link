import "./motion.css";

// 押した点からインクが広がる演出。対象は主要なボタン類だけ（小さいアイコンボタンには付けない）。
const INK_TARGETS = ".btn,.choice,.qbtn,.hubBtn,.spCard,.cat,.utilityBtn,.primaryNav button,.confBtn,.memoryDeckOpen,.reviewQuestion,.lsReadBtn,.study-primary,.study-secondary";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

document.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || reduceMotion.matches || !(event.target instanceof Element)) return;
  const host = event.target.closest<HTMLElement>(INK_TARGETS);
  if (!host || (host as HTMLButtonElement).disabled) return;
  if (getComputedStyle(host).position === "static") host.style.position = "relative";

  const rect = host.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const radius = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y));
  const layer = document.createElement("span");
  layer.className = "ink";
  layer.setAttribute("aria-hidden", "true");
  const drop = document.createElement("i");
  drop.style.cssText = `left:${x - radius}px;top:${y - radius}px;width:${radius * 2}px;height:${radius * 2}px`;
  layer.append(drop);
  host.append(layer);

  const done = new AbortController();
  const release = () => {
    done.abort();
    layer.classList.add("out");
    setTimeout(() => layer.remove(), 400);
  };
  window.addEventListener("pointerup", release, { signal: done.signal });
  window.addEventListener("pointercancel", release, { signal: done.signal });
});
