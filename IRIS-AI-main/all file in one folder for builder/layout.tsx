import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ALPHA — AI-native code editor",
  description:
    "ALPHA is a premium AI-native code editor that delivers a pixel-perfect VS Code experience with deep AI integration and seamless live preview.",
  keywords: ["ALPHA", "AI code editor", "VS Code", "TypeScript", "React"],
  authors: [{ name: "ALPHA Team" }],
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased bg-[#1e1e1e] text-[#cccccc] font-sans`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
