/**
 * Lista os códigos de cargo do CSV do RH que ainda não têm cargo correspondente em `cargos`.
 *
 * POR QUE ISTO EXISTE
 *   `cargos` tem 267 linhas, 241 com código (bulk import de 14/07/2026 — provavelmente de uma
 *   exportação parecida com esta). A mesma profissão aparece duas vezes por causa do regime
 *   ("0101 TEC.ENFERM." concursado × "3716 TEC.ENFERM_CONTRATADO" contratado) — isto NÃO é
 *   duplicidade a corrigir: é organização própria do RH pra diferenciar efetivo de contratado
 *   (decisão do usuário, 10/08/2026, revertendo uma primeira leitura minha de que seria fusão).
 *   Cada código continua sendo seu próprio cargo.
 *
 *   A seção "Fusões por nome-base" abaixo é só INFORMATIVA (mostra onde a duplicação por regime
 *   já existe hoje) — não gera proposta de fusão nem é aplicada em lugar nenhum.
 *
 * COMO RODAR
 *   node scratchpad/rh_normalizar_cargos.js
 *   Lê produção só leitura (cargos, cargos_codigos_origem). Gera rh_normalizacao_cargos.json/.md
 *   para revisão — mesmo espírito de rh_mapear_unidades.js.
 */

const fs = require('fs')
const path = require('path')
const { parseCsv, corrigirMojibake } = require('./rh_csv_utils')

const RAIZ = path.resolve(__dirname, '..')
const CSV_PATH = path.join(RAIZ, 'docs', 'Dados Cadastrais - Julho 2026 - SFPRC01M.csv')

// Todas as variações de sufixo de regime encontradas nos dados reais, incluindo os dois erros de
// digitação da fonte ("_CONTRATRADO", "_ contratado" com espaço solto).
const SUFIXOS_REGIME = [
  /\s*_\s*CONTRATRADO\s*$/i,
  /\s*_\s*CONTRATADO\s*$/i,
  /\s*-\s*CONTRATADO\s*$/i,
  /\s*_\s*contratado\s*$/i,
]

function nomeBase(nomeCompleto) {
  let n = nomeCompleto.trim()
  for (const re of SUFIXOS_REGIME) {
    if (re.test(n)) { n = n.replace(re, '').trim(); break }
  }
  return n.toUpperCase()
}

