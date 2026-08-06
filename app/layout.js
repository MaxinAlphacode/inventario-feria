import "./globals.css";
import SupabaseProvider from "./SupabaseProvider";
import FairProvider from "./FairProvider";

export const metadata = {
  title: "Inventario Feria",
  description: "Inventario y ventas para la feria",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#faf8fb",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <SupabaseProvider>
          <FairProvider>{children}</FairProvider>
        </SupabaseProvider>
      </body>
    </html>
  );
}
