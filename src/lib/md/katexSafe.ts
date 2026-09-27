// KaTeX が受け付けない書き方を、LaTeX と同じ意味のまま読める形へ直す。
//
// `\lambda_\max` のように、演算子名を波括弧なしで添字・肩字に置くと、LaTeX や
// MathJax では通るが KaTeX は「引数の無い関数を添字にした」として落とす。
// 演算子名だけを `{\max}` と包む。記号（`\alpha`）や引数を取る命令（`\text`、
// `\sqrt`）は包むと意味が変わるので触らない。原文は書き換えず、描く直前にだけ通す。
const OPERATORS = [
  "arccos", "arcctg", "arcsin", "arctan", "arctg", "arg", "ch", "cos", "cosec",
  "cosh", "cot", "cotg", "coth", "csc", "ctg", "cth", "deg", "det", "dim", "exp",
  "gcd", "hom", "inf", "injlim", "ker", "lg", "lim", "liminf", "limsup", "ln",
  "log", "max", "min", "Pr", "projlim", "sec", "sh", "sin", "sinh", "sup", "tan",
  "tanh", "tg", "th", "varinjlim", "varliminf", "varlimsup", "varprojlim",
];

const BARE = new RegExp(`([_^])\\s*\\\\(${OPERATORS.join("|")})(?![A-Za-z])`, "g");

export function katexSafe(tex: string): string {
  return tex.includes("\\") ? tex.replace(BARE, "$1{\\$2}") : tex;
}

interface HastNode {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

const isMath = (node: HastNode) => {
  const cls = node.properties?.className;
  return (
    Array.isArray(cls) && (cls.includes("math-inline") || cls.includes("math-display"))
  );
};

function fix(node: HastNode, inMath: boolean): void {
  if (inMath && node.type === "text" && node.value) node.value = katexSafe(node.value);
  const math = inMath || (node.type === "element" && isMath(node));
  for (const child of node.children ?? []) fix(child, math);
}

// rehype-katex の手前に置く。remark-math が作った数式の要素の字を直す。
export function rehypeKatexSafe() {
  return (tree: HastNode) => fix(tree, false);
}
