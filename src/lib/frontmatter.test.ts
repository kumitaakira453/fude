import { describe, expect, it } from "vitest";
import { extractMeta, parseFrontmatter } from "./frontmatter";

// 先頭の --- の領域は、読めても読めなくても本文から切り離す。
// 残すと remark-frontmatter が本文側でも読み飛ばして、画面から消えてしまう。

const BODY = "# 題\n\n本文です。\n";

describe("読めるフロントマター", () => {
  it("対応表と本文に分かれる", () => {
    const got = parseFrontmatter(`---\ntitle: 題\n種別: 依頼\n---\n${BODY}`);
    expect(got.data).toEqual({ title: "題", 種別: "依頼" });
    expect(got.body).toBe(BODY);
    expect(got.head).toBe("---\ntitle: 題\n種別: 依頼\n---\n");
    expect(got.broken).toBe(false);
  });

  it("中身が空でも領域として切り離す", () => {
    const got = parseFrontmatter(`---\n\n---\n${BODY}`);
    expect(got.data).toBe(null);
    expect(got.body).toBe(BODY);
    expect(got.head).toBe("---\n\n---\n");
    expect(got.broken).toBe(false);
  });
});

describe("読めないフロントマター", () => {
  it("YAML として壊れていても本文から切り離し、壊れていると伝える", () => {
    const bad = "---\ntitle: 題\n  ずれた: 行\n- 並び\n---\n";
    const got = parseFrontmatter(bad + BODY);
    expect(got.broken).toBe(true);
    expect(got.data).toBe(null);
    expect(got.head).toBe(bad);
    expect(got.body).toBe(BODY);
  });

  it("対応表でないもの（裸の字）も読めていない扱いにする", () => {
    const got = parseFrontmatter(`---\nただの字\n---\n${BODY}`);
    expect(got.broken).toBe(true);
    expect(got.data).toBe(null);
    expect(got.body).toBe(BODY);
  });

  it("並びも読めていない扱いにする", () => {
    const got = parseFrontmatter(`---\n- 一つ\n- 二つ\n---\n${BODY}`);
    expect(got.broken).toBe(true);
    expect(got.data).toBe(null);
  });
});

describe("フロントマターの無いファイル", () => {
  it("全部が本文になる", () => {
    const got = parseFrontmatter(BODY);
    expect(got.data).toBe(null);
    expect(got.body).toBe(BODY);
    expect(got.head).toBe("");
    expect(got.broken).toBe(false);
  });

  it("本文の途中の --- は区切り線のまま", () => {
    const text = "# 題\n\n---\n\nあと\n";
    expect(parseFrontmatter(text).head).toBe("");
    expect(parseFrontmatter(text).body).toBe(text);
  });
});

describe("表示用の題と印", () => {
  it("題と、並びでも字でも印を取り出す", () => {
    expect(extractMeta({ title: "題", tags: ["a", "b"] })).toEqual({
      title: "題",
      tags: ["a", "b"],
    });
    expect(extractMeta({ tag: "a, b" }).tags).toEqual(["a", "b"]);
    expect(extractMeta(null)).toEqual({ tags: [] });
  });
});
