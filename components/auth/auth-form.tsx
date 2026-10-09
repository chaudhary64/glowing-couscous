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
 * The visual language is the app's, unchanged: a ruled box instead of a rounded card,
 * labels set in the display face and uppercased like every other label in the product,
 * and the field itself sunken below the paper it sits on.
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
    <div className="flex flex-col">
      <label
        htmlFor={name}
        className="mb-1 font-display text-[12px] uppercase tracking-[0.1em] text-ink"
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
        className="w-full border-2 border-ink bg-paper px-3 py-2.5 font-mono text-[14px] text-ink placeholder:text-ink-muted/70 focus:border-copper"
      />
      {hint ? (
        <p id={`${name}-hint`} className="mt-1.5 text-[12px] leading-snug text-ink-muted">
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
 */
export function AuthNotice({ notice }: { notice: Notice }) {
  const isError = notice.tone === "error";

  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "border-2 px-4 py-3",
        isError
          ? "border-hazard bg-hazard-tint"
          : "border-verified bg-verified-tint",
      )}
    >
      <p
        className={cn(
          "font-display text-[13px] uppercase tracking-[0.1em]",
          isError ? "text-hazard" : "text-verified",
        )}
      >
        {notice.title}
      </p>
      {notice.detail ? (
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
          {notice.detail}
        </p>
      ) : null}
      {notice.action ? (
        <Link
          href={notice.action.href}
          className={cn(
            "mt-2 inline-block font-mono text-[11px] uppercase tracking-[0.14em] underline underline-offset-2",
            isError ? "text-hazard" : "text-verified",
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

/** A quiet route between the three auth screens. */
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
    <p className="text-[13px] leading-relaxed text-ink-muted">
      {prompt}{" "}
      <Link
        href={href}
        className="font-medium text-ink underline decoration-rule underline-offset-2 hover:decoration-copper"
      >
        {label}
      </Link>
    </p>
  );
}
