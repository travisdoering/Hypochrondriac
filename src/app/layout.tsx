import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hypochondriac - for whatever ails you",
  description:
    "A real-time health companion: journal, coach, diagnostician, therapist, lab & imaging translator, and care navigator in one conversation. Connects to your EHR and imaging.",
  applicationName: "Hypochondriac",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
  appleWebApp: { capable: true, title: "Hypochondriac", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0e7c86",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
