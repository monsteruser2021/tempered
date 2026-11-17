export default function GrobitPreview() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <section className="flex min-h-[70vh] w-[90vw] max-w-4xl items-center justify-center rounded-3xl border border-white/25 bg-white/10 p-8 text-white shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-12">
        <div className="w-full max-w-2xl text-center">
          <p className="mt-12 text-xs uppercase tracking-[0.16em] text-white/55">Aplicación de hábitos</p>
          <h1 className="font-display mt-5 text-3xl uppercase tracking-widest text-[#76c978] sm:text-5xl">Grobit</h1>
          <p className="mx-auto mt-6 max-w-md text-sm leading-6 text-white/65">
            Tu espacio para construir hábitos con constancia.
          </p>
          <div className="mx-auto mt-10 max-w-sm rounded-2xl border border-white/15 bg-black/20 p-6">
            <p className="text-sm uppercase text-white/80">Próximamente</p>
            <p className="mt-3 text-xs leading-5 text-white/50">Esta aplicación estará disponible en una próxima versión.</p>
          </div>
        </div>
      </section>
    </main>
  );
}