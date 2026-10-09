import { ProductShell } from "@/components/layout/product-shell";

/**
 * The shell reads the session to decide which links the rail shows, so the segment is
 * allowed to block on the server. Every page inside it guards itself with
 * `requireAccess` as well — this layout is chrome, not the authorization boundary.
 */
export const instant = false;

export default function ProductLayout({ children }: LayoutProps<"/">) {
  return <ProductShell>{children}</ProductShell>;
}
