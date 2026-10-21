import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { imageUrl, peekImageUrl } from "../lib/fsAccess";
import { useZoomView } from "../hooks/useZoomView";
import { svgSize } from "../lib/svgSize";
import type { Size } from "../lib/zoom";
import { assetVersionAtom } from "../state/atoms";
import { ZoomControls } from "./ZoomControls";

// 画像を 1 枚の書き物として開く。
//
// 拡大縮小と位置は useZoomView が持つ（.d2 の図と同じ動き）。

const NONE: Size = { width: 0, height: 0 };

// 大きさの手掛かりが何も無いときの代わり。置き換えられる要素の既定と同じ。
const FALLBACK: Size = { width: 300, height: 150 };

export function ImageDoc({ abs }: { abs: string }) {
  const version = useAtomValue(assetVersionAtom);
  const [url, setUrl] = useState<string | null>(() => peekImageUrl(abs));
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState<Size>(NONE);

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

  const zoom = useZoomView(host, natural);
  const { shown, sized, over, handlers } = zoom;

  // 別の画像に移ったら、見え方を最初へ戻す。
  useEffect(() => {
    zoom.fit();
    setNatural(NONE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abs]);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={host}
        tabIndex={0}
        {...handlers}
        className="mg-imgdoc relative min-h-0 flex-1 overflow-hidden outline-none"
        style={{ cursor: over ? (zoom.grabbing ? "grabbing" : "grab") : "default" }}
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
        <ZoomControls zoom={zoom} />
      </div>
    </div>
  );
}
