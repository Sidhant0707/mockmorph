import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers"; // Excellent, the import is here

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Updated metadata to match your SaaS branding
export const metadata: Metadata = {
  title: "MockMorph | Production-grade mock data",
  description: "Generate relationally perfect SQL directly to your local machine.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased scroll-smooth`}
    >
      {/* Kept your flex layout, added the dark background color */}
      <body className="min-h-full flex flex-col bg-[#0a0a0a] text-white">
        
        {/* THE FIX: The Providers tag now wraps the entire application */}
        <Providers>
          {children}
        </Providers>
        
      </body>
    </html>
  );
}