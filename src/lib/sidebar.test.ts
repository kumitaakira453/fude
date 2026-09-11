import { describe, expect, it } from "vitest";
import {
  REVIEW_SIDE_MAX,
  REVIEW_SIDE_MIN,
  REVIEW_SIDE_WIDTH,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  SIDEBAR_WIDTH,
  fitReviewSideWidth,
  fitSidebarWidth,
} from "./sidebar";

describe("左の欄の幅", () => {
  it("収まっている値はそのまま", () => {
    expect(fitSidebarWidth(SIDEBAR_WIDTH)).toBe(SIDEBAR_WIDTH);
    expect(fitSidebarWidth(400)).toBe(400);
  });

  it("下限より狭い値は下限にする", () => {
    expect(fitSidebarWidth(0)).toBe(SIDEBAR_MIN);
    expect(fitSidebarWidth(-500)).toBe(SIDEBAR_MIN);
    expect(fitSidebarWidth(SIDEBAR_MIN - 1)).toBe(SIDEBAR_MIN);
  });

  it("上限より広い値は上限にする", () => {
    expect(fitSidebarWidth(9999)).toBe(SIDEBAR_MAX);
    expect(fitSidebarWidth(SIDEBAR_MAX + 1)).toBe(SIDEBAR_MAX);
  });

  it("端数は丸める（style に載る値なので）", () => {
    expect(fitSidebarWidth(320.6)).toBe(321);
  });
});

describe("レビュー画面の右の欄の幅", () => {
  it("収まっている値はそのまま", () => {
    expect(fitReviewSideWidth(REVIEW_SIDE_WIDTH)).toBe(REVIEW_SIDE_WIDTH);
  });

  it("上下限へ収める", () => {
    expect(fitReviewSideWidth(0)).toBe(REVIEW_SIDE_MIN);
    expect(fitReviewSideWidth(9999)).toBe(REVIEW_SIDE_MAX);
  });
});
