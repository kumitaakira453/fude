import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { imageUrl, peekImageUrl } from "../lib/fsAccess";
import { svgSize } from "../lib/svgSize";
import {
  clampPan,
  fitScale,
  panBy,
  wheelZoom,
  zoomAt,
  type Size,
  type View,
} from "../lib/zoom";
import { assetVersionAtom } from "../state/atoms";
import { Icon } from "./Icon";

// 画像を 1 枚の書き物として開く。
//
// 見えているものを動かすのは transform だけ。スクロール箱に大きな絵を置く
// 作りだと、ピンチの中心を合わせるのにスクロール量を逆算することになり、
// 端で計算が合わなくなる。倍率と位置は `lib/zoom` が持つ。

// 押して変える 1 段。
const STEP = 1.25;

const NONE: Size = { width: 0, height: 0 };

// 大きさの手掛かりが何も無いときの代わり。置き換えられる要素の既定と同じ。
const FALLBACK: Size = { width: 300, height: 150 };

export function ImageDoc({ abs }: { abs: string }) {
  const version = useAtomValue(assetVersionAtom);
  const [url, setUrl] = useState<string | null>(() => peekImageUrl(abs));
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState<Size>(NONE);
  const [box, setBox] = useState<Size>(NONE);
  // null は「枠に合わせる」。窓の大きさが変わっても合わせ続ける。
  const [view, setView] = useState<View | null>(null);

  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    void imageUrl(abs).then((got) => {
      if (!alive) return;
      if (got) setUrl(got);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [abs, version]);

  // 元の大きさは、画面に置く前に別の Image で測る。置いてから聞くと、WebKit は
  // 寸法を持たない SVG に**枠の大きさ**を返すので、窓を変えるたびに「原寸」が
  // 変わってしまう。
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const probe = new Image();
    probe.onload = () => {
      if (!alive) return;
      if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
        setNatural({ width: probe.naturalWidth, height: probe.naturalHeight });
        return;
      }
      // 寸法を持たない SVG。書いてある値から読む。
      void fetch(url)
        .then((r) => r.text())
        .then((text) => alive && setNatural(svgSize(text) ?? FALLBACK))
        .catch(() => alive && setNatural(FALLBACK));
    };
    probe.onerror = () => {
      if (alive) setFailed(true);
    };
    probe.src = url;
    return () => {
      alive = false;
    };
  }, [url]);

  // 枠の大きさ。窓や仕切りを動かすたびに変わる。
  useEffect(() => {
    const at = host.current;
    if (!at) return;
    const read = () => setBox({ width: at.clientWidth, height: at.clientHeight });
    read();
    const eye = new ResizeObserver(read);
    eye.observe(at);
    return () => eye.disconnect();
  }, []);

  // 別の画像に移ったら、見え方を最初へ戻す。
  useEffect(() => {
    setView(null);
    setNatural(NONE);
  }, [abs]);

  const sized = natural.width > 0 && natural.height > 0;
  const fit = sized ? fitScale(natural, box) : 1;
  const shown: View = view ?? { scale: fit, x: 0, y: 0 };
  const over =
    sized && (natural.width * shown.scale > box.width || natural.height * shown.scale > box.height);

  // 枠の左上から測った、指した位置。
  const spotOf = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const at = host.current?.getBoundingClientRect();
    return at ? { x: e.clientX - at.left, y: e.clientY - at.top } : { x: 0, y: 0 };
  };

  const zoomTo = useCallback(
    (scale: number, at?: { x: number; y: number }) => {
      if (!sized) return;
      const spot = at ?? { x: box.width / 2, y: box.height / 2 };
      setView((was) =>
        zoomAt(was ?? { scale: fit, x: 0, y: 0 }, natural, box, scale, spot),
      );
    },
    [sized, box, fit, natural],
  );

  // ピンチは ctrlKey 付きの wheel で届く。二本指のスクロールは平行移動。
  // どちらも既定の動き（窓ごとの拡大、行き過ぎの跳ね返り）を止めるので、
  // passive にできない。React の onWheel は passive で付くため自分で繋ぐ。
  useEffect(() => {
    const at = host.current;
    if (!at) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!sized) return;
      if (e.ctrlKey || e.metaKey) {
        const spot = spotOf(e);
        setView((was) => {
          const from = was ?? { scale: fit, x: 0, y: 0 };
          return zoomAt(from, natural, box, wheelZoom(from.scale, e.deltaY), spot);
        });
        return;
      }
      setView((was) =>
        panBy(was ?? { scale: fit, x: 0, y: 0 }, { x: -e.deltaX, y: -e.deltaY }, natural, box),
      );
    };
    at.addEventListener("wheel", onWheel, { passive: false });
    return () => at.removeEventListener("wheel", onWheel);
  }, [sized, fit, natural, box]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    if (e.key === "+" || e.key === "=" || e.key === ";") {
      e.preventDefault();
      zoomTo(shown.scale * STEP);
    } else if (e.key === "-") {
      e.preventDefault();
      zoomTo(shown.scale / STEP);
    } else if (e.key === "0") {
      e.preventDefault();
      setView(clampPan({ scale: 1, x: 0, y: 0 }, natural, box));
    } else if (e.key === "9") {
      e.preventDefault();
      setView(null);
    }
  };

  // 掴んで動かす。はみ出しているときだけ。
  const held = useRef<{ id: number; x: number; y: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    host.current?.focus();
    if (!over || e.button !== 0) return;
    held.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const grip = held.current;
    if (!grip || grip.id !== e.pointerId) return;
    const by = { x: e.clientX - grip.x, y: e.clientY - grip.y };
    held.current = { id: grip.id, x: e.clientX, y: e.clientY };
    setView((was) => panBy(was ?? { scale: fit, x: 0, y: 0 }, by, natural, box));
  };
  const onUp = (e: React.PointerEvent) => {
    if (held.current?.id !== e.pointerId) return;
    held.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  // 二度押しで、枠に合わせる ↔ 原寸。押した点を残したまま移る。
  const onDouble = (e: React.MouseEvent) => {
    if (shown.scale < 1) zoomTo(1, spotOf(e));
    else setView(null);
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={host}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={onDouble}
        className="mg-imgdoc relative min-h-0 flex-1 overflow-hidden outline-none"
        style={{ cursor: over ? (held.current ? "grabbing" : "grab") : "default" }}
      >
        {url && sized && !failed && (
          <img
            src={url}
            alt=""
            draggable={false}
            onError={() => setFailed(true)}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: natural.width,
              height: natural.height,
              maxWidth: "none",
              transform: `translate(calc(-50% + ${shown.x}px), calc(-50% + ${shown.y}px)) scale(${shown.scale})`,
              imageRendering: shown.scale >= 2 ? "pixelated" : "auto",
            }}
          />
        )}
        {failed && (
          <div className="flex h-full items-center justify-center text-[13px] text-[var(--mg-muted)]">
            この画像は開けませんでした
          </div>
        )}
      </div>

      <div className="mg-imgdoc-bar">
        <span className="mg-imgdoc-size">
          {sized ? `${natural.width} × ${natural.height}` : ""}
        </span>
        <button type="button" className="mg-small" onClick={() => zoomTo(shown.scale / STEP)}>
          <Icon name="zoom_out" size={15} />
        </button>
        <span className="mg-imgdoc-scale">{Math.round(shown.scale * 100)}%</span>
        <button type="button" className="mg-small" onClick={() => zoomTo(shown.scale * STEP)}>
          <Icon name="zoom_in" size={15} />
        </button>
        <button
          type="button"
          className={`mg-small${view === null ? " is-on" : ""}`}
          onClick={() => setView(null)}
        >
          枠に合わせる
        </button>
        <button
          type="button"
          className="mg-small"
          onClick={() => setView(clampPan({ scale: 1, x: 0, y: 0 }, natural, box))}
        >
          原寸
        </button>
      </div>
    </div>
  );
}
