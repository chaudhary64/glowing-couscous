import { DocNav } from "@/components/layout/doc-nav";
import { TopBar } from "@/components/layout/top-bar";

/** Shell for the feature write-ups under /doc. */
export function DocShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <DocNav />

      <div className="flex min-w-0 flex-col">
        <TopBar />

        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8 lg:py-12">
          {children}
        </main>

        <footer className="border-t border-rule">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-6 sm:px-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
              EcoEPR · feature documentation
            </p>
            <p className="max-w-3xl text-[12px] leading-relaxed text-ink-muted">
              These pages explain the build and the priority ranking. The working
              screens live in the app itself. Every number here is a fixture, and
              credits are simulated.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
