import { features } from "@/lib/data/features";

const stack = ["Amazon Bedrock", "Amazon Transcribe", "Lambda", "API Gateway", "DynamoDB", "OpenSearch"];

export function TopBar() {
  const coreCount = features.filter((f) => f.status === "core").length;

  return (
    <div className="sticky top-0 z-10 border-b border-rule bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5 sm:px-8">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          Demo build · {coreCount} of {features.length} capabilities in the core loop
        </span>

        <span className="hidden h-3 w-px bg-rule sm:block" />

        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {stack.map((service) => (
            <li
              key={service}
              className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted"
            >
              {service}
            </li>
          ))}
        </ul>

        <span className="ml-auto inline-flex items-center gap-2 border border-review/40 bg-review-tint px-2 py-0.5">
          <span aria-hidden className="size-1.5 bg-review" />
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-review">
            Simulated data
          </span>
        </span>
      </div>
    </div>
  );
}
