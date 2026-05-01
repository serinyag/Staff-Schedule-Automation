import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Staff Availability",
  description: "Monthly staff availability submission for unavailable dates.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full font-sans text-slate-950 antialiased">{children}</body>
    </html>
  );
}
