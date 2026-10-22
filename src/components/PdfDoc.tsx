import { useAtomValue } from "jotai";
import type { PDFDocumentProxy, RenderTask, TextLayer } from "pdfjs-dist";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePinch } from "../hooks/usePinch";
import { assetSrc } from "../lib/asset";
import { openPdf, PDF_TO_CSS, pdfjs } from "../lib/pdf";
import { clampScale, MARGIN, wheelZoom, type Size } from "../lib/zoom";
import { assetVersionAtom } from "../state/atoms";
import { Icon } from "./Icon";

// PDF を 1 枚の書き物として開く。頁を縦に並べ、拡大は画像を見る画面と同じ
// 触り方にする（ピンチ・⌘+ ⌘-・⌘0 で実寸・⌘⇧0 で幅に合わせる）。
//
// 倍率は押した瞬間に枠の大きさで当て、描き直しは手が止まってから行う。
// 描き直すまでは前の倍率で描いた絵を引き伸ばして見せる。

const STEP = 1.25;
// 頁の間。
const GAP = 12;
// 手が止まったとみなすまでの待ち。
const SETTLE_MS = 160;

export function PdfDoc({ abs }: { abs: string }) {
  const version = useAtomValue(assetVersionAtom);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  // 倍率 1 での頁の大きさ（CSS px）。
  const [pages, setPages] = useState<Size[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  // null は「幅に合わせる」。
  const [scale, setScale] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  // ピンチの受け口を付ける要素（usePinch は要素を受ける）。
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (host.current !== hostEl) setHostEl(host.current);
  });

  useEffect(() => {
    let gone = false;
    let destroy: (() => void) | null = null;
    setDoc(null);
    setPages([]);
    setFailed(null);
    setScale(null);
    void (async () => {
      try {
        const data = await fetch(assetSrc(abs, version)).then((r) => r.arrayBuffer());
        if (gone) return;
        const opened = await openPdf(data);
        destroy = opened.destroy;
        if (gone) return destroy();
        const pdf = await opened.doc;
        const sizes: Size[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const view = (await pdf.getPage(i)).getViewport({ scale: PDF_TO_CSS });
          sizes.push({ width: view.width, height: view.height });
        }
        if (gone) return;
        setDoc(pdf);
        setPages(sizes);
      } catch (e) {
        if (!gone) setFailed(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      gone = true;
      destroy?.();
    };
  }, [abs, version]);

  useEffect(() => {
    const at = host.current;
    if (!at) return;
    const read = () => setWidth(at.clientWidth);
    read();
    const eye = new ResizeObserver(read);
    eye.observe(at);
    return () => eye.disconnect();
  }, []);

  const widest = pages.reduce((w, p) => Math.max(w, p.width), 0);
  // 1px の遊びを取る。頁の幅の丸めで枠をわずかに越え、横の送り棒が出る。
  const fit = widest > 0 && width > 0 ? clampScale((width - MARGIN * 2 - 1) / widest) : 1;
  const shown = scale ?? fit;

  // 描く倍率。手が止まってから追いつく。
  const [drawn, setDrawn] = useState(shown);
  useEffect(() => {
    const timer = window.setTimeout(() => setDrawn(shown), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [shown]);

  // 倍率を変えても、指した点の下の場所を動かさない。新しい大きさで組み
  // 直した後に、送り位置を合わせる。
  const anchor = useRef<{ x: number; y: number; k: number } | null>(null);
  useLayoutEffect(() => {
    const at = host.current;
    const pin = anchor.current;
    if (!at || !pin) return;
    anchor.current = null;
    at.scrollLeft = (at.scrollLeft + pin.x) * pin.k - pin.x;
    at.scrollTop = (at.scrollTop + pin.y) * pin.k - pin.y;
  }, [shown]);

  const zoomTo = useCallback(
    (next: number | null, spot?: { x: number; y: number }) => {
      const at = host.current;
      const to = next === null ? fit : clampScale(next);
      if (at && to !== shown) {
        anchor.current = {
          x: spot?.x ?? at.clientWidth / 2,
          y: spot?.y ?? at.clientHeight / 2,
          k: to / shown,
        };
      }
      setScale(next === null ? null : to);
    },
    [fit, shown],
  );

  // ピンチは ctrlKey 付きの wheel で届く。窓ごとの拡大を止めるので passive に
  // できない（React の onWheel は passive で付く）。二本指の送りはそのまま。
  useEffect(() => {
    const at = host.current;
    if (!at) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const box = at.getBoundingClientRect();
      zoomTo(wheelZoom(shown, e.deltaY), { x: e.clientX - box.left, y: e.clientY - box.top });
    };
    at.addEventListener("wheel", onWheel, { passive: false });
    return () => at.removeEventListener("wheel", onWheel);
  }, [shown, zoomTo]);

  // WebKit のピンチ。始まりの倍率に比を掛ける。
  const pinchFrom = useRef(1);
  usePinch(hostEl, {
    start: () => {
      pinchFrom.current = shown;
    },
    change: (ratio, at) => zoomTo(pinchFrom.current * ratio, at),
  });

  const onKey = (e: React.KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    if (e.key === "+" || e.key === "=" || e.key === ";") {
      e.preventDefault();
      zoomTo(shown * STEP);
    } else if (e.key === "-") {
      e.preventDefault();
      zoomTo(shown / STEP);
    } else if (e.code === "Digit0" && e.shiftKey) {
      // ⌘⇧0 で幅に合わせる（⌘9 はワークスペースの切り替えに使う）。
      e.preventDefault();
      zoomTo(null);
    } else if (e.key === "0") {
      e.preventDefault();
      zoomTo(1);
    }
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={host}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={() => host.current?.focus({ preventScroll: true })}
        className="mg-pdfdoc min-h-0 flex-1 overflow-auto outline-none"
      >
        {failed ? (
          <div className="flex h-full items-center justify-center text-[13px] text-[var(--mg-muted)]">
            この PDF は開けませんでした（{failed}）
          </div>
        ) : (
          <div className="mg-pdfdoc-pages" style={{ gap: GAP, padding: MARGIN }}>
            {doc &&
              pages.map((size, i) => (
                <PdfPage
                  key={i}
                  doc={doc}
                  index={i + 1}
                  size={size}
                  shown={shown}
                  drawn={drawn}
                  root={host}
                />
              ))}
          </div>
        )}
      </div>

      <div className="mg-imgdoc-bar">
        <span className="mg-imgdoc-size">{pages.length > 0 ? `${pages.length} ページ` : ""}</span>
        <button type="button" className="mg-small" onClick={() => zoomTo(shown / STEP)}>
          <Icon name="zoom_out" size={15} />
        </button>
        <span className="mg-imgdoc-scale">{Math.round(shown * 100)}%</span>
        <button type="button" className="mg-small" onClick={() => zoomTo(shown * STEP)}>
          <Icon name="zoom_in" size={15} />
        </button>
        <button
          type="button"
          className={`mg-small${scale === null ? " is-on" : ""}`}
          onClick={() => zoomTo(null)}
        >
          幅に合わせる
        </button>
        <button type="button" className="mg-small" onClick={() => zoomTo(1)}>
          実寸
        </button>
      </div>
    </div>
  );
}

// 1 頁。見える辺りに来たときだけ描き、離れたら絵を捨てる（数百頁の PDF でも
// 描くのは手元の数頁だけにする）。
const PdfPage = memo(function PdfPage({
  doc,
  index,
  size,
  shown,
  drawn,
  root,
}: {
  doc: PDFDocumentProxy;
  index: number;
  size: Size;
  shown: number;
  drawn: number;
  root: React.RefObject<HTMLDivElement | null>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  // 描き終えた倍率。描き直すまで、文字の層をこの倍率から引き伸ばして合わせる。
  const [painted, setPainted] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const eye = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      root: root.current,
      rootMargin: "100% 0px",
    });
    eye.observe(el);
    return () => eye.disconnect();
  }, [root]);

  useEffect(() => {
    const paper = canvas.current;
    const layer = text.current;
    if (!near || !paper || !layer) {
      if (paper) paper.width = paper.height = 0;
      if (layer) layer.replaceChildren();
      setPainted(null);
      return;
    }
    let gone = false;
    let task: RenderTask | null = null;
    let words: TextLayer | null = null;
    void (async () => {
      const [lib, page] = await Promise.all([pdfjs(), doc.getPage(index)]);
      if (gone) return;
      const view = page.getViewport({ scale: drawn * PDF_TO_CSS });
      const ratio = window.devicePixelRatio || 1;
      // 描き上がるまでは前の絵を残す。別の板に描いてから差し替える。
      const off = document.createElement("canvas");
      off.width = Math.floor(view.width * ratio);
      off.height = Math.floor(view.height * ratio);
      task = page.render({
        canvas: off,
        viewport: view,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      try {
        await task.promise;
      } catch {
        return;
      }
      if (gone) return;
      paper.width = off.width;
      paper.height = off.height;
      paper.getContext("2d")?.drawImage(off, 0, 0);
      layer.replaceChildren();
      layer.style.setProperty("--total-scale-factor", String(drawn * PDF_TO_CSS));
      words = new lib.TextLayer({
        textContentSource: page.streamTextContent(),
        container: layer,
        viewport: view,
      });
      await words.render().catch(() => {});
      if (!gone) setPainted(drawn);
    })();
    return () => {
      gone = true;
      task?.cancel();
      words?.cancel();
    };
  }, [near, doc, index, drawn]);

  const stretch = painted ? shown / painted : 1;
  return (
    <div
      ref={box}
      className="mg-pdfdoc-page"
      style={{ width: Math.floor(size.width * shown), height: Math.floor(size.height * shown) }}
    >
      <canvas ref={canvas} />
      <div
        ref={text}
        className="textLayer"
        style={{ transform: stretch === 1 ? undefined : `scale(${stretch})` }}
      />
    </div>
  );
});
