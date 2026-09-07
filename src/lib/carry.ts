// 掴んだものをマウスで運ぶ。
//
// HTML5 のドラッグは使わない。WebKit は離したときに写しを掴んだ場所へ戻す
// アニメーションを出し、CSS からも JS からも止められない（`drop` で
// `preventDefault()` しても出る）。本文はその場で入れ替わっているので、
// 目には「戻ってから入れ替わった」と映る。
//
// 写しの位置を自分で持てば、掴んだところに付いてきて離した瞬間に消える。

export interface CarryOpts {
  // 押し下げた場所。ここから動いた距離で運びの始まりを決める。
  from: { x: number; y: number };
  // 付いてくる写し。無ければ写しなしで運ぶ。
  ghost: HTMLElement | null;
  // 写しの中で、カーソルが指す点。
  grip?: { x: number; y: number };
  // 運びが始まったとき。
  onStart?: () => void;
  onMove: (x: number, y: number) => void;
  onDrop: (x: number, y: number) => void;
  onCancel: () => void;
}

// 運びが始まるまでの距離。押しただけならメニューを出す道を残す。
const SLACK = 4;

export function startCarry(opts: CarryOpts): () => void {
  const { from, ghost, onMove, onDrop, onCancel, onStart } = opts;
  const grip = opts.grip ?? { x: 12, y: 12 };
  let carrying = false;
  let frame = 0;
  let at = { x: from.x, y: from.y };

  const place = () => {
    frame = 0;
    if (!ghost) return;
    ghost.style.left = `${at.x - grip.x}px`;
    ghost.style.top = `${at.y - grip.y}px`;
  };

  const follow = () => {
    if (frame || !ghost) return;
    frame = requestAnimationFrame(place);
  };

  const begin = () => {
    carrying = true;
    document.body.classList.add("mg-carrying");
    if (ghost) {
      ghost.classList.add("mg-carry");
      document.body.appendChild(ghost);
      place();
    }
    onStart?.();
  };

  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    document.body.classList.remove("mg-carrying");
    ghost?.remove();
    window.removeEventListener("mousemove", move, true);
    window.removeEventListener("mouseup", up, true);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", away);
  };

  function move(e: MouseEvent) {
    at = { x: e.clientX, y: e.clientY };
    if (!carrying) {
      if (Math.abs(at.x - from.x) < SLACK && Math.abs(at.y - from.y) < SLACK) return;
      begin();
    }
    // 本文の選択が始まらないようにする。
    e.preventDefault();
    follow();
    onMove(at.x, at.y);
  }

  function up(e: MouseEvent) {
    stop();
    if (!carrying) return;
    e.preventDefault();
    e.stopPropagation();
    onDrop(e.clientX, e.clientY);
  }

  function key(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    const was = carrying;
    stop();
    if (was) onCancel();
  }

  function away() {
    const was = carrying;
    stop();
    if (was) onCancel();
  }

  window.addEventListener("mousemove", move, true);
  window.addEventListener("mouseup", up, true);
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", away);

  // 途中でやめる口（部品が消えるときに使う）。
  return () => {
    const was = carrying;
    stop();
    if (was) onCancel();
  };
}
