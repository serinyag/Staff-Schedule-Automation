type AppPlaceholderPageProps = {
  eyebrow: string;
  title: string;
  message: string;
};

export function AppPlaceholderPage({ eyebrow, title, message }: AppPlaceholderPageProps) {
  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/90 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-10">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-700">{eyebrow}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
        {title}
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">{message}</p>
    </section>
  );
}
