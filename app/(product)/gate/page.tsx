import { RecyclerGate } from "@/components/features/handoff/recycler-gate";
import { ScreenHeader } from "@/components/ui/page-header";
import { requireAccess } from "@/lib/auth/dal";

export const instant = false;

/** The recycler's terminal at the gate. `?pickup=PU-2026-0001` opens a load directly. */
export default async function GatePage({ searchParams }: PageProps<"/gate">) {
  await requireAccess("/gate");
  const { pickup } = await searchParams;
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Smart pickup · recycler"
        title="Recycler gate"
        lede="Weigh the load and enter the collector's PIN to complete the handoff. Five wrong attempts lock the load."
      />
      <RecyclerGate pickupId={typeof pickup === "string" ? pickup : null} />
    </div>
  );
}
