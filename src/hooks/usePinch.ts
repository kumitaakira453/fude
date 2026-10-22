import { useEffect, useRef } from "react";

// トラックパッドのピンチ。WebKit は wheel ではなく gesturestart / gesturechange /
// gestureend で送る（Chromium 系は ctrlKey 付きの wheel で送るので、そちらは
// 呼ぶ側の wheel で受ける）。
//
// 渡すのは始まりからの比と、枠の左上から測った指の位置。始まりの倍率は
// 呼ぶ側が start で控え、比を掛けて使う。止めないと窓ごと拡大される。

// WebKit 独自の催し。使う分だけを持つ。
interface Gesture extends Event {
  scale: number;
  clientX: number;
  clientY: number;
}

const isGesture = (e: Event): e is Gesture =>
  typeof (e as Partial<Gesture>).scale === "number";

// 受けるのは要素そのもの（ref の器ではなく）。後から描かれる・作り直される枠でも
// 付け直せるように、呼ぶ側が要素を state に控えて渡す。
export function usePinch(
  el: HTMLElement | null,
  on: { start: () => void; change: (ratio: number, at: { x: number; y: number }) => void },
): void {
  // 毎回の描き直しで繋ぎ直さないよう、手は控えから呼ぶ。
  const hands = useRef(on);
  hands.current = on;

  useEffect(() => {
    if (!el) return;
    const onStart = (e: Event) => {
      e.preventDefault();
      hands.current.start();
    };
    const onChange = (e: Event) => {
      e.preventDefault();
      if (!isGesture(e)) return;
      const box = el.getBoundingClientRect();
      hands.current.change(e.scale, { x: e.clientX - box.left, y: e.clientY - box.top });
    };
    const onEnd = (e: Event) => e.preventDefault();
    el.addEventListener("gesturestart", onStart);
    el.addEventListener("gesturechange", onChange);
    el.addEventListener("gestureend", onEnd);
    return () => {
      el.removeEventListener("gesturestart", onStart);
      el.removeEventListener("gesturechange", onChange);
      el.removeEventListener("gestureend", onEnd);
    };
  }, [el]);
}
