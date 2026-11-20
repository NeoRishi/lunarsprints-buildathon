import type { Metadata, Viewport } from "next";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource/jetbrains-mono/400.css";
import "./globals.css";
export const viewport: Viewport = { themeColor: "#0e1116" };
export const metadata: Metadata = {
  title: "LunarSprints · Know what matters today",
  description:
    "From an intention to an approved, realistic sprint of 3 to 45 days.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
