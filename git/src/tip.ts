import { ref, type Directive } from "vue";

export const tip = ref<{ text: string; keys: string; x: number; y: number; above: boolean } | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

const isMac = navigator.platform === "MacIntel";

/** `"Ctrl+Enter"` as the platform writes it. */
export function keys(combo: string): string {
  return isMac
    ? combo
        .replace(/Ctrl\+/g, "⌘")
        .replace(/Shift\+/g, "⇧")
        .replace(/Alt\+/g, "⌥")
    : combo;
}

type TipValue = string | [label: string, combo: string];
type TipElement = HTMLElement & { __tip?: TipValue };

function show(el: TipElement, now: boolean) {
  const value = el.__tip;
  if (!value) return;
  const [text, combo] = typeof value === "string" ? [value, ""] : value;
  clearTimeout(timer);
  const place = () => {
    const box = el.getBoundingClientRect();
    const above = box.bottom + 40 > innerHeight;
    const x = Math.min(Math.max(box.x + box.width / 2, 90), innerWidth - 90);
    tip.value = { text, keys: combo ? keys(combo) : "", x, y: above ? box.y - 6 : box.bottom + 6, above };
  };
  if (now || tip.value) place();
  else timer = setTimeout(place, 500);
}

export function hideTip() {
  clearTimeout(timer);
  tip.value = null;
}

/** `v-tip="'Refresh'"` or `v-tip="['Commit', 'Ctrl+Enter']"`: a tooltip with its shortcut. */
export const vTip: Directive<TipElement, TipValue> = {
  mounted(el, binding) {
    el.__tip = binding.value;
    el.addEventListener("pointerenter", () => show(el, false));
    el.addEventListener("pointerleave", hideTip);
    el.addEventListener("pointerdown", hideTip);
    el.addEventListener("focus", () => {
      if (el.matches(":focus-visible")) show(el, true);
    });
    el.addEventListener("blur", hideTip);
  },
  updated(el, binding) {
    el.__tip = binding.value;
  },
  unmounted() {
    hideTip();
  },
};
