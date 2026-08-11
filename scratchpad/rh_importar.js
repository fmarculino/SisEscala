/**
 * Importa os vínculos ativos do CSV de RH pro SisEscala.
 *
 * POR QUE ISTO EXISTE, E COMO
 *   docs/planos/2026-08-10-plano-de-importacao-de-dados-cadastrais-rh.md é o plano completo.
 *   Resumo: 3.492 vínculos ativos (Situacao IN ('At. Normal','Afastado')), 3.382 CPFs distintos.
 *   Pra cada um:
 *     - CPF já em `servidores` (existingByCpf)  -> ATUALIZAR: só preenche campo hoje vazio
 *       (pis_pasep é o ganho grande). NUNCA sobrescreve o que já está preenchido. Cargo/unidade
 *       divergente vira nota no relatório, não é aplicado.
 *     - CPF novo, matrícula não bate com nada    -> NOVO: entra em `importacao_rh_pendentes`.
 *       Unidade só é preenchida quando o Departamento bateu com unidade JÁ CADASTRADA no
 *       mapeamento revisado (rh_mapeamento_unidades.json, MATCH_EXATO/MATCH_PROVAVEL) — decisão
 *       do usuário em 10/08/2026: NENHUMA unidade nova é criada por este script. Sem match, o
 *       vínculo fica pendente com unidade em branco (departamento_origem preservado como pista).
 *     - Ambíguo (CPF tem 2+ vínculo ativo no CSV e a matrícula de nenhum bate com o que já existe
 *       em `servidores`) -> listado à parte, NADA é feito. Decisão humana.
 *   Cargo: resolvido 1:1 por código via `cargos_codigos_origem` (253/253 códigos ativos cobertos
 *   depois de 20260810170000) — sem fusão por regime, decisão do usuário.
 *   Histórico: todo CPF com pelo menos 1 vínculo ativo grava TODOS os seus registros do arquivo
 *   (inclusive os "Demitido" — sucessão de matrícula) em `servidores_historico_vinculo`.
 *
 * MODO SIMULAÇÃO POR PADRÃO — mesmo padrão de fn_expurgar_logs(p_simular)
 *   node scratchpad/rh_importar.js            -> só mostra o resumo, não escreve nada
 *   node scratchpad/rh_importar.js --aplicar  -> grava de verdade
 *
 * Aborta se `servidores_historico_vinculo` já tiver linhas com origem='importacao_rh_2026_07'
 * (evita duplicar histórico rodando duas vezes) — use --forcar pra ignorar essa trava.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')
const { parseCsv, corrigirMojibake } = require('./rh_csv_utils')

const RAIZ = path.resolve(__dirname, '..')
const CSV_PATH = path.join(RAIZ, 'docs', 'Dados Cadastrais - Julho 2026 - SFPRC01M.csv')
const APLICAR = process.argv.includes('--aplicar')
const FORCAR = process.argv.includes('--forcar')

// ---------------------------------------------------------------------------
// 0. Fonte única de validação de CPF — compila documentos.ts, não reimplementa o algoritmo.
// ---------------------------------------------------------------------------
function carregarValidarCpf() {
  const tsc = path.join(RAIZ, 'node_modules', 'typescript', 'bin', 'tsc')
  const saida = fs.mkdtempSync(path.join(os.tmpdir(), 'rhimport-'))
  execFileSync(
    process.execPath,
    [tsc, path.join(RAIZ, 'src', 'utils', 'documentos.ts'), '--outDir', saida, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { cwd: RAIZ, stdio: 'pipe' }
  )
  return require(path.join(saida, 'documentos.js'))
}

// ---------------------------------------------------------------------------
// 1. Acesso a produção
// ---------------------------------------------------------------------------
const env = fs.readFileSync(path.join(RAIZ, '.env.production'), 'utf8')
const g = k => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : null }
const U = g('NEXT_PUBLIC_SUPABASE_URL')
const K = g('SUPABASE_SERVICE_ROLE_KEY')
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' }

async function all(p) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${p}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    if (!r.ok) throw new Error(`GET ${p} -> ${r.status} ${(await r.text()).slice(0, 300)}`)
    const j = await r.json()
    out.push(...j)
    if (j.length < 1000) break
  }
  return out
}

async function insertLote(tabela, linhas, tamanhoLote = 200) {
  let inseridos = 0
  for (let i = 0; i < linhas.length; i += tamanhoLote) {
    const lote = linhas.slice(i, i + tamanhoLote)
    const r = await fetch(`${U}/rest/v1/${tabela}`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(lote) })
    if (!r.ok) throw new Error(`POST ${tabela} (lote ${i}) -> ${r.status} ${(await r.text()).slice(0, 500)}`)
    inseridos += lote.length
  }
  return inseridos
}

// ---------------------------------------------------------------------------
// 2. Datas do CSV vêm M/D/YYYY — converte pra YYYY-MM-DD (ou null)
// ---------------------------------------------------------------------------
function paraDataIso(v) {
  if (!v || !v.trim()) return null
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [, mm, dd, yyyy] = m
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

function normCpf(v) {
  const d = (v || '').replace(/\D/g, '')
  return d ? d.padStart(11, '0') : null
}

// PIS/PASEP, como CPF, perde zero à esquerda na exportação (armadilha 10) — repadStart antes de
// validar. `chk_servidores_pis_digito` (banco) rejeitaria de qualquer forma, mas silenciosamente
// falhar toda a linha do PATCH (inclusive campos que estavam certos) não é o comportamento certo
// aqui: melhor não mandar o PIS que sabemos inválido, e deixar visível pra correção manual depois.
function pisValidoOuNulo(v, validarPis) {
  const d = normCpf(v) // mesmo padStart(11,'0'), PIS também tem 11 dígitos
  return d && validarPis(d) ? d : null
}

const MAPA_CLASSIFICACAO = {
  'Contratado': 'Contratada',
  'Concursado': 'Concursada',
  'Comissionado': 'Comissionada',
}

;(async () => {
  console.log('Compilando src/utils/documentos.ts...')
  const { validarCpf, validarPis } = carregarValidarCpf()
  console.log('  ok.\n')

  // -------------------------------------------------------------------------
  // CSV
  // -------------------------------------------------------------------------
  const raw = fs.readFileSync(CSV_PATH, 'utf8')
  const rows = parseCsv(raw)
  const header = rows[0]
  const idx = {}
  header.forEach((h, i) => { idx[h.trim()] = i })
  const linhaFmt = r => {
    const o = {}
    for (const col of Object.keys(idx)) o[col] = corrigirMojibake((r[idx[col]] || '').trim())
    return o
  }
  const todasComDuplicata = rows.slice(1).filter(r => r.length === header.length && r.some(f => f !== '')).map(linhaFmt)
  // Duas linhas do CSV são duplicata exata (mesma matrícula, todos os campos iguais) — artefato
  // da exportação, não vínculo real. Vale pro histórico também, não só pro processamento ativo.
  const matriculasVistasTodas = new Set()
  const todas = todasComDuplicata.filter(r => {
    if (matriculasVistasTodas.has(r.Funcionario)) return false
    matriculasVistasTodas.add(r.Funcionario)
    return true
  })
  const ativas = todas.filter(r => r.Situacao !== 'Demitido')
  console.log(`CSV: ${todas.length} linhas totais, ${ativas.length} vínculos ativos.\n`)

  // -------------------------------------------------------------------------
  // Produção — só leitura
  // -------------------------------------------------------------------------
  console.log('Lendo produção (servidores, cargos, financiamento, mapeamento de unidades)...')
  const servidoresAtuais = await all('servidores?select=id,cpf,matricula,nome,unidade_id,setor_id,cargo,vinculo,status,pis_pasep,rg_numero,rg_orgao_emissor,rg_data_emissao,data_nascimento,sexo,nacionalidade,naturalidade,nome_mae,nome_pai,escolaridade,estado_civil,nome_conjuge,endereco_logradouro,endereco_numero,bairro,cep,municipio_residencia,telefone_residencial,registro_profissional,registro_profissional_orgao,data_admissao_pmm,observacao')
  const cco = await all('cargos_codigos_origem?select=codigo,cargo_id')
  const cargosDb = await all('cargos?select=id,nome')
  const nomeCargoPorId = new Map(cargosDb.map(c => [c.id, c.nome]))
  const cargoNomePorCodigo = new Map(cco.map(m => [m.codigo, nomeCargoPorId.get(m.cargo_id)]).filter(([, n]) => n))
  const blocos = await all('financiamento_saude_blocos?select=id,codigo')
  const blocoIdPorCodigo = new Map(blocos.map(b => [b.codigo, b.id]))
  const pendentesExistentes = await all('importacao_rh_pendentes?select=matricula')
  const matriculasJaPendentes = new Set(pendentesExistentes.map(p => p.matricula))
  const { count: historicoExistente } = await (async () => {
    const r = await fetch(`${U}/rest/v1/servidores_historico_vinculo?select=id&origem=eq.importacao_rh_2026_07`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } })
    const cr = r.headers.get('content-range')
    return { count: Number((cr || '*/0').split('/')[1]) }
  })()

  if (historicoExistente > 0 && !FORCAR) {
    console.error(`\n✗ servidores_historico_vinculo já tem ${historicoExistente} linha(s) com origem=importacao_rh_2026_07.`)
    console.error('  Rodar de novo duplicaria o histórico. Use --forcar se isso for intencional (ex.: re-rodando depois de um --aplicar parcial).')
    if (APLICAR) process.exit(1)
  }

  const mapeamentoUnidades = JSON.parse(fs.readFileSync(path.join(RAIZ, 'scratchpad', 'rh_mapeamento_unidades.json'), 'utf8'))
  const unidadeIdPorDepartamento = new Map(
    mapeamentoUnidades
      .filter(m => m.acao === 'MATCH_EXATO' || m.acao === 'MATCH_PROVAVEL')
      .map(m => [m.departamento, m.unidade_id])
  )
  console.log(`  ${servidoresAtuais.length} servidores em produção, ${cargoNomePorCodigo.size} códigos de cargo mapeados, ${unidadeIdPorDepartamento.size} departamentos com unidade confirmada.\n`)

  // -------------------------------------------------------------------------
  // 3. Índices auxiliares
  // -------------------------------------------------------------------------
  const existingByCpf = new Map() // cpfNorm -> servidor[]
  const existingByMatricula = new Map() // matricula -> servidor
  for (const s of servidoresAtuais) {
    const cpf = normCpf(s.cpf)
    if (cpf) {
      if (!existingByCpf.has(cpf)) existingByCpf.set(cpf, [])
      existingByCpf.get(cpf).push(s)
    }
    if (s.matricula) existingByMatricula.set(s.matricula, s)
  }

  // Agrupa vínculos ativos por CPF, pra tratar vínculo simultâneo corretamente. Duplicata exata
  // já foi removida antes (junto com `todas`), então este loop só filtra CPF ausente/inválido.
  const ativasPorCpf = new Map()
  let cpfInvalido = 0, semCpf = 0
  for (const r of ativas) {
    const cpf = normCpf(r.CPF)
    if (!cpf) { semCpf++; continue }
    if (!validarCpf(cpf)) { cpfInvalido++; continue }

    if (!ativasPorCpf.has(cpf)) ativasPorCpf.set(cpf, [])
    ativasPorCpf.get(cpf).push(r)
  }

  // -------------------------------------------------------------------------
  // 4. Classificação
  // -------------------------------------------------------------------------
  const paraAtualizar = []   // { servidorId, patch, divergencias }
  const paraInserirPendente = []
  const ambiguos = []
  const historicoLinhas = []

  function resolverCargo(codigoRaw) {
    return cargoNomePorCodigo.get(codigoRaw) || null
  }

  function montarDadosComplementares(r) {
    return {
      data_nascimento: paraDataIso(r.DataNascimento),
      sexo: r.Sexo || null,
      nacionalidade: r.Nacionalidade || null,
      nome_mae: r.Mae || null,
      nome_pai: r.Pai === '0' ? null : (r.Pai || null),
      escolaridade: r.Escolaridade || null,
      estado_civil: r.EstadoCivil || null,
      nome_conjuge: r.Conjuge === '0' ? null : (r.Conjuge || null),
      endereco_logradouro: r.Endereco || null,
      endereco_numero: r.Nro || null,
      bairro: r.Bairro || null,
      rg_numero: r.Identidade || null,
      rg_orgao_emissor: r.OrgaoExpedidor || null,
      pis_pasep: pisValidoOuNulo(r.PIS_PASEP, validarPis),
      data_admissao_pmm: paraDataIso(r.DataAdmissao),
    }
  }

  // Campos de servidores que podem ser preenchidos por backfill (nunca sobrescreve valor já
  // presente). Chave = coluna em servidores, valor = como extrair do CSV.
  function calcularPatchBackfill(servidor, r) {
    const candidatos = {
      pis_pasep: pisValidoOuNulo(r.PIS_PASEP, validarPis),
      rg_numero: r.Identidade || null,
      rg_orgao_emissor: r.OrgaoExpedidor || null,
      data_nascimento: paraDataIso(r.DataNascimento),
      sexo: r.Sexo || null,
      nacionalidade: r.Nacionalidade || null,
      nome_mae: r.Mae || null,
      nome_pai: r.Pai === '0' ? null : (r.Pai || null),
      escolaridade: r.Escolaridade || null,
      estado_civil: r.EstadoCivil || null,
      nome_conjuge: r.Conjuge === '0' ? null : (r.Conjuge || null),
      endereco_logradouro: r.Endereco || null,
      endereco_numero: r.Nro || null,
      bairro: r.Bairro || null,
      data_admissao_pmm: paraDataIso(r.DataAdmissao),
    }
    const patch = {}
    for (const [campo, valorCsv] of Object.entries(candidatos)) {
      const atual = servidor[campo]
      const vazio = atual === null || atual === undefined || atual === ''
      if (vazio && valorCsv) patch[campo] = valorCsv
    }
    return patch
  }

  for (const [cpf, linhas] of ativasPorCpf) {
    const existentes = existingByCpf.get(cpf) || []
    const existentesPorMatricula = new Map(existentes.map(s => [s.matricula, s]))

    for (const r of linhas) {
      const mCodigo = r.Cargo.match(/^(\d+)\s+(.*)$/)
      const codigo = mCodigo ? mCodigo[1] : null
      const cargoResolvido = codigo ? resolverCargo(codigo) : null
      const financiamentoId = blocoIdPorCodigo.get(r.CodLotacao) || null
      const classificacao = MAPA_CLASSIFICACAO[r.Classificacao] || null
      const unidadeId = unidadeIdPorDepartamento.get(r.Departamento) || null

      // Histórico: TODOS os registros do CPF no arquivo inteiro (ativos + demitidos), uma vez
      // por CPF processado — monta fora deste loop de linhas ativas (ver abaixo).

      const servidorPorMatricula = existentesPorMatricula.get(r.Funcionario)
      if (servidorPorMatricula) {
        paraAtualizar.push({ servidor: servidorPorMatricula, patch: calcularPatchBackfill(servidorPorMatricula, r), csv: r, cargoResolvido, unidadeId })
        continue
      }

      if (linhas.length === 1 && existentes.length === 1) {
        // CPF único dos dois lados, matrícula diferente (ex.: SisEscala criou com temporária) —
        // ainda é a mesma pessoa, sem ambiguidade nenhuma pra decidir.
        paraAtualizar.push({ servidor: existentes[0], patch: calcularPatchBackfill(existentes[0], r), csv: r, cargoResolvido, unidadeId, matriculaDivergente: true })
        continue
      }

      if (existentes.length > 0) {
        // Existe(m) servidor(es) com este CPF, mas nenhum bate por matrícula, e não é o caso
        // simples 1-pra-1 acima — não dá pra saber qual registro do SisEscala este vínculo
        // deveria atualizar (ou se é vínculo adicional de verdade). Decisão humana.
        ambiguos.push({ csv: r, existentes, motivo: 'CPF já cadastrado, matrícula não bate com nenhum existente, e não é caso 1-pra-1' })
        continue
      }

      // Novo — nem CPF nem matrícula batem com nada em produção.
      paraInserirPendente.push({
        cpf_normalizado: cpf,
        nome: r.Nome,
        matricula: r.Funcionario,
        classificacao,
        cargo_sugerido: cargoResolvido,
        financiamento_bloco_id: financiamentoId,
        unidade_id: unidadeId,
        departamento_origem: r.Departamento,
        dados_complementares: montarDadosComplementares(r),
        vinculo_adicional_de_cpf: linhas.length > 1 || existentes.length > 0,
      })
    }

    // Histórico: todos os registros deste CPF no arquivo inteiro (ativos + Demitido).
    for (const h of todas.filter(x => normCpf(x.CPF) === cpf)) {
      const mCodigo = h.Cargo.match(/^(\d+)\s+(.*)$/)
      const codigo = mCodigo ? mCodigo[1] : null
      historicoLinhas.push({
        cpf_normalizado: cpf,
        matricula: h.Funcionario,
        nome: h.Nome,
        cargo: (codigo && resolverCargo(codigo)) || (mCodigo ? mCodigo[2] : h.Cargo) || null,
        funcao: h.Funcao || null,
        classificacao: MAPA_CLASSIFICACAO[h.Classificacao] || h.Classificacao || null,
        financiamento_bloco_id: blocoIdPorCodigo.get(h.CodLotacao) || null,
        departamento_origem: h.Departamento || null,
        data_inicio: paraDataIso(h.DataAdmissao),
        data_fim: paraDataIso(h.DataDemissao),
        origem: 'importacao_rh_2026_07',
      })
    }
  }

  // Dedup de matrícula já enfileirada numa rodada anterior (idempotência de reexecução parcial).
  const pendentesFiltrados = paraInserirPendente.filter(p => !matriculasJaPendentes.has(p.matricula))
  const pendentesJaExistiam = paraInserirPendente.length - pendentesFiltrados.length

  // -------------------------------------------------------------------------
  // 5. Resumo
  // -------------------------------------------------------------------------
  console.log('=== RESUMO ===')
  console.log('CPF inválido (dígito verificador) — não importado:', cpfInvalido)
  console.log('Sem CPF — não importado:', semCpf)
  console.log('Linha duplicada exata no CSV (mesma matrícula repetida) — ignorada:', todasComDuplicata.length - todas.length)
  console.log('')
  console.log('Atualizar (CPF já em produção, backfill de campos vazios):', paraAtualizar.length)
  console.log('  ...dos quais com matrícula divergente (mesma pessoa, matrícula diferente):', paraAtualizar.filter(x => x.matriculaDivergente).length)
  // Não comparo cargo do CSV com o cargo já salvo em `servidores`: o SisEscala usa nomenclatura
  // própria ("ASG Auxiliar de Serviços Gerais") que não bate com o dicionário do RH por
  // construção — comparar string daria "divergência" em quase todo mundo, sem sinal nenhum.
  console.log('Novo, pendente de cadastro:', pendentesFiltrados.length, `(${pendentesJaExistiam} já estavam pendentes de rodada anterior)`)
  console.log('  ...dos quais com unidade já resolvida:', pendentesFiltrados.filter(p => p.unidade_id).length)
  console.log('  ...dos quais SEM unidade (aguardando decisão humana):', pendentesFiltrados.filter(p => !p.unidade_id).length)
  console.log('  ...dos quais vínculo adicional de CPF já presente:', pendentesFiltrados.filter(p => p.vinculo_adicional_de_cpf).length)
  console.log('Ambíguos (nada feito, decisão humana):', ambiguos.length)
  console.log('Linhas de histórico (ativos + demitidos, só CPFs com vínculo ativo):', historicoLinhas.length)

  if (ambiguos.length) {
    console.log('\n--- Ambíguos ---')
    ambiguos.slice(0, 15).forEach(a => console.log(`  ${a.csv.Nome} (CPF ${a.csv.CPF}, matrícula ${a.csv.Funcionario}) — existentes: ${a.existentes.map(e => e.matricula).join(', ')}`))
    if (ambiguos.length > 15) console.log(`  ...e mais ${ambiguos.length - 15}`)
  }

  if (!APLICAR) {
    console.log('\n(modo simulação — nada foi gravado. Rode com --aplicar para gravar de verdade.)')
    return
  }

  // -------------------------------------------------------------------------
  // 6. Aplicar
  // -------------------------------------------------------------------------
  console.log('\nGravando...')

  let atualizados = 0
  for (const item of paraAtualizar) {
    if (Object.keys(item.patch).length === 0) continue
    const r = await fetch(`${U}/rest/v1/servidores?id=eq.${item.servidor.id}`, {
      method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(item.patch),
    })
    if (!r.ok) throw new Error(`PATCH servidores ${item.servidor.id} -> ${r.status} ${(await r.text()).slice(0, 300)}`)
    atualizados++
  }
  console.log(`  servidores atualizados (backfill): ${atualizados}`)

  const inseridosPendentes = await insertLote('importacao_rh_pendentes', pendentesFiltrados)
  console.log(`  importacao_rh_pendentes inseridos: ${inseridosPendentes}`)

  const inseridosHistorico = await insertLote('servidores_historico_vinculo', historicoLinhas)
  console.log(`  servidores_historico_vinculo inseridos: ${inseridosHistorico}`)

  console.log('\n✓ Concluído.')
})().catch(e => { console.error('\n✗ ' + (e.stack || e.message)); process.exit(1) })
