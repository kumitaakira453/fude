import { describe, expect, it, vi } from "vitest";
import { kindOf, LIST } from "./kinds";

// 値の種類の見分け。取り違えると、ただの字に「開く」釦が出たりする。

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: () => Promise.resolve() }));

const id = (text: string) => kindOf(text).id;

describe("URL", () => {
  it("http と https を拾う", () => {
    expect(id("https://app.notion.com/p/abc")).toBe("url");
    expect(id("http://localhost:5273/")).toBe("url");
  });

  it("URL らしくない字は拾わない", () => {
    expect(id("http")).toBe("text");
    expect(id("https://")).toBe("text");
    expect(id("見に行く https://example.com")).toBe("text");
  });

  it("開く操作が付く", () => {
    expect(kindOf("https://example.com").act?.title).toBe("開く");
    expect(kindOf("ただの字").act).toBe(undefined);
  });
});

describe("メール", () => {
  it("宛先の形を拾う", () => {
    expect(id("akira@example.co.jp")).toBe("mail");
    expect(id("mailto:akira@example.com")).toBe("mail");
  });

  it("ドメインが無いものは拾わない", () => {
    expect(id("a@b")).toBe("text");
    expect(id("@akira")).toBe("text");
  });
});

describe("日付", () => {
  it("年月日と、時刻・時差付きを拾う", () => {
    expect(id("2026-09-02")).toBe("date");
    expect(id("2026-09-10T08:07:09.068081+00:00")).toBe("date");
    expect(id("2026-09-10 08:07")).toBe("date");
  });

  it("ありえない月日は拾わない", () => {
    expect(id("2026-13-45")).toBe("text");
    expect(id("2026-00-10")).toBe("text");
    expect(id("2026-9-2")).toBe("text");
  });
});

describe("真偽と数", () => {
  it("true / false", () => {
    expect(id("true")).toBe("bool");
    expect(id("false")).toBe("bool");
    expect(id("True")).toBe("text");
  });

  it("数だけの字", () => {
    expect(id("42")).toBe("number");
    expect(id("-3.5")).toBe("number");
    expect(id("3 件")).toBe("text");
  });
});

describe("その他", () => {
  it("空の値は字として扱う", () => {
    expect(id("")).toBe("text");
  });

  it("前後の空白は見分けに影響しない", () => {
    expect(id("  https://example.com  ")).toBe("url");
  });

  it("並びは字から見分けない（行の側で指す）", () => {
    expect(LIST.match("なんでも")).toBe(false);
    expect(LIST.id).toBe("list");
  });
});
