import { fromMarkdown, type Loaded } from "./fromMarkdown";
import { unpack } from "./loadedWire";
import type { Ask, Reply } from "./parse.worker";

// 本文の解析を Worker へ頼む。
//
// 解析は本文の大きさに比例して重く（2000 ブロックで実測 285ms、4000 で
// 441ms）、メインスレッドで走らせるとその間ブラウザは 1 枚も塗れず、押下も
// 処理されない。受け渡しは 24ms / 36ms で済むので、外へ出すのが利く。
//
// 使えないときは同期の `fromMarkdown` に落とす。試験（jsdom には Worker が
// 無い）と、万一 WKWebView で module worker が動かないときの受け。

// 返事が来ないまま放っておくと編集面が出ないままになる。最後の受けとして
// 時間で切って同期でやり直す。大きい本文の解析より十分長くしておく。
const GIVE_UP = 10_000;

interface Pending {
  body: string;
  done: (loaded: Loaded) => void;
  timer: number;
}

let worker: Worker | null = null;
let broken = false;
let seq = 0;
const pending = new Map<number, Pending>();

// 待っている分を同期でやり直す。Worker が壊れたときに使う。
function fallbackAll(): void {
  for (const [id, one] of [...pending]) {
    pending.delete(id);
    window.clearTimeout(one.timer);
    one.done(fromMarkdown(one.body));
  }
}

function boot(): Worker | null {
  if (broken) return null;
  if (worker) return worker;
  if (typeof Worker === "undefined") {
    broken = true;
    return null;
  }
  try {
    const made = new Worker(new URL("./parse.worker.ts", import.meta.url), {
      type: "module",
    });
    made.onmessage = (event: MessageEvent<Reply>) => {
      const { id, wire, error } = event.data;
      const one = pending.get(id);
      if (!one) return;
      pending.delete(id);
      window.clearTimeout(one.timer);
      // 解析でしくじったら同期でやり直す。原因は本文の側にあるはずなので、
      // Worker は壊れたことにしない。
      one.done(error !== undefined || !wire ? fromMarkdown(one.body) : unpack(wire));
    };
    const die = () => {
      broken = true;
      made.terminate();
      worker = null;
      fallbackAll();
    };
    made.onerror = die;
    made.onmessageerror = die;
    worker = made;
  } catch {
    broken = true;
    return null;
  }
  return worker;
}

// Worker が使えるときは Promise、使えないときは**その場で**返す。
// 落とし先で 1 手待たせないのは、待つ意味が無いところに非同期を持ち込まない
// ため（試験も組み立て直後に編集面を見られる）。
export function parseAway(body: string): Loaded | Promise<Loaded> {
  const at = boot();
  if (!at) return fromMarkdown(body);
  const id = ++seq;
  return new Promise<Loaded>((done) => {
    const timer = window.setTimeout(() => {
      if (!pending.delete(id)) return;
      done(fromMarkdown(body));
    }, GIVE_UP);
    pending.set(id, { body, done, timer });
    at.postMessage({ id, body } satisfies Ask);
  });
}
