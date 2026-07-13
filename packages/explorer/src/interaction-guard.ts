const PROHIBITED_SUBSTRINGS: string[] = [
  "delete",
  "刪除",
  "remove",
  "移除",
  "payment",
  "checkout",
  "purchase",
  "付款",
  "結帳",
  "publish",
  "發布",
  "deploy",
  "部署",
  "send",
  "寄送",
  "logout",
  "log out",
  "log-out",
  "sign out",
  "sign-out",
  "登出",
  "upload",
  "上傳",
];

const PAY_STANDALONE = /\bpay\b/i;

export type InteractableElement = {
  tagName: string;
  text: string;
  type?: string;
};

export function isProhibitedInteraction(element: InteractableElement): boolean {
  if (element.type === "file" || element.type === "submit") {
    return true;
  }

  const lower = element.text.toLowerCase();

  if (PROHIBITED_SUBSTRINGS.some((kw) => lower.includes(kw))) {
    return true;
  }

  if (PAY_STANDALONE.test(element.text)) {
    return true;
  }

  return false;
}
