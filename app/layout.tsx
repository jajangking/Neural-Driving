import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Neural Driving — self-driving car sandbox",
  description:
    "Mobil yang belajar menyetir sendiri: neural network + genetic algorithm, dilatih langsung di browser.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
