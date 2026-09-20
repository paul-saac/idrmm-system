import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

// The whole system's body font — matches the Figma design file's own
// typeface, replacing Next.js's default Geist Sans.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "IDR M&M",
    template: "%s | IDR M&M",
  },
  description:
    "Web-Based Construction Project Management with Automated Delay Risk Assessment and Completion Forecasting for IDR M&M Inc.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* Tailwind's own Preflight reset sets a hardcoded generic
          font-family stack on <body> — defining --font-sans in
          globals.css alone doesn't override that; the font-sans utility
          class has to actually be applied somewhere for it to take
          effect. Confirmed directly: computed font-family on a heading
          resolved to the browser's plain sans-serif fallback (Geist
          Sans was already silently unused before this), not either
          variable, without this class. */}
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
