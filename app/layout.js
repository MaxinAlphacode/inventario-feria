import "./globals.css";
import SupabaseProvider from "./SupabaseProvider";

export const metadata = {
  title: "Inventario Feria",
  description: "Inventario y ventas para la feria",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#fbf7f1",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <SupabaseProvider>{children}</SupabaseProvider>
      </body>
    </html>
  );
}
