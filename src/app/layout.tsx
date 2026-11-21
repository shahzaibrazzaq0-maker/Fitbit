import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FitBite Pro",
  description: "Calories, steps, water, workouts, and watch vitals in one quiet dashboard.",
};

export const viewport: Viewport = {
  themeColor: "#F5F6F8",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" dir="ltr" className={`${jakarta.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            // Sets the saved language and direction before first paint. Arabic reads right-to-left.
            __html: `(function(){try{var l=localStorage.getItem("fitbite_lang_v1");if(/^(en|ar|de|fr|es|it)$/.test(l)){var r=document.documentElement;r.lang=l;r.dir=l==="ar"?"rtl":"ltr"}}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${jakarta.className} min-h-dvh`}>{children}</body>
    </html>
  );
}
