/**
 * Strip across the top of the documentation.
 *
 * The list is the stack that actually serves these pages — Gemini for the model
 * calls, Cognito for identity, Postgres on RDS, Amplify's SSR compute to run it.
 * Lambda, API Gateway, DynamoDB and OpenSearch were in the first proposal and were
 * never built: this app ships no function, gateway or queue table of its own, and the
 * validation queue says as much on the screen itself. Amplify's SSR compute runs on
 * Lambda underneath, but that is the host's business rather than a service this app
 * deploys and names, and the distinction is the whole point of the list.
 *
 * The count of capabilities in the core loop used to sit here too. It is a fact
 * about the build order, not about the product, so it belongs in the priority
 * ladder under `/doc` rather than in every page's header.
 */
const stack = ["Gemini", "Cognito", "RDS Postgres", "Amplify SSR"];

export function TopBar() {
  return (
    <div className="sticky top-0 z-10 border-b border-rule bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5 sm:px-8">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          Built on
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
