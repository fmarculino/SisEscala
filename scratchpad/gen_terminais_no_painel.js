/**
 * Acrescenta o TERMINAL LOCAL ao painel publico de implantacao.
 *
 * Por que um gerador e nao edicao a mao: os dois arquivos sao CRLF e as substituicoes precisam
 * casar exatamente. O script ABORTA se qualquer trecho nao aparecer exatamente uma vez (mesmo
 * padrao dos demais scratchpad/gen_*.js). Rodar duas vezes tambem aborta - o alvo ja mudou.
 */
const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const DADOS = path.join(RAIZ, 'src/app/implantacao/dados.ts')
const PAGE = path.join(RAIZ, 'src/app/implantacao/page.tsx')

/** Converte o LF do literal para o EOL do arquivo alvo - senao a substituicao vira no-op. */
function comEol(txt, eol) { return txt.replace(/\r?\n/g, eol) }

function trocar(txt, eol, de, para, rotulo) {
  const alvo = comEol(de, eol)
  const n = txt.split(alvo).length - 1
  if (n !== 1) throw new Error(`[${rotulo}] esperava 1 ocorrencia, achou ${n}`)
  return txt.replace(alvo, () => comEol(para, eol))
}

function eolDe(txt) { return txt.includes('\r\n') ? '\r\n' : '\n' }

// ============================================================================
// dados.ts
// ============================================================================
let d = fs.readFileSync(DADOS, 'utf8')
const eolD = eolDe(d)
if (eolD !== '\r\n') throw new Error('dados.ts deixou de ser CRLF - confira antes de seguir')

d = trocar(d, eolD, `  temRelogio: boolean
  relogios: number
  ativadoEm: string | null
  ultimoContato: string | null`, `  temRelogio: boolean
  relogios: number
  /**
   * Terminal local conta como PONTO DE MARCACAO, igual ao relogio.
   *
   * ⚠️ Unidade pequena (menos de ~10 servidores) recebe terminal e nao vai receber relogio.
   * Sem conta-lo aqui, ela fica para sempre em "em preparacao" num painel que a diretoria le
   * como atraso da implantacao - enquanto o ponto dela ja esta sendo registrado.
   */
  temTerminal: boolean
  terminais: number
  /** Primeira ativacao de QUALQUER ponto de marcacao da unidade - relogio ou terminal. */
  ativadoEm: string | null
  ultimoContato: string | null`, 'interface UnidadeStatus')

d = trocar(d, eolD,
  `  /** operando = tem escala E relógio · preparando = tem escala · cadastrada = só cadastro */`,
  `  /**
   * operando = tem escala E ponto de marcação (relógio OU terminal) · preparando = tem escala ·
   * cadastrada = só cadastro
   */`,
  'doc da fase')

d = trocar(d, eolD, `    setores: number
    relogios: number
    escalados: number`, `    setores: number
    relogios: number
    /** Contado À PARTE do relógio: são equipamentos diferentes e o painel não os funde. */
    terminais: number
    escalados: number`, 'totais')

d = trocar(d, eolD,
  `  ativacoes: { data: string; unidade: string }[]`,
  `  ativacoes: { data: string; unidade: string; tipo: 'relogio' | 'terminal' }[]`,
  'tipo em ativacoes')

d = trocar(d, eolD,
  `  const [{ data: unidades }, { data: setores }, { data: servidores }, { data: disp }] = await Promise.all([`,
  `  const [{ data: unidades }, { data: setores }, { data: servidores }, { data: disp }, { data: terms }] =
    await Promise.all([`,
  'destructure da consulta')

d = trocar(d, eolD,
  `    supabase.from('dispositivos_rep').select('id, unidade_id, ativo, created_at, ultimo_contato_em'),
  ])`,
  `    supabase.from('dispositivos_rep').select('id, unidade_id, ativo, created_at, ultimo_contato_em'),
    Promise.resolve({
      data: await todas(supabase, 'terminais_locais', 'id, unidade_id, ativo, created_at, ultimo_contato_em'),
    }),
  ])`,
  'consulta de terminais')

d = trocar(d, eolD, `  const dispPorUn = new Map<string, any[]>()
  for (const d of disp || []) {
    if (d.ativo === false) continue
    if (!dispPorUn.has(d.unidade_id)) dispPorUn.set(d.unidade_id, [])
    dispPorUn.get(d.unidade_id)!.push(d)
  }`, `  const dispPorUn = new Map<string, any[]>()
  for (const d of disp || []) {
    if (d.ativo === false) continue
    if (!dispPorUn.has(d.unidade_id)) dispPorUn.set(d.unidade_id, [])
    dispPorUn.get(d.unidade_id)!.push(d)
  }

  // Mesmo tratamento para o terminal local. \`ativo = false\` é a revogação de verdade nas duas
  // tabelas — em \`terminais_locais\` é o que derruba a sessão do navegador já aberta, na marcação
  // seguinte —, então terminal desativado não sustenta uma unidade como "operando".
  const termPorUn = new Map<string, any[]>()
  for (const t of terms || []) {
    if (t.ativo === false) continue
    if (!termPorUn.has(t.unidade_id)) termPorUn.set(t.unidade_id, [])
    termPorUn.get(t.unidade_id)!.push(t)
  }`, 'mapa de terminais por unidade')

