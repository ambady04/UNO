import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "UNO! Real-Time Multiplayer",
  description: "Real-time multiplayer UNO card game.",
  icons: {
    icon: "/uno-logo.svg",
  },
  openGraph: {
    title: "UNO! Real-Time Multiplayer",
    description: "Real-time multiplayer UNO card game.",
    url: "https://uno.ambady.space",
    siteName: "UNO! Multiplayer",
    images: [
      {
        url: "/uno-logo.svg",
        width: 200,
        height: 200,
        alt: "UNO! Logo",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "UNO! Real-Time Multiplayer",
    description: "Real-time multiplayer UNO card game.",
    images: ["/uno-logo.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>{children}</body>
    </html>
  );
}
