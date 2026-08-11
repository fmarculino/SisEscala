/**
 * Propõe o mapeamento Departamento (CSV do RH) -> unidades (SisEscala).
 *
 * POR QUE ISTO EXISTE
 *   O CSV tem 121 valores distintos de Departamento entre os vínculos ativos, e o SisEscala tem
 *   16 unidades cadastradas. A nomenclatura não bate exata quase nunca ("CS ENF. ZEZINHA" vs
 *   "USF ENFERMEIRA ZEZINHA"). Isto aqui PROPÕE o mapeamento por similaridade de palavras -
 *   NÃO aplica nada. Mesmo espírito dos geradores de migration do projeto: gera, um humano revisa.
 *
 * O QUE ELE NÃO FAZ
 *   Não cria unidade, não decide nada sozinho. Grava um relatório (rh_mapeamento_unidades.json e
 *   .md) para revisão em docs/planos/2026-08-10-plano-de-importacao-de-dados-cadastrais-rh.md
 *   § Fase 2. Departamentos sem match viram candidatos a "CRIAR NOVA" - inclusive os cedidos a
 *   outros órgãos (decisão do usuário, 10/08/2026: viram unidade também).
 *
 * COMO RODAR
 *   node scratchpad/rh_mapear_unidades.js
 *   Lê produção só leitura (unidades). Não escreve nada no banco nem no CSV.
 */

const fs = require('fs')
const path = require('path')
const { parseCsv, corrigirMojibake } = require('./rh_csv_utils')

const RAIZ = path.resolve(__dirname, '..')
const CSV_PATH = path.join(RAIZ, 'docs', 'Dados Cadastrais - Julho 2026 - SFPRC01M.csv')

const raw = fs.readFileSync(CSV_PATH, 'utf8')
const rows = parseCsv(raw)
const header = rows[0]
const idx = {}
header.forEach((h, i) => { idx[h.trim()] = i })
const data = rows.slice(1).filter(r => r.length === header.length && r.some(f => f !== ''))
const ativos = data.filter(r => r[idx['Situacao']].trim() !== 'Demitido')

const contagem = new Map()
for (const r of ativos) {
  // corrigirMojibake antes de qualquer coisa: "CAMARA MUNICIPAL DE MARABÃ" (cru) e
  // "CAMARA MUNICIPAL DE MARABÁ" (corrigido) não podem contar como departamentos diferentes.
  const dep = corrigirMojibake(r[idx['Departamento']].trim())
  if (!dep) continue
  contagem.set(dep, (contagem.get(dep) || 0) + 1)
}

