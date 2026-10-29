import { Suspense } from "react";
import { ConsoleShell, UserLabel } from "@/components/shell";
import { ConsoleUser, ReviewCount, SandboxBadge } from "./shell-data";

export default function ConsoleLayout({ children }: LayoutProps<"/">) {
  return (
    <ConsoleShell
      user={
        <Suspense fallback={<UserLabel email={null} />}>
          <ConsoleUser />
        </Suspense>
      }
      reviewCount={
        <Suspense>
          <ReviewCount />
        </Suspense>
      }
      env={
        <Suspense>
          <SandboxBadge />
        </Suspense>
      }
    >
      {children}
    </ConsoleShell>
  );
}
