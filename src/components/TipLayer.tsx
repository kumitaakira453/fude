import { useEffect, useRef, useState } from "react";

// 吹き出し。画面に 1 つだけ置き、指した部品の位置へ動かして使い回す。
//
// WKWebView は title 属性の吹き出しを出さない。部品には data-tip（名前）と
// data-key（キー）を付ければここで出す。title しか持たない絵だけのボタンも、
// 指したときに title を data-tip へ移して同じように出す（字のある行の title は
// 補足なので出さない）。

// 出すまでの待ち。続けて別の部品へ移ったときは待たずに出す。
const WAIT_MS = 700;
const WARM_MS = 300;
const GAP = 6;
const EDGE = 8;

export interface Tip {
  label: string;
  keys: string | null;
}

// 「サイドバー (⌘D)」「設定（⌘,）」のように末尾に括って書いたキーを分ける。
export function splitTip(text: string, key?: string | null): Tip {
  const m = /^(.*?)\s*[（(]\s*([⌘⌃⌥⇧][^）)]*)[）)]\s*$/s.exec(text);
  if (m) return { label: m[1], keys: key ?? m[2] };
  return { label: text, keys: key ?? null };
}

// 字を持たない（絵とキーの表示だけの）部品か。
function bare(el: Element): boolean {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(".material-symbols-rounded, .mg-ui-icon, kbd, svg").forEach((n) => n.remove());
  return (clone.textContent ?? "").trim() === "";
}

// 別の文書を抱える器（PDF・HTML を出す iframe など）。中へ入ると指した位置が
// 親に届かなくなるので、吹き出しの相手にしない。
const FRAME = "iframe, embed, object";

// 指した位置から、吹き出しを出す部品を探す。
export function tipTarget(from: Element | null): HTMLElement | null {
  if (from?.closest(FRAME)) return null;
  let el = from instanceof HTMLElement ? from : (from?.parentElement ?? null);
  while (el && el !== document.body) {
    if (el.dataset.tip) return el;
    const title = el.getAttribute("title");
    if (title && bare(el)) {
      el.dataset.tip = title;
      el.removeAttribute("title");
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

export function TipLayer() {
  const [tip, setTip] = useState<(Tip & { x: number; y: number; below: boolean }) | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const shownAt = useRef(0);

  useEffect(() => {
    let timer = 0;
    let on: HTMLElement | null = null;
    let showing = false;
    const settle = () => {
      if (showing) shownAt.current = Date.now();
      showing = false;
    };
    const hide = () => {
      window.clearTimeout(timer);
      settle();
      on = null;
      setTip(null);
    };
    const show = (el: HTMLElement) => {
      showing = true;
      const r = el.getBoundingClientRect();
      const below = r.bottom + 40 < window.innerHeight;
      setTip({
        ...splitTip(el.dataset.tip ?? "", el.dataset.key),
        x: r.left + r.width / 2,
        y: below ? r.bottom + GAP : r.top - GAP,
        below,
      });
    };
    const enter = (el: HTMLElement | null) => {
      if (el === on) return;
      window.clearTimeout(timer);
      on = el;
      const warm = showing || Date.now() - shownAt.current < WARM_MS;
      settle();
      if (!el) {
        setTip(null);
        return;
      }
      if (warm) show(el);
      else timer = window.setTimeout(() => on === el && show(el), WAIT_MS);
    };
    const onOver = (e: PointerEvent) => enter(tipTarget(e.target as Element));
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el.matches?.(":focus-visible")) enter(tipTarget(el));
    };
    window.addEventListener("pointerover", onOver, true);
    window.addEventListener("focusin", onFocus, true);
    window.addEventListener("pointerdown", hide, true);
    window.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("pointerover", onOver, true);
      window.removeEventListener("focusin", onFocus, true);
      window.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
      window.clearTimeout(timer);
    };
  }, []);

  // 端からはみ出さないよう、描いてから横の位置を詰める。
  useEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    const w = el.offsetWidth;
    const left = Math.max(EDGE, Math.min(tip.x - w / 2, window.innerWidth - EDGE - w));
    el.style.left = `${left}px`;
    el.style.top = tip.below ? `${tip.y}px` : `${tip.y - el.offsetHeight}px`;
    el.style.visibility = "visible";
  }, [tip]);

  if (!tip || !tip.label) return null;
  return (
    <div ref={box} role="tooltip" className="mg-tip" style={{ visibility: "hidden", left: 0, top: 0 }}>
      <span>{tip.label}</span>
      {tip.keys && <kbd>{tip.keys}</kbd>}
    </div>
  );
}
