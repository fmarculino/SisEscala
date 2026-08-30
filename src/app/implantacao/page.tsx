import { obterPainel, type UnidadeStatus, type UsoUnidade } from './dados'
import { formatarData, formatarDataHora } from '@/utils/horario'

/**
 * Painel PÚBLICO de acompanhamento da implantação do SisEscala.
 *
 * Sem login, sem menu, fora do dashboard — é um link para a diretoria e a Secretaria
 * acompanharem o avanço. Atualiza sozinho: `revalidate` regenera a página no servidor a cada 5
 * minutos, e o `<meta http-equiv="refresh">` mantém um telão vivo sem ninguém apertar F5.
 *
 * ⚠️ SÓ DADO AGREGADO. Nada de nome, matrícula, CPF ou horário de servidor — a página é aberta.
 * A regra vive em ./dados.ts, que é a única porta de consulta.
 */
export const revalidate = 300
export const metadata = {
  title: 'SisEscala · Painel de Implantação',
  description: 'Acompanhamento da implantação do ponto digital na Secretaria Municipal de Saúde de Marabá',
}

const MARCOS = [
  { data: '2026-09-01', titulo: 'Produção oficial', texto: 'Onde o sistema está instalado, a escala e a folha do SisEscala passam a ser as oficiais para o fechamento do mês.' },
  { data: '2026-11-30', titulo: 'Cobertura total', texto: 'Todas as unidades operando, incluindo as da zona rural — as de acesso mais difícil.' },
]

function pct(a: number, b: number) { return b > 0 ? Math.round((a / b) * 100) : 0 }
function nf(n: number) { return new Intl.NumberFormat('pt-BR').format(n) }

/** Rosca em SVG puro. Sem biblioteca: menos peso, zero dependência para manter. */
function Rosca({ fatias, total }: { fatias: { valor: number; cor: string; rotulo: string }[]; total: number }) {
  const R = 70, C = 2 * Math.PI * R
  let acc = 0
  return (
    <div className="rosca-wrap">
      <svg viewBox="0 0 180 180" className="rosca" role="img" aria-label="Composição das unidades por fase">
        <circle cx="90" cy="90" r={R} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="26" />
        {fatias.map((f, i) => {
          const frac = total > 0 ? f.valor / total : 0
          const dash = `${C * frac} ${C * (1 - frac)}`
          const off = C * (0.25 - acc)
          acc += frac
          return (
            <circle key={i} cx="90" cy="90" r={R} fill="none" stroke={f.cor} strokeWidth="26"
              strokeDasharray={dash} strokeDashoffset={off} strokeLinecap="butt"
              transform="rotate(-90 90 90)" />
          )
        })}
        <text x="90" y="84" textAnchor="middle" className="rosca-num">{total}</text>
        <text x="90" y="104" textAnchor="middle" className="rosca-lbl">unidades</text>
      </svg>
    </div>
  )
}

function Barras({ dados }: { dados: { mes: string; total: number; rep: number; terminal: number; ajuste: number }[] }) {
  const max = Math.max(1, ...dados.map(d => d.total))
  return (
    <div className="barras">
      {dados.map(d => (
        <div key={d.mes} className="barra-col">
          <div className="barra-num">{nf(d.total)}</div>
          <div className="barra-pilha" style={{ height: `${Math.max(6, (d.total / max) * 100)}%` }}>
            <div className="seg seg-rep" style={{ flexGrow: d.rep }} title={`Relógio: ${nf(d.rep)}`} />
            <div className="seg seg-term" style={{ flexGrow: d.terminal }} title={`Terminal: ${nf(d.terminal)}`} />
            <div className="seg seg-aj" style={{ flexGrow: d.ajuste }} title={`Validação: ${nf(d.ajuste)}`} />
          </div>
          <div className="barra-mes">{d.mes}</div>
        </div>
      ))}
    </div>
  )
}

