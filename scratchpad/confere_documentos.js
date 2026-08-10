/**
 * Conferência cruzada TS × SQL da validação de documentos.
 *
 * POR QUE ISTO EXISTE
 *   O algoritmo do dígito verificador vive em dois lugares que não podem divergir:
 *     - src/utils/documentos.ts   (formulário e server action)
 *     - fn_cpf/cnpj/pis_digito_valido no banco (o CHECK, 20260809220000)
 *   Duas implementações são inevitáveis. Divergirem em silêncio, não. É o mesmo mecanismo dos
 *   geradores de migration (gen_ancora.js, gen_hora_dia.js): confere e ABORTA.
 *
 * O QUE ELE NÃO FAZ
 *   Não reescreve o TS em JS. Reescrever seria criar uma TERCEIRA implementação, e ela é que
 *   passaria a ser conferida — o bug moraria justamente no que o script não olha. Ele COMPILA
 *   src/utils/documentos.ts com o tsc do projeto e executa o resultado.
 *
 * COMO RODAR
 *   node scratchpad/confere_documentos.js
 *   Exit 0 = as duas concordam em todos os documentos reais. Exit 1 = divergência ou falha.
 *
 * Só faz SELECT e chamada de função IMMUTABLE. Não escreve nada.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const RAIZ = path.resolve(__dirname, '..')
const FONTE = path.join(RAIZ, 'src', 'utils', 'documentos.ts')

// ---------------------------------------------------------------------------
// 1. Compila o módulo real
// ---------------------------------------------------------------------------
// Chamamos o entrypoint JS do tsc com o proprio node, e nao `npx`: no Windows o Node recente
// recusa spawnar `.cmd` sem shell (EINVAL), e `shell: true` traria problema de escape de caminho.
function carregarModuloTs() {
  const tsc = path.join(RAIZ, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!fs.existsSync(tsc)) throw new Error(`tsc nao encontrado em ${tsc} — rode npm install`)

  const saida = fs.mkdtempSync(path.join(os.tmpdir(), 'confdoc-'))
  execFileSync(
    process.execPath,
    [tsc, FONTE, '--outDir', saida, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { cwd: RAIZ, stdio: 'pipe' }
  )
  return require(path.join(saida, 'documentos.js'))
}

// ---------------------------------------------------------------------------
// 2. Acesso ao banco (produção — leitura apenas)
// ---------------------------------------------------------------------------
const env = fs.readFileSync(path.join(RAIZ, '.env.production'), 'utf8')
const g = k => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : null }
const U = g('NEXT_PUBLIC_SUPABASE_URL')
const K = g('SUPABASE_SERVICE_ROLE_KEY')
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' }

// PostgREST corta em 1000 linhas em silêncio (armadilha 8 do CLAUDE.md).
const all = async p => {
  const o = []
  for (let f = 0; ; f += 1000) {
    const r = await fetch(`${U}/rest/v1/${p}`, { headers: { ...H, Range: `${f}-${f + 999}` } })
    if (!r.ok) throw new Error(`GET ${p} -> ${r.status} ${(await r.text()).slice(0, 200)}`)
    const j = await r.json()
    o.push(...j)
    if (j.length < 1000) break
  }
  return o
}

const rpc = async (fn, body) => {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`RPC ${fn} -> ${r.status} ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

// ---------------------------------------------------------------------------
// 3. Casos sintéticos — as bordas que dado real não cobre
// ---------------------------------------------------------------------------
// Produção tem 126 CPFs (4 inválidos), 16 CNPJs (todos válidos) e ZERO PIS. Sem estes casos, o
// PIS não seria conferido de forma nenhuma e as bordas (repetido, comprimento errado, dígito
// 10 → 0) passariam despercebidas nos três.
const SINTETICOS = {
  cpf: [
    '52998224725', '11144477735',           // válidos conhecidos
    '52998224724', '11144477736',           // dígito final trocado
    '00000000000', '11111111111',           // repetido: passa na conta, não é documento
    '5299822472', '529982247251',           // comprimento errado
    '', '   ', '529.982.247-25',            // vazio e com máscara
  ],
  cnpj: [
    '11222333000181',
    '11222333000180', '11222333000191',
    '00000000000000', '11111111111111',
    '1122233300018', '112223330001811',
    '', '11.222.333/0001-81',
  ],
  pis: [
    '12056412545', '12345678900', '00000000191',
    '12056412547', '12345678901',
    '11111111111', '00000000000',
    '1205641254', '120564125451',
    '', '120.56412.54-5',
  ],
}

const FN_SQL = { cpf: 'fn_cpf_digito_valido', cnpj: 'fn_cnpj_digito_valido', pis: 'fn_pis_digito_valido' }
const ARG_SQL = { cpf: 'p_cpf', cnpj: 'p_cnpj', pis: 'p_pis' }

// ---------------------------------------------------------------------------
;(async () => {
  console.log('Compilando src/utils/documentos.ts com o tsc do projeto…')
  let doc
  try {
    doc = carregarModuloTs()
  } catch (e) {
    console.error('\n✗ tsc falhou — o módulo TS não compila:\n' + (e.stdout || e.message || e))
    process.exit(1)
  }
  const validarTs = { cpf: doc.validarCpf, cnpj: doc.validarCnpj, pis: doc.validarPis }
  console.log('  ok — usando validarCpf/validarCnpj/validarPis do módulo real.\n')

  // Quais funções SQL já existem? Uma ausente NÃO interrompe as outras — antes de 20260809220000
  // ser aplicada só fn_cpf_digito_valido existe, e conferir o CPF (o único com dado real) já vale.
  // Mas ausência continua sendo falha: o script termina com exit 1.
  let faltando = 0
  const disponivel = {}
  for (const tipo of Object.keys(FN_SQL)) {
    try {
      await rpc(FN_SQL[tipo], { [ARG_SQL[tipo]]: '00000000000' })
      disponivel[tipo] = true
    } catch {
      disponivel[tipo] = false
      faltando++
      console.warn(`⚠ ${FN_SQL[tipo]} não existe no banco — aplique 20260809220000. ${tipo.toUpperCase()} não será conferido.`)
    }
  }
  if (faltando) console.log('')

  // Documentos reais + sintéticos, por tipo.
  const servidores = await all('servidores?select=id,nome,cpf,pis_pasep')
  const unidades = await all('unidades?select=id,nome,cnpj,responsavel_cpf')

  const amostras = { cpf: [], cnpj: [], pis: [] }
  const push = (tipo, valor, origem) => {
    if (valor === null || valor === undefined) return
    amostras[tipo].push({ valor: String(valor), origem })
  }
  servidores.forEach(s => {
    push('cpf', s.cpf, `servidores.cpf · ${s.nome}`)
    push('pis', s.pis_pasep, `servidores.pis_pasep · ${s.nome}`)
  })
  unidades.forEach(u => {
    push('cnpj', u.cnpj, `unidades.cnpj · ${u.nome}`)
    push('cpf', u.responsavel_cpf, `unidades.responsavel_cpf · ${u.nome}`)
  })
  for (const tipo of Object.keys(SINTETICOS)) {
    SINTETICOS[tipo].forEach(v => push(tipo, v, 'sintético'))
  }

  let divergencias = 0
  const invalidosReais = []

  for (const tipo of ['cpf', 'cnpj', 'pis']) {
    const lista = amostras[tipo]
    if (!disponivel[tipo]) {
      // Sem a função SQL não há o que cruzar, mas o inválido real ainda precisa ser listado.
      lista.forEach(({ valor, origem }) => {
        if (origem !== 'sintético' && !validarTs[tipo](valor) && doc.normalizarDoc(valor)) {
          invalidosReais.push({ tipo, valor, origem })
        }
      })
      console.log(`${tipo.toUpperCase().padEnd(5)} — pulado (função SQL ausente)`)
      continue
    }
    let concordaram = 0
    for (const { valor, origem } of lista) {
      const ts = validarTs[tipo](valor)
      const sql = await rpc(FN_SQL[tipo], { [ARG_SQL[tipo]]: valor })
      if (ts !== sql) {
        divergencias++
        console.error(`  ✗ DIVERGÊNCIA ${tipo.toUpperCase()} "${valor}" — TS=${ts} SQL=${sql}  (${origem})`)
      } else {
        concordaram++
      }
      // Só dado real entra no relatório de pendência.
      if (origem !== 'sintético' && ts === false && doc.normalizarDoc(valor)) {
        invalidosReais.push({ tipo, valor, origem })
      }
    }
    const reais = lista.filter(x => x.origem !== 'sintético').length
    console.log(`${tipo.toUpperCase().padEnd(5)} ${String(concordaram).padStart(4)}/${lista.length} concordaram ` +
      `(${reais} de produção, ${lista.length - reais} sintéticos)`)
  }

  console.log('\n=== DOCUMENTOS REAIS INVÁLIDOS ===')
  if (!invalidosReais.length) {
    console.log('  nenhum.')
  } else {
    invalidosReais.forEach(x => console.log(`  ${x.tipo.toUpperCase().padEnd(5)} ${x.valor.padEnd(16)} ${x.origem}`))
    console.log(`\n  ⚠ O CHECK (20260809230000) só pode ser aplicado depois de corrigir estes ${invalidosReais.length}.`)
  }

  // A função de diagnóstico do banco tem de enxergar exatamente os mesmos.
  try {
    const doBanco = await rpc('fn_documentos_invalidos', {})
    console.log(`\nfn_documentos_invalidos() devolveu ${doBanco.length} — o script achou ${invalidosReais.length}.`)
    if (doBanco.length !== invalidosReais.length) {
      console.error('  ✗ contagens diferentes: a função de diagnóstico não cobre os mesmos campos.')
      divergencias++
    }
  } catch {
    console.warn('\n⚠ fn_documentos_invalidos() ainda não existe — aplique 20260809220000.')
  }

  if (divergencias) {
    console.error(`\n✗ ABORTADO — ${divergencias} divergência(s). TS e SQL não podem seguir assim.`)
    process.exit(1)
  }
  if (faltando) {
    console.error(`\n✗ ${faltando} função(ões) SQL ausente(s) — a conferência ficou incompleta. Aplique 20260809220000.`)
    process.exit(1)
  }
  console.log('\n✓ TS e SQL concordam em todos os documentos conferidos.')
})().catch(e => { console.error('\n✗ ' + (e.stack || e.message)); process.exit(1) })
