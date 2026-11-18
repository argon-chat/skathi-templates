import { ref } from "vue";

export const tip = ref<{ text: string; x: number; y: number; below: boolean } | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

/** Shows `text` beside `el` after a short hover; above it, or below when `below`. */
export function showTip(event: Event, text: string, below = false) {
  const el = event.currentTarget;
  if (!(el instanceof HTMLElement)) return;
  if (event.type === "focus" && !el.matches(":focus-visible")) return;
  clearTimeout(timer);
  const place = () => {
    const box = el.getBoundingClientRect();
    tip.value = { text, x: box.x + box.width / 2, y: below ? box.y + box.height + 8 : box.y - 8, below };
  };
  if (tip.value || event.type === "focus") place();
  else timer = setTimeout(place, 450);
}

export function hideTip() {
  clearTimeout(timer);
  tip.value = null;
}
