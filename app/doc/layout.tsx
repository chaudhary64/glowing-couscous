import { DocShell } from "@/components/layout/doc-shell";

export default function DocLayout({ children }: LayoutProps<"/doc">) {
  return <DocShell>{children}</DocShell>;
}
