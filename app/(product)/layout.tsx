import { ProductShell } from "@/components/layout/product-shell";

export default function ProductLayout({ children }: LayoutProps<"/">) {
  return <ProductShell>{children}</ProductShell>;
}
