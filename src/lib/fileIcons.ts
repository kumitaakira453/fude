// ファイルとフォルダの顔。名前 → 拡張子 → 既定の順に引き、字形と色を返す。
//
// 字形は Tabler Icons の線画。使う分だけを取り込み、アプリに同梱する（全部を
// 取り込むと 5,000 字を超える）。色は CSS の変数（--mg-ic-*）で、テーマごとの
// 色の組から引く。

export type Tone =
  | "accent"
  | "blue"
  | "cyan"
  | "green"
  | "yellow"
  | "orange"
  | "red"
  | "purple"
  | "gray";

export interface Face {
  glyph: string;
  tone: Tone;
}

const raw = import.meta.glob(
  "/node_modules/@tabler/icons/icons/outline/{markdown,file-text,file,file-code,file-settings,file-info,file-certificate,file-spreadsheet,file-zip,file-music,file-type-ts,file-type-tsx,file-type-js,file-type-jsx,file-type-html,file-type-css,file-type-php,file-type-pdf,file-type-csv,file-type-png,file-type-jpg,file-type-svg,file-type-txt,file-type-xml,file-type-rs,file-type-sql,file-type-vue,file-type-doc,file-type-xls,file-type-ppt,file-type-docx,braces,brand-python,brand-rust,brand-golang,brand-docker,brand-git,brand-npm,brand-github,brand-swift,brand-kotlin,brand-c-sharp,brand-cpp,brand-php,brand-sass,brand-vite,brand-react,brand-typescript,coffee,diamond,letter-c,terminal-2,database,lock,key,license,photo,movie,gif,table,package,tool,flask,folder,folder-open,folder-code,folder-cog,folders}.svg",
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

// 外枠を外した中身。外枠の大きさと線の太さは描く側（FileIcon）で決める。
const glyphs = new Map<string, string>();
for (const [path, svg] of Object.entries(raw)) {
  const name = path.slice(path.lastIndexOf("/") + 1, -".svg".length);
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  // 枠いっぱいの透明な四角（Tabler が大きさ合わせに置く）は描かない。
  glyphs.set(name, inner.replace(/<path stroke="none" d="M0 0h24v24H0z" fill="none" \/>/, "").trim());
}

export function glyphOf(name: string): string | null {
  return glyphs.get(name) ?? null;
}

const face = (glyph: string, tone: Tone): Face => ({ glyph, tone });

// 表に並べた字形の一覧。取り込み漏れを試験で拾う。
export const usedGlyphs = (): string[] =>
  [...Object.values(BY_NAME), ...Object.values(BY_EXT), ...Object.values(BY_DIR), FILE].map(
    (f) => f.glyph,
  ).concat(["folder", "folder-open"]);

// 名前で決まるもの。拡張子より先に見る（package.json は json の形にしない）。
const BY_NAME: Record<string, Face> = {
  "package.json": face("brand-npm", "red"),
  "package-lock.json": face("lock", "gray"),
  "tsconfig.json": face("brand-typescript", "blue"),
  "jsconfig.json": face("file-settings", "yellow"),
  "vite.config.ts": face("brand-vite", "purple"),
  "vite.config.js": face("brand-vite", "purple"),
  dockerfile: face("brand-docker", "cyan"),
  "docker-compose.yml": face("brand-docker", "cyan"),
  "docker-compose.yaml": face("brand-docker", "cyan"),
  "compose.yml": face("brand-docker", "cyan"),
  "compose.yaml": face("brand-docker", "cyan"),
  ".gitignore": face("brand-git", "orange"),
  ".gitattributes": face("brand-git", "orange"),
  ".gitmodules": face("brand-git", "orange"),
  ".env": face("key", "yellow"),
  ".env.local": face("key", "yellow"),
  ".env.example": face("key", "yellow"),
  "readme.md": face("file-info", "blue"),
  license: face("license", "yellow"),
  "license.md": face("license", "yellow"),
  "license.txt": face("license", "yellow"),
  makefile: face("tool", "orange"),
  "cargo.toml": face("brand-rust", "orange"),
  "cargo.lock": face("lock", "gray"),
  "pyproject.toml": face("brand-python", "blue"),
  "requirements.txt": face("brand-python", "blue"),
  "uv.lock": face("lock", "gray"),
  "yarn.lock": face("lock", "gray"),
  "pnpm-lock.yaml": face("lock", "gray"),
  "go.mod": face("brand-golang", "cyan"),
  "go.sum": face("brand-golang", "cyan"),
  gemfile: face("diamond", "red"),
  ".editorconfig": face("file-settings", "gray"),
  ".prettierrc": face("file-settings", "purple"),
  ".eslintrc": face("file-settings", "purple"),
  "claude.md": face("file-info", "orange"),
};

const BY_EXT: Record<string, Face> = {
  md: face("markdown", "accent"),
  mdx: face("markdown", "accent"),
  markdown: face("markdown", "accent"),
  txt: face("file-type-txt", "gray"),
  log: face("file-text", "gray"),
  json: face("braces", "yellow"),
  jsonc: face("braces", "yellow"),
  yaml: face("file-settings", "purple"),
  yml: face("file-settings", "purple"),
  toml: face("file-settings", "orange"),
  ini: face("file-settings", "gray"),
  csv: face("file-type-csv", "green"),
  tsv: face("file-spreadsheet", "green"),
  ts: face("file-type-ts", "blue"),
  mts: face("file-type-ts", "blue"),
  cts: face("file-type-ts", "blue"),
  tsx: face("file-type-tsx", "blue"),
  js: face("file-type-js", "yellow"),
  mjs: face("file-type-js", "yellow"),
  cjs: face("file-type-js", "yellow"),
  jsx: face("file-type-jsx", "yellow"),
  py: face("brand-python", "blue"),
  ipynb: face("brand-python", "orange"),
  rs: face("file-type-rs", "orange"),
  go: face("brand-golang", "cyan"),
  rb: face("diamond", "red"),
  java: face("coffee", "red"),
  kt: face("brand-kotlin", "purple"),
  swift: face("brand-swift", "orange"),
  c: face("letter-c", "blue"),
  h: face("letter-c", "purple"),
  cpp: face("brand-cpp", "blue"),
  hpp: face("brand-cpp", "purple"),
  cs: face("brand-c-sharp", "purple"),
  php: face("file-type-php", "purple"),
  html: face("file-type-html", "orange"),
  htm: face("file-type-html", "orange"),
  css: face("file-type-css", "blue"),
  scss: face("brand-sass", "red"),
  sass: face("brand-sass", "red"),
  vue: face("file-type-vue", "green"),
  xml: face("file-type-xml", "orange"),
  sql: face("database", "cyan"),
  sqlite: face("database", "cyan"),
  db: face("database", "cyan"),
  sh: face("terminal-2", "green"),
  zsh: face("terminal-2", "green"),
  bash: face("terminal-2", "green"),
  fish: face("terminal-2", "green"),
  lock: face("lock", "gray"),
  svg: face("file-type-svg", "orange"),
  png: face("file-type-png", "purple"),
  jpg: face("file-type-jpg", "purple"),
  jpeg: face("file-type-jpg", "purple"),
  webp: face("photo", "purple"),
  avif: face("photo", "purple"),
  heic: face("photo", "purple"),
  bmp: face("photo", "purple"),
  ico: face("photo", "purple"),
  gif: face("gif", "purple"),
  mp4: face("movie", "red"),
  mov: face("movie", "red"),
  webm: face("movie", "red"),
  mp3: face("file-music", "cyan"),
  wav: face("file-music", "cyan"),
  pdf: face("file-type-pdf", "red"),
  doc: face("file-type-doc", "blue"),
  docx: face("file-type-docx", "blue"),
  xls: face("file-type-xls", "green"),
  xlsx: face("file-type-xls", "green"),
  ppt: face("file-type-ppt", "orange"),
  pptx: face("file-type-ppt", "orange"),
  zip: face("file-zip", "gray"),
  gz: face("file-zip", "gray"),
  tar: face("file-zip", "gray"),
  pem: face("file-certificate", "yellow"),
  crt: face("file-certificate", "yellow"),
  key: face("key", "yellow"),
};

// よくあるフォルダ。名前の意味を形と色で出す。ふつうのフォルダの形のものは
// 開くと開いた形にし、専用の印のもの（src・.github など）は形を保つ（開いた
// 形が無い。開いているかは行の折り返しの印で分かる）。
const BY_DIR: Record<string, Face> = {
  src: face("folder-code", "blue"),
  lib: face("folder-code", "blue"),
  app: face("folder-code", "blue"),
  components: face("folder-code", "cyan"),
  docs: face("folder", "accent"),
  doc: face("folder", "accent"),
  notes: face("folder", "accent"),
  images: face("folder", "purple"),
  img: face("folder", "purple"),
  assets: face("folder", "purple"),
  public: face("folder", "purple"),
  test: face("folder", "green"),
  tests: face("folder", "green"),
  __tests__: face("folder", "green"),
  ".github": face("brand-github", "gray"),
  ".git": face("brand-git", "orange"),
  node_modules: face("package", "green"),
  dist: face("folders", "gray"),
  build: face("folders", "gray"),
  target: face("folders", "gray"),
  scripts: face("folder-cog", "yellow"),
  config: face("folder-cog", "gray"),
  ".claude": face("folder-cog", "orange"),
  ".vscode": face("folder-cog", "blue"),
};

const FILE = face("file", "gray");

export function fileFace(name: string): Face {
  const base = (name.split("/").pop() ?? name).toLowerCase();
  const named = BY_NAME[base];
  if (named) return named;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1) : "";
  return BY_EXT[ext] ?? FILE;
}

export function dirFace(name: string, open: boolean): Face {
  const base = (name.split("/").pop() ?? name).toLowerCase();
  const known = BY_DIR[base];
  if (!known) return face(open ? "folder-open" : "folder", "gray");
  return open && known.glyph === "folder" ? face("folder-open", known.tone) : known;
}
