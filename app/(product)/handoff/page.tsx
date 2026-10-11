import { CollectorPhone, PhoneFrame } from "@/components/features/handoff/collector-phone";
import { HandoffLoadContext } from "@/components/features/handoff/load-context";
import { ScreenHeader } from "@/components/ui/page-header";
import { requireAccess } from "@/lib/auth/dal";
import { DEMO_LOAD } from "@/lib/pickup/demo";
import { readHandoffContext } from "@/lib/pickup/handoff";

export const instant = false;

/** The collector's phone, on its own — open it on a real handset next to `/gate`. */
export default async function HandoffPage() {
  const user = await requireAccess("/handoff");
  const context = await readHandoffContext(user);

  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Smart pickup · collector"
        title="Hand over e-waste"
        lede="The kabadiwala's phone. One tap routes the load to a licensed recycler and puts a 4-digit PIN on screen; the money arrives when the gate types it."
      />
      <HandoffLoadContext context={context} />
      <PhoneFrame>
        <CollectorPhone load={DEMO_LOAD} />
      </PhoneFrame>
    </div>
  );
}
