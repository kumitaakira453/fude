import { Plugin, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { readBlockText } from "../domText";

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
  domObserver?: {
    flushSoon(): void;
    forceFlush(): void;
    pendingRecords(): unknown[];
    queue: unknown[];
  };
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

// 待たせていた分を、確定の字が入った直後にその場で読ませる。
//
// WebKit は、中身が変換中の字だけだった行（行頭から打ち始めた箇条書きの項目
// など）では、消すときに項目ごと DOM から外し、確定の字を項目の外へ入れる。
// 読むのを待ったままにすると、prosemirror が項目を組み直すまで（確定の知らせ
// のあと、次の変換が始まるまで）行が画面から消え、一瞬差し替わったように
// ちらつく。確定と同じ処理の中で読めば、外れた姿は描かれない。
const readNow = (view: EditorView): void => {
  (view as EditorView & Inner).domObserver?.forceFlush();
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
//
// 変換中の字の一部だけを確定したとき（行頭から長く打ち続けたときの自動確定。
// 先頭の文節だけを確定し、残りはすぐ次の変換になる）も触らない。そのとき
// 本文はまだ変換中だった字を丸ごと持っていて、確定後の中身ではない。描き直すと
// その丸ごとの字が画面に戻り、続く変換の字が後ろに足されて二重になる。
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
  // 画面の字は、本文に無いもの（コードの塊の言語の札やコピーの釦、アイコンの
  // 合字）を除いて数える。そのまま数えると、それらを抱える節点では本文と必ず
  // 食い違い、手当てが素通りして塊が段落へ落ちる。
  if (readBlockText(dom).plain !== node.textContent) return;

  watch.pendingRecords();
  watch.queue.length = 0;
  drawn.markDirty(from, from + node.nodeSize);
  view.updateState(view.state);
};

// 候補を矢印で選んでいる間、WebKit は変換中の字を選択範囲として持ち、
// prosemirror もそれを読んで選択を範囲にする。確定したあともその範囲が残ると、
// 確定した字が選ばれたまま見える。変換が終わって字が落ち着いたら末尾へ畳む。
// 次の変換が始まっていたら触らない。
const collapseAfterCompose = (view: EditorView): void => {
  requestAnimationFrame(() => {
    if (view.isDestroyed || view.composing) return;
    const sel = view.state.selection;
    if (!(sel instanceof TextSelection) || sel.empty) return;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, sel.to)));
  });
};

export const composingKeys = () => {
  // 変換中か。WebKit は確定の打鍵の isComposing を false で寄こすことがあるので、
  // 知らせを自分でも数える（useImeSafeEnter と同じ見分け方）。
  let composing = false;
  // 直前まで変換中だった字。確定した字と同じなら、全部をそのまま確定した。
  let marked: string | null = null;

  return new Plugin({
    props: {
      handleDOMEvents: {
        compositionstart() {
          composing = true;
          marked = null;
          return false;
        },
        compositionupdate(_view, event) {
          marked = event.data;
          return false;
        },
        compositionend(view, event) {
          composing = false;
          // 一部だけの確定（自動確定）では描き直さない。上の mendAfterCompose の説明。
          if (marked === null || event.data === marked) mendAfterCompose(view);
          marked = null;
          collapseAfterCompose(view);
          return false;
        },
        input(view, event) {
          // 確定の字が入ったら、その場で読ませる。待たせていた消した側と合わせて
          // 1 度に読み、器の作り直しを確定と同じ処理の中で済ませる。
          if ((event as InputEvent).inputType === "insertFromComposition") readNow(view);
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
