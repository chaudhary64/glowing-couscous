import { RolePicker } from "@/components/features/product/team/role-picker";
import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { ScreenHeader } from "@/components/ui/page-header";
import { requireAccess } from "@/lib/auth/dal";
import { readPoolRoles, type PoolAccount } from "@/lib/auth/pool";
import { roleLabel } from "@/lib/auth/roles";
import { formatTimestamp } from "@/lib/format";
import { listMembers } from "@/lib/records/users";

export const instant = false;

/**
 * The team, for the two roles that answer for it.
 *
 * Who has signed in comes from the `users` rows written at sign-in. Who holds which role
 * is the Cognito pool's business — a role is a group, carried on the person's token — so
 * the role column and its picker appear only when the server holds admin credentials for
 * the pool (`lib/auth/pool.ts`). Without them the list stays read-only and says how to
 * change a role, rather than showing a button that could only fail.
 */
export default async function TeamPage() {
  const user = await requireAccess("/team");
  const [members, pool] = await Promise.all([listMembers(), readPoolRoles()]);
  const active = members.rows.filter((member) => member.status === "active").length;

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Administration"
        title="Team"
        lede={`People who have signed in, most recent first. ${
          pool.readable
            ?             "Role changes apply at the next sign-in."
            : "Roles are managed in the Cognito user pool."
        } You are ${roleLabel(user.role)}.`}
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={members.configured ? "verified" : "hazard"}>
              {members.configured ? "Live records" : "Unavailable"}
            </Badge>
            {members.configured ? (
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                {members.rows.length} account{members.rows.length === 1 ? "" : "s"} · {active} active
              </span>
            ) : null}
            <Badge tone={pool.readable ? "verified" : "neutral"}>
              {pool.readable ? "Roles available" : "Roles unavailable"}
            </Badge>
            {pool.error ? (
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-hazard-ink">
                {pool.error}
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

      {pool.readable ? null : (
        <Surface tone="inset" className="p-4">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            Role changes need permission to administer this user pool. The app uses the
            local AWS profile or the hosting IAM role first; set{" "}
            <span className="font-mono">COGNITO_ADMIN_ACCESS_KEY_ID</span> and{" "}
            <span className="font-mono">COGNITO_ADMIN_SECRET_ACCESS_KEY</span>             only when explicit credentials are required. Required actions are listed in{" "}
            <span className="font-mono">.env.example</span>. Until usable credentials are
            available, change roles in the Cognito console.
          </p>
        </Surface>
      )}

      <Surface>
        {members.rows.length === 0 ? (
          <p className="p-4 text-sm leading-relaxed text-ink-soft">
            {members.configured
              ? "No accounts yet."
              : "No database is connected, so accounts cannot be listed."}
          </p>
        ) : (
          <Table caption="Accounts that have signed in">
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Email</TH>
                {pool.readable ? <TH>Role</TH> : null}
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
                  {pool.readable ? (
                    <TD>
                      <RoleCell
                        account={member.email ? pool.byEmail.get(member.email.toLowerCase()) : undefined}
                        name={member.name}
                        self={Boolean(member.email && member.email.toLowerCase() === user.email?.toLowerCase())}
                      />
                    </TD>
                  ) : null}
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

    </div>
  );
}

/** A member's role: changeable, except your own, and absent for an account the pool lacks. */
function RoleCell({
  account,
  name,
  self,
}: {
  account: PoolAccount | undefined;
  name: string;
  self: boolean;
}) {
  if (!account) return <span className="text-[12px] text-ink-muted">Not in the pool</span>;
  if (self) {
    return (
      <span className="text-[12px]">
        {roleLabel(account.role)} <span className="text-ink-muted">· you</span>
      </span>
    );
  }
  return <RolePicker username={account.username} name={name} role={account.role} />;
}
