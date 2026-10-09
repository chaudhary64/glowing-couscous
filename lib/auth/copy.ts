import type { AuthErrorCode } from "./cognito";

/**
 * Every word the auth screens say about a failure.
 *
 * The route handlers redirect with a short code and nothing else, so this table is
 * the only place wording lives. Two reasons, both deliberate:
 *
 *  - A code in a URL is safe to log and to look at; a provider's raw message is not.
 *    Cognito's `NotAuthorizedException` text, an internal hostname or a stack trace
 *    in the address bar is how demos leak architecture.
 *  - Sign-in failures all read the same whether the account is unknown or the
 *    password is wrong. Cognito already refuses to distinguish them, and the copy
 *    must not undo that by guessing.
 */

export type NoticeTone = "error" | "notice";

export interface Notice {
  tone: NoticeTone;
  title: string;
  detail?: string;
  /** A second action worth offering at exactly this failure. */
  action?: { label: string; href: string };
}

/** Failures raised by a route handler before Cognito is even called. */
export type FormErrorCode = "missing" | "csrf" | "expired" | "mismatch";

type ErrorCode = AuthErrorCode | FormErrorCode;

export const ERRORS: Record<ErrorCode, Notice> = {
  "bad-credentials": {
    tone: "error",
    title: "That email and password do not match",
    detail:
      "We cannot tell you which of the two is wrong — saying so would let anyone check whether an address has an account here.",
    action: { label: "Create an account", href: "/signup" },
  },
  unconfirmed: {
    tone: "error",
    title: "This account has not been confirmed yet",
    detail: "Enter the code Cognito emailed you, or send a fresh one.",
    action: { label: "Confirm the account", href: "/confirm" },
  },
  "already-exists": {
    tone: "error",
    title: "That email already has an account",
    detail:
      "Sign in instead. If the account was never confirmed, request a new code.",
    action: { label: "Sign in", href: "/login" },
  },
  "weak-password": {
    tone: "error",
    title: "That password is too easy to guess",
    detail:
      "At least 8 characters, with an upper-case letter, a lower-case letter and a number.",
  },
  "invalid-email": {
    tone: "error",
    title: "That email address was not accepted",
    detail: "Check it for a typo — the address is also the sign-in name.",
  },
  "bad-code": {
    tone: "error",
    title: "That code is not right",
    detail: "Six digits, no spaces. Request a new one if it has expired.",
  },
  "expired-code": {
    tone: "error",
    title: "That code has expired",
    detail: "Codes are short-lived. Send yourself another one.",
  },
  "too-many": {
    tone: "error",
    title: "Too many attempts",
    detail:
      "Cognito is rate-limiting this account for a few minutes. Waiting is the only fix.",
  },
  server: {
    tone: "error",
    title: "Something went wrong on our side",
    detail:
      "The sign-in service did not answer as expected. Try again in a moment.",
  },
  missing: {
    tone: "error",
    title: "Some fields were empty",
    detail: "Every field on this form is required.",
  },
  mismatch: {
    tone: "error",
    title: "The two passwords are different",
    detail: "Retype them so they match.",
  },
  csrf: {
    tone: "error",
    title: "That request came from another site",
    detail:
      "Forms here only accept a submission from this origin. Reload the page and try again.",
  },
  expired: {
    tone: "error",
    title: "That confirmation session has expired",
    detail:
      "We keep the address a code was sent to for 15 minutes. Sign in to get a new code.",
    action: { label: "Sign in", href: "/login" },
  },
};

const NOTICES = {
  confirmed: {
    tone: "notice",
    title: "Account confirmed",
    detail: "Sign in with the password you chose.",
  },
  resent: {
    tone: "notice",
    title: "A new code is on its way",
    detail: "It can take a minute to arrive. Check the spam folder too.",
  },
  "code-sent": {
    tone: "notice",
    title: "Check your email",
    detail: "Enter the six-digit code to finish creating the account.",
  },
  "signed-out": {
    tone: "notice",
    title: "Signed out",
    detail: "The session cookie is gone from this browser.",
  },
} satisfies Record<string, Notice>;

export type NoticeCode = keyof typeof NOTICES;

/** Unknown values fall back to the generic server failure rather than to nothing. */
export function errorNotice(code: string | undefined | null): Notice | null {
  if (!code) return null;
  return Object.prototype.hasOwnProperty.call(ERRORS, code)
    ? ERRORS[code as ErrorCode]
    : ERRORS.server;
}

export function infoNotice(code: string | undefined | null): Notice | null {
  if (!code) return null;
  return Object.prototype.hasOwnProperty.call(NOTICES, code)
    ? NOTICES[code as NoticeCode]
    : null;
}