d = trocar(d, eolD, `      const ds = dispPorUn.get(u.id) || []
      const temRelogio = ds.length > 0
      const temEscala = comEscala.has(u.id)
      return {
        nome: u.nome,
        temRelogio,
        relogios: ds.length,
        ativadoEm: ds.length ? ds.map(d => d.created_at).sort()[0] : null,
        ultimoContato: ds.length
          ? ds.map(d => d.ultimo_contato_em).filter(Boolean).sort().slice(-1)[0] || null
          : null,`, `      const ds = dispPorUn.get(u.id) || []
      const ts = termPorUn.get(u.id) || []
      // Relógio e terminal são equivalentes para a pergunta que este painel faz ("esta unidade
      // já registra ponto?"). O que muda entre eles é o equipamento, não o fato — por isso a
      // data de ativação e o último contato saem dos dois juntos.
      const pontos = [...ds, ...ts]
      const temRelogio = ds.length > 0
      const temEscala = comEscala.has(u.id)
      return {
        nome: u.nome,
        temRelogio,
        relogios: ds.length,
        temTerminal: ts.length > 0,
        terminais: ts.length,
        ativadoEm: pontos.length ? pontos.map(p => p.created_at).sort()[0] : null,
        ultimoContato: pontos.length
          ? pontos.map(p => p.ultimo_contato_em).filter(Boolean).sort().slice(-1)[0] || null
          : null,`, 'montagem da UnidadeStatus')

d = trocar(d, eolD,
  `        fase: temRelogio && temEscala ? 'operando' : temEscala ? 'preparando' : 'cadastrada',`,
  `        fase: pontos.length > 0 && temEscala ? 'operando' : temEscala ? 'preparando' : 'cadastrada',`,
  'regra da fase')

d = trocar(d, eolD, `  const ativacoes = (disp || [])
    .filter((d: any) => d.ativo !== false && d.created_at)
    .map((d: any) => ({
      data: String(d.created_at).slice(0, 10),
      unidade: (unidades || []).find((u: any) => u.id === d.unidade_id)?.nome || '—',
    }))
    .sort((a, b) => a.data.localeCompare(b.data))`,
`  const nomeUnidade = (id: string) => (unidades || []).find((u: any) => u.id === id)?.nome || '—'

  // ⚠️ Relógios e terminais na MESMA lista, com \`tipo\`: o primeiro marco do cronograma lê a
  // primeira linha daqui e se rotula por ele. Deixar o terminal de fora faria a página anunciar
  // "primeiro relógio em operação" no dia em que a primeira unidade a entrar tivesse só terminal.
  const ativacoes = [
    ...(disp || [])
      .filter((d: any) => d.ativo !== false && d.created_at)
      .map((d: any) => ({
        data: String(d.created_at).slice(0, 10),
        unidade: nomeUnidade(d.unidade_id),
        tipo: 'relogio' as const,
      })),
    ...(terms || [])
      .filter((t: any) => t.ativo !== false && t.created_at)
      .map((t: any) => ({
        data: String(t.created_at).slice(0, 10),
        unidade: nomeUnidade(t.unidade_id),
        tipo: 'terminal' as const,
      })),
  ].sort((a, b) => a.data.localeCompare(b.data))`, 'lista de ativacoes')

d = trocar(d, eolD,
  `      relogios: (disp || []).filter((d: any) => d.ativo !== false).length,`,
  `      relogios: (disp || []).filter((d: any) => d.ativo !== false).length,
      terminais: (terms || []).filter((t: any) => t.ativo !== false).length,`,
  'total de terminais')

fs.writeFileSync(DADOS, d)

// ============================================================================
// page.tsx
// ============================================================================
let p = fs.readFileSync(PAGE, 'utf8')
const eolP = eolDe(p)
if (eolP !== '\r\n') throw new Error('page.tsx deixou de ser CRLF - confira antes de seguir')

p = trocar(p, eolP,
  `function pct(a: number, b: number) { return b > 0 ? Math.round((a / b) * 100) : 0 }`,
  `function pct(a: number, b: number) { return b > 0 ? Math.round((a / b) * 100) : 0 }
/** "1 terminal" / "2 terminais" — o painel é lido por gente de fora do projeto. */
function plural(n: number, um: string, varios: string) { return \`\${n} \${n === 1 ? um : varios}\` }`,
  'helper plural')

