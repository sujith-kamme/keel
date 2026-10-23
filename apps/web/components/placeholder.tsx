export function Placeholder({ title, phase }: { title: string; phase: number }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm opacity-70">Built in Phase {phase} of the roadmap.</p>
    </section>
  );
}
