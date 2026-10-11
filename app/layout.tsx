import type { Metadata } from "next";
import { Archivo_Black, Space_Mono, Work_Sans } from "next/font/google";
import "./globals.css";
import { ConsentBanner } from "@/components/layout/consent-banner";
import { MotionObserver } from "@/components/motion/motion-observer";

/*
  RawBlock's three faces: Archivo Black for display, Work Sans for body, Space Mono
  for every label, figure and rule annotation. Space Mono ships 400 and 700 only, and
  the bold weight is what carries table headers and chip text.
*/
const archivoBlack = Archivo_Black({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-archivo-black",
  display: "swap",
});

const workSans = Work_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-work-sans",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "EcoEPR — Verifiable e-waste take-back",
  description:
    "Multi-modal AI bridge connecting informal e-waste collectors to CPCB-registered recyclers, producing verifiable brand EPR compliance.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Browser extensions write attributes onto <html> before React loads (e.g. a
    // focus extension's id). This silences that one element's attribute check only;
    // everything inside it is still verified.
    <html
      lang="en"
      className={`${archivoBlack.variable} ${workSans.variable} ${spaceMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <ConsentBanner />
        {children}
        <MotionObserver />
      </body>
    </html>
  );
}
