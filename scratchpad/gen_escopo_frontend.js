// Faz o filtro do lado do cliente (applyAccessFilters) enxergar os SUBSETORES, para nao
// divergir da RLS corrigida por 20260814120000_hierarchical_sector_scope.sql.
//
// `permitted_setores` era montado a partir do embed CRU de profile_setores -- lista plana, sem
// descendentes. Passa a vir da coluna computada `setores_no_escopo` (PostgREST), que devolve o
// mesmo conjunto que fn_setores_no_escopo() entrega a RLS. Fonte unica: se as duas divergirem,
// a tela mostra menos (ou mais) do que o banco autoriza.
//
// Uso: node scratchpad/gen_escopo_frontend.js [--dry]

const fs = require('fs')
const path = require('path')

const DRY = process.argv.includes('--dry')
const RAIZ = 'src'

// Nem toda leitura de profile_setores e escopo de acesso. Estas DEVEM continuar planas --
// expandir aqui seria erro, nao correcao:
//
//   usuarios/page.tsx    monta a tela que GERENCIA os vinculos. `permitted_setores` ali alimenta
//                        as caixas marcadas do formulario de edicao; mostrar descendente herdado
//                        como se fosse vinculo explicito faria o proximo "salvar" grava-lo de
//                        verdade, convertendo heranca em vinculo real sem ninguem pedir.
//
//   actions/sobreaviso.ts  usa o primeiro setor vinculado como "meu setor", so para pre-preencher
//                        o formulario de acionamento. Nao e filtro de acesso; com a expansao, o
//                        [0] passaria a poder cair num descendente arbitrario.
//   servidores/pendencias/page.tsx  deriva UNIDADES a partir dos setores vinculados
//                        (`profile_setores(setores(unidade_id))`, embed de forma propria). Um
//                        setor descendente sempre pertence a mesma unidade do pai, entao a
//                        expansao nao mudaria o conjunto de unidades -- so custaria linhas.
const EXCLUIDOS = [
  path.join('src', 'app', '(dashboard)', 'usuarios', 'page.tsx'),
  path.join('src', 'app', 'actions', 'sobreaviso.ts'),
  path.join('src', 'app', '(dashboard)', 'servidores', 'pendencias', 'page.tsx'),
]

const TROCAS = [
  {
    nome: 'embed -> coluna computada',
    de: /profile_setores\(setor_id\)/g,
    para: 'setores_no_escopo',
    esperado: 26,
  },
  {
    nome: 'map do embed -> array pronto',
    // O receptor (profile / prof / p? / data / (profile as any)) fica fora do match de
    // proposito: nao ha por que reescrever o que ja esta certo em cada arquivo.
    de: /\.profile_setores\?\.map\(\(ps: any\) => ps\.setor_id\) \|\| \[\]/g,
    para: '.setores_no_escopo || []',
    esperado: 25,
  },
  {
    // Unico site com forma propria: a checagem de "posso lotar um servidor neste setor?" em
    // servidores/actions.ts. E escopo de acesso -- e exatamente o que barraria o coordenador do
    // APOIO de lotar alguem em APOIO/SERVICOS GERAIS -- entao entra na expansao.
    nome: 'checagem de lotacao (servidores/actions.ts)',
    de: /\(profile\.profile_setores \|\| \[\]\)\.map\(\(ps: any\) => ps\.setor_id\)/g,
    para: '((profile as any).setores_no_escopo || [])',
    esperado: 1,
  },
]

const arquivos = []
;(function varrer(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) varrer(p)
    else if (/\.tsx?$/.test(e.name)) arquivos.push(p)
  }
})(RAIZ)

const contagem = TROCAS.map(() => 0)
const tocados = new Set()

const resultado = new Map() // arquivo -> conteudo apos as trocas

for (const f of arquivos) {
  const antes = fs.readFileSync(f, 'utf8')
  if (EXCLUIDOS.includes(f)) {
    resultado.set(f, antes)
    continue
  }
  let depois = antes

  TROCAS.forEach((t, i) => {
    depois = depois.replace(t.de, () => {
      contagem[i]++
      tocados.add(f)
      return t.para
    })
  })

  resultado.set(f, depois)
  if (depois !== antes && !DRY) fs.writeFileSync(f, depois, 'utf8')
}

let falhou = false
TROCAS.forEach((t, i) => {
  const ok = contagem[i] === t.esperado
  if (!ok) falhou = true
  console.log(`${ok ? 'OK ' : 'ERRO'}  ${t.nome}: ${contagem[i]} (esperado ${t.esperado})`)
})

// Nao pode sobrar leitura crua do embed em lugar nenhum -- seria um ponto de divergencia
// silencioso com a RLS. A tela de Usuarios GERENCIA profile_setores (insert/delete) e por isso
// nao entra aqui: so leituras para efeito de escopo foram trocadas.
// Le o conteudo JA transformado (nao o arquivo), para o --dry conferir de verdade.
const sobrou = []
for (const [f, conteudo] of resultado) {
  conteudo.split(/\r?\n/).forEach((linha, n) => {
    if (/\.profile_setores\b/.test(linha) || /profile_setores\(setor_id\)/.test(linha)) {
      sobrou.push(`${EXCLUIDOS.includes(f) ? 'excluido ' : 'INESPERADO'}  ${f}:${n + 1}  ${linha.trim()}`)
    }
  })
}
const inesperados = sobrou.filter(s => s.startsWith('INESPERADO'))
if (sobrou.length) {
  console.log(`\nleituras de profile_setores remanescentes:`)
  sobrou.forEach(s => console.log(`  ${s}`))
}
if (inesperados.length) {
  falhou = true
  console.log(`\nERRO  ${inesperados.length} leitura(s) nao prevista(s) sobraram`)
}

console.log(`\n${tocados.size} arquivos alterados${DRY ? ' (DRY RUN, nada gravado)' : ''}`)
process.exit(falhou ? 1 : 0)
