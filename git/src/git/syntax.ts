// A line-at-a-time highlighter: keywords, strings, numbers and comments for the common C-like and script
// languages. It does not track state across lines, which a diff of fragments could not give it anyway.

export type Token = { from: number; to: number; name: "kw" | "str" | "num" | "com" };

export interface Lang {
  keywords: Set<string>;
  line: string[];
  hash: boolean;
}

const words = (s: string) => new Set(s.split(" "));
const C_LIKE =
  "if else for while do switch case break continue return default new delete try catch finally throw class struct enum interface extends implements import export from as const let var function static public private protected void true false null this super typeof instanceof in of async await yield";

const LANGS: Record<string, Lang> = {
  js: {
    keywords: words(`${C_LIKE} undefined type readonly declare namespace keyof satisfies`),
    line: ["//"],
    hash: false,
  },
  rs: {
    keywords: words(
      "fn let mut pub use mod impl trait struct enum match if else for while loop return self Self crate super where as const static unsafe async await move dyn ref true false Some None Ok Err type in",
    ),
    line: ["//"],
    hash: false,
  },
  go: {
    keywords: words(`${C_LIKE} func package go defer chan map range select type nil var`),
    line: ["//"],
    hash: false,
  },
  c: {
    keywords: words(
      `${C_LIKE} int char long short unsigned signed float double bool auto sizeof typedef include define namespace template typename using virtual override nullptr`,
    ),
    line: ["//"],
    hash: false,
  },
  py: {
    keywords: words(
      "def class if elif else for while return import from as with try except finally raise pass break continue lambda yield None True False and or not in is global nonlocal async await self",
    ),
    line: [],
    hash: true,
  },
  sh: {
    keywords: words("if then else elif fi for while do done case esac function return in export local echo"),
    line: [],
    hash: true,
  },
  css: { keywords: words("important media supports keyframes import from to"), line: [], hash: false },
};

const EXT: Record<string, string> = {
  ts: "js",
  tsx: "js",
  js: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  vue: "js",
  svelte: "js",
  json: "js",
  rs: "rs",
  go: "go",
  c: "c",
  h: "c",
  cc: "c",
  cpp: "c",
  hpp: "c",
  cs: "c",
  java: "c",
  kt: "c",
  swift: "c",
  py: "py",
  sh: "sh",
  bash: "sh",
  zsh: "sh",
  ps1: "sh",
  toml: "sh",
  yaml: "sh",
  yml: "sh",
  css: "css",
  scss: "css",
};

export function languageFor(path: string): Lang | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const id = EXT[ext];
  return id ? LANGS[id]! : null;
}

const WORD = /[A-Za-z_$][\w$]*/y;
const NUMBER = /(?:0x[\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)/y;

export function tokenize(text: string, lang: Lang): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if ((lang.hash && ch === "#") || lang.line.some((p) => text.startsWith(p, i))) {
      out.push({ from: i, to: n, name: "com" });
      break;
    }
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      const to = end < 0 ? n : end + 2;
      out.push({ from: i, to, name: "com" });
      i = to;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n && text[j] !== ch) j += text[j] === "\\" ? 2 : 1;
      const to = Math.min(n, j + 1);
      out.push({ from: i, to, name: "str" });
      i = to;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      WORD.lastIndex = i;
      const m = WORD.exec(text)!;
      if (lang.keywords.has(m[0])) out.push({ from: i, to: i + m[0].length, name: "kw" });
      i += m[0].length;
      continue;
    }
    if (/\d/.test(ch)) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(text);
      const len = m ? m[0].length : 1;
      out.push({ from: i, to: i + len, name: "num" });
      i += len;
      continue;
    }
    i++;
  }
  return out;
}
