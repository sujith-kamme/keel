export default function StoreLayout({ children }: LayoutProps<"/store">) {
  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Harbor &amp; Pine Outfitters</h1>
      <p className="mb-6 text-sm text-black/60 dark:text-white/60">Support chat</p>
      {children}
    </main>
  );
}
