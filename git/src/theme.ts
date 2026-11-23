import { computed, ref } from "vue";

const query = matchMedia("(prefers-color-scheme: dark)");
export const dark = ref(query.matches);
query.addEventListener("change", (e) => (dark.value = (e as MediaQueryListEvent).matches));

const reduce = matchMedia("(prefers-reduced-motion: reduce)");
export const reducedMotion = ref(reduce.matches);
reduce.addEventListener("change", (e) => (reducedMotion.value = (e as MediaQueryListEvent).matches));

const DARK_LANES = ["#9488ff", "#4fe0c6", "#ff7d6b", "#ffc24d", "#5cb6ff", "#ff70c8", "#9de05e", "#ff9d4a"];
const LIGHT_LANES = ["#5a4de0", "#0f9e8e", "#e0533f", "#c48300", "#1c7fd6", "#cc3d97", "#4f9a21", "#d4691a"];

/** The lane colours of the commit graph, also used for branch pills. */
export const lanes = computed(() => (dark.value ? DARK_LANES : LIGHT_LANES));
export const accent = computed(() => lanes.value[0]!);
export const accent2 = computed(() => lanes.value[1]!);
