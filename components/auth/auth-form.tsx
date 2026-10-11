import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { Notice } from "@/lib/auth/copy";
import { cn } from "@/lib/cn";

/**
 * Form primitives shared by sign in, sign up and confirmation.
 *
 * These are Server Components rendering plain HTML: the browser does the submitting,
 * so the whole flow works with JavaScript disabled and can be driven with `curl`.
 * That is not a purity exercise — an auth flow that only works after hydration is one
 * you cannot test from a terminal, and this one is tested that way.
 *
 * The visual language is RawBlock, the same system the working screens wear: a white
 * ground, 3px black edges, mono utility labels, Archivo Black for display, radius 0 and
 * no shadow anywhere. Three devices are borrowed from the rest of the product on
 * purpose —
 *
 *  - the **eyebrow**, an 11px mono line opened by an 8px copper square;
 *  - the **perforated frame** of the receipt, which is the one object the product
 *    produces, so a credential form framed like one says what it is: a record, not a card;
 *  - the **boxed field**, sunken grey under a 3px rule, which is the skill's input and
 *    the shape the app's own console fields use.
 *
 * Only one bordered object is allowed per page, and on these screens it is the form.
 */

/**
 * The screens' hero. Centred, like the landing's, because it is the same surface: the
 * type is the composition and there is nothing to put beside it.
 *
 * `titleTail` is the second display line drawn as a stroke (`.display-outline`, defined
 * in the landing's stylesheet). One outlined line per page, the way the hero does it.
 */
export function AuthHero({
  eyebrow,
  title,
  titleTail,
  lede,
}: {
  eyebrow: string;
  title: string;
  /** Optional second display line, struck as an outline. */
  titleTail?: string;
  lede?: string;
}) {
  return (
    <header className="text-center">
      <p className="flex items-center justify-center gap-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-ink-muted">
        <span aria-hidden className="size-2 shrink-0 bg-copper" />
        {eyebrow}
      </p>
      {/* The floor is 2.5rem, not 2rem: the outlined line is drawn at 0.028em, and below
          about 40px that stroke stops reading as a stroke. The landing holds its hero at
          44px on a 390px screen for the same reason. */}
      <h1 className="mx-auto mt-6 max-w-2xl font-display text-[clamp(2.5rem,8vw,3.25rem)] uppercase leading-[0.95] tracking-tight">
        {title}
        {titleTail ? (
          <>
            {/* The explicit space is not decoration: JSX drops the whitespace around a
                tag, so `Create an` + <br /> + `account` would read to a screen reader —
                and to any test asking for the heading by name — as one word. It collapses
                at the line break, so nothing moves on screen. */}
            {" "}
            <br />
            <span className="display-outline">{titleTail}</span>
          </>
        ) : null}
      </h1>
      {lede ? (
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-ink-soft">
          {lede}
        </p>
      ) : null}
    </header>
  );
}

/**
 * The one bordered object on an auth screen: a credential block framed like the receipt.
 *
 * Perforated top and bottom, a mono head with the title and where the credential is held,
 * the fields as their own block, then a heavy rule and the single action — the same
 * anatomy as `components/ui/receipt.tsx`, which is the shape this product already uses
 * for "a record of one transaction".
 */
export function AuthFrame({
  title,
  note,
  action,
  children,
}: {
  title: string;
  /** Mono second line: who holds the credential, or what is being recorded. */
  note?: string;
  /** The one primary action, below the heavy rule. */
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative border-[3px] border-ink bg-paper-raised font-mono text-[13px]">
      <div aria-hidden className="h-0 border-t-[3px] border-dashed border-ink" />

      <div className="px-4 pt-4 pb-3">
        <p className="font-display text-lg uppercase leading-none tracking-tight">
          {title}
        </p>
        {note ? (
          <p className="mt-1.5 text-[11px] uppercase tracking-[0.14em] text-ink-muted">
            {note}
          </p>
        ) : null}
      </div>

      <div aria-hidden className="mx-4 border-t border-ink" />

      <div className="flex flex-col gap-6 px-4 py-5">{children}</div>

      <div aria-hidden className="mx-4 border-t-[3px] border-ink" />

      <div className="px-4 py-4">{action}</div>

      <div aria-hidden className="h-0 border-t-[3px] border-dashed border-ink" />
    </div>
  );
}

