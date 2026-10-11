import { HandoffDemo } from "@/components/features/handoff/handoff-demo";
import { HandoffLoadContext } from "@/components/features/handoff/load-context";
import { Panel } from "@/components/ui/card";
import { requireAccess } from "@/lib/auth/dal";
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
  await requireAccess("/demo");
  const context = await readHandoffContext();

  return (
    <div className="space-y-5">
      <HandoffLoadContext context={context} />
      {context.load ? (
        <HandoffDemo load={context.load} />
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
