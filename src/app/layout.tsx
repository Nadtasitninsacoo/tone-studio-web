import type { Metadata, Viewport } from "next";
import { Azeret_Mono, Geist, JetBrains_Mono } from "next/font/google";

import { ServiceWorkerRegistrar } from "@/components/providers/ServiceWorkerRegistrar";
import { StudioProviders } from "@/components/providers/StudioProviders";
import { AppShell } from "@/components/ui/AppShell";
import { THEME_STORAGE_KEY } from "@/lib/theme";

import "./globals.css";

/** UI text. */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

/** Data, labels and file metadata — excellent tabular figures. */
const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

/** Display face reserved for the hero timecode: wide, geometric numerals. */
const azeretMono = Azeret_Mono({
  variable: "--font-azeret-mono",
  weight: ["300", "400", "500", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Guitar Recorder — Studio",
  description:
    "Browser-based multi-take guitar recorder for USB audio interfaces and multi-effects pedals.",
  applicationName: "Guitar Rec",
  /*
   * iOS installs from the Share sheet and reads none of the manifest. These three are
   * the whole of what it does read: without `capable` an added shortcut opens in a
   * Safari tab with its chrome, which is not an installed app, and without the icon
   * it renders a screenshot of the page as the home-screen tile.
   */
  appleWebApp: {
    capable: true,
    title: "Guitar Rec",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom stays available — clamping it would fail accessibility on phones.
  maximumScale: 5,
  // Tints the mobile browser chrome to match whichever theme is active.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eaeaec" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0c" },
  ],
};

/**
 * Applies the stored theme before the first paint.
 *
 * Without this, a user who picked dark mode sees a white flash on every load,
 * because the class can only be set after hydration. It runs as the first thing
 * in <body> so no markup has been painted yet.
 */
const themeScript = `
(function(){try{
  var stored = localStorage.getItem('${THEME_STORAGE_KEY}') || 'system';
  var dark = stored === 'dark' || (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
}catch(e){}})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${jetBrainsMono.variable} ${azeretMono.variable} h-full antialiased`}
      // The pre-paint script mutates this element, which hydration would
      // otherwise flag as a server/client mismatch.
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-base font-sans text-ink">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <ServiceWorkerRegistrar />
        {/* The recorder engine lives here, outside the router, so a route
            change no longer tears down playback, the input or the imported media. */}
        <StudioProviders>
          <AppShell>{children}</AppShell>
        </StudioProviders>
      </body>
    </html>
  );
}
