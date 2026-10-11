import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { requireAccess } from "@/lib/auth/dal";
import { ROLES, roleLabel, type Role } from "@/lib/auth/roles";
import { formatTimestamp } from "@/lib/format";
import { listMembers } from "@/lib/records/users";

export const instant = false;

/**
 * The team, for the two roles that answer for it.
 *
 * Read-only on purpose. Who holds which role is the Cognito pool's business — a role is a
 * group, carried on the person's token — and this app has no admin credentials for the
 * pool, so a "change role" button here could only be a button that fails. What the app
 * does know is who has signed in, from the `users` rows written at sign-in, and that is
 * what this lists; the role ladder under it says what each group opens.
 */
export default async function TeamPage() {
  const user = await requireAccess("/team");
  const members = await listMembers();
  const active = members.rows.filter((member) => member.status === "active").length;

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Administration"
        title="Team"
        lede={`Everyone who has signed in to EcoEPR, most recently seen first. Roles are groups in the Cognito pool and are changed there; you are signed in as ${roleLabel(user.role)}.`}
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={members.configured ? "verified" : "hazard"}>
              {members.configured ? "Read from the database" : "No database"}
            </Badge>
            {members.configured ? (
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                {members.rows.length} account{members.rows.length === 1 ? "" : "s"} · {active} active
              </span>
            ) : null}
            {members.error ? (
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-hazard-ink">
                {members.error}
              </span>
            ) : null}
          </div>
        }
      />

      <Surface>
        {members.rows.length === 0 ? (
          <p className="p-4 text-sm leading-relaxed text-ink-soft">
            {members.configured
              ? "Nobody has signed in yet. An account appears here after its first sign-in."
              : "The team list needs a database. Without one there is no record of who has signed in."}
          </p>
        ) : (
          <Table caption="Accounts that have signed in">
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Status</TH>
                <TH className="hidden sm:table-cell">Last seen</TH>
              </TR>
            </THead>
            <TBody>
              {members.rows.map((member) => (
                <TR key={member.email ?? member.name}>
                  <TD className="font-medium">{member.name}</TD>
                  <TD mono className="text-[12px] break-all">
                    {member.email ?? "—"}
                  </TD>
                  <TD>
                    <Badge tone={member.status === "active" ? "verified" : "neutral"}>
                      {member.status}
                    </Badge>
                  </TD>
                  <TD mono className="hidden text-[11px] text-ink-muted sm:table-cell">
                    {member.lastSeenAt ? formatTimestamp(member.lastSeenAt) : "Never"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Surface>

      <section>
        <SectionHeader
          eyebrow="Roles"
          title="What each role opens"
          note="Highest authority first. A person in several groups gets the strongest one."
        />
        <Surface className="mt-4">
          <ol>
            {(Object.entries(ROLES) as [Role, (typeof ROLES)[Role]][]).map(([role, spec]) => (
              <li
                key={role}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-rule-soft px-4 py-3 last:border-b-0"
              >
                <span className="w-24 font-mono text-[11px] uppercase tracking-[0.14em] text-copper">
                  {spec.label}
                </span>
                <span className="text-[13px] leading-snug text-ink-soft">{spec.summary}</span>
              </li>
            ))}
          </ol>
        </Surface>
      </section>
    </div>
  );
}
