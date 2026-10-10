import { HandoffDemo } from "@/components/features/handoff/handoff-demo";
import { requireAccess } from "@/lib/auth/dal";
import { DEMO_LOAD } from "@/lib/pickup/demo";

export const instant = false;

/** Phone and gate side by side, for the 3-minute demo recording. */
export default async function DemoPage() {
  await requireAccess("/demo");
  return <HandoffDemo load={DEMO_LOAD} />;
}
