import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Team Planner",
  description: "A shared daily planner for your team.",
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
