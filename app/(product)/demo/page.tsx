import { HandoffDemo } from "@/components/features/handoff/handoff-demo";
import { HandoffLoadContext } from "@/components/features/handoff/load-context";
import { Panel } from "@/components/ui/card";
import { requireAccess } from "@/lib/auth/dal";
import { canOpen } from "@/lib/auth/roles";
import { scopeForUser } from "@/lib/records/scope";
import { readHandoffContext } from "@/lib/pickup/handoff";

export const instant = false;

/**
 * Phone and gate side by side, for the 3-minute demo recording.
 *
 * The load is the newest cleared priced item, so each take hands over a real row rather
 * than a constant typed into the repository. Nothing cleared means nothing to record, and
 * the page says which is missing.
 */
export default async function DemoPage() {
  const user = await requireAccess("/demo");
  const scope = await scopeForUser(user);
  // One page, two seats (handover §4.2): each half acts only for the role that holds it,
  // and shows the other role's step as a sentence rather than a button the API refuses.
  const canRoute = canOpen("/handoff", user.role).ok;
  const canSettle = canOpen("/gate", user.role).ok;
  const context = await readHandoffContext(scope);

  return (
    <div className="space-y-5">
      <HandoffLoadContext context={context} />
      {context.load ? (
        <HandoffDemo load={context.load} canRoute={canRoute} canSettle={canSettle} />
      ) : (
        <Panel eyebrow="Nothing to route" title="No load can be handed over yet">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            {context.loadError
              ? `The priced record could not be read: ${context.loadError}`
              : (context.loadReason ??
                "No cleared item is on file, so there is no load to record a handoff for.")}
          </p>
        </Panel>
      )}
    </div>
  );
}
