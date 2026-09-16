import { beforeEach, describe, expect, it, vi } from "vitest";
import { absFrom, adopt, freeName, imageName, stow } from "./images";

// 画像を取り込むところ。保存先と名前の決め方を見る。
//
// ファイルの読み書きはアプリ側（Rust）の口なので、ここで差し替える。

const here = new Set<string>();
const written = new Map<string, Uint8Array>();
const copied: [string, string][] = [];
const made: string[] = [];

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: (abs: string) => Promise.resolve(here.has(abs)),
  mkdir: (abs: string) => {
    made.push(abs);
    return Promise.resolve();
  },
  writeFile: (abs: string, bytes: Uint8Array) => {
    written.set(abs, bytes);
    here.add(abs);
    return Promise.resolve();
  },
  copyFile: (from: string, to: string) => {
    copied.push([from, to]);
    here.add(to);
    return Promise.resolve();
  },
  // fsAccess が読み込みで使うもの。ここでは呼ばない。
  readFile: () => Promise.reject(new Error("読まない")),
  readTextFile: () => Promise.reject(new Error("読まない")),
  readDir: () => Promise.resolve([]),
  remove: () => Promise.resolve(),
  rename: () => Promise.resolve(),
  stat: () => Promise.reject(new Error("見ない")),
  writeTextFile: () => Promise.resolve(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

const DOC = "/Users/me/docs/仕様.md";
const NOW = new Date(2026, 8, 16, 9, 5, 3);
const bytes = new Uint8Array([1, 2, 3]);

beforeEach(() => {
  here.clear();
  written.clear();
  copied.length = 0;
  made.length = 0;
});

describe("imageName", () => {
  it("元の名前をそのまま残す", () => {
    expect(imageName({ bytes, name: "図解.png", mime: "image/png" }, NOW)).toBe("図解.png");
  });

  it("道筋で渡されても、名前のところだけ取る", () => {
    expect(imageName({ bytes, name: "/a/b/図解.jpg", mime: null }, NOW)).toBe("図解.jpg");
  });

  it("名前が無ければ日時から作る", () => {
    expect(imageName({ bytes, name: null, mime: "image/png" }, NOW)).toBe(
      "貼り付け 2026-09-16 09-05-03.png",
    );
  });

  it("窓が付けた名前も、名前が無いものとして扱う", () => {
    // 撮った画面を貼ると image.png で来る。連番が積み上がると何の画像か読めない。
    expect(imageName({ bytes, name: "image.png", mime: "image/png" }, NOW)).toBe(
      "貼り付け 2026-09-16 09-05-03.png",
    );
  });

  it("種別から拡張子を補う", () => {
    expect(imageName({ bytes, name: null, mime: "image/webp" }, NOW)).toMatch(/\.webp$/);
    expect(imageName({ bytes, name: "図解", mime: "image/jpeg" }, NOW)).toBe("図解.jpg");
  });

  it("種別も拡張子も無ければ png と見なす", () => {
    expect(imageName({ bytes, name: null, mime: null }, NOW)).toMatch(/\.png$/);
  });

  it("区切りの字は落とす", () => {
    expect(imageName({ bytes, name: "a:b.png", mime: null }, NOW)).toBe("ab.png");
  });
});

describe("freeName", () => {
  it("空いていればそのまま", async () => {
    expect(await freeName("/d", "図解.png")).toBe("図解.png");
  });

  it("重なったら連番を付ける", async () => {
    here.add("/d/図解.png");
    expect(await freeName("/d", "図解.png")).toBe("図解 2.png");
    here.add("/d/図解 2.png");
    expect(await freeName("/d", "図解.png")).toBe("図解 3.png");
  });
});

describe("absFrom", () => {
  it("頭が / ならそのまま", () => {
    expect(absFrom(DOC, "/Users/me/写真/a.png")).toBe("/Users/me/写真/a.png");
  });

  it("相対は文書のある場所から解く", () => {
    expect(absFrom(DOC, "./images/a.png")).toBe("/Users/me/docs/images/a.png");
    expect(absFrom(DOC, "../素材/a.png")).toBe("/Users/me/素材/a.png");
  });

  it("file:// は落とす（Finder から写した道筋）", () => {
    expect(absFrom(DOC, "file:///Users/me/a.png")).toBe("/Users/me/a.png");
  });

  it("根より上へは出ない", () => {
    expect(absFrom(DOC, "../../../../../a.png")).toBe("/a.png");
  });
});

describe("stow", () => {
  it("文書と同じ場所のフォルダへ置き、相対の道筋を返す", async () => {
    const src = await stow(DOC, "images", { bytes, name: "図解.png", mime: null }, NOW);
    expect(src).toBe("./images/図解.png");
    expect(made).toContain("/Users/me/docs/images");
    expect(written.get("/Users/me/docs/images/図解.png")).toBe(bytes);
  });

  it("フォルダ名は呼び出し側が決める", async () => {
    const src = await stow(DOC, "素材", { bytes, name: "図解.png", mime: null }, NOW);
    expect(src).toBe("./素材/図解.png");
  });

  it("重なったら連番で置く", async () => {
    here.add("/Users/me/docs/images/図解.png");
    const src = await stow(DOC, "images", { bytes, name: "図解.png", mime: null }, NOW);
    expect(src).toBe("./images/図解 2.png");
  });
});

describe("adopt", () => {
  it("外のファイルは置き場所へ複製する", async () => {
    const src = await adopt(DOC, "images", "/Users/me/写真/図解.png", NOW);
    expect(src).toBe("./images/図解.png");
    expect(copied).toEqual([["/Users/me/写真/図解.png", "/Users/me/docs/images/図解.png"]]);
  });

  it("すでに置き場所の中なら複製しない", async () => {
    const src = await adopt(DOC, "images", "/Users/me/docs/images/図解.png", NOW);
    expect(src).toBe("./images/図解.png");
    expect(copied).toEqual([]);
  });

  it("置き場所の下の階層も、そのまま指す", async () => {
    const src = await adopt(DOC, "images", "/Users/me/docs/images/2026/図解.png", NOW);
    expect(src).toBe("./images/2026/図解.png");
    expect(copied).toEqual([]);
  });
});
