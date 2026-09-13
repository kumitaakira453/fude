import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DocSearchOverlay } from "./DocSearchOverlay";
import { useReview } from "../hooks/useReview";
import { useWorkspace } from "../hooks/useWorkspace";
import { fontStack } from "../lib/fonts";
import {
  blockIndexOf,
  blockRect,
  selectTextIn,
  topmostBlock,
} from "../lib/domText";
import { blocksOf } from "../lib/blocks";
import { askWhereToSave, DRAFT, dropDraft, inDrafts } from "../lib/drafts";
import { parseFrontmatter } from "../lib/frontmatter";
import { displayName, writeFile } from "../lib/fsAccess";
import { createCheckpoint, moveReviewFile } from "../lib/review";
import { defaultName } from "../lib/versions";
import { DARK_THEME_IDS } from "../lib/themes";
import { closePane, inEditable, inFloating, WIDTH_CLASS } from "../lib/ui";
import { screenOpenAtom, syncLedger, versionScreenAtom } from "../state/review";
import { notify, notifyBusy, settle } from "../state/toast";
import {
  activeFolderIdAtom,
  activePath,
  activePaneIdAtom,
  contentCacheAtom,
  editorialAtom,
  fontAtom,
  draftAskAtom,
  draftsDirAtom,
  liveEditAtom,
  metaOpenAtom,
  paletteOpenAtom,
  readingWidthAtom,
  settingsOpenAtom,
  shortcutsOpenAtom,
  soleAtom,
  themeAtom,
  tocOpenAtom,
  watchModeAtom,
  type Pane,
} from "../state/atoms";
import { Breadcrumbs } from "./Breadcrumbs";
import { EditableBody } from "./EditableBody";
import { DraftClose } from "./DraftClose";
import { MetaModal } from "./meta/MetaModal";
import { Icon } from "./Icon";
import { LoadingBody } from "./LoadingBody";
import { markdownContext } from "./MarkdownContext";
import { kindOf } from "../lib/kind";
import { BodyEditor, type Editing } from "./BodyEditor";
import { HtmlDoc } from "./HtmlDoc";
import { ImageDoc } from "./ImageDoc";
import { PdfDoc } from "./PdfDoc";
import { SelectionBar } from "./SelectionBar";
import { SaveVersion } from "./version/SaveVersion";
import {
  recallViewpoint,
  rememberViewpoint,
  viewKey,
} from "../lib/viewpoint";
import { AnchorOverlay } from "./review/AnchorOverlay";
import {
  readingMarks,
  readingPending,
  type Marked,
} from "../lib/reviewMarks";
import { anchorsKey } from "../lib/md/anchors";
import { editorMarks, editorPending } from "../lib/md/editorMarks";
import {
  anchorThreads,
  targetOfBlock,
  targetOfSpan,
} from "../lib/md/reviewAnchors";
import { TextSelection } from "prosemirror-state";
import { domSpan } from "../lib/md/domSpan";
import { CommentComposer } from "./review/CommentComposer";
import { SelectionAct, SelectionMenu } from "./review/SelectionMenu";
import { Toc } from "./Toc";
import { Tooltip } from "./Tooltip";

// 外の書き換えを取り込むまでの待ち。エージェントは 1 回の作業で何度も書くので、
// 続けて来た分をまとめる。
const ADOPT_WAIT = 800;

