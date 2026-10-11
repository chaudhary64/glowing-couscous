import { HandoffDemo } from "@/components/features/handoff/handoff-demo";
import { HandoffLoadContext } from "@/components/features/handoff/load-context";
import { requireAccess } from "@/lib/auth/dal";
import { DEMO_LOAD } from "@/lib/pickup/demo";
import { readHandoffContext } from "@/lib/pickup/handoff";

export const instant = false;

/** Phone and gate side by side, for the 3-minute demo recording. */
export default async function DemoPage() {
  const user = await requireAccess("/demo");
  const context = await readHandoffContext(user);

  return (
    <div className="space-y-5">
      <HandoffLoadContext context={context} />
      <HandoffDemo load={DEMO_LOAD} />
    </div>
  );
}
