// 引用の先頭に置く [!NOTE] などの目印。GitHub の alert 記法。
//
// 読むときは Callout として描き、そうでない引用はエディトリアルの
// 「大きく見せる引用」にする。編集面でも同じ判定をするので、ここに置く。
export const CALLOUT_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
