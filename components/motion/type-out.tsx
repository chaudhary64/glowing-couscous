"use client";

import { useEffect, useState } from "react";

/**
 * Text that types itself out, a grapheme at a time, with a copper caret — for a fresh
 * transcript arriving on screen. The full text is in the DOM for screen readers from the
 * first frame (aria-label); only the visible copy is paced. Under reduced motion it
 * renders whole.
 */
export function TypeOut({ text, msPerChar = 28 }: { text: string; msPerChar?: number }) {
  // Graphemes, not code units: a Devanagari conjunct must never be cut in half.
  const [parts] = useState(() =>
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((s) => s.segment)
      : [...text],
  );
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const done = setTimeout(() => setShown(parts.length), 0);
      return () => clearTimeout(done);
    }
    const timer = setInterval(() => {
      setShown((count) => {
        if (count >= parts.length) {
          clearInterval(timer);
          return count;
        }
        return count + 1;
      });
    }, msPerChar);
    return () => clearInterval(timer);
  }, [parts, msPerChar]);

  const typing = shown < parts.length;
  return (
    <span aria-label={text}>
      <span aria-hidden>{parts.slice(0, shown).join("")}</span>
      {typing ? <span aria-hidden className="type-caret" /> : null}
    </span>
  );
}
