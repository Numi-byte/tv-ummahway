import "./globals.css";
import ServiceWorkerRegister from "./ServiceWorkerRegister";

export const metadata = {
  title: "UmmahWay TV",
  description: "Digital Masjid Display",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
