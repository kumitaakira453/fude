// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  loadEmoji,
  rememberEmoji,
  recentEmoji,
  searchEmoji,
  type Emoji,
} from "./emoji";

// 絵文字の探し方。狙いが決まっている打ち方（英字の短名）を先に返す。

const one = (over: Partial<Emoji>): Emoji => ({
  char: "🙂",
  label: "顔",
  tags: [],
  codes: [],
  group: 0,
  order: 0,
  ...over,
});

const bulb = one({ char: "💡", label: "電球", tags: ["ひらめき"], codes: ["bulb", "light_bulb"], group: 7 });
const flash = one({ char: "🔦", label: "懐中電灯", tags: [], codes: ["flashlight"], group: 7 });
const idea = one({ char: "🤔", label: "考え込む顔", tags: ["電球が欲しい"], codes: ["thinking"] });
const all = [bulb, flash, idea];

describe("searchEmoji", () => {
  it("短名の丸ごと一致を先に返す", () => {
    expect(searchEmoji(all, "bulb")[0]).toBe(bulb);
  });

  it("短名の頭一致でも当たる", () => {
    expect(searchEmoji(all, "flash")[0]).toBe(flash);
  });

  it("区切りは _ でも - でも当たる", () => {
    expect(searchEmoji(all, "light-bulb")[0]).toBe(bulb);
  });

  it("日本語の名前でも当たる", () => {
    expect(searchEmoji(all, "電球")[0]).toBe(bulb);
  });

  it("名前の頭一致を、別名に含むものより先に返す", () => {
    // 「電球」は bulb の名前の頭、idea の別名の途中にある。
    expect(searchEmoji(all, "電球").map((e) => e.char)).toEqual(["💡", "🤔"]);
  });

  it("日本語の別名でも当たる", () => {
    expect(searchEmoji(all, "ひらめき")[0]).toBe(bulb);
  });

  it("当たらなければ空", () => {
    expect(searchEmoji(all, "どこにも無い語")).toEqual([]);
  });

  it("空の問いには先頭から返す", () => {
    expect(searchEmoji(all, "", 2)).toEqual([bulb, flash]);
  });

  it("上限で切る", () => {
    expect(searchEmoji(all, "", 1)).toHaveLength(1);
  });
});

describe("最近使ったもの", () => {
  beforeEach(() => localStorage.clear());

  it("新しいものが先頭に来る", () => {
    rememberEmoji("💡");
    rememberEmoji("🔦");
    expect(recentEmoji()).toEqual(["🔦", "💡"]);
  });

  it("同じものは重ねずに先頭へ動かす", () => {
    rememberEmoji("💡");
    rememberEmoji("🔦");
    rememberEmoji("💡");
    expect(recentEmoji()).toEqual(["💡", "🔦"]);
  });

  it("上限を超えたら古いものから捨てる", () => {
    for (let i = 0; i < 20; i++) rememberEmoji(String.fromCodePoint(0x1f600 + i));
    expect(recentEmoji()).toHaveLength(16);
    expect(recentEmoji()[0]).toBe(String.fromCodePoint(0x1f600 + 19));
  });

  it("壊れた控えは無かったことにする", () => {
    localStorage.setItem("mdglow:callout-icons", "{");
    expect(recentEmoji()).toEqual([]);
  });
});

describe("loadEmoji", () => {
  it("実データを読み、日本語と英語のどちらでも引ける", async () => {
    const list = await loadEmoji();
    expect(list.length).toBeGreaterThan(1000);
    expect(searchEmoji(list, "bulb")[0]?.char).toBe("💡");
    expect(searchEmoji(list, "電球")[0]?.char).toBe("💡");
    // 肌の色などの部品は本文に置くものではないので入れない。
    expect(list.some((e) => e.group === 2)).toBe(false);
  });

  it("2 度目は同じ配列を返す（読み直さない）", async () => {
    expect(await loadEmoji()).toBe(await loadEmoji());
  });
});
