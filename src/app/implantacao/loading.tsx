/**
 * Tela de carregamento do painel público de implantação.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE (30/08/2026)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * A página é renderizada no SERVIDOR e consulta o banco antes de responder — medido contra
 * produção: **~4,2 s**, dos quais ~3,6 s são as contagens de `marcacoes_ponto` dos três meses
 * (29.294 registros só em agosto). Até o HTML chegar, o navegador não mostra nada.
 *
 * ⚠️ **Quatro segundos de tela em branco são indistinguíveis de página travada.** O usuário não
 * sabe se está carregando ou se quebrou — e quem acha que quebrou fecha a aba ou recarrega, o
 * que só faz o servidor refazer as mesmas consultas.
 *
 * O Next transmite este arquivo IMEDIATAMENTE e troca pelo conteúdo quando ele fica pronto.
 *
 * ⚠️ **A barra é INDETERMINADA de propósito.** Uma barra que enche até uma porcentagem afirma
 * saber quanto falta, e aqui não se sabe: o tempo depende do banco. Barra que finge progresso é
 * a mesma família de erro da armadilha 22 — mostrar um número que não corresponde a nada medido.
 * Esta apenas indica atividade.
 *
 * ⚠️ **Nenhum esqueleto imita número.** Os blocos cinzentos têm a FORMA dos cartões, mas nenhum
 * dígito: um "0" ou um "--" no lugar de "12 unidades operando" seria lido como resultado. Vale
 * a mesma regra do estado de falha em `page.tsx`.
 *
 * Mantém a identidade visual do painel (mesmo fundo, mesmos gradientes) para a transição não
 * parecer troca de página.
 */
export default function Carregando() {
  return (
    <div className="carregando">
      <style>{`
        .carregando {
          position: relative; min-height: 100vh; overflow-x: hidden;
          background: #070b18; color: #eef2ff;
          padding: clamp(20px, 4vw, 56px);
          font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
        }
        /* Mesmo fundo do painel, para a troca não piscar uma cor diferente. */
        .carregando::before {
          content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
          background:
            radial-gradient(60rem 40rem at 12% -10%, rgba(34,211,238,.20), transparent 60%),
            radial-gradient(50rem 36rem at 92% 8%, rgba(167,139,250,.18), transparent 60%),
            radial-gradient(46rem 34rem at 50% 108%, rgba(236,72,153,.14), transparent 60%);
        }
        .carregando > * { position: relative; z-index: 1; }

        .c-olho {
          font-size: 12px; font-weight: 800; letter-spacing: .18em;
          text-transform: uppercase; color: #22d3ee; margin: 0 0 10px;
        }
        .c-titulo {
          margin: 0; font-size: clamp(30px, 5.2vw, 58px); line-height: 1.04;
          font-weight: 800; letter-spacing: -.03em;
        }
        .c-sub { color: #94a3b8; margin: 14px 0 0; font-size: 15px; }

        /* Barra INDETERMINADA: vai e volta, não promete porcentagem nenhuma. */
        .c-barra {
          margin: 36px 0 44px; height: 4px; width: 100%; max-width: 520px;
          background: rgba(148,163,184,.18); border-radius: 999px; overflow: hidden;
        }
        .c-barra span {
          display: block; height: 100%; width: 38%; border-radius: 999px;
          background: linear-gradient(90deg, #22d3ee, #a78bfa);
          animation: desliza 1.15s ease-in-out infinite;
        }
        @keyframes desliza {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(320%); }
        }

        .c-cards { display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
        .c-card {
          border: 1px solid rgba(148,163,184,.14); border-radius: 18px;
          padding: 26px 22px; background: rgba(255,255,255,.02);
        }
        /* Blocos com a FORMA do conteúdo, sem nenhum dígito. */
        .c-bloco { border-radius: 8px; background: rgba(148,163,184,.13); animation: pulsa 1.6s ease-in-out infinite; }
        .c-bloco.alto { height: 38px; width: 58%; margin-bottom: 14px; }
        .c-bloco.medio { height: 11px; width: 82%; margin-bottom: 8px; }
        .c-bloco.baixo { height: 9px;  width: 62%; }
        @keyframes pulsa { 0%,100% { opacity: .55 } 50% { opacity: 1 } }

        /* Quem prefere menos movimento na tela não perde a informação: o texto continua lá. */
        @media (prefers-reduced-motion: reduce) {
          .c-barra span { animation: none; width: 100%; }
          .c-bloco { animation: none; }
        }
      `}</style>

      <p className="c-olho">Secretaria Municipal de Saúde · Marabá / PA</p>
      <h1 className="c-titulo">Implantação do <strong>Ponto Digital</strong></h1>
      <p className="c-sub" role="status" aria-live="polite">
        Carregando os números direto do sistema… isso costuma levar alguns segundos.
      </p>

      <div className="c-barra" aria-hidden="true"><span /></div>

      <div className="c-cards" aria-hidden="true">
        {[0, 1, 2, 3].map(i => (
          <div className="c-card" key={i}>
            <div className="c-bloco alto" />
            <div className="c-bloco medio" />
            <div className="c-bloco baixo" />
          </div>
        ))}
      </div>
    </div>
  )
}