function Cartao({ u }: { u: UnidadeStatus }) {
  const cls = u.fase === 'operando' ? 'ok' : u.fase === 'preparando' ? 'prep' : 'cad'
  const rotulo = u.fase === 'operando' ? 'Operando' : u.fase === 'preparando' ? 'Em preparação' : 'Cadastrada'
  return (
    <article className={`card ${cls}`}>
      <header>
        <span className={`tag ${cls}`}>{rotulo}</span>
        {u.relogios > 0 && <span className="tag relogio">{u.relogios} relógio{u.relogios > 1 ? 's' : ''}</span>}
      </header>
      <h3>{u.nome}</h3>
      <dl>
        <div><dt>Servidores</dt><dd>{u.servidores}</dd></div>
        <div><dt>Setores</dt><dd>{u.setores}</dd></div>
        <div><dt>Escalados</dt><dd>{u.escalados || '—'}</dd></div>
      </dl>
      {u.ativadoEm && <p className="card-pe">Relógio ativado em {formatarData(u.ativadoEm)}</p>}
      {!u.ativadoEm && u.fase === 'cadastrada' && <p className="card-pe">Aguardando escala e equipamento</p>}
    </article>
  )
}

export default async function PainelImplantacao() {
  const p = await obterPainel()

  // ⚠️ SEM DADO, DIZ QUE NÃO SABE — nunca renderiza zeros.
  //
  // `obterPainel` devolve `null` quando o banco não responde. Isso acontece de propósito no
  // BUILD do CI, onde não existe banco: sem este ramo, a pré-renderização (`revalidate = 300`)
  // pendurava e derrubava o build inteiro — o CI ficou vermelho por uma semana por causa disso
  // (ver o comentário em ./dados.ts).
  //
  // 🚨 O ramo devolve uma MENSAGEM, não um painel zerado. "0 unidades operando" é um número, e
  // quem lê acredita nele: seria este painel — que existe para a diretoria acompanhar o avanço —
  // afirmando que a implantação não saiu do lugar. Armadilha 22: nunca relatar o que se calculou
  // como se fosse o que aconteceu. A página se recupera sozinha na revalidação seguinte.
  if (!p) {
    return (
      <>
        <meta httpEquiv="refresh" content="60" />
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#09090b', color: '#a1a1aa', fontFamily: 'system-ui, sans-serif',
          padding: '2rem', textAlign: 'center',
        }}>
          <div>
            <p style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#52525b' }}>
              Secretaria Municipal de Saúde · Marabá / PA
            </p>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#e4e4e7', margin: '0.75rem 0' }}>
              Painel de Implantação
            </h1>
            <p style={{ maxWidth: '32rem', lineHeight: 1.6 }}>
              Os dados não puderam ser carregados agora. Esta página tenta de novo automaticamente
              em um minuto — <strong style={{ color: '#e4e4e7' }}>nenhum número é exibido enquanto
              isso</strong>, para que nada aqui seja lido como resultado real.
            </p>
          </div>
        </div>
      </>
    )
  }

  const t = p.totais
  const avanco = pct(t.operando, t.unidades)
  const primeiraAtivacao = p.ativacoes[0]?.data

  return (
    <>
      {/* Mantém um telão vivo sem ninguém apertar F5. */}
      <meta httpEquiv="refresh" content="300" />
      <div className="painel">
        <div className="fundo" aria-hidden="true" />

        <header className="topo">
          <div className="topo-txt">
            <p className="olho">Secretaria Municipal de Saúde · Marabá / PA</p>
            <h1>Implantação do <strong>Ponto Digital</strong></h1>
            <p className="sub">Acompanhamento em tempo real da chegada do SisEscala às unidades de saúde do município.</p>
          </div>
          <div className="selo">
            <div className="selo-num">{avanco}<span>%</span></div>
            <div className="selo-lbl">das unidades<br />cadastradas operando</div>
          </div>
        </header>

        <section className="kpis">
          {[
            { n: t.operando, l: 'Unidades operando', s: `de ${t.unidades} cadastradas`, c: 'a' },
            { n: t.relogios, l: 'Relógios ativos', s: primeiraAtivacao ? `desde ${formatarData(primeiraAtivacao)}` : '—', c: 'b' },
            { n: t.escalados, l: 'Servidores escalados', s: `de ${nf(t.servidores)} no cadastro`, c: 'c' },
            { n: nf(t.afd), l: 'Registros coletados', s: 'do arquivo-fonte assinado, desde jun/2026', c: 'd' },
          ].map((k, i) => (
            <div key={i} className={`kpi kpi-${k.c}`}>
              <div className="kpi-num">{k.n}</div>
              <div className="kpi-lbl">{k.l}</div>
              <div className="kpi-sub">{k.s}</div>
            </div>
          ))}
        </section>

        <section className="grade">
          <div className="bloco">
            <h2>Avanço da implantação</h2>
            <div className="progresso">
              <div className="p-seg p-ok" style={{ width: `${pct(t.operando, t.unidades)}%` }} />
              <div className="p-seg p-prep" style={{ width: `${pct(t.preparando, t.unidades)}%` }} />
              <div className="p-seg p-cad" style={{ width: `${pct(t.cadastradas, t.unidades)}%` }} />
            </div>
            <ul className="legenda">
              <li><i className="c-ok" /> <b>{t.operando}</b> operando <span>escala + relógio</span></li>
              <li><i className="c-prep" /> <b>{t.preparando}</b> em preparação <span>escala montada</span></li>
              <li><i className="c-cad" /> <b>{t.cadastradas}</b> cadastradas <span>a implantar</span></li>
            </ul>
            <Rosca total={t.unidades} fatias={[
              { valor: t.operando, cor: '#22d3ee', rotulo: 'Operando' },
              { valor: t.preparando, cor: '#a78bfa', rotulo: 'Preparação' },
              { valor: t.cadastradas, cor: 'rgba(255,255,255,.18)', rotulo: 'Cadastradas' },
            ]} />
          </div>

          <div className="bloco">
            <h2>Registros de ponto por mês</h2>
            <p className="bloco-sub">O salto mostra a entrada dos relógios: a coleta automática passa a responder por boa parte do volume.</p>
            <Barras dados={p.marcacoesPorMes} />
            <ul className="legenda linha">
              <li><i className="c-rep" /> Relógio de ponto</li>
              <li><i className="c-term" /> Terminal</li>
              <li><i className="c-aj" /> Validação do coordenador</li>
            </ul>
          </div>
        </section>

        <section className="bloco largo">
          <h2>Cronograma</h2>
          <div className="linha-tempo">
            <div className="marco feito">
              <div className="ponto" />
              <div className="marco-txt">
                <span className="marco-data">{primeiraAtivacao ? formatarData(primeiraAtivacao) : '—'}</span>
                <strong>Primeiro relógio em operação</strong>
                <p>Início da coleta automática do arquivo-fonte assinado.</p>
              </div>
            </div>
            <div className="marco atual">
              <div className="ponto" />
              <div className="marco-txt">
                <span className="marco-data">agora</span>
                <strong>{t.operando} unidades operando · {t.relogios} relógios</strong>
                <p>{nf(t.afd)} registros coletados no período e {nf(t.sincOk)} sincronizações concluídas.</p>
              </div>
            </div>
            {MARCOS.map(m => (
              <div key={m.data} className="marco">
                <div className="ponto" />
                <div className="marco-txt">
                  <span className="marco-data">{formatarData(m.data)}</span>
                  <strong>{m.titulo}</strong>
                  <p>{m.texto}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {p.ranking.length > 0 && (
          <section className="bloco largo">
            <h2>Ranking de uso <span className="cont">competência atual</span></h2>
            <p className="bloco-sub">Unidades ordenadas pelo volume de registros de ponto no mês. <strong>Adesão</strong> é a fatia dos servidores escalados que efetivamente registrou ponto.</p>
            <ol className="rank">
              {p.ranking.slice(0, 12).map((u: UsoUnidade, i: number) => {
                const maxR = p.ranking[0].registros || 1
                return (
                  <li key={u.nome} className={i < 3 ? 'top' : ''}>
                    <span className="pos">{i + 1}</span>
                    <div className="rank-corpo">
                      <div className="rank-topo">
                        <strong>{u.nome}</strong>
                        <span className="rank-n">{nf(u.registros)} <i>registros</i></span>
                      </div>
                      <div className="rank-barra"><span style={{ width: `${Math.max(3, (u.registros / maxR) * 100)}%` }} /></div>
                      <div className="rank-pe">
                        {u.servidoresAtivos} servidor{u.servidoresAtivos === 1 ? '' : 'es'} registrando
                        {u.escalados > 0 && <> · <b>{u.adesao}%</b> de adesão</>}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>
        )}

        <section className="bloco largo">
          <h2>Unidades <span className="cont">{t.unidades}</span></h2>
          <div className="cards">
            {p.unidades.map(u => <Cartao key={u.nome} u={u} />)}
          </div>
        </section>

        <footer className="rodape">
          <p><strong>SisEscala</strong> · Secretaria Municipal de Saúde de Marabá</p>
          <p>Dados lidos direto do sistema. Atualizado em {formatarDataHora(p.atualizadoEm)} · a página se atualiza sozinha a cada 5 minutos.</p>
          <p className="nota">Os números contam apenas o período da implantação (a partir de junho/2026). Os {nf(t.afdHerdado)} registros históricos que vieram dentro dos equipamentos reaproveitados são preservados no sistema, mas não entram nesta contagem — não são resultado do projeto.</p>
          <p className="nota">Painel de acompanhamento gerencial. Exibe apenas números agregados — nenhuma informação individual de servidor.</p>
        </footer>
      </div>

      <style>{`
        .painel{--bg:#070b18;--txt:#eef2ff;--dim:#94a3b8;position:relative;min-height:100vh;
          background:var(--bg);color:var(--txt);padding:clamp(20px,4vw,56px);overflow-x:hidden;
          font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
        .fundo{position:fixed;inset:0;pointer-events:none;z-index:0;
          background:radial-gradient(60rem 40rem at 12% -10%,rgba(34,211,238,.20),transparent 60%),
                     radial-gradient(50rem 36rem at 92% 8%,rgba(167,139,250,.18),transparent 60%),
                     radial-gradient(46rem 34rem at 50% 108%,rgba(236,72,153,.14),transparent 60%)}
        .painel>*{position:relative;z-index:1}
        .topo{display:flex;flex-wrap:wrap;gap:28px;align-items:center;justify-content:space-between;margin-bottom:44px}
        .olho{font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#22d3ee;margin:0 0 10px}
        .topo h1{margin:0;font-size:clamp(30px,5.2vw,58px);line-height:1.04;font-weight:800;letter-spacing:-.03em}
        .topo h1 strong{background:linear-gradient(100deg,#22d3ee,#a78bfa 55%,#f472b6);
          -webkit-background-clip:text;background-clip:text;color:transparent}
        .sub{margin:14px 0 0;color:var(--dim);font-size:clamp(14px,1.6vw,17px);max-width:56ch;line-height:1.55}
        .selo{flex:0 0 auto;text-align:center;padding:22px 30px;border-radius:24px;
          background:linear-gradient(150deg,rgba(34,211,238,.16),rgba(167,139,250,.10));
          border:1px solid rgba(34,211,238,.32);box-shadow:0 18px 50px -22px rgba(34,211,238,.6)}
        .selo-num{font-size:clamp(42px,7vw,68px);font-weight:800;line-height:1;letter-spacing:-.04em;color:#22d3ee}
        .selo-num span{font-size:.44em;margin-left:2px}
        .selo-lbl{margin-top:8px;font-size:12px;font-weight:700;color:var(--dim);line-height:1.4;text-transform:uppercase;letter-spacing:.08em}
        .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:26px}
        .kpi{padding:24px;border-radius:20px;background:rgba(255,255,255,.045);
          border:1px solid rgba(255,255,255,.10);backdrop-filter:blur(8px);position:relative;overflow:hidden}
        .kpi::before{content:"";position:absolute;inset:0 0 auto 0;height:3px}
        .kpi-a::before{background:linear-gradient(90deg,#22d3ee,#0ea5e9)}
        .kpi-b::before{background:linear-gradient(90deg,#a78bfa,#8b5cf6)}
        .kpi-c::before{background:linear-gradient(90deg,#34d399,#10b981)}
        .kpi-d::before{background:linear-gradient(90deg,#fbbf24,#f472b6)}
        .kpi-num{font-size:clamp(30px,4vw,44px);font-weight:800;letter-spacing:-.03em;line-height:1}
        .kpi-lbl{margin-top:8px;font-size:13px;font-weight:700}
        .kpi-sub{margin-top:3px;font-size:12px;color:var(--dim)}
        .grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;margin-bottom:16px}
        .bloco{padding:26px;border-radius:22px;background:rgba(255,255,255,.045);
          border:1px solid rgba(255,255,255,.10);backdrop-filter:blur(8px)}
        .bloco.largo{margin-bottom:16px}
        .bloco h2{margin:0 0 4px;font-size:17px;font-weight:800;letter-spacing:-.01em}
        .bloco h2 .cont{margin-left:8px;font-size:13px;color:var(--dim);font-weight:700}
        .bloco-sub{margin:0 0 18px;font-size:13px;color:var(--dim);line-height:1.5}
        .progresso{display:flex;height:16px;border-radius:99px;overflow:hidden;background:rgba(255,255,255,.07);margin:18px 0 16px}
        .p-seg{transition:width .5s}
        .p-ok{background:linear-gradient(90deg,#22d3ee,#0ea5e9)}
        .p-prep{background:linear-gradient(90deg,#a78bfa,#8b5cf6)}
        .p-cad{background:rgba(255,255,255,.14)}
        .legenda{list-style:none;margin:0;padding:0;display:grid;gap:9px;font-size:13px}
        .legenda.linha{display:flex;flex-wrap:wrap;gap:16px;margin-top:16px}
        .legenda li{display:flex;align-items:center;gap:9px;color:var(--dim)}
        .legenda b{color:var(--txt);font-size:15px;min-width:2ch}
        .legenda span{color:#64748b;font-size:12px}
        .legenda i{width:11px;height:11px;border-radius:4px;flex:0 0 auto}
        .c-ok{background:#22d3ee}.c-prep{background:#a78bfa}.c-cad{background:rgba(255,255,255,.2)}
        .c-rep{background:#22d3ee}.c-term{background:#a78bfa}.c-aj{background:#fbbf24}
        .rosca-wrap{display:flex;justify-content:center;margin-top:20px}
        .rosca{width:min(190px,60%);height:auto}
        .rosca-num{fill:#eef2ff;font-size:34px;font-weight:800;letter-spacing:-.03em}
        .rosca-lbl{fill:#94a3b8;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em}
        .barras{display:flex;align-items:flex-end;gap:clamp(10px,3vw,26px);height:210px;padding-top:12px}
        .barra-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
        .barra-num{font-size:13px;font-weight:800;margin-bottom:8px}
        .barra-pilha{width:100%;max-width:74px;display:flex;flex-direction:column-reverse;
          border-radius:12px;overflow:hidden;min-height:8px;box-shadow:0 12px 30px -14px rgba(34,211,238,.7)}
        .seg{min-height:0}
        .seg-rep{background:linear-gradient(180deg,#22d3ee,#0ea5e9)}
        .seg-term{background:linear-gradient(180deg,#a78bfa,#8b5cf6)}
        .seg-aj{background:linear-gradient(180deg,#fbbf24,#f59e0b)}
        .barra-mes{margin-top:10px;font-size:12px;color:var(--dim);font-weight:700;text-transform:uppercase;letter-spacing:.06em}
        .linha-tempo{display:grid;gap:0;margin-top:18px}
        .marco{display:flex;gap:18px;padding-bottom:26px;position:relative}
        .marco:not(:last-child)::after{content:"";position:absolute;left:7px;top:20px;bottom:0;width:2px;background:rgba(255,255,255,.12)}
        .ponto{width:16px;height:16px;border-radius:99px;flex:0 0 auto;margin-top:4px;
          background:rgba(255,255,255,.16);border:2px solid rgba(255,255,255,.25)}
        .marco.feito .ponto{background:#22d3ee;border-color:#22d3ee;box-shadow:0 0 0 5px rgba(34,211,238,.18)}
        .marco.atual .ponto{background:#f472b6;border-color:#f472b6;box-shadow:0 0 0 5px rgba(244,114,182,.22)}
        .marco-data{display:block;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#22d3ee;margin-bottom:3px}
        .marco.atual .marco-data{color:#f472b6}
        .marco-txt strong{display:block;font-size:16px;font-weight:800;letter-spacing:-.01em}
        .marco-txt p{margin:5px 0 0;font-size:13px;color:var(--dim);line-height:1.5;max-width:62ch}
        .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin-top:18px}
        .card{padding:18px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09)}
        .card.ok{border-color:rgba(34,211,238,.34);background:linear-gradient(160deg,rgba(34,211,238,.11),rgba(255,255,255,.03))}
        .card.prep{border-color:rgba(167,139,250,.30)}
        .card header{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
        .tag{font-size:10px;font-weight:800;padding:4px 9px;border-radius:99px;text-transform:uppercase;letter-spacing:.08em}
        .tag.ok{background:rgba(34,211,238,.20);color:#67e8f9}
        .tag.prep{background:rgba(167,139,250,.20);color:#c4b5fd}
        .tag.cad{background:rgba(255,255,255,.09);color:#94a3b8}
        .tag.relogio{background:rgba(52,211,153,.16);color:#6ee7b7}
        .card h3{margin:0 0 12px;font-size:14px;font-weight:700;line-height:1.35}
        .card dl{display:flex;gap:16px;margin:0}
        .card dl div{display:flex;flex-direction:column}
        .card dt{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.07em;font-weight:700}
        .card dd{margin:2px 0 0;font-size:18px;font-weight:800;letter-spacing:-.02em}
        .card-pe{margin:12px 0 0;font-size:11px;color:var(--dim);padding-top:10px;border-top:1px solid rgba(255,255,255,.07)}
        .rank{list-style:none;margin:18px 0 0;padding:0;display:grid;gap:10px;counter-reset:r}
        .rank li{display:flex;gap:14px;align-items:flex-start;padding:14px 16px;border-radius:14px;
          background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08)}
        .rank li.top{background:linear-gradient(100deg,rgba(34,211,238,.12),rgba(255,255,255,.03));
          border-color:rgba(34,211,238,.28)}
        .pos{flex:0 0 auto;width:30px;height:30px;border-radius:10px;display:grid;place-items:center;
          font-size:14px;font-weight:800;background:rgba(255,255,255,.08);color:#94a3b8}
        .rank li.top .pos{background:linear-gradient(140deg,#22d3ee,#0ea5e9);color:#052030;
          box-shadow:0 8px 20px -8px rgba(34,211,238,.9)}
        .rank-corpo{flex:1;min-width:0}
        .rank-topo{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;justify-content:space-between}
        .rank-topo strong{font-size:14px;font-weight:700;line-height:1.3}
        .rank-n{font-size:15px;font-weight:800;white-space:nowrap;color:#67e8f9}
        .rank-n i{font-size:10px;font-weight:700;color:#64748b;font-style:normal;text-transform:uppercase;letter-spacing:.07em}
        .rank-barra{height:7px;border-radius:99px;background:rgba(255,255,255,.07);margin:9px 0 7px;overflow:hidden}
        .rank-barra span{display:block;height:100%;border-radius:99px;
          background:linear-gradient(90deg,#22d3ee,#a78bfa)}
        .rank-pe{font-size:11px;color:var(--dim)}
        .rank-pe b{color:#6ee7b7}
        .rodape{margin-top:34px;padding-top:22px;border-top:1px solid rgba(255,255,255,.09);
          font-size:12px;color:var(--dim);display:grid;gap:5px}
        .rodape strong{color:var(--txt)}
        .rodape .nota{color:#64748b;margin-top:6px}
        @media print{.painel{background:#fff;color:#0f172a}.fundo{display:none}}
      `}</style>
    </>
  )
}
