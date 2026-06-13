// Root layout — applies global styles and fonts, wraps the entire application
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Oikos Ledger",
  description: "Personal finance intelligence",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
