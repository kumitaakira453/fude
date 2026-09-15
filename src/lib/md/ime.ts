import { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

// 変換を確定した直後の 1 打を、編集面に届ける。
//
// prosemirror-view は WebKit 向けの備えとして、変換が終わってから 500ms の
// あいだ最初の keydown を捨てる（inOrNearComposition）。確定に使った Enter が
// 確定の知らせのあとでもう一度届く実装があり、それを二重に処理しないための
// ものだが、500ms は人の次の打鍵まで丸ごと覆う。日本語を打って確定し、続けて
// Enter を押す打ち方では毎回これに当たり、編集面は何も受け取らない。
// contenteditable の既定の改行だけが起きるので、箇条書きの次の項目にならず
// 点が出ない。本文と DOM がずれたままになるので、そこから先は入力変換も
// 効かなくなる。Enter に限らず、Tab も ⌘Z も同じ窓で消える。
//
// 窓を閉じる合図は時間ではなく、打鍵の切れ目にする。確定に使った物理キーは、
// 離すまで次の打鍵にならない。keyup を待てば、確定の keydown が知らせの前に
// 来ても後に来ても捨てるのは 1 回きりで、続けて押した分は必ず編集面へ届く。
//
// 時間で測ると、確定の keydown が窓を閉じたあとに届いた場合に今度は逆へ外す。
// 編集面はまだ変換後の字を読み込んでいない状態で塊を割り、そのあと DOM から
// 読み直した字が下に落ちて、同じ文が二重に出る。

// 捨てないことにする印。prosemirror-view が「ずっと前に終わった」と見る値。
const LONG_AGO = -2e8;

// 内側の控え。窓を閉じるのと、確定のあとの後始末に触る。名前が変わったら
// 試験で落ちる。
interface Inner {
  input?: { compositionEndedAt: number };
  domObserver?: { flushSoon(): void; pendingRecords(): unknown[]; queue: unknown[] };
  docView?: { markDirty(from: number, to: number): void };
}

const stopDropping = (view: EditorView): void => {
  const input = (view as EditorView & Inner).input;
  if (input && typeof input.compositionEndedAt === "number") {
    input.compositionEndedAt = LONG_AGO;
  }
};

// 変換の確定で起きる DOM の変化を、ひとまとめにしてから読ませる。
//
// WebKit は確定のとき 2 段で DOM を触る。まず変換中の字を消し（このとき、
// 中身がその字だけだった器は要素ごと消える）、数ミリ秒あとに確定の字を入れる。
// 消した側だけを読むと「見出しが消えて段落になった」形に見え、prosemirror は
// それを Enter と取るか、差分としてそのまま本文へ当てる。どちらでも見出しは
// 段落に落ちる。入れる側まで待てば、差分は字の入れ替えだけになる。
//
// prosemirror-view は同じことが表の行で起きるのを知っていて、そこでは
// flushSoon で待っている（badSafariComposition）。待ち方をそれに合わせる。
const holdRead = (view: EditorView): void => {
  (view as EditorView & Inner).domObserver?.flushSoon();
};

// 変換の確定で WebKit が作り替えた DOM は読まず、本文から描き直す。
//
// WebKit は確定のとき、中身が変換中の字だけだった器を要素ごと作り替える
// （見出しは <p><b>…</b><br></p> になる）。prosemirror がそれを差分として読むと、
// 本文の見出しが段落へ落ちる。
//
// 本文の側は、変換中の字が入った時点で確定後と同じ中身になっている。つまり
// 読み直す理由がない。溜まっている DOM の変化を捨て、書いていた塊に印を付けて
// 描き直せば、本文は無傷のまま画面が本文に追いつく。prosemirror は本文が
// 変わっていなくても、印が立っていれば描き直す（updateStateInner の
// matchesNode が dirty を見る）。
//
// 画面の字と本文の字が食い違うときは触らない。確定の字がまだ本文に入って
// いないので、そのときは今までどおり prosemirror に読ませる。
const mendAfterCompose = (view: EditorView): void => {
  const inner = view as EditorView & Inner;
  const watch = inner.domObserver;
  const drawn = inner.docView;
  if (!watch || !drawn) return;

  const $at = view.state.selection.$from;
  if ($at.depth < 1) return;
  // 作り替えは、書いていた行とそれを抱える器（項目や升目）までしか及ばない。
  // 並び全体まで描き直すと、項目の多い箇条書きでそのぶん時間がかかる。
  const from = $at.before(Math.max(1, $at.depth - 1));
  const node = view.state.doc.nodeAt(from);
  const dom = view.nodeDOM(from);
  if (!node || !(dom instanceof HTMLElement)) return;
  if (dom.textContent !== node.textContent) return;

  watch.pendingRecords();
  watch.queue.length = 0;
  drawn.markDirty(from, from + node.nodeSize);
  view.updateState(view.state);
};

export const composingKeys = () => {
  // 変換中か。WebKit は確定の打鍵の isComposing を false で寄こすことがあるので、
  // 知らせを自分でも数える（useImeSafeEnter と同じ見分け方）。
  let composing = false;

  return new Plugin({
    props: {
      handleDOMEvents: {
        compositionstart() {
          composing = true;
          return false;
        },
        compositionend(view) {
          composing = false;
          mendAfterCompose(view);
          return false;
        },
        beforeinput(view, event) {
          // 消した側だけを読ませない。待っているあいだに確定が来て、そこで
          // まとめて捨てる。
          if (event.inputType === "deleteCompositionText") holdRead(view);
          return false;
        },
        keyup(view, event) {
          if (composing || event.isComposing || event.keyCode === 229) return false;
          stopDropping(view);
          return false;
        },
      },
    },
  });
};
