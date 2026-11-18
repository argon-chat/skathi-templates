import { ref } from "vue";

export type TipPlace = "above" | "below" | "right";

export const tip = ref<{ text: string; x: number; y: number; place: TipPlace } | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

/** Shows `text` beside `el` after a short hover: above it, below it when `below`, or to its right. */
export function showTip(event: Event, text: string, below = false, side?: "right") {
  const el = event.currentTarget;
  if (!(el instanceof HTMLElement)) return;
  if (event.type === "focus" && !el.matches(":focus-visible")) return;
  clearTimeout(timer);
  const place = () => {
    const box = el.getBoundingClientRect();
    tip.value =
      side === "right"
        ? { text, x: box.x + box.width + 10, y: box.y + box.height / 2, place: "right" }
        : {
            text,
            x: box.x + box.width / 2,
            y: below ? box.y + box.height + 8 : box.y - 8,
            place: below ? "below" : "above",
          };
  };
  if (tip.value || event.type === "focus") place();
  else timer = setTimeout(place, 450);
}

export function hideTip() {
  clearTimeout(timer);
  tip.value = null;
}