// ---------------------------------------------------------------------------
// 2. Unidades de produção (só leitura)
// ---------------------------------------------------------------------------
function normalizar(v) {
  return (v || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acento
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ') // pontuação vira espaço
    .replace(/\s+/g, ' ')
    .trim()
}

// Palavras que só indicam "isto é uma unidade da prefeitura", não identificam QUAL — não contam
// para a similaridade, senão qualquer duas entidades municipais casariam entre si. Lista ajustada
// depois de rodar mais de uma vez e ver os falsos positivos:
//   - sem MARABA/CENTRAL/MUNICIPAL, "Câmara Municipal de Marabá" batia com "Hospital Municipal
//     de Marabá" (MUNICIPAL+MARABA), e "Almoxarifado Central"/"Central de Regulação" batiam com o
//     LACEM ("Laboratório CENTRAL de Marabá") só por CENTRAL — nenhum identifica a unidade certa.
//   - "HOSPITAL" fica DE FORA de propósito: é o único token que sobra em "HOSPITAL MUNICIPAL"
//     (1.025 pessoas, o maior departamento do arquivo) depois de tirar MUNICIPAL, e é ele que
//     aponta pra HMM.
const STOPWORDS = new Set([
  'CS', 'USF', 'UNID', 'UNIDADE', 'S', 'FAM', 'DE', 'DA', 'DO', 'DOS',
  'DAS', 'D', 'DR', 'CENTRO', 'SAUDE', 'ZR', 'ZU', 'MARABA', 'CENTRAL', 'MUNICIPAL',
])

function tokens(nomeNormalizado) {
  return nomeNormalizado.split(' ').filter(t => t.length > 1 && !STOPWORDS.has(t))
}

// Jaccard (interseção / união), não interseção/menor-conjunto: o segundo empatava "HOSPITAL
// MUNICIPAL" (tokens úteis: {HOSPITAL}) contra HMM E contra HMI ao mesmo tempo — os dois têm
// "HOSPITAL" no nome, e dividir pelo menor conjunto (tamanho 1) dava nota máxima pros dois. Jaccard
// penaliza a unidade com token extra que o departamento não menciona (MATERNO, INFANTIL, no caso
// da HMI) e desempata corretamente a favor da HMM.
function similaridade(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0
  const setA = new Set(tokensA)
  const setB = new Set(tokensB)
  let inter = 0
  for (const t of setA) if (setB.has(t)) inter++
  const uniao = setA.size + setB.size - inter
  return inter / uniao
}

async function main() {
  const fs2 = require('fs')
  const env = fs2.readFileSync(path.join(RAIZ, '.env.production'), 'utf8')
  const g = k => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : null }
  const U = g('NEXT_PUBLIC_SUPABASE_URL')
  const K = g('SUPABASE_SERVICE_ROLE_KEY')
  const H = { apikey: K, Authorization: 'Bearer ' + K }

  const r = await fetch(`${U}/rest/v1/unidades?select=id,nome&order=nome`, { headers: H })
  if (!r.ok) throw new Error(`GET unidades -> ${r.status} ${await r.text()}`)
  const unidades = await r.json()

  const unidadesComTokens = unidades.map(u => ({ ...u, tokens: tokens(normalizar(u.nome)) }))

  // Com Jaccard, um match "perfeito na prática" (ex.: MATERNO INFANTIL contra HMI, que tem a
  // palavra HOSPITAL a mais no nome oficial) fica em 0.67, não 1.0 — por isso o corte de EXATO
  // desceu para 0.6, e o de PROVAVEL para 0.3 (ainda cobre casos como ZEZINHA, onde só metade
  // dos tokens bate por abreviação: ENF. vs ENFERMEIRA).
  const LIMIAR_EXATO = 0.6
  const LIMIAR_MATCH = 0.3
  const propostas = []

  for (const [departamento, qtd] of [...contagem.entries()].sort((a, b) => b[1] - a[1])) {
    if (departamento === 'Atualizar') {
      propostas.push({ departamento, qtd, acao: 'DESCARTAR', motivo: 'placeholder de dado incompleto na fonte, nao e nome de unidade', candidatos: [] })
      continue
    }

    const depTokens = tokens(normalizar(departamento))
    const ranking = unidadesComTokens
      .map(u => ({ unidade_id: u.id, unidade_nome: u.nome, score: similaridade(depTokens, u.tokens) }))
      .sort((a, b) => b.score - a.score)
      .filter(c => c.score > 0)
      .slice(0, 3)

    const melhor = ranking[0]
    if (melhor && melhor.score >= LIMIAR_MATCH) {
      propostas.push({
        departamento, qtd,
        acao: melhor.score >= LIMIAR_EXATO ? 'MATCH_EXATO' : 'MATCH_PROVAVEL',
        unidade_id: melhor.unidade_id,
        unidade_nome: melhor.unidade_nome,
        score: Number(melhor.score.toFixed(2)),
        candidatos: ranking,
      })
    } else {
      propostas.push({
        departamento, qtd,
        acao: 'CRIAR_NOVA',
        candidatos: ranking, // pode ter candidato fraco (< limiar) — fica visível para revisão
      })
    }
  }

  const outJson = path.join(RAIZ, 'scratchpad', 'rh_mapeamento_unidades.json')
  fs.writeFileSync(outJson, JSON.stringify(propostas, null, 2))

  const outMd = path.join(RAIZ, 'scratchpad', 'rh_mapeamento_unidades.md')
  const linhas = ['# Proposta de mapeamento Departamento -> unidade', '',
    `Gerado em ${new Date().toISOString()}. ${propostas.length} departamentos distintos (vínculos ativos).`, '',
    '| Departamento (CSV) | pessoas | ação proposta | unidade | score |',
    '|---|---|---|---|---|']
  for (const p of propostas) {
    linhas.push(`| ${p.departamento} | ${p.qtd} | ${p.acao} | ${p.unidade_nome || '—'} | ${p.score ?? '—'} |`)
  }
  linhas.push('', '## CRIAR_NOVA (sem match >= 0.5) — candidatas a virar unidade nova', '')
  for (const p of propostas.filter(p => p.acao === 'CRIAR_NOVA')) {
    const cand = p.candidatos.length ? ` (mais próximo, abaixo do limiar: ${p.candidatos[0].unidade_nome} = ${p.candidatos[0].score.toFixed(2)})` : ''
    linhas.push(`- **${p.departamento}** (${p.qtd} pessoas)${cand}`)
  }
  linhas.push('', '## DESCARTAR', '')
  for (const p of propostas.filter(p => p.acao === 'DESCARTAR')) {
    linhas.push(`- **${p.departamento}** (${p.qtd} pessoas) — ${p.motivo}`)
  }
  fs.writeFileSync(outMd, linhas.join('\n'))

  const resumo = propostas.reduce((acc, p) => { acc[p.acao] = (acc[p.acao] || 0) + 1; return acc }, {})
  console.log('Resumo:', resumo)
  console.log('Total de pessoas em CRIAR_NOVA:', propostas.filter(p => p.acao === 'CRIAR_NOVA').reduce((s, p) => s + p.qtd, 0))
  console.log('\nArquivos gerados:')
  console.log(' ', outJson)
  console.log(' ', outMd)
}

main().catch(e => { console.error('\n✗ ' + (e.stack || e.message)); process.exit(1) })
