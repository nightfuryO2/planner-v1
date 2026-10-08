import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Team Planner",
  description: "A shared daily planner for your team.",
};

// Applies the saved theme (or the system preference) before the first paint to avoid a flash.
const themeScript = `(function(){try{var m=localStorage.getItem("planner-theme");var d=m==="dark"||(m!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light")}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
