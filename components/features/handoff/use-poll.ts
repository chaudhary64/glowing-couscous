"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `tick` as soon as `enabled` turns true and then every `intervalMs`, never
 * overlapping: the next call is scheduled after the previous one settles, so a slow API
 * cannot pile up requests. Stops on unmount and whenever `enabled` turns false.
 */
export function usePoll(tick: () => Promise<void>, intervalMs: number, enabled: boolean) {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        await latest.current();
      } finally {
        if (!cancelled) timer = setTimeout(run, intervalMs);
      }
    };
    timer = setTimeout(run, 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, intervalMs]);
}

/** POST/GET a JSON endpoint and return status + body, without throwing on 4xx. */
export async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  // The app's own guards answer `{ error: "unauthorized", message }`; the Lambda answers
  // `{ error: { code, message } }`. One shape for the screens to read.
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    const flat = body as { error: string; message?: string };
    body = { error: { code: flat.error, message: flat.message ?? flat.error } };
  }
  return { status: response.status, body };
}
