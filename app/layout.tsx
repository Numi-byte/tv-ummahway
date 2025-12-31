import "./globals.css";

export const metadata = {
  title: "UmmahWay TV",
  description: "Digital Masjid Display",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
