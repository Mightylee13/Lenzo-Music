import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Lenzo Music — Your sound. Your wave.",
    template: "%s · Lenzo Music",
  },
  description:
    "Lenzo Music (BLUEWAVE): a premium streaming experience — search, discover, stream, build playlists and take your music offline.",
  applicationName: "Lenzo Music",
  appleWebApp: { capable: true, title: "Lenzo Music", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#070d1a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${manrope.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
