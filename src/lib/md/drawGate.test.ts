// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawGate } from "./drawGate";

// 編集面で図を描き直す間合い。IME の確定や打っている途中の書きかけで、エラーが
// 出入りしてちらつかないようにする。

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

// 描けるのは "ok" で終わる記述だけ。
function rig(composing = () => false) {
  const shown: string[] = [];
  const errors: string[] = [];
  const gate = drawGate({
    render: async (code) => {
      if (!code.endsWith("ok")) throw new Error(`描けない: ${code}`);
      return `<svg>${code}</svg>`;
    },
    onSvg: (svg) => shown.push(svg),
    onError: (m) => errors.push(m),
    composing,
    delay: 250,
    errorDelay: 1000,
  });
  return { gate, shown, errors };
}

const flush = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe("図を描き直す間合い", () => {
  it("描けないときのエラーは、1 秒同じ記述のままだったときに出す", async () => {
    const { gate, errors } = rig();
    gate.draw("a ->");
    await flush(250);
    await flush(900);
    expect(errors).toEqual([]);
    await flush(200);
    expect(errors).toEqual(["描けない: a ->"]);
  });

  it("エラーを出す前に打ち直して描ければ、エラーは出ない", async () => {
    const { gate, shown, errors } = rig();
    gate.draw("a ->");
    await flush(500);
    gate.draw("a -> ok");
    await flush(2000);
    expect(errors).toEqual([]);
    expect(shown).toEqual(["<svg>a -> ok</svg>"]);
  });

  it("変換中は描かず、変換が終わってから描く", async () => {
    let composing = true;
    const { gate, shown } = rig(() => composing);
    gate.draw("x ok");
    await flush(1000);
    expect(shown).toEqual([]);
    composing = false;
    await flush(250);
    expect(shown).toEqual(["<svg>x ok</svg>"]);
  });

  it("止めた後は何も出さない", async () => {
    const { gate, shown, errors } = rig();
    gate.draw("a ->", true);
    gate.stop();
    await flush(2000);
    expect(shown).toEqual([]);
    expect(errors).toEqual([]);
  });
});
