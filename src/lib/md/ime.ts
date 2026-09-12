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
// 点が出ない。次に何か打って本文を読み直したところで、やっと形が整う。
//
// Enter に限らず、Tab も ⌘Z も同じ窓で消える。捨てるのは確定と見分けが
// つかないあいだだけにして、それ以降は普段どおり編集面へ渡す。
const SPURIOUS = 50;

// 捨てないことにする印。prosemirror-view が「ずっと前に終わった」と見る値。
const LONG_AGO = -2e8;

// 内側の控え。窓を短くするのに触る。名前が変わったら試験で落ちる。
interface Inner {
  input?: { compositionEndedAt: number };
}

export const composingKeys = () =>
  new Plugin({
    props: {
      handleDOMEvents: {
        compositionend(view) {
          window.setTimeout(() => {
            const input = (view as EditorView & Inner).input;
            if (input && typeof input.compositionEndedAt === "number") {
              input.compositionEndedAt = LONG_AGO;
            }
          }, SPURIOUS);
          return false;
        },
      },
    },
  });