export function DocPane({ pane, isSplit }: { pane: Pane; isSplit: boolean }) {
  const cache = useAtomValue(contentCacheAtom);
  const font = useAtomValue(fontAtom);
  const width = useAtomValue(readingWidthAtom);
  const editorial = useAtomValue(editorialAtom);
  const live = useAtomValue(liveEditAtom);
  // 設定の切り替えでファイル切替の手順を走らせないよう、控えから読む。
  const liveRef = useRef(live);
  liveRef.current = live;
  // 図の明暗。mermaid は暗い / 明るいの 2 通りしか描き分けない。
  const dark = DARK_THEME_IDS.has(useAtomValue(themeAtom));
  const tocOpen = useAtomValue(tocOpenAtom);
  const watchMode = useAtomValue(watchModeAtom);
  const [activeId, setActiveId] = useAtom(activePaneIdAtom);
  // 重ねた画面が出ているか。本文向けのキー操作をそこへ効かせないための判定。
  // コメント・バージョンの画面が出ているあいだ、読む画面は隠れているだけで
  // 生きているので、ここで止めないとキー操作がその画面の上でも効いてしまう。
  const settingsOpen = useAtomValue(settingsOpenAtom);
  const shortcutsOpen = useAtomValue(shortcutsOpenAtom);
  const paletteOpen = useAtomValue(paletteOpenAtom);
  const screenOpen = useAtomValue(screenOpenAtom);
  const overlayOpen = settingsOpen || shortcutsOpen || paletteOpen || screenOpen;
  const store = useStore();
  const {
    absOf,
    navigate,
    openDoc,
    resolveAsset,
    peekAsset,
    reloadFile,
    saveFile,
    undoFile,
    redoFile,
  } = useWorkspace();

  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [content, setContent] = useState<HTMLElement | null>(null);
  // 進捗バーはスクロール毎に DOM へ直接反映する。
  // （React 再描画 + CSS transition を挟むと遅延してむしろ煩わしいため）
  const progressRef = useRef<HTMLDivElement>(null);
  const setBar = (frac: number) => {
    if (progressRef.current) progressRef.current.style.width = `${frac * 100}%`;
  };
  // 見ていた場所はプレビュー・全文編集・レビュー画面の行き帰りで引き継ぐ。
  // 控えはコンポーネントの外（lib/viewpoint）に置く。レビュー画面は本文の木を
  // 丸ごと差し替えるので、ここに持つと戻ってきた時点で消えていて先頭に戻る。
  const [editing, setEditing] = useState(false);
  // 新しいファイルを編集面で開く途中。組むのに時間がかかる（大きい本文で
  // 300ms 台）ので、先に読み込みの印を描いてから組む。ツリーで選んだ瞬間に
  // 選択と画面が切り替わって見えるようにするため、ここを同じ一枚でやらない。
  const [opening, setOpening] = useState(false);
  const [draft, setDraft] = useState("");
  // フロントマター（先頭の --- ブロック）をその場編集中か（開始時のクリック座標）
  // 選択メニューの「編集する」から立てる編集の頼み。
  const [editRequest, setEditRequest] = useState<{
    // どのファイルへの頼みか。ファイルを切り替えると本文の中身も番号も
    // 変わるので、別のファイルに残った頼みは効かせない。
    path: string;
    blockIndex: number;
    // 表のセル・箇条書きの項目を選んでいるときは、その要素のソースオフセット。
    // どちらでもなければ両方 undefined で、ブロック全体の編集になる。
    cellStart?: number;
    itemAnchor?: number;
    nonce: number;
  } | null>(null);
  // 編集面の要素と、その入れ物。目次が本文の DOM を見るのに使う。
  const [editContent, setEditContent] = useState<HTMLElement | null>(null);
  const [editScroller, setEditScroller] = useState<HTMLElement | null>(null);

  const isActive = activeId === pane.id;
  // 押した瞬間の値と、本文を組むための値を分ける。
  //
  // 本文の入れ替え（前の本文の片付けと新しい本文の組み立て）は 900 ブロックで
  // 実測 105〜144ms、2000 ブロックで 196〜215ms かかる。これを選択の塗りと同じ
  // 一枚に入れると、React は組み終わるまでコミットせず、ブラウザはコミットまで
  // 塗れない。状態が同期で変わっていても画面が追いつかないのはこれ。
  //
  // 遅らせた値で本文を組めば、押した一枚は「前の本文のまま + 骨組みを重ねる」
  // だけで済む。入れ替えは塗った後の一枚へ移る。
  //
  // 進めるのは requestAnimationFrame の二段。useDeferredValue では分かれない
  // （React の scheduler は塗りを待たず、同じフレームのうちに遅らせた側の描画へ
  // 入る。実測でも本文の大きさに比例したまま最大 224ms だった）。一段目はその
  // フレームの塗りより前に走るので、二段目まで待って初めて塗った後になる。
  //
  // 組み立ては startTransition の中で始める。そのままだと割り込めない同期の
  // 描画になり、900 ブロックなら 100ms 以上のあいだ本流が塞がって、その間に
  // 別のファイルを押しても何も起きない。transition なら合間にブラウザへ譲り、
  // 押下が来たらその場で割り込んで、進めていた分は捨てて押した先で組み直す。
  // path は途中のファイルを飛ばして最後に押したものへ進むので、path を見ている
  // 効果（編集モードの解除・見ていた場所の復帰・印の当て直し）も走らない。
  const shownPath = activePath(pane);
  const [path, setPath] = useState(shownPath);
  // 押した先へ本文がまだ追いついていない。骨組みを重ねる合図。
  const settling = shownPath !== path;
  useEffect(() => {
    if (!settling) return;
    const go = () => startTransition(() => setPath(shownPath));
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(go);
    });
    // 窓が隠れているとフレームは来ない。骨組みのまま取り残されないよう、
    // 時間でも進める（先に来たほうで切り替わる）。
    const late = window.setTimeout(go, 100);
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      window.clearTimeout(late);
    };
  }, [settling, shownPath]);
  const raw = path ? cache.get(path) : undefined;

  // 本文が読めていないあいだは骨組みを出す。
  //
  // 待たずに出す。以前は「一瞬で読めるときにちらつかせない」ために 180ms
  // 遅らせていたが、その間は骨組みも本文も無い白紙になり、押した手応えが
  // まるで無かった。速く読めたときに一瞬光る方を採る。
  const loaded = !!path && raw !== undefined;

  // 保存の途中が分かるようにする。件数で数えるのは、続けて保存したときに
  // 先に終わった 1 件で印が消えないため。
  const [saving, setSaving] = useState(0);
  const write = useCallback(
    (rel: string, text: string, opts?: { checkpoint?: boolean }) => {
      setSaving((n) => n + 1);
      void saveFile(rel, text, opts).finally(() => setSaving((n) => n - 1));
    },
    [saveFile],
  );

  // 編集面から「今すぐ組み直して渡せ」と頼む口。編集面が入れる。
  const flushRef = useRef<(() => void) | null>(null);
  // 外で書き換わった本文を編集面へ入れる口。
  const adoptRef = useRef<((text: string) => void) | null>(null);
  // 編集面が読み込んだ本文。自分の保存が返ってきただけなのか、外で
  // 書き換わったのかを見分ける。
  const base = useRef("");
  // この編集で文書全体の Undo に段を積んだか。積むのは 1 回だけにして、
  // ⌘Z が「この編集を始める前」まで 1 度で戻るようにする。
  const marked = useRef(false);

  // 自動保存。編集面が組み直した本文をそのまま書く。
  const autoSave = useCallback(
    (rel: string, text: string) => {
      const first = !marked.current;
      marked.current = true;
      base.current = text;
      write(rel, text, { checkpoint: first });
    },
    [write],
  );


  // ---- バージョン ----
  const openVersions = useSetAtom(versionScreenAtom);
  // バージョンの名前を決める小窓。開くたびに日時を入れ直す。
  const [naming, setNaming] = useState<string | null>(null);
  // メタ情報の小窓。開いているペインの id を持つので、⌘⇧M からも開ける。
  const [metaPane, setMetaPane] = useAtom(metaOpenAtom);
  const metaOpen = metaPane === pane.id;
  // 閉じるのは自分の分だけ。隣のペインで開いている小窓を巻き込まない。
  const closeMeta = useCallback(
    () => setMetaPane((id) => (id === pane.id ? null : id)),
    [setMetaPane, pane.id],
  );
  const stamping = useRef(false);

  // 書きかけを先に流し、そのうえで今の本文を読む。
  //
  // 自動保存が届く前に押されると、打った直後の一手が入っていない本文を
  // 版にしてしまう。flush は本文キャッシュを同期で書き換えるので、
  // 呼んだ直後に読めば最新が取れる（描画を待つ cache は 1 手古い）。
  const settled = useCallback((): string | null => {
    if (!path) return null;
    flushRef.current?.();
    return store.get(contentCacheAtom).get(path) ?? null;
  }, [path, store]);

  // バージョンを打つ。名前を消して確定すれば名前なしで残る。
  const stamp = useCallback(
    async (name: string) => {
      if (stamping.current || !path) return;
      const text = settled();
      const abs = absOf(path);
      if (text === null || !abs) return;
      stamping.current = true;
      try {
        const done = await createCheckpoint(abs, text, name.trim() || null);
        if (!done) return;
        await syncLedger(store);
        notify(
          store,
          done.created
            ? "バージョンを保存しました"
            : "同じ内容のバージョンがすでにあります",
        );
      } finally {
        stamping.current = false;
      }
    },
    [absOf, path, settled, store],
  );

  const sole = useAtomValue(soleAtom);

  // ---- 下書き（保存先の決まっていないメモ） ----
  const draftsDir = useAtomValue(draftsDirAtom);
  const isDraft = inDrafts(sole, draftsDir);
  // 何で見せるか。Markdown 以外は読むだけなので、編集・版・指摘は出さない。
  const kind = path ? kindOf(path) : "markdown";
  const isDoc = kind === "markdown";
  const [ask, setAsk] = useAtom(draftAskAtom);

  // 保存先を決めて、そこへ移す。指摘と版も付いていく。
  //
  // 名前を変えるのではなく、書いてから消す。名前を変えると、遅れて届く
  // 自動保存が元の道筋にもう 1 つ作ってしまう。
  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (!sole) return false;
    const text = settled() ?? "";
    const dest = await askWhereToSave();
    if (!dest) return false;
    await writeFile(dest, text);
    await moveReviewFile(sole, dest);
    openDoc(dest);
    // 開き先が変わってから消す。ここまで来れば、下書きへ書く経路はもう無い。
    requestAnimationFrame(() => void dropDraft(sole));
    return true;
  }, [sole, settled, openDoc]);

  // 名前を決める小窓を開く。既定の名前はそのときの日時。
  const startNaming = useCallback(() => {
    if (path) setNaming(defaultName());
  }, [path]);

  // 履歴を開く。開く前に書きかけを流して、いまの本文をバージョンと
  // 比べられるようにする。
  const showVersions = useCallback(() => {
    if (!path) return;
    settled();
    openVersions(path);
  }, [openVersions, path, settled]);

  // ⌘S の行き先。下書きは版を持てない（置き場がまだ決まっていない）ので、
  // 同じキーで保存先を決めるほうへ回す。釦も同じ場所で入れ替える。
  const onCmdS = useCallback(() => {
    if (isDraft) {
      void saveDraft();
      return;
    }
    startNaming();
  }, [isDraft, saveDraft, startNaming]);

  // ⌘S でバージョンを打つ。自動保存があるので、押して書き足すものは無い。
  //
  // 編集面の中では編集面の側の割り当てが受け取る（そちらは preventDefault まで
  // する）。ここは読む画面と、入力欄の外にいるときのための受け口。
  useEffect(() => {
    if (!isActive || overlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key !== "s" && e.key !== "S") return;
      if (inEditable(e.target)) return;
      e.preventDefault();
      onCmdS();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, overlayOpen, onCmdS]);
  const exitEdit = () => {
    // 書きかけを先に流す。流れた分は自動保存が書く。
    flushRef.current?.();
    // 戻ったときに合わせるブロックまでを、最初の描画で出させる。
    setStartAt(restoreIndex() ?? 0);
    setEditing(false);
  };

  // 外で書き換わったものを編集面へ取り込む。
  //
  // 相手は AI エージェントで、1 回の作業で何度も書く。続けて来た分は 1 回に
  // まとめる。手元に未保存があるあいだは触らない（打っている最中に本文を
  // 差し替えない、という意味でもある）。
  useEffect(() => {
    if (!editing || raw === undefined || raw === base.current) return;
    if (draft !== base.current) return;
    const t = window.setTimeout(() => {
      // 寝かせている間に打ち始めたら見送る。
      if (draft !== base.current) return;
      base.current = raw;
      setDraft(raw);
      // 編集面が持っているのは本文だけ（Loaded.source はフロントマターを
      // 除いたもの）。全文を渡すとフロントマターが本文の節点として入る。
      adoptRef.current?.(parseFrontmatter(raw).body);
    }, ADOPT_WAIT);
    return () => window.clearTimeout(t);
  }, [editing, raw, draft]);


  // ファイル切替。書きかけは編集面の後片付けが流すので、ここでは何も書かない
  // （切り替える前の path 向けの onChange が呼ばれる）。
  //
  // リアルタイム編集が入っているときは**編集モードを降りない**。
  // React は子（編集面）の効果を親より先に走らせるので、ここで一度降りると
  // その前に新しいファイルの編集面が組まれてしまい、それを捨ててもう一度
  // 組むことになる。2000 ブロックで実測すると 1 回の押下で
  // fromMarkdown 130ms → 組み立て 28ms → 焦点 375ms が**2 度**走っていた。
  useEffect(() => {
    marked.current = false;
    closeMeta();
    // 本文は控えから読む。raw を依存に入れると、自分の保存が返ってきた
    // だけでもここが走り、書きかけを取り込みの手順より先に踏んでしまう。
    const text = rawRef.current;
    if (liveRef.current && text !== undefined) {
      // そのまま編集面で開く。組むのは 1 度だけになる。
      handed.current = path;
      setDraft(text);
      base.current = text;
      setOpening(false);
      setEditing(true);
      return;
    }
    setEditing(false);
    // リアルタイム編集が入っていてまだ読めていないときは、読み込みの印を
    // 出しておく。読めた時点で下の手順が編集面へ移す。
    setOpening(liveRef.current);
  }, [path, closeMeta]);

  // 読む / 書くは設定だけで決まる。本文が読めた時点で編集面へ移し、設定を
  // 切ったらその場で読む画面へ降りる。
  //
  // 渡し終えた path を控える。組むのは 2 フレーム後なので、そのあいだに
  // ここがもう一度走ると（本文が届いた、印が下りた）同じファイルを二重に組む。
  const handed = useRef<string | null>(null);
  useEffect(() => {
    if (!live) {
      handed.current = null;
      if (editing) {
        // 書きかけの指摘は持ち越さない。対象の指し方が画面ごとに違う。
        reviewRef.current?.close();
        setEditSel(null);
        exitEdit();
      }
      return;
    }
    if (!path || !loaded) return;
    if (handed.current === path) {
      // 既に渡したファイル。印が残っていたら下ろす（読み込みの印のまま
      // 止まらないように）。
      if (opening) setOpening(false);
      return;
    }
    handed.current = path;
    setDraft(raw ?? "");
    base.current = raw ?? "";
    marked.current = false;
    // 印を描いた後の一枚で組む。同じ一枚でやると印が出ないまま止まる。
    const want = path;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        // 組んでいる間に別のファイルへ移っていたら、そちらの手順に任せる。
        if (pathRef.current !== want) return;
        setOpening(false);
        setEditing(true);
      }),
    );
    // exitEdit は描画ごとに作り直される（見ていた場所を今の本文から出す）。
    // 依存に入れると、設定が入っているあいだも毎回走る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, editing, path, loaded, raw, opening]);

  // ドキュメント全体の Undo/Redo（アクティブペインのみ、CM 編集中は CM に任せる）
  useEffect(() => {
    if (!isActive || overlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.key !== "z" && e.key !== "Z")) return;
      // 編集中の入力欄（CodeMirror・セルのインライン textarea 等）では、
      // その入力欄自身のネイティブ undo を優先し、ドキュメント全体の undo は行わない
      if (inEditable(e.target)) return;
      if (!path) return;
      e.preventDefault();
      // 指摘を消した直後は、それを戻す。消したものが無ければ本文へ譲る。
      if (!e.shiftKey && reviewRef.current?.undoRemove()) return;
      // 本文全体を読み直すので間があく。何が起きているかを知らせで出す。
      const back = !e.shiftKey;
      const id = notifyBusy(store, back ? "戻しています" : "やり直しています", "right");
      void (back ? undoFile(path) : redoFile(path)).then((ok) => {
        settle(
          store,
          id,
          ok
            ? back
              ? "戻しました"
              : "やり直しました"
            : back
              ? "これ以上戻せません"
              : "やり直せる変更がありません",
        );
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, overlayOpen, path, undoFile, redoFile, store]);

  const { data, body, broken } = useMemo(() => parseFrontmatter(raw ?? ""), [raw]);
  const absPath = useMemo(() => (path ? absOf(path) : null), [path, absOf]);
  const review = useReview({ absPath, body, raw, content, isActive });
  // キー操作から今の選択を読むための控え。毎描画で作り直さずに済む。
  const reviewRef = useRef(review);
  reviewRef.current = review;

  // 最新の raw/body/path を ref で参照し、saveBody を安定な関数に保つ。
  // （背景索引などで再レンダーしても Markdown のメモ化が壊れず、Mermaid の
  //  再パース＝チカチカを防ぐ）
  const rawRef = useRef(raw);
  const bodyRef = useRef(body);
  const pathRef = useRef(path);
  rawRef.current = raw;
  bodyRef.current = body;
  pathRef.current = path;

  // ブロック編集の確定: body を差し戻し、フロントマターを保ったまま全文保存する。
  // body は raw の suffix なので、先頭の frontmatter 部分を prefix として復元する。
  const saveBody = useCallback(
    (newBody: string) => {
      const p = pathRef.current;
      if (!p) return;
      const full = rawRef.current ?? "";
      const prefix = full.slice(0, full.length - bodyRef.current.length);
      write(p, prefix + newBody);
    },
    [write],
  );

  // ブロック全体への指摘。つまみのメニューから呼ぶ。選択を持たない操作なので、
  // そのブロックの中身を選んでから通常の指摘の流れに乗せる。
  const commentOnBlock = useCallback(
    (index: number) => {
      if (!content) return;
      const el = content.querySelector<HTMLElement>(
        `[data-mg-block="${index}"]`,
      );
      if (!el) return;
      if (selectTextIn(el)) {
        reviewRef.current?.startDraft({ whole: true });
        return;
      }
      // 図のように選べる文字を持たないブロック。枠そのものを対象にする。
      const rect = blockRect(el) ?? el.getBoundingClientRect();
      reviewRef.current?.startDraft({
        whole: true,
        at: { blockIndex: index, start: 0, end: 0, text: "", rect },
      });
    },
    [content],
  );

  // 指摘を書いている間、対象のブロックが今どこに居るかを測る。小窓は
  // 動いた分だけ一緒に動く。
  // 小窓が居てよい範囲。分割しているときに隣のペインやタブ帯へはみ出さない。
  const draftArea = useCallback(() => {
    const el = scroller ?? content;
    return el ? el.getBoundingClientRect() : null;
  }, [scroller, content]);

  const trackDraft = useCallback(() => {
    const at = reviewRef.current?.draft?.blockIndex;
    if (!content || at === undefined) return null;
    const el = content.querySelector<HTMLElement>(`[data-mg-block="${at}"]`);
    if (!el) return null;
    const box = blockRect(el) ?? el.getBoundingClientRect();
    return { top: box.top, left: box.left };
  }, [content]);

  // 箇条書きの項目への指摘。項目の中身を選んでから通常の流れに乗せるので、
  // 印はその項目の箱で出る。
  const commentOnItem = useCallback(
    (index: number, anchor: number) => {
      const el = content?.querySelector<HTMLElement>(
        `[data-mg-block="${index}"] li[data-mg-item="${anchor}"]`,
      );
      if (!el || !selectTextIn(el)) return;
      reviewRef.current?.startDraft({ unit: true });
    },
    [content],
  );

  // セルへの指摘を、位置から直に始める。右押しのメニューから呼ぶ。
  // 中身のあるセルは選択に乗せ、空のセルはセルの箱そのものを対象にする。
  const commentOnCellAt = useCallback(
    (index: number, cellStart: number) => {
      if (!content) return;
      const cell = content.querySelector<HTMLElement>(
        `[data-mg-block="${index}"] [data-mg-cell="${cellStart}"]`,
      );
      if (!cell) return;
      if (selectTextIn(cell)) {
        reviewRef.current?.startDraft({ unit: true });
        return;
      }
      reviewRef.current?.startDraft({
        unit: true,
        at: {
          blockIndex: index,
          start: 0,
          end: 0,
          text: "",
          rect: cell.getBoundingClientRect(),
          cellStart,
        },
      });
    },
    [content],
  );

  // セル全体への指摘。セルの中を選んでいるときだけ使える。選択をセルの
  // 中身へ広げてから通常の流れに乗せるので、印はセルの箱で出る。
  const commentOnCell = useCallback(() => {
    const sel = reviewRef.current?.selection;
    if (!content || !sel || sel.cellStart === undefined) return;
    const cell = content.querySelector<HTMLElement>(
      `[data-mg-block="${sel.blockIndex}"] [data-mg-cell="${sel.cellStart}"]`,
    );
    if (!cell || !selectTextIn(cell)) return;
    reviewRef.current?.startDraft({ unit: true });
  }, [content]);

  // 選択したところを消す頼み。ソースのどこを切るかは EditableBody が出す。
  const [deleteRequest, setDeleteRequest] = useState<{
    path: string;
    blockIndex: number;
    start: number;
    text: string;
    cellStart?: number;
    itemAnchor?: number;
    nonce: number;
  } | null>(null);

  const deleteSelection = useCallback(() => {
    const sel = reviewRef.current?.selection;
    const p = pathRef.current;
    if (!sel || !p) return;
    // またいだ選択は扱わない。見えている選択と消える範囲が食い違う。
    if (sel.endBlockIndex !== undefined) {
      notify(store, "ブロックをまたいだ選択は消せません", "right");
      return;
    }
    setDeleteRequest((r) => ({
      path: p,
      blockIndex: sel.blockIndex,
      start: sel.start,
      text: sel.text,
      cellStart: sel.cellStart,
      itemAnchor: sel.itemAnchor,
      nonce: (r?.nonce ?? 0) + 1,
    }));
    window.getSelection()?.removeAllRanges();
    reviewRef.current?.clearSelection();
  }, [store]);

  // 選択したところに対する 2 つの操作。メニューとキーの両方から呼ぶ。
  const startEdit = useCallback(() => {
    const sel = reviewRef.current?.selection;
    const p = pathRef.current;
    if (!sel || !p) return;
    // またいだ選択は扱わない。先頭のブロックだけを開くと、選んだ範囲と
    // 直す範囲が食い違う。
    if (sel.endBlockIndex !== undefined) {
      notify(store, "ブロックをまたいだ選択は編集できません", "right");
      return;
    }
    setEditRequest((r) => ({
      path: p,
      blockIndex: sel.blockIndex,
      cellStart: sel.cellStart,
      itemAnchor: sel.itemAnchor,
      nonce: (r?.nonce ?? 0) + 1,
    }));
    // 選択を解いてメニューを閉じる。selectionchange は 1 フレーム遅れて
    // 届くので、控えの方も同時に落として待たせない。
    window.getSelection()?.removeAllRanges();
    reviewRef.current?.clearSelection();
  }, [store]);

  // 選択したところへのキー操作。メニューを出さずに同じことができる。
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      const current = reviewRef.current;
      const sel = current?.selection;
      if (!current || !sel || current.draft) return;
      // 選択したところを消す。入力欄の中の削除はそのまま入力欄に任せる。
      // ⌫ の既定動作（WKWebView の「戻る」）は useHotkeys が止めている。
      // 重ねた画面（設定・一覧・パレット）が出ているあいだは、本文に残った
      // 選択へ効かせない。
      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !inEditable(e.target) &&
        !overlayOpen
      ) {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "i" && !e.shiftKey) {
        e.preventDefault();
        current.startDraft();
      } else if (key === "i" && e.shiftKey) {
        // 範囲を広げた指摘。セルの中ならそのセル、箇条書きならその項目、
        // それ以外はブロック全体。
        e.preventDefault();
        if (sel.cellStart !== undefined) commentOnCell();
        else if (sel.itemAnchor !== undefined)
          commentOnItem(sel.blockIndex, sel.itemAnchor);
        else commentOnBlock(sel.blockIndex);
      } else if (key === "e" && !e.shiftKey) {
        e.preventDefault();
        startEdit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    isActive,
    startEdit,
    commentOnCell,
    commentOnBlock,
    commentOnItem,
    deleteSelection,
    overlayOpen,
  ]);

  // 頼みは 1 回で使い切る。残しておくと、本文の入れ物が組み直されたとき
  // （全文編集から戻ったときなど）にもう一度効いてしまう。編集なら勝手に
  // その場編集が開き、削除なら同じ削除がもう一度走る。
  // 子の layout effect のあとに走るので、渡し損ねることはない。
  useLayoutEffect(() => {
    if (editRequest) setEditRequest(null);
  }, [editRequest]);
  useLayoutEffect(() => {
    if (deleteRequest) setDeleteRequest(null);
  }, [deleteRequest]);

  // 削除の知らせ。消す前の本文を受け取ったときだけ取り消しを出す。
  const undoDelete = useCallback(
    (previousBody: string | null, text: string) => {
      notify(
        store,
        text,
        "right",
        previousBody === null
          ? undefined
          : { label: "元に戻す", run: () => saveBody(previousBody) },
      );
    },
    [store, saveBody],
  );

  // フロントマター（本文の前にある --- ブロック）の生ソース
  const fmPrefix = (raw ?? "").slice(0, (raw ?? "").length - body.length);

  // 読むときの印。矩形の作り方は reviewMarks が持ち、出し方は AnchorOverlay。
  const measureMarks = useCallback(
    (base: DOMRect): Marked => {
      if (!content) return { marks: [], pending: [] };
      const draft = review.draft;
      return {
        marks: readingMarks(content, base, review.threads, review.resolutions),
        pendingWhole: !!draft && (draft.whole || draft.until !== undefined),
        pending: draft
          ? readingPending(content, base, {
              blockIndex: draft.blockIndex,
              offset: draft.offset,
              length: draft.text.length,
              // またいだ指摘は箇所を線で示せないので、覆っているブロックの
              // 枠で出す。
              whole: draft.whole || draft.until !== undefined,
              until: draft.until,
              // セル・項目を丸ごと対象にしたときの引き先。行ごとの矩形では
              // なくこの箱で示す。
              unit: !draft.unit
                ? undefined
                : draft.itemAnchor !== undefined
                  ? `li[data-mg-item="${draft.itemAnchor}"]`
                  : draft.cellStart !== undefined
                    ? `[data-mg-cell="${draft.cellStart}"]`
                    : undefined,
            })
          : [],
      };
    },
    // 指摘や下書きが変わったら測り直させる。合図は AnchorOverlay が
    // これの識別で見ている。
    [content, review.threads, review.resolutions, review.draft],
  );

  // 組み立てた編集面。指摘の印は本文の DOM ではなく編集モデルから位置を出す。
  // 組み上がった編集面。**どのファイルのぶんか**を一緒に持つ。
  //
  // 編集面だけを控えると、ファイルを切り替えた後も新しいものが組み上がって
  // onBuilt が来るまで**前のファイルの編集面を指したまま**になる。そのあいだ
  // 骨組みの合図（!pm）が偽になるので、いちばん重い組み立ての最中に骨組みが
  // 消えて「読み込んでいる」ことが分からなくなっていた（実測で 900 ブロック
  // なら 432ms、2000 ブロックなら 951ms のあいだ）。捨てた編集面へ
  // transaction を流して落ちる元でもあった。
  const [built, setBuilt] = useState<{ path: string; view: Editing } | null>(
    null,
  );
  const pm = built && built.path === path ? built.view : null;

  // 字を打ち始めたら編集面へ焦点を渡す。
  //
  // 開いた時点では焦点を当てていない（当てると、読んでいる間も OS が入力
  // モードの印を出す）。打鍵は編集面の外で起きているので既定では落ちる。
  // 焦点を渡したうえで、その 1 字は自分で入れる。
  useEffect(() => {
    if (!isActive || overlayOpen || !pm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      if (inEditable(e.target) || pm.view.hasFocus()) return;
      e.preventDefault();
      pm.view.focus();
      pm.view.dispatch(pm.view.state.tr.insertText(e.key));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, overlayOpen, pm]);

  // 骨組みで隠しているあいだは編集面へ打鍵を通さない。
  // 押した先へ入れ替わるまでは前のファイルの編集面が生きたままなので、
  // 隠れているところへ打つと前のファイルへ字が入る。
  useEffect(() => {
    if (!settling || !pm || pm.view.isDestroyed) return;
    if (pm.view.hasFocus()) pm.view.dom.blur();
  }, [settling, pm]);

  // 当て直した回数。印を測り直させる合図（当て直しでは DOM が動かないので、
  // AnchorOverlay の observer には何も届かない）。
  const [anchorSeq, setAnchorSeq] = useState(0);

  // 指摘の居場所を編集面の節点へ当てる。本文を丸ごと直列化するので重い。
  // 走らせるのは開いたとき・台帳が変わったとき・本文が落ち着いたときだけで、
  // 打鍵の経路には乗せない。決めた位置はプラグインが transaction で写す。
  useEffect(() => {
    // 片付けた編集面には流さない。
    //
    // pm は控えなので、ファイルを切り替えた一枚では**まだ古い編集面を
    // 指している**（子の後片付けが view を捨てても、setPm(null) が届くのは
    // 次の描画）。同じ一枚で本文（draft）も変わるためこの効果が走り、
    // 捨てた編集面へ transaction を流して ProseMirror の中で落ちていた
    // （実機で再現: TypeError: null is not an object — this.docView）。
    if (!pm || pm.view.isDestroyed) return;
    const view = pm.view;
    const list =
      review.threads.length === 0
        ? []
        : anchorThreads(
            view.state.doc,
            pm.loaded(),
            review.threads,
            review.resolutions,
          );
    const was = anchorsKey.getState(view.state) ?? [];
    if (was.length === 0 && list.length === 0) return;
    view.dispatch(
      view.state.tr
        .setMeta(anchorsKey, list)
        // 指摘の居場所は自分が打ったものではない。⌘Z に積まない。
        .setMeta("addToHistory", false),
    );
    setAnchorSeq((n) => n + 1);
  }, [pm, review.threads, review.resolutions, draft]);

  // 編集面の印。位置はプラグインが持っている今の値を引く（打っている間も
  // 写されているので、当て直しを待たずに合う）。
  const measureEditMarks = useCallback(
    (base: DOMRect): Marked => {
      if (!pm) return { marks: [], pending: [] };
      const list = anchorsKey.getState(pm.view.state) ?? [];
      const draft = review.draft;
      return {
        marks: editorMarks(pm.view, base, list, review.threads),
        pendingWhole: !draft?.spot,
        pending:
          draft?.pos === undefined
            ? []
            : editorPending(pm.view, base, {
                pos: draft.pos,
                spot: draft.spot ?? null,
              }),
      };
    },
    // anchorSeq は測り直させるための合図。
    [pm, review.threads, review.draft, anchorSeq],
  );

  // 編集面で選んだところ。指摘の入口をここに出す。
  //
  // 読むのは DOM が今持っている選択。編集モデルの選択は selectionchange 経由で
  // 次のタスクに更新されるので、離した番に見るとまだ前の範囲を指している。
  const [editSel, setEditSel] = useState<{
    from: number;
    to: number;
    rect: { top: number; bottom: number; left: number };
  } | null>(null);
  // 本文を送った合図。帯はこれが動いたときだけ置き場所を取り直す（装飾を
  // 付けて字幅が変わった分では動かさない）。
  const [scrolled, setScrolled] = useState(0);

  useEffect(() => {
    if (!pm) {
      setEditSel(null);
      return;
    }
    const view = pm.view;
    const read = () => {
      const span = view.composing ? null : domSpan(view);
      const sel = span && view.dom.ownerDocument.getSelection();
      if (!span || !sel || sel.rangeCount === 0) {
        setEditSel(null);
        return;
      }
      const rects = sel.getRangeAt(0).getClientRects();
      const rc = rects.length ? rects[rects.length - 1] : null;
      if (!rc) {
        setEditSel(null);
        return;
      }
      setEditSel({
        from: span.from,
        to: span.to,
        rect: { top: rc.top, bottom: rc.bottom, left: rc.left },
      });
    };
    // 出すのは離したとき。引いている間に出すと、そのままドラッグの行き先を
    // 奪って選択が飛ぶ。打ち始めたら消す。
    const onUp = () => read();
    // 自分が出した帯・メニュー・入力欄を押したときは畳まない。畳むと押した番に
    // 帯ごと消えて、そこから出しているものも一緒に消える（リンクや式の入力欄が
    // 押した瞬間に閉じるのはこれ）。
    const onDown = (e: MouseEvent) => {
      if (inFloating(e.target)) return;
      setEditSel(null);
    };
    const onKey = (e: KeyboardEvent) => {
      // 選択を伸ばす操作と、ショートカット（装飾の付け外しなど）では消さない。
      // 消すのは字が入るとき（対象がずれる）。
      if (e.shiftKey && e.key.startsWith("Arrow")) return;
      if (e.metaKey || e.ctrlKey) return;
      setEditSel(null);
    };
    // 本文を送ったら測り直す。帯は画面の座標で置くので、送った分だけ選んだ
    // ところと離れる。1 枚に 1 回へまとめる。
    let soon = 0;
    const onMove = () => {
      if (soon) return;
      soon = requestAnimationFrame(() => {
        soon = 0;
        read();
        setScrolled((n) => n + 1);
      });
    };
    view.dom.addEventListener("mouseup", onUp);
    view.dom.addEventListener("keyup", onUp);
    window.addEventListener("mousedown", onDown);
    view.dom.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      cancelAnimationFrame(soon);
      view.dom.removeEventListener("mouseup", onUp);
      view.dom.removeEventListener("keyup", onUp);
      window.removeEventListener("mousedown", onDown);
      view.dom.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [pm]);

  // ⌘K でリンクの入力を開く。帯を出している側が受け取る。
  const [linkNonce, setLinkNonce] = useState(0);
  useEffect(() => {
    // 帯を出しているときだけ受ける（editSel が入るのは編集面が組めていて、
    // かつ範囲を選んでいるときだけ）。
    if (!pm || !editSel || overlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key !== "k" && e.key !== "K") return;
      e.preventDefault();
      setLinkNonce((n) => n + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pm, editSel, overlayOpen]);

  // 編集面から指摘を始める。対象は編集モデルから組み立てる。
  const commentOnSpan = useCallback(() => {
    if (!pm || pm.view.isDestroyed || !editSel) return;
    const target = targetOfSpan(
      pm.view.state.doc,
      pm.loaded(),
      fmPrefix,
      editSel.from,
      editSel.to,
    );
    setEditSel(null);
    if (!target) return;
    // 選択は畳む。対象は下書きの印で示すので、範囲の帯を残すと印と二重に
    // なるうえ、小窓を閉じたあとも選んだままに見える。DOM 側の選択だけを
    // 解いても、編集モデルの選択から描き直されて戻ってくる。
    const view = pm.view;
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.near(view.state.doc.resolve(editSel.to)),
      ),
    );
    reviewRef.current?.startDraftIn({ ...target, rect: editSel.rect });
  }, [pm, editSel, fmPrefix]);

  // つまみのメニューからの指摘。
  //
  // ブロック丸ごとなら pos だけ（図のように選べる文字を持たないブロックにも
  // 付けられる）。箇条書きの項目のように中の一部を相手にするときは範囲も
  // 受け取り、その範囲を対象にする。
  const commentOnNode = useCallback(
    (pos: number, span?: { from: number; to: number }) => {
      if (!pm || pm.view.isDestroyed) return;
      const doc = pm.view.state.doc;
      const target = span
        ? targetOfSpan(doc, pm.loaded(), fmPrefix, span.from, span.to)
        : targetOfBlock(doc, pm.loaded(), fmPrefix, pos);
      if (!target) return;
      // 小窓を出す位置。範囲のときはその頭、丸ごとのときはブロックの箱。
      let rect = { top: 0, bottom: 0, left: 0 };
      if (span) {
        try {
          const at = pm.view.coordsAtPos(span.from);
          rect = { top: at.top, bottom: at.bottom, left: at.left };
        } catch {
          /* 測れない場所では画面の左上から出す */
        }
      } else {
        const dom = pm.view.nodeDOM(pos);
        if (dom instanceof HTMLElement) {
          const box = dom.getBoundingClientRect();
          rect = { top: box.top, bottom: box.bottom, left: box.left };
        }
      }
      reviewRef.current?.startDraftIn({ ...target, rect });
    },
    [pm, fmPrefix],
  );

  // 指摘を書いている間、対象が今どこに居るかを測る。小窓は動いた分だけ動く。
  const trackEditDraft = useCallback(() => {
    const at = reviewRef.current?.draft?.pos;
    if (!pm || at === undefined) return null;
    const dom = pm.view.nodeDOM(at);
    if (!(dom instanceof HTMLElement)) return null;
    const box = dom.getBoundingClientRect();
    return { top: box.top, left: box.left };
  }, [pm]);

  const editArea = useCallback(
    () => editScroller?.getBoundingClientRect() ?? null,
    [editScroller],
  );

  // 編集面を出すのは、本文が読めていて、組む前の一枚を描き終えたときだけ。
  // 読めていないうちに出すと、前のファイルの中身が消えたところへ空の紙が
  // 立ち、切り替わったのか読み込み中なのか分からない。
  const writing = editing && !!path && loaded && !opening;

  // フロントマターの差し替え。本文は編集面の書きかけを先に流してから取る
  // （流さないと、打った直後の一手を巻き戻す）。書いた全文は控えにも入れて、
  // 自分の書き込みを外からの変更として取り込み直さないようにする。
  const saveFm = (newFm: string) => {
    if (!path || newFm === fmPrefix) return;
    const now = settled();
    const full = newFm + (now === null ? body : parseFrontmatter(now).body);
    base.current = full;
    setDraft(full);
    write(path, full);
  };


  // path はあるが未読込なら読み込む。
  // 読み始めは押した瞬間の値で動かす。遅らせた値で待つと、読み取りの開始が
  // 一枚ぶん後ろへずれる。
  useEffect(() => {
    if (shownPath && !cache.has(shownPath)) void reloadFile(shownPath);
  }, [shownPath, cache, reloadFile]);

  // いま画面の上端にあるブロックと、そのブロックへ入り込んでいる画素。
  // 長い表の途中を見ていたときに、表の先頭へ戻ってしまわないようにする。
  const viewAt = useCallback((): { at: number; into: number } => {
    if (!content || !scroller) return { at: 0, into: 0 };
    const top = scroller.getBoundingClientRect().top;
    const el = topmostBlock(content, top);
    if (!el) return { at: 0, into: 0 };
    const at = blockIndexOf(el);
    if (at === null) return { at: 0, into: 0 };
    const block = blocksOf(bodyRef.current)[at];
    if (!block) return { at: 0, into: 0 };
    const prefix = (rawRef.current ?? "").length - bodyRef.current.length;
    const box = blockRect(el);
    return {
      at: prefix + block.start,
      into: box ? Math.max(0, top - box.top) : 0,
    };
  }, [content, scroller]);

  // 読書プログレス + 見ていた場所の保存。
  // 重要: マウント時に即時実行しない。まだ復元前で scrollTop=0 のため、
  // 先頭を保存してしまい「切替のたびに先頭へ」戻る原因になる。
  // 保存は実際のスクロール操作時のみ行う。
  useEffect(() => {
    if (!scroller) return;
    let raf = 0;
    const onScroll = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      setBar(max > 0 ? Math.min(1, scroller.scrollTop / max) : 0);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const seen = viewAt();
        rememberViewpoint(viewKey(pane.id, absPath), seen.at, seen.into);
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [scroller, pane.id, absPath, viewAt]);

  // 編集面でも読書プログレスを動かす。見ている場所の控えは編集面の側が持つので、
  // ここで見るのは帯だけ。
  useEffect(() => {
    if (!editScroller) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = editScroller.scrollHeight - editScroller.clientHeight;
        setBar(max > 0 ? Math.min(1, editScroller.scrollTop / max) : 0);
      });
    };
    onScroll();
    editScroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      editScroller.removeEventListener("scroll", onScroll);
    };
  }, [editScroller]);

  // 控えの位置が本文の何番目のブロックか。復帰の合わせ先に使う。
  // memo にしない（控えは外に置いてあるので、描画のたびに見直さないと古い値を使う）。
  const restoreIndex = useCallback((): number | null => {
    const saved = recallViewpoint(viewKey(pane.id, absPath)).at;
    if (saved <= 0) return null;
    const prefix = (rawRef.current ?? "").length - bodyRef.current.length;
    const at = saved - prefix;
    const hit = blocksOf(bodyRef.current).findIndex((b) => b.end > at);
    return hit < 0 ? null : hit;
  }, [pane.id, absPath]);

  // 漸進描画をどこまで先に出すか。プレビューに戻る時点で決める（描画より前に
  // 決まっていないと、合わせ先のブロックがまだ無い）。
  const [startAt, setStartAt] = useState(0);

  // 本文が出たとき: 同じファイルなら見ていた場所のブロックを上端へ、
  // 別ファイルなら先頭へ。描き終わる前に合わせるので、先頭が一瞬見えて
  // からスクロールしていく動きにはならない。
  useLayoutEffect(() => {
    if (editing || !scroller || !content) return;
    const at = restoreIndex();
    if (at === null) {
      scroller.scrollTop = 0;
      return;
    }
    // 画像や KaTeX で後から高さが変わるので、数フレーム押さえる。
    // 自分でスクロールしたらそこで打ち切る。
    let settled = false;
    let left = 12;
    let raf = 0;
    const apply = () => {
      if (settled) return;
      const el = content.querySelector<HTMLElement>(`[data-mg-block="${at}"]`);
      const box = el ? blockRect(el) : null;
      if (box) {
        const into = recallViewpoint(viewKey(pane.id, absPath)).into;
        const delta = box.top - scroller.getBoundingClientRect().top + into;
        if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
      }
      if (--left > 0) raf = requestAnimationFrame(apply);
    };
    const stop = () => {
      settled = true;
    };
    apply();
    raf = requestAnimationFrame(apply);
    scroller.addEventListener("wheel", stop, { passive: true, once: true });
    scroller.addEventListener("touchstart", stop, { passive: true, once: true });
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener("wheel", stop);
      scroller.removeEventListener("touchstart", stop);
    };
  }, [path, absPath, editing, scroller, content, restoreIndex, startAt]);


  const ctx = useMemo(
    () => ({
      docPath: path ?? "",
      onNavigate: (href: string) => path && navigate(path, href),
      resolveAsset: (src: string) => resolveAsset(path ?? "", src),
      peekAsset: (src: string) => peekAsset(path ?? "", src),
      onEditBlock: (blockIndex: number) => {
        const p = pathRef.current;
        if (!p) return;
        setEditRequest((r) => ({
          path: p,
          blockIndex,
          nonce: (r?.nonce ?? 0) + 1,
        }));
      },
    }),
    [path, navigate, resolveAsset, peekAsset],
  );

  const doClosePane = () => closePane(store, pane.id);

  return (
    <section
      onMouseDown={() => !isActive && setActiveId(pane.id)}
      className={`relative flex min-w-0 flex-1 flex-col overflow-hidden ${
        isSplit && isActive
          ? "ring-1 ring-inset ring-[var(--mg-accent)]/40"
          : ""
      }`}
    >
      {/* ヘッダー */}
      <header className="mg-pane-head flex items-center gap-2 border-b border-[var(--mg-border)] bg-[var(--mg-panel)]/80 px-4 py-2 backdrop-blur">
        {isDraft ? (
          // 置き場の道筋は人に見せない。まだ保存先が無いことだけを出す。
          <div className="flex min-w-0 flex-1 items-center">
            <span className="mg-draft-chip">
              <Icon name="edit_note" size={13} />
              下書き
            </span>
          </div>
        ) : (
          <div className="min-w-0 flex-1 truncate text-[12px] text-[var(--mg-muted)]">
            {/* 1 枚だけ開いているときは、どこのファイルか分かるよう絶対パスで出す。 */}
            <Breadcrumbs path={sole ?? shownPath} paneId={pane.id} lazy={!!sole} />
          </div>
        )}
        {path && isDoc && (
          <>
            {isDraft ? (
              // 下書きは版を持てない。同じ場所に、行き先を決める釦を置く。
              <button
                onClick={() => void saveDraft()}
                title="名前を付けて保存 (⌘S)"
                className="grid h-6 w-6 place-items-center rounded text-[var(--mg-accent)] transition hover:bg-[var(--mg-hover)]"
              >
                <Icon name="save" size={16} />
              </button>
            ) : (
            <button
              onClick={() => (naming === null ? startNaming() : setNaming(null))}
              title="バージョンを保存 (⌘S)"
              className={`grid h-6 w-6 place-items-center rounded transition ${
                naming !== null
                  ? "bg-[var(--mg-accent-soft)] text-[var(--mg-accent)]"
                  : "text-[var(--mg-muted)] hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
              }`}
            >
              <Icon name="save_as" size={16} />
            </button>
            )}
            {/* 下書きは版も指摘も持たない。行き先が決まってからのものなので、
                履歴の口は出さない。 */}
            {!isDraft && (
              <button onClick={showVersions} title="バージョン履歴" className="grid h-6 w-6 place-items-center rounded text-[var(--mg-muted)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]">
                <Icon name="history" size={16} />
              </button>
            )}
            <button
              onClick={() => setMetaPane(pane.id)}
              title="メタ情報 (⌘⇧M)"
              className={`grid h-6 w-6 place-items-center rounded transition ${
                data || broken
                  ? "text-[var(--mg-accent)] hover:bg-[var(--mg-hover)]"
                  : "text-[var(--mg-muted)] hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
              }`}
            >
              <Icon name="list_alt" size={16} fill={!!data || broken} />
            </button>
          </>
        )}
        {saving > 0 && (
          <span title="保存中" className="shrink-0 text-[var(--mg-muted)]">
            <Icon name="progress_activity" size={13} className="mg-spin" />
          </span>
        )}
        <Tooltip
          align="end"
          label={
            watchMode === "observer"
              ? "変更をリアルタイム監視中"
              : watchMode === "polling"
                ? "変更を監視中（ポーリング）"
                : "監視は停止中"
          }
        >
          <span
            className={`h-2 w-2 shrink-0 cursor-help rounded-full ${
              watchMode === "observer"
                ? "bg-emerald-400"
                : watchMode === "polling"
                  ? "bg-amber-400"
                  : "bg-zinc-500"
            }`}
          />
        </Tooltip>
        {isSplit && (
          <button
            onClick={doClosePane}
            title="このペインを閉じる"
            className="grid h-6 w-6 place-items-center rounded text-[var(--mg-muted)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)]"
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </header>

      {metaOpen && path && (
        <MetaModal
          key={path}
          name={isDraft ? DRAFT : displayName(path)}
          fm={fmPrefix}
          broken={broken}
          onChange={saveFm}
          onClose={closeMeta}
        />
      )}

      {ask !== null && ask.path === sole && (
        <DraftClose
          onSave={() => {
            const go = ask.go;
            setAsk(null);
            void saveDraft().then((done) => {
              // 決めなかったら引き止めたまま。行き先へは進めない。
              if (done && go) go();
            });
          }}
          onDrop={() => {
            const go = ask.go;
            const at = ask.path;
            setAsk(null);
            void dropDraft(at);
            if (go) {
              go();
              return;
            }
            // 行き先が無ければ起動画面へ戻る。
            store.set(soleAtom, null);
            store.set(activeFolderIdAtom, null);
          }}
          onClose={() => setAsk(null)}
        />
      )}

      {naming !== null && (
        <SaveVersion
          initial={naming}
          onSave={(name) => void stamp(name)}
          onClose={() => setNaming(null)}
        />
      )}

      {/* 読書プログレスバー */}
      <div className="h-0.5 w-full bg-transparent">
        <div
          ref={progressRef}
          className="h-full bg-[var(--mg-accent)]"
          style={{ width: 0 }}
        />
      </div>

      {/* 本文 + 目次 */}
      <div className="flex min-h-0 flex-1">
        {path && !isDoc ? (
          kind === "image" ? (
            <ImageDoc abs={absPath ?? path} />
          ) : kind === "html" ? (
            <HtmlDoc abs={absPath ?? path} />
          ) : kind === "pdf" ? (
            <PdfDoc abs={absPath ?? path} />
          ) : null
        ) : writing && path ? (
          <div
            ref={setEditScroller}
            className="mg-tail relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-10 pt-8 sm:px-16"
          >
            {/* 組み上がるまで骨組みを被せる。
                編集面を組むのは React の効果の中で、それが走るのは骨組みを
                外した一枚を描いた後。被せないと、その間（大きいファイルでは
                140ms）は空の紙が「書ける状態」に見えて、打った字がどこにも
                入らない。編集面が出来たかどうかは onBuilt で分かる。

                settling も見る。押した瞬間の pm は**前のファイルの**編集面
                なので `!pm` は偽になり、それだけだと押しても骨組みが出ない
                （読むとき側は settling を見ているので出る）。編集モードの
                解除は遅らせた path に紐づくので、2 フレーム後まで前の
                ファイルが出たままになっていた。 */}
            {(!pm || settling) && (
              <div className="absolute inset-0 z-10 bg-[var(--mg-bg)] px-10 py-8 sm:px-16">
                <div className={`${WIDTH_CLASS[width]} mx-auto`}>
                  <LoadingBody />
                </div>
              </div>
            )}
            <BodyEditor
              key={path}
              body={body}
              prefix={fmPrefix}
              path={path}
              viewpoint={recallViewpoint(viewKey(pane.id, absPath))}
              onViewpoint={(at, into) => {
                rememberViewpoint(viewKey(pane.id, absPath), at, into);
              }}
              onDom={setEditContent}
              onBuilt={(view) => setBuilt(view ? { path, view } : null)}
              onComment={commentOnNode}
              onChange={(next) => {
                setDraft(next);
                if (path) autoSave(path, next);
              }}
              onSave={onCmdS}
              flushRef={flushRef}
              adoptRef={adoptRef}
              fontFamily={fontStack(font)}
              dark={dark}
              resolveAsset={ctx.resolveAsset}
              peekAsset={ctx.peekAsset}
              className={`mg-prose prose ${
                editorial ? "mg-editorial" : ""
              } ${WIDTH_CLASS[width]} mx-auto`}
            />
          </div>
        ) : (
          // 骨組みは本文と入れ替えず、上に重ねる。
          //
          // 入れ替えると、押した一枚で前の本文の片付けが走る。重ねるなら
          // 押した一枚で増えるのは骨組みの 1 枚だけで、本文の入れ替えは
          // 遅らせた値の一枚（塗った後）へ移る。
          //
          // 重ねる先はスクロールする要素の外側。中に置くと、前の本文を下まで
          // 送っていたときに骨組みがスクロール範囲の上端へ行って見えない。
          <div className="relative flex min-h-0 min-w-0 flex-1">
            <div
              ref={setScroller}
              className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
            >
              {path ? (
                <div className="mg-tail px-10 pt-8 sm:px-16">
                  <article
                    ref={setContent}
                    style={{ fontFamily: fontStack(font) }}
                    className={`mg-prose prose ${
                      editorial ? "mg-editorial" : ""
                    } ${WIDTH_CLASS[width]} mx-auto`}
                  >
                    <markdownContext.Provider value={ctx}>
                      {/* 選択メニューやつまみから、そのブロックだけを生ソース編集 */}
                      {/* key でファイルごとに貼り替え、漸進描画を先頭からやり直す */}
                      <EditableBody
                        key={path}
                        body={body}
                        editorial={editorial}
                        onSaveBody={saveBody}
                        editRequest={editRequest}
                        deleteRequest={deleteRequest}
                        onDeleted={undoDelete}
                        startIndex={startAt}
                        content={content}
                        scroller={scroller}
                        contentKey={path}
                        onComment={commentOnBlock}
                        onCommentItem={commentOnItem}
                        onCommentCell={commentOnCellAt}
                      />
                    </markdownContext.Provider>
                  </article>
                </div>
              ) : (
                <EmptyPane />
              )}
            </div>
            {shownPath && (settling || !loaded || opening) && (
              <div className="absolute inset-0 z-10 overflow-hidden bg-[var(--mg-bg)] px-10 py-8 sm:px-16">
                <div className={`${WIDTH_CLASS[width]} mx-auto`}>
                  <LoadingBody />
                </div>
              </div>
            )}
          </div>
        )}

        {/* 目次は編集中も出す。見出しの増減は MutationObserver が拾うので、
            打つそばから追従する。 */}
        {!isSplit && tocOpen && path && isDoc && (
          <Toc
            content={editing ? editContent : content}
            scroller={editing ? editScroller : scroller}
            contentKey={path + (editing ? draft.length : (raw?.length ?? 0))}
          />
        )}

        {!editing && path && isDoc && (
          <AnchorOverlay
            content={content}
            contentKey={path + (raw?.length ?? 0)}
            measure={measureMarks}
            onPick={review.inspect}
            onEdit={(t, c, b) => void review.rewrite(t, c, b)}
            onRemove={(id) => void review.remove(id)}
            onResolve={(id) => void review.resolve(id)}
          />
        )}

        {/* 編集面の印。重ねる先は編集面そのものではなくその外側の入れ物。
            ProseMirror が持つ DOM の中に React の要素を入れると、本文の
            書き換えと見なされて消される。 */}
        {writing && pm && (
          <AnchorOverlay
            content={pm.host}
            contentKey={path ?? ""}
            measure={measureEditMarks}
            onPick={review.inspect}
            onEdit={(t, c, b) => void review.rewrite(t, c, b)}
            onRemove={(id) => void review.remove(id)}
            onResolve={(id) => void review.resolve(id)}
          />
        )}

        {!editing && isDoc && review.selection && !review.draft && (
          <SelectionMenu at={review.selection.rect} onComment={review.startDraft}>
            {review.selection.cellStart !== undefined && (
              <SelectionAct icon="table" label="セルにコメント" onPick={commentOnCell} />
            )}
            {/* またいだ選択では出さない。先頭のブロックだけに効くと、
                選んだ範囲と食い違う。 */}
            {review.selection.endBlockIndex === undefined && (
              <>
                <SelectionAct icon="edit" label="編集する" onPick={startEdit} />
                <SelectionAct icon="backspace" label="削除" onPick={deleteSelection} />
              </>
            )}
          </SelectionMenu>
        )}

        {writing && pm && editSel && !review.draft && (
          <SelectionBar
            view={pm.view}
            at={editSel.rect}
            span={{ from: editSel.from, to: editSel.to }}
            linkNonce={linkNonce}
            pin={scrolled}
            onComment={commentOnSpan}
          />
        )}

        {writing && review.draft && (
          <CommentComposer
            anchorRect={review.draft.hit}
            selection={review.draft.text}
            source={review.draft.whole ? review.draft.quote : undefined}
            busy={review.busy}
            track={trackEditDraft}
            bounds={editArea}
            onSubmit={(text) => {
              // 先に書き出す。版はいま画面に出ている全文なので、ファイルが
              // それより古いままだと、対応付けが古い本文と突き合わせて
              // 付けた直後だけ居場所を見失う。
              flushRef.current?.();
              void review.submit(text);
            }}
            onClose={review.close}
          />
        )}

        {!editing && review.draft && (
          <CommentComposer
            anchorRect={review.draft.hit}
            selection={review.draft.text}
            // ブロック全体への指摘は、画面から拾った文字を並べても何への指摘か
            // 読み取れない（表は行の間の改行だけが並ぶ）。もとの書き方を渡す。
            source={review.draft.whole ? review.draft.quote : undefined}
            busy={review.busy}
            track={trackDraft}
            bounds={draftArea}
            onSubmit={(text) => void review.submit(text)}
            onClose={review.close}
          />
        )}

        {/* ファイル内検索。読むときと編集面で同じものを使う。探す先だけが
            違う（編集面は ProseMirror が持つ DOM を走査し、印はその外側の
            入れ物へ重ねる）。 */}
        {path && (
          <DocSearchOverlay
            content={writing ? editContent : content}
            into={writing ? pm?.host : content}
            isActive={isActive}
            path={path}
            docKey={
              writing
                ? `${path}:edit:${draft.length}`
                : `${path}:${raw?.length ?? 0}`
            }
          />
        )}
      </div>
    </section>
  );
}

// 読込中のプレースホルダ。見出し＋段落の骨組みを並べ、本文が出たときに
// 位置が大きく動かないようにする。
function EmptyPane() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-[var(--mg-muted)]">
      <Icon name="draft" size={56} className="opacity-30" />
      <div className="text-sm">
        左のファイルを選ぶか、
        <kbd className="mx-1 rounded border border-[var(--mg-border)] px-1.5 py-0.5 text-[11px]">
          ⌘P
        </kbd>
        でクイックオープン
      </div>
    </div>
  );
}
