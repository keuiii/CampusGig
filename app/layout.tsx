import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CampusGig — Student skills, real opportunities",
  description: "A trusted student services marketplace for schools in Lipa City.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
