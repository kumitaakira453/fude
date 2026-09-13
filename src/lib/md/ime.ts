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

// 内側の控え。窓を閉じるのに触る。名前が変わったら試験で落ちる。
interface Inner {
  input?: { compositionEndedAt: number };
}

const stopDropping = (view: EditorView): void => {
  const input = (view as EditorView & Inner).input;
  if (input && typeof input.compositionEndedAt === "number") {
    input.compositionEndedAt = LONG_AGO;
  }
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
        compositionend() {
          composing = false;
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
