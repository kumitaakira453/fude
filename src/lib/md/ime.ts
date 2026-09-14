import type { Node as PmNode } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
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

// 内側の控え。窓を閉じるのと、読み取りを束ねるのに触る。名前が変わったら
// 試験で落ちる。
interface Inner {
  input?: { compositionEndedAt: number };
  domObserver?: { flushSoon(): void; forceFlush(): void };
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

// 束ねた読み取りを、確定の字が入った直後に片付ける。待つと、作り替えられた
// 見た目（見出しが段落に潰れた姿）がそのぶん長く画面に残る。
const readNow = (view: EditorView): void => {
  (view as EditorView & Inner).domObserver?.forceFlush();
};

// 変換が終わってから、作り替えの差分が届くまでの猶予。実測では 8ms ほど。
const AFTER = 200;

// その塊の形。変換の前後で変わっていなければ、字の入れ替えだけと見てよい。
const shapeOf = (node: PmNode): string => `${node.type.name}:${node.attrs.level ?? ""}`;

export const composingKeys = () => {
  // 変換中か。WebKit は確定の打鍵の isComposing を false で寄こすことがあるので、
  // 知らせを自分でも数える（useImeSafeEnter と同じ見分け方）。
  let composing = false;
  // 変換が終わった時刻。作り替えの差分は、終わった知らせの少しあとに届く。
  let ended = -1;

  return new Plugin({
    // 変換の確定で WebKit が器ごと作り替えたぶんを、本文の側で戻す。
    //
    // 確定のとき WebKit は見出しなどの器を <p><b>…</b><br></p> に作り替える
    // （deleteCompositionText は cancelable: false なので止められない）。
    // prosemirror はそれを差分として読み、見出しを段落へ落とす。
    //
    // 落ちる前の塊は、変換中の字が入った時点で既に確定後と同じ中身になって
    // いる。だからその塊をそのまま置き直せば、器も飾りも元どおりになる。
    // 差分を捨てる形にすると、画面には作り替えられた DOM が後始末まで
    // （実測 20ms）残って、見出しが一度潰れてから戻るように見える。
    //
    // 見るのは変換の最中と、終わった直後だけ。その窓の中で、書いている塊の形
    // そのものが変わったときだけ戻す。字の入れ替えには手を出さない。
    appendTransaction(trs, old, next) {
      if (!trs.some((tr) => tr.docChanged)) return null;
      if (!composing && !(ended > 0 && Date.now() - ended < AFTER)) return null;
      const was = old.selection.$from;
      const $at = next.selection.$from;
      if (shapeOf(was.parent) === shapeOf($at.parent)) return null;
      const from = $at.before();
      const tr = next.tr.replaceWith(from, $at.after(), was.parent);
      const back = Math.min(from + 1 + was.parentOffset, tr.doc.content.size);
      return tr.setSelection(TextSelection.create(tr.doc, back));
    },
    props: {
      handleDOMEvents: {
        compositionstart() {
          composing = true;
          return false;
        },
        compositionend() {
          composing = false;
          ended = Date.now();
          return false;
        },
        beforeinput(view, event) {
          if (event.inputType === "deleteCompositionText") holdRead(view);
          // beforeinput は変わる前に来るので、入った直後まで一手ずらす。
          else if (event.inputType === "insertFromComposition") {
            void Promise.resolve().then(() => {
              if (!view.isDestroyed) readNow(view);
            });
          }
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
