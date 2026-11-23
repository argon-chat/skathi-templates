// Avatars without the network: a gradient picked by the e-mail's hash, with the author's initials.

const cache = new Map<string, { background: string; initials: string }>();

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function avatar(name: string, email: string) {
  const key = `${name}\0${email}`;
  let found = cache.get(key);
  if (!found) {
    const h = hash(email.toLowerCase() || name);
    const hue = h % 360;
    const second = (hue + 40 + ((h >> 9) % 80)) % 360;
    const initials =
      name
        .split(/[\s._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]!.toUpperCase())
        .join("") || "?";
    found = {
      background: `linear-gradient(135deg, hsl(${hue} 72% 58%), hsl(${second} 70% 44%))`,
      initials,
    };
    cache.set(key, found);
  }
  return found;
}
