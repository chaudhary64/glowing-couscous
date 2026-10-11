"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ROLES, type Role } from "@/lib/auth/roles";

/**
 * One member's role, changeable in place. The pool is the state: after a change the
 * page is refreshed, so what shows is what Cognito holds, never what was clicked.
 */
export function RolePicker({
  username,
  name,
  role,
}: {
  username: string;
  name: string;
  role: Role | null;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<Role | "">(role ?? "");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function save() {
    if (!choice || choice === role) return;
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch("/api/team/role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, role: choice }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setFailure(payload?.message ?? `The role was not changed (HTTP ${response.status}).`);
        return;
      }
      router.refresh();
    } catch {
      setFailure("The browser could not reach the server, so the role was not changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <select
          aria-label={`Role for ${name}`}
          value={choice}
          disabled={busy}
          onChange={(event) => setChoice(event.target.value as Role | "")}
          className="border border-ink bg-paper px-2 py-1 font-mono text-[11px] uppercase tracking-[0.12em]"
        >
          {role === null ? <option value="">No role</option> : null}
          {(Object.keys(ROLES) as Role[]).map((value) => (
            <option key={value} value={value}>
              {ROLES[value].label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={busy || !choice || choice === role}
          className="border border-ink bg-ink px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper disabled:border-rule disabled:bg-paper disabled:text-ink-muted"
        >
          {busy ? "Saving" : "Save"}
        </button>
      </div>
      {failure ? (
        <p role="alert" className="text-[12px] leading-snug text-hazard-ink">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
