import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { fieldsOf, safeScalar, withValue } from "./frontmatterFields";

// Notion から降りてくるフロントマターの実物の形。鍵に「4. 」が付いたものや、
// 値が空で次の行から並びが始まるものが混ざる。
const FM = [
  "---",
  "notion_id: 3cf53222-ff1e-81cf-86f2-f28c9d8ee6e1",
  "種別: 新規依頼",
  "依頼日: '2026-09-02'",
  "4. 画面・機能案:",
  "- 3ce53222-ff1e-813b-934d-d06774db8c13",
  "- 3ce53222-ff1e-8000-0000-000000000000",
  "title: 【請求情報通知】ビューを指定して通知対象を絞り込める",
  "url: https://app.notion.com/p/3cf53222ff1e81cf86f2f28c9d8ee6e1",
  "last_synced: '2026-09-10T08:07:09.068081+00:00'",
  "---",
  "",
].join("\n");

const keys = (fm: string) => fieldsOf(fm).map((f) => f.key);
const find = (fm: string, key: string) => fieldsOf(fm).find((f) => f.key === key)!;
const read = (fm: string) =>
  yaml.load(fm.slice(4, fm.lastIndexOf("---"))) as Record<string, unknown>;

describe("フロントマターの欄", () => {
  it("鍵の並び順のまま取り出す", () => {
    expect(keys(FM)).toEqual([
      "notion_id",
      "種別",
      "依頼日",
      "4. 画面・機能案",
      "title",
      "url",
      "last_synced",
    ]);
  });

  it("値が空の鍵に続く並びは、項目ごとの箱になる", () => {
    const f = find(FM, "4. 画面・機能案");
    expect(f.cells.map((c) => c.text)).toEqual([
      "3ce53222-ff1e-813b-934d-d06774db8c13",
      "3ce53222-ff1e-8000-0000-000000000000",
    ]);
  });

  it("引用符は外して見せ、形は覚えておく", () => {
    const f = find(FM, "依頼日");
    expect(f.cells[0].text).toBe("2026-09-02");
    expect(f.cells[0].quote).toBe("'");
  });

  it("箱の範囲は生テキストのその値を指している", () => {
    const f = find(FM, "url");
    const [from, to] = f.cells[0].at;
    expect(FM.slice(from, to)).toBe(
      "https://app.notion.com/p/3cf53222ff1e81cf86f2f28c9d8ee6e1",
    );
  });

  it("フロントマターでない字からは何も取れない", () => {
    expect(fieldsOf("")).toEqual([]);
    expect(fieldsOf("# 題\n\n本文\n")).toEqual([]);
  });
});

describe("値の差し替え", () => {
  it("その値の行だけが変わり、他の行は一字も動かない", () => {
    const next = withValue(FM, find(FM, "種別").cells[0], "修正依頼");
    const was = FM.split("\n");
    const now = next.split("\n");
    expect(now.length).toBe(was.length);
    now.forEach((line, i) => {
      if (i === 2) expect(line).toBe("種別: 修正依頼");
      else expect(line).toBe(was[i]);
    });
  });

  it("引用符付きの値は引用符のまま差し替わる（日付として読まれないように）", () => {
    const next = withValue(FM, find(FM, "依頼日").cells[0], "2026-09-30");
    expect(next).toContain("依頼日: '2026-09-30'");
    expect(read(next)["依頼日"]).toBe("2026-09-30");
  });

  it("並びの項目を差し替えても、隣の項目は動かない", () => {
    const f = find(FM, "4. 画面・機能案");
    const next = withValue(FM, f.cells[1], "差し替えた");
    expect(read(next)["4. 画面・機能案"]).toEqual([
      "3ce53222-ff1e-813b-934d-d06774db8c13",
      "差し替えた",
    ]);
  });

  it("差し替えたあとも同じ数の欄が取れる（範囲がずれない）", () => {
    const next = withValue(FM, find(FM, "notion_id").cells[0], "短くした");
    expect(keys(next)).toEqual(keys(FM));
    expect(find(next, "last_synced").cells[0].text).toBe(
      "2026-09-10T08:07:09.068081+00:00",
    );
  });

  it("値の無い鍵に打つと、コロンの後ろに区切りの空白が入る", () => {
    const fm = "---\nmemo:\n---\n";
    const next = withValue(fm, fieldsOf(fm)[0].cells[0], "書いた");
    expect(next).toBe("---\nmemo: 書いた\n---\n");
  });
});

describe("打った字を YAML として置ける形にする", () => {
  it("そのまま置ける字は裸のまま", () => {
    expect(safeScalar("新規依頼")).toBe("新規依頼");
    expect(safeScalar("a-b-c")).toBe("a-b-c");
  });

  it("記号で始まる・コロンを含む・前後に空白のある字は引用符で包む", () => {
    expect(safeScalar("a: b")).toBe("'a: b'");
    expect(safeScalar("- 項目")).toBe("'- 項目'");
    expect(safeScalar("# 見出し")).toBe("'# 見出し'");
    expect(safeScalar(" 前に空白")).toBe("' 前に空白'");
    expect(safeScalar("")).toBe("''");
  });

  it("引用符を包む側に回したときは中の引用符を二重にする", () => {
    // 字の途中の ' は平文でもそのまま置ける。包むのは元が引用符付きだったとき。
    expect(safeScalar("It's")).toBe("It's");
    expect(safeScalar("It's", "'")).toBe("'It''s'");
  });

  it("何を打ってもファイルは YAML として読み直せる", () => {
    for (const typed of ["a: b", "- x", "{}", "[1,2]", "#", "'", '"', "", "  "]) {
      const next = withValue(FM, find(FM, "種別").cells[0], typed);
      expect(() => read(next)).not.toThrow();
      expect(read(next)["種別"]).toBe(typed);
    }
  });
});

describe("手に負えない値", () => {
  it("入れ子の対応表は打たせない", () => {
    const fm = "---\nowner:\n  name: 汲田\n  team: 開発\n---\n";
    expect(fieldsOf(fm)[0].cells).toEqual([]);
  });

  it("複数行の字は打たせない", () => {
    const fm = "---\nnote: |\n  一行目\n  二行目\n---\n";
    expect(fieldsOf(fm)[0].cells).toEqual([]);
  });

  it("流し書きの並びは打たせない", () => {
    const fm = "---\ntags: [a, b]\n---\n";
    expect(fieldsOf(fm)[0].cells).toEqual([]);
  });
});