/**
 * One field, boxed: the skill's input — sunken fill, 3px black rule, Space Mono at 15px —
 * under a display-face label. Focus is left to the global `:focus-visible` ring in
 * `globals.css` rather than a border that thickens to 5px, because the ring walks around
 * the field instead of shoving the column sideways when it lands.
 */
export function AuthField({
  label,
  name,
  type = "text",
  autoComplete,
  placeholder,
  hint,
  defaultValue,
  inputMode,
  pattern,
  maxLength,
  required = true,
}: {
  label: string;
  name: string;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  placeholder?: string;
  /** Shown under the field. Never used for errors — those belong at the top. */
  hint?: string;
  defaultValue?: string;
  inputMode?: "text" | "email" | "numeric";
  pattern?: string;
  maxLength?: number;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={name}
        className="font-display text-[13px] uppercase tracking-[0.04em] text-ink"
      >
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        defaultValue={defaultValue}
        inputMode={inputMode}
        pattern={pattern}
        maxLength={maxLength}
        aria-describedby={hint ? `${name}-hint` : undefined}
        className="w-full border-[3px] border-ink bg-sunken px-3 py-2.5 font-mono text-[15px] text-ink placeholder:text-ink-muted disabled:border-rule-soft disabled:bg-[#f5f5f5]"
      />
      {hint ? (
        // Sans, not the frame's mono: this is a sentence of explanation, and the whole
        // frame would otherwise set every line in the utility face.
        <p
          id={`${name}-hint`}
          className="mt-0.5 font-sans text-[12px] leading-snug text-ink-muted"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One failure or one piece of good news, stated once at the top of the form.
 *
 * Deliberately a single banner rather than per-field messages: Cognito refuses to say
 * whether an address or a password was wrong, so field-level errors would have to be
 * invented locally and would contradict the provider the moment they disagreed.
 *
 * Drawn as a ruled note rather than a box — a hazard rule on the left, the tint behind
 * it, and the same copper-square marker the eyebrows use to say what kind of line it is.
 */
export function AuthNotice({ notice }: { notice: Notice }) {
  const isError = notice.tone === "error";

  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "border-l-[5px] bg-sunken px-4 py-3",
        isError ? "border-hazard" : "border-verified",
      )}
    >
      <p
        className={cn(
          "flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em]",
          isError ? "text-hazard-ink" : "text-verified",
        )}
      >
        <span
          aria-hidden
          className={cn("size-2 shrink-0", isError ? "bg-hazard" : "bg-verified")}
        />
        {notice.title}
      </p>
      {notice.detail ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
          {notice.detail}
        </p>
      ) : null}
      {notice.action ? (
        <Link
          href={notice.action.href}
          className={cn(
            "mt-2.5 inline-block font-mono text-[11px] font-bold uppercase tracking-[0.14em] underline underline-offset-2",
            isError ? "text-hazard-ink" : "text-verified",
          )}
        >
          {notice.action.label} →
        </Link>
      ) : null}
    </div>
  );
}

/** The one primary action on an auth screen. Full width, because there is only one. */
export function AuthSubmit({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Button type="submit" className={cn("w-full justify-center py-3", className)}>
      {children}
    </Button>
  );
}

/**
 * A quiet route between the three auth screens, set in the utility face like every other
 * label on the surface — the prompt and the link are the same kind of thing.
 */
export function AuthSwitch({
  prompt,
  href,
  label,
}: {
  prompt: string;
  href: string;
  label: string;
}) {
  return (
    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">
      {prompt}{" "}
      <Link
        href={href}
        className="text-ink underline decoration-copper underline-offset-[6px] hover:decoration-ink"
      >
        {label}
      </Link>
    </p>
  );
}
