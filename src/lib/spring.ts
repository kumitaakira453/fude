// 掴んだまま畳んだものの上に留まったら、開く。
//
// 運ぶ先が畳まれていると、そこへは置けない。いったん置くのをやめて開き、
// もう一度掴み直す、を繰り返すことになる。留まった先を開けば、掴んだまま
// 奥の階層まで降りられる（Finder も同じ振る舞いをする）。
//
// 留まる時間は、通り過ぎるだけでは開かず、置き先を探して止まったら開く長さ。

const DWELL = 550;

export interface Spring<T> {
  // いま指しているもの。指す先が変わるたびに呼ぶ。外れたときは null。
  over(next: T | null): void;
  stop(): void;
}

export function makeSpring<T>(
  open: (key: T) => void,
  dwell: number = DWELL,
): Spring<T> {
  let key: T | null = null;
  let timer = 0;

  const clear = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };

  return {
    over(next) {
      if (next === key) return;
      clear();
      key = next;
      if (next === null) return;
      timer = window.setTimeout(() => {
        timer = 0;
        open(next);
      }, dwell);
    },
    stop() {
      clear();
      key = null;
    },
  };
}

// 編集面の畳んだトグル。掴んだまま上に留まったら開く。
//
// 掴みものの種類は見ない（dragScroll と同じ）。座標の下に畳んだトグルが
// あれば開くだけなので、ブロックでも項目でも表でも、そのまま効く。
export function watchSpringDetails(): () => void {
  let at: HTMLElement | null = null;
  const spring = makeSpring<HTMLElement>((el) => {
    // 開き方は三角の押下と同じ道を通す。畳んだ覚えもそちらで書き換わる。
    el.querySelector<HTMLElement>(":scope > .mg-details-mark")?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
  });

  const onOver = (e: DragEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const shut =
      el instanceof Element
        ? el.closest<HTMLElement>(".mg-details.is-closed")
        : null;
    if (shut === at) return;
    at = shut;
    spring.over(shut);
  };

  const stop = () => {
    at = null;
    spring.stop();
  };

  window.addEventListener("dragover", onOver, true);
  window.addEventListener("dragend", stop, true);
  window.addEventListener("drop", stop, true);
  return () => {
    stop();
    window.removeEventListener("dragover", onOver, true);
    window.removeEventListener("dragend", stop, true);
    window.removeEventListener("drop", stop, true);
  };
}
