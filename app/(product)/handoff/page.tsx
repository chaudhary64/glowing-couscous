import { CollectorPhone, PhoneFrame } from "@/components/features/handoff/collector-phone";
import { ScreenHeader } from "@/components/ui/page-header";
import { requireAccess } from "@/lib/auth/dal";
import { DEMO_LOAD } from "@/lib/pickup/demo";

export const instant = false;

/** The collector's phone, on its own — open it on a real handset next to `/gate`. */
export default async function HandoffPage() {
  await requireAccess("/handoff");
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Smart pickup · collector"
        title="Hand over e-waste"
        lede="The kabadiwala's phone. One tap routes the load to a licensed recycler and puts a 4-digit PIN on screen; the money arrives when the gate types it."
      />
      <PhoneFrame>
        <CollectorPhone load={DEMO_LOAD} />
      </PhoneFrame>
    </div>
  );
}
