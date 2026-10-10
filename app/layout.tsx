import type { Metadata } from "next";
import { Anton, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { ConsentBanner } from "@/components/layout/consent-banner";
import { MotionObserver } from "@/components/motion/motion-observer";

const anton = Anton({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-anton",
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
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
      className={`${anton.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        {children}
        <MotionObserver />
        <ConsentBanner />
      </body>
    </html>
  );
}
