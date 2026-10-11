import { CollectorPhone, PhoneFrame } from "@/components/features/handoff/collector-phone";
import { HandoffLoadContext } from "@/components/features/handoff/load-context";
import { Panel } from "@/components/ui/card";
import { ScreenHeader } from "@/components/ui/page-header";
import { requireAccess } from "@/lib/auth/dal";
import { readHandoffContext } from "@/lib/pickup/handoff";

export const instant = false;

/**
 * The collector's phone, on its own — open it on a real handset next to `/gate`.
 *
 * The load is the newest cleared item from the priced record, so this screen only has a
 * phone when there is something real to hand over; with nothing cleared it says so
 * instead of showing a load nothing produced.
 */
export default async function HandoffPage() {
  await requireAccess("/handoff");
  const context = await readHandoffContext();

  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Smart pickup · collector"
        title="Hand over e-waste"
        lede="The kabadiwala's phone. One tap routes the newest cleared load to a licensed recycler and puts a 4-digit PIN on screen; the money arrives when the gate types it."
      />
      <HandoffLoadContext context={context} />
      {context.load ? (
        <PhoneFrame>
          <CollectorPhone load={context.load} />
        </PhoneFrame>
      ) : (
        <Panel eyebrow="Nothing to route" title="No load can be handed over yet">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            {context.loadError
              ? `The priced record could not be read: ${context.loadError}`
              : (context.loadReason ??
                "No cleared item is on file, so the phone has no load to route.")}
          </p>
        </Panel>
      )}
    </div>
  );
}
