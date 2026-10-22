import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { usePinch } from "./usePinch";
import {
  clampPan,
  fitScale,
  panBy,
  wheelZoom,
  zoomAt,
  type Point,
  type Size,
  type View,
} from "../lib/zoom";

// 1 枚のもの（画像・図）を枠の中で拡大縮小して見る。画像（ImageDoc）と
// .d2 の図（D2Doc）で同じ動きにする。
//
// 見えているものを動かすのは transform だけ。スクロール箱に大きな絵を置く
// 作りだと、ピンチの中心を合わせるのにスクロール量を逆算することになり、
// 端で計算が合わなくなる。倍率と位置は `lib/zoom` が持つ。

// 押して変える 1 段。
export const ZOOM_STEP = 1.25;

const NONE: Size = { width: 0, height: 0 };

export interface ZoomView {
  // いまの見え方。view が null のときは枠に合わせた形。
  shown: View;
  // null は「枠に合わせる」。窓の大きさや中身の大きさが変わっても合わせ続ける。
  view: View | null;
  sized: boolean;
  // 枠からはみ出しているか（掴んで動かせるか）。
  over: boolean;
  grabbing: boolean;
  zoomTo: (scale: number, at?: Point) => void;
  fit: () => void;
  actual: () => void;
  handlers: {
    onKeyDown: (e: React.KeyboardEvent) => void;
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
    onDoubleClick: (e: React.MouseEvent) => void;
  };
}

export function useZoomView(host: RefObject<HTMLDivElement | null>, natural: Size): ZoomView {
  const [box, setBox] = useState<Size>(NONE);
  const [view, setView] = useState<View | null>(null);
  // 枠の要素。読み込みを待ってから描く・見せ方を替えると作り直すので、描くたびに
  // 見直す（ref の器は変わらないので、[host] を見ても最初の 1 回しか付かない）。
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (host.current !== el) setEl(host.current);
  });

  // 枠の大きさ。窓や仕切りを動かすたびに変わる。
  useEffect(() => {
    const at = el;
    if (!at) {
      setBox(NONE);
      return;
    }
    const read = () => setBox({ width: at.clientWidth, height: at.clientHeight });
    read();
    const eye = new ResizeObserver(read);
    eye.observe(at);
    return () => eye.disconnect();
  }, [el]);

  const sized = natural.width > 0 && natural.height > 0;
  const fitted = sized ? fitScale(natural, box) : 1;
  const shown: View = view ?? { scale: fitted, x: 0, y: 0 };
  const over =
    sized && (natural.width * shown.scale > box.width || natural.height * shown.scale > box.height);

  // 中身の大きさが変わったら（図を描き直したとき）、自分で動かした見え方は
  // 倍率を保ったまま枠の中へ収め直す。枠に合わせているなら合わせ直す。
  useEffect(() => {
    if (sized) setView((was) => (was ? clampPan(was, natural, box) : was));
    // 大きさの数だけを見る（同じ大きさで作り直された物で動かさない）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natural.width, natural.height]);

  // 枠の左上から測った、指した位置。
  const spotOf = (e: { clientX: number; clientY: number }): Point => {
    const at = host.current?.getBoundingClientRect();
    return at ? { x: e.clientX - at.left, y: e.clientY - at.top } : { x: 0, y: 0 };
  };

  const zoomTo = useCallback(
    (scale: number, at?: Point) => {
      if (!sized) return;
      const spot = at ?? { x: box.width / 2, y: box.height / 2 };
      setView((was) => zoomAt(was ?? { scale: fitted, x: 0, y: 0 }, natural, box, scale, spot));
    },
    [sized, box, fitted, natural],
  );
  const fit = useCallback(() => setView(null), []);
  const actual = useCallback(
    () => setView(clampPan({ scale: 1, x: 0, y: 0 }, natural, box)),
    [natural, box],
  );

  // ピンチは ctrlKey 付きの wheel で届く。二本指のスクロールは平行移動。
  // どちらも既定の動き（窓ごとの拡大、行き過ぎの跳ね返り）を止めるので、
  // passive にできない。React の onWheel は passive で付くため自分で繋ぐ。
  useEffect(() => {
    const at = el;
    if (!at) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!sized) return;
      if (e.ctrlKey || e.metaKey) {
        const spot = spotOf(e);
        setView((was) => {
          const from = was ?? { scale: fitted, x: 0, y: 0 };
          return zoomAt(from, natural, box, wheelZoom(from.scale, e.deltaY), spot);
        });
        return;
      }
      setView((was) =>
        panBy(was ?? { scale: fitted, x: 0, y: 0 }, { x: -e.deltaX, y: -e.deltaY }, natural, box),
      );
    };
    at.addEventListener("wheel", onWheel, { passive: false });
    return () => at.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, sized, fitted, natural, box]);

  // WebKit のピンチ。始まりの倍率に比を掛ける。
  const pinchFrom = useRef(1);
  usePinch(el, {
    start: () => {
      pinchFrom.current = shown.scale;
    },
    change: (ratio, at) => {
      if (!sized) return;
      setView((was) =>
        zoomAt(was ?? { scale: fitted, x: 0, y: 0 }, natural, box, pinchFrom.current * ratio, at),
      );
    },
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    if (e.key === "+" || e.key === "=" || e.key === ";") {
      e.preventDefault();
      zoomTo(shown.scale * ZOOM_STEP);
    } else if (e.key === "-") {
      e.preventDefault();
      zoomTo(shown.scale / ZOOM_STEP);
    } else if (e.code === "Digit0" && e.shiftKey) {
      // ⌘⇧0 で画面に合わせる（⌘9 はワークスペースの切り替えに使う）。
      e.preventDefault();
      fit();
    } else if (e.key === "0") {
      e.preventDefault();
      actual();
    }
  };

  // 掴んで動かす。はみ出しているときだけ。
  const held = useRef<{ id: number; x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    host.current?.focus();
    if (!over || e.button !== 0) return;
    held.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const grip = held.current;
    if (!grip || grip.id !== e.pointerId) return;
    const by = { x: e.clientX - grip.x, y: e.clientY - grip.y };
    held.current = { id: grip.id, x: e.clientX, y: e.clientY };
    setView((was) => panBy(was ?? { scale: fitted, x: 0, y: 0 }, by, natural, box));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (held.current?.id !== e.pointerId) return;
    held.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  // 二度押しで、枠に合わせる ↔ 原寸。押した点を残したまま移る。
  const onDoubleClick = (e: React.MouseEvent) => {
    if (shown.scale < 1) zoomTo(1, spotOf(e));
    else fit();
  };

  return {
    shown,
    view,
    sized,
    over,
    grabbing: held.current !== null,
    zoomTo,
    fit,
    actual,
    handlers: {
      onKeyDown,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick,
    },
  };
}
