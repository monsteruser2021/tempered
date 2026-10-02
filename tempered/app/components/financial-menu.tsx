import Link from "next/link";

const financialApps = [
  { href: "/summary", label: "Resumen" },
  { href: "/isorropia/metricas", label: "Métricas financieras" },
  { href: "/distribucion", label: "Distribuciones" },
  { href: "/balance-bs", label: "Balance Bs" },
  { href: "/balance-dolares", label: "Balance $" },
  { href: "/deudas", label: "Deudas pendientes" },
  { href: "/transfers", label: "Transferencias" },
];

export default function FinancialMenu() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <section className="flex min-h-[70vh] w-[calc(100%-2rem)] max-w-7xl items-center justify-center rounded-3xl border border-white/25 bg-white/10 p-5 shadow-2xl shadow-black/30 backdrop-blur-xl sm:w-[90vw] sm:p-12">
        <div className="w-full max-w-4xl min-w-0">
          <div className="flex justify-end">
            <span className="text-xs uppercase tracking-[0.12em] text-white/45">Aplicación financiera</span>
          </div>
          <h1 className="font-display mt-10 max-w-full wrap-break-word text-center text-2xl uppercase tracking-[0.06em] text-[#ddab36] sm:text-5xl sm:tracking-widest">
            Isorropia Kairos
          </h1>

          <nav className="mt-16 grid min-w-0 gap-5 sm:grid-cols-2 md:grid-cols-3" aria-label="Opciones de Isorropia Kairos">
            {financialApps.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="min-w-0 w-full max-w-full wrap-break-word rounded-xl border border-white/25 bg-black/20 px-4 py-5 text-center text-xs uppercase text-white transition hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/70 sm:px-5 sm:text-sm"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </section>
    </main>
  );
}