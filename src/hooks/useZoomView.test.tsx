// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Size } from "../lib/zoom";
import { useZoomView, type ZoomView } from "./useZoomView";

// 中身の大きさが変わったとき（図を描き直したとき）の見え方。枠に合わせて
// いれば合わせ直し、自分で拡大していれば倍率を保ったまま枠の中へ収め直す。

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class implements ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  // 枠は 400 × 300 として測らせる。
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 300 });
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

let zoom: ZoomView | null = null;
function Probe({ natural }: { natural: Size }) {
  const ref = useRef<HTMLDivElement>(null);
  zoom = useZoomView(ref, natural);
  return <div ref={ref} />;
}

function mount(natural: Size) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Probe natural={natural} />));
}
const resize = (natural: Size) => act(() => root!.render(<Probe natural={natural} />));

// 読み込みを待ってから枠を描く使い方（D2Doc）。
function Late({ natural, ready }: { natural: Size; ready: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  zoom = useZoomView(ref, natural);
  return ready ? <div ref={ref} /> : null;
}

describe("useZoomView", () => {
  it("枠が後から描かれても、枠を測って合わせる", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const natural = { width: 800, height: 600 };
    act(() => root!.render(<Late natural={natural} ready={false} />));
    act(() => root!.render(<Late natural={natural} ready />));
    // 枠は 400 × 300。測れていなければ 1（原寸）のまま。
    expect(zoom!.shown.scale).toBeLessThan(1);
  });

  it("枠に合わせているあいだは、大きさが変わっても合わせ続ける", () => {
    mount({ width: 800, height: 600 });
    expect(zoom!.view).toBeNull();
    const before = zoom!.shown.scale;
    resize({ width: 1600, height: 1200 });
    expect(zoom!.view).toBeNull();
    expect(zoom!.shown.scale).toBeLessThan(before);
  });

  it("自分で拡大していれば、倍率を保ったまま枠の中へ収め直す", () => {
    mount({ width: 800, height: 600 });
    act(() => zoom!.zoomTo(2, { x: 0, y: 0 }));
    const was = zoom!.view!;
    expect(was.scale).toBe(2);
    // 小さくなって、もとの位置では枠の外へ出る。
    resize({ width: 100, height: 80 });
    expect(zoom!.view!.scale).toBe(2);
    expect(zoom!.view!.x).toBe(0);
    expect(zoom!.view!.y).toBe(0);
  });
});
