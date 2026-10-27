import { Nav } from "@/components/nav";

export default function ConsoleLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1">
      <aside className="w-56 shrink-0 border-r border-black/10 dark:border-white/10">
        <Nav />
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