p = trocar(p, eolP,
  `function Cartao({ u }: { u: UnidadeStatus }) {
  const cls = u.fase === 'operando' ? 'ok' : u.fase === 'preparando' ? 'prep' : 'cad'
  const rotulo = u.fase === 'operando' ? 'Operando' : u.fase === 'preparando' ? 'Em preparação' : 'Cadastrada'`,
  `function Cartao({ u }: { u: UnidadeStatus }) {
  const cls = u.fase === 'operando' ? 'ok' : u.fase === 'preparando' ? 'prep' : 'cad'
  const rotulo = u.fase === 'operando' ? 'Operando' : u.fase === 'preparando' ? 'Em preparação' : 'Cadastrada'
  // ⚠️ Na unidade que só tem terminal, "Relógio ativado em" descreveria um equipamento que não
  // existe ali — e é justamente o caso das unidades pequenas, que não vão receber relógio.
  const ativou = u.relogios > 0 && u.terminais > 0 ? 'Ponto de marcação ativado'
    : u.relogios > 0 ? 'Relógio ativado'
    : 'Terminal ativado'`,
  'rotulo do pe do cartao')

p = trocar(p, eolP,
  `        {u.relogios > 0 && <span className="tag relogio">{u.relogios} relógio{u.relogios > 1 ? 's' : ''}</span>}`,
  `        {u.relogios > 0 && <span className="tag relogio">{plural(u.relogios, 'relógio', 'relógios')}</span>}
        {u.terminais > 0 && <span className="tag terminal">{plural(u.terminais, 'terminal', 'terminais')}</span>}`,
  'tag de terminal no cartao')

p = trocar(p, eolP,
  `      {u.ativadoEm && <p className="card-pe">Relógio ativado em {formatarData(u.ativadoEm)}</p>}`,
  `      {u.ativadoEm && <p className="card-pe">{ativou} em {formatarData(u.ativadoEm)}</p>}`,
  'pe do cartao')

p = trocar(p, eolP,
  `            { n: t.relogios, l: 'Relógios ativos', s: primeiraAtivacao ? \`desde \${formatarData(primeiraAtivacao)}\` : '—', c: 'b' },`,
  `            // ⚠️ O número grande é a SOMA — é ele que responde "quantos pontos de marcação
            // existem". A linha de baixo separa os dois: terminal não é relógio, não tem AFD
            // assinado, e fundi-los num rótulo só esconderia isso de quem lê o painel.
            {
              n: t.relogios + t.terminais,
              l: 'Pontos de marcação',
              s: \`\${plural(t.relogios, 'relógio', 'relógios')} · \${plural(t.terminais, 'terminal', 'terminais')}\`,
              c: 'b',
            },`,
  'kpi de pontos de marcacao')

p = trocar(p, eolP,
  `            <h2>Avanço da implantação</h2>`,
  `            <h2>Avanço da implantação</h2>
            <p className="bloco-sub">Uma unidade entra em <strong>operando</strong> quando tem escala montada e um ponto de marcação instalado — relógio de ponto ou terminal. As unidades menores recebem terminal; o registro do ponto é o mesmo.</p>`,
  'explicacao do avanco')

p = trocar(p, eolP,
  `              <li><i className="c-ok" /> <b>{t.operando}</b> operando <span>escala + relógio</span></li>`,
  `              <li><i className="c-ok" /> <b>{t.operando}</b> operando <span>escala + ponto de marcação</span></li>`,
  'legenda do avanco')

p = trocar(p, eolP,
  `  const primeiraAtivacao = p.ativacoes[0]?.data`,
  `  // O registro inteiro, não só a data: o primeiro marco do cronograma se rotula pelo \`tipo\`.
  const primeiraAtivacao = p.ativacoes[0]`,
  'primeiraAtivacao')

p = trocar(p, eolP,
  `                <span className="marco-data">{primeiraAtivacao ? formatarData(primeiraAtivacao) : '—'}</span>`,
  `                <span className="marco-data">{primeiraAtivacao ? formatarData(primeiraAtivacao.data) : '—'}</span>`,
  'data do primeiro marco')

p = trocar(p, eolP,
  `                <strong>Primeiro relógio em operação</strong>
                <p>Início da coleta automática do arquivo-fonte assinado.</p>`,
  `                <strong>{primeiraAtivacao?.tipo === 'terminal' ? 'Primeiro terminal em operação' : 'Primeiro relógio em operação'}</strong>
                <p>{primeiraAtivacao?.tipo === 'terminal'
                  ? 'Início do registro digital de ponto nas unidades.'
                  : 'Início da coleta automática do arquivo-fonte assinado.'}</p>`,
  'primeiro marco')

p = trocar(p, eolP,
  `                <strong>{t.operando} unidades operando · {t.relogios} relógios</strong>`,
  `                <strong>{t.operando} unidades operando · {plural(t.relogios, 'relógio', 'relógios')} e {plural(t.terminais, 'terminal', 'terminais')}</strong>`,
  'marco atual')

p = trocar(p, eolP,
  `        .tag.relogio{background:rgba(52,211,153,.16);color:#6ee7b7}`,
  `        .tag.relogio{background:rgba(52,211,153,.16);color:#6ee7b7}
        .tag.terminal{background:rgba(244,114,182,.16);color:#f9a8d4}`,
  'css da tag de terminal')

fs.writeFileSync(PAGE, p)

console.log('ok: dados.ts e page.tsx atualizados')