async function main() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8')
  const rows = parseCsv(raw)
  const header = rows[0]
  const idx = {}
  header.forEach((h, i) => { idx[h.trim()] = i })
  const data = rows.slice(1).filter(r => r.length === header.length && r.some(f => f !== ''))
  const ativos = data.filter(r => r[idx['Situacao']].trim() !== 'Demitido')

  const cargosCsv = new Map() // codigo -> { nomeCompleto, qtd }
  for (const r of ativos) {
    const raw2 = corrigirMojibake(r[idx['Cargo']].trim())
    const m = raw2.match(/^(\d+)\s+(.*)$/)
    const codigo = m ? m[1] : null
    const nomeCompleto = m ? m[2].trim() : raw2
    if (!codigo) continue
    if (!cargosCsv.has(codigo)) cargosCsv.set(codigo, { nomeCompleto, qtd: 0 })
    cargosCsv.get(codigo).qtd += 1
  }

  const env = fs.readFileSync(path.join(RAIZ, '.env.production'), 'utf8')
  const g = k => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : null }
  const U = g('NEXT_PUBLIC_SUPABASE_URL')
  const K = g('SUPABASE_SERVICE_ROLE_KEY')
  const H = { apikey: K, Authorization: 'Bearer ' + K }

  const rCargos = await fetch(`${U}/rest/v1/cargos?select=id,nome,codigo,ativo&order=nome`, { headers: H })
  if (!rCargos.ok) throw new Error(`GET cargos -> ${rCargos.status} ${await rCargos.text()}`)
  const cargos = await rCargos.json()

  const rMap = await fetch(`${U}/rest/v1/cargos_codigos_origem?select=codigo,cargo_id&sistema_origem=eq.SFPRC01M`, { headers: H })
  if (!rMap.ok) throw new Error(`GET cargos_codigos_origem -> ${rMap.status} ${await rMap.text()}`)
  const mapeamentoExistente = await rMap.json()
  const codigosJaMapeados = new Set(mapeamentoExistente.map(m => m.codigo))

  // -------------------------------------------------------------------------
  // 1. Fusões entre cargos JÁ cadastrados (mesmo nome-base, código diferente por regime)
  // -------------------------------------------------------------------------
  const porBase = new Map()
  for (const c of cargos) {
    if (!c.ativo) continue
    const base = nomeBase(c.nome)
    if (!porBase.has(base)) porBase.set(base, [])
    porBase.get(base).push(c)
  }

  const fusoes = []
  for (const [base, grupo] of porBase) {
    if (grupo.length < 2) continue
    // Canônico: o que NÃO tem sufixo de regime no nome (o "limpo"); se nenhum ou mais de um, o
    // humano decide — não adivinho.
    const semSufixo = grupo.filter(c => nomeBase(c.nome) === c.nome.trim().toUpperCase())
    fusoes.push({
      nomeBase: base,
      cargos: grupo.map(c => ({ id: c.id, nome: c.nome, codigo: c.codigo })),
      canonicoSugerido: semSufixo.length === 1 ? semSufixo[0] : null,
      ambiguo: semSufixo.length !== 1,
    })
  }

  // -------------------------------------------------------------------------
  // 2. Códigos do CSV sem mapeamento hoje — todos viram cargo novo, um pra um. Sem fusão com
  //    cargo existente (decisão do usuário, 10/08/2026): mesmo que já exista "MEDICO PSIQUIATRA"
  //    concursado, o código "_CONTRATADO" que falta ganha SEU PRÓPRIO cargo, não é apontado pro
  //    concursado — a separação por regime é o ponto, não um problema a resolver.
  // -------------------------------------------------------------------------
  const faltantes = []
  for (const [codigo, { nomeCompleto, qtd }] of cargosCsv) {
    if (codigosJaMapeados.has(codigo)) continue
    faltantes.push({ codigo, nomeCompleto, qtd, acao: 'CRIAR_NOVO' })
  }
  faltantes.sort((a, b) => b.qtd - a.qtd)

  // -------------------------------------------------------------------------
  // Relatório
  // -------------------------------------------------------------------------
  const outJson = path.join(RAIZ, 'scratchpad', 'rh_normalizacao_cargos.json')
  fs.writeFileSync(outJson, JSON.stringify({ fusoes, faltantes }, null, 2))

  const linhas = ['# Códigos de cargo do RH sem cargo correspondente', '',
    `Gerado em ${new Date().toISOString()}.`, '',
    `## Separação por regime já existente hoje — informativo, NÃO é proposta de fusão (${fusoes.length} grupos)`, '',
    'Mostra onde a mesma profissão já tem dois códigos (concursado × contratado) em `cargos`.',
    'Decisão do usuário (10/08/2026): isto é organização do RH, não duplicidade — cada código',
    'continua com seu próprio cargo. Nada aqui é aplicado.', '']
  for (const f of fusoes) {
    linhas.push(`### ${f.nomeBase}`)
    for (const c of f.cargos) {
      linhas.push(`- \`${c.codigo || '(sem código)'}\` ${c.nome}`)
    }
    linhas.push('')
  }

  linhas.push(`## Códigos do CSV sem cargo hoje — todos viram cargo novo (${faltantes.length})`, '',
    '| código | nome no RH | pessoas |',
    '|---|---|---|')
  for (const f of faltantes) {
    linhas.push(`| ${f.codigo} | ${f.nomeCompleto} | ${f.qtd} |`)
  }
  fs.writeFileSync(path.join(RAIZ, 'scratchpad', 'rh_normalizacao_cargos.md'), linhas.join('\n'))

  console.log('Separações por regime já existentes (informativo):', fusoes.length)
  console.log('Códigos faltantes (todos viram cargo novo):', faltantes.length)
  console.log('Pessoas nos códigos faltantes:', faltantes.reduce((s, f) => s + f.qtd, 0))
  console.log('\nArquivos gerados:')
  console.log(' ', outJson)
  console.log(' ', path.join(RAIZ, 'scratchpad', 'rh_normalizacao_cargos.md'))
}

main().catch(e => { console.error('\n✗ ' + (e.stack || e.message)); process.exit(1) })
