import { AuthProvider } from "@/components/AuthProvider";
import { ToastProvider } from "@/components/Toast";
import { AppShell } from "@/components/AppShell";

// ZP-485: the back office. Every admin page (all of src/app/(admin)/**) gets the
// session check, login screen and admin chrome. The route group adds no URL
// segment, so admin URLs are unchanged. The storefront (src/app/site/**) sits
// outside this group and never loads these providers.
export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppShell>{children}</AppShell>
      </AuthProvider>
    </ToastProvider>
  );
}
