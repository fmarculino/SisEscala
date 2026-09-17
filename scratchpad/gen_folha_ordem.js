/**
 * Cópia mecânica: faz `folha-ponto/actions.ts` usar a ORDEM da fonte única
 * (`ordenarServidoresFolha`, em src/utils/folhaNavegacao.ts) nos DOIS sítios que montam a lista.
 *
 * Aborta se a contagem divergir: as duas actions (listagem por unidade e busca global) alimentam
 * a MESMA tela e a MESMA sequência de setas — corrigir uma e esquecer a outra faria a navegação
 * percorrer uma ordem diferente da que o usuário viu, exatamente o defeito que o util evita.
 */
const fs = require('fs')
const path = 'src/app/(dashboard)/folha-ponto/actions.ts'
let src = fs.readFileSync(path, 'utf8')

const ALVO = "    result.sort((a, b) => a.nome.localeCompare(b.nome))"
const ocorrencias = src.split(ALVO).length - 1
if (ocorrencias !== 2) {
  console.error(`ABORTADO: esperava 2 ordenacoes, achei ${ocorrencias}`)
  process.exit(1)
}

// Ordena uma copia e devolve a copia: a fonte unica nao muta o array recebido.
src = src.split(ALVO).join("    const ordenados = ordenarServidoresFolha(result)")

const trocas = [
  ["    return { servidores: result, completo: escalasCompletas && folhasCompletas }",
   "    return { servidores: ordenados, completo: escalasCompletas && folhasCompletas }"],
  ["    return { servidores: result, semEscala, truncado }",
   "    return { servidores: ordenados, semEscala, truncado }"]
]
for (const [de, para] of trocas) {
  const n = src.split(de).length - 1
  if (n !== 1) {
    console.error(`ABORTADO: esperava 1 ocorrencia de retorno, achei ${n}\n  ${de}`)
    process.exit(1)
  }
  src = src.split(de).join(para)
}

const IMPORT_ANCORA = "import { buscarTodasPaginas } from '@/utils/paginacao'"
if (src.split(IMPORT_ANCORA).length - 1 !== 1) {
  console.error('ABORTADO: ancora de import nao encontrada uma unica vez')
  process.exit(1)
}
if (!src.includes("from '@/utils/folhaNavegacao'")) {
  src = src.replace(
    IMPORT_ANCORA,
    IMPORT_ANCORA + "\r\nimport { ordenarServidoresFolha } from '@/utils/folhaNavegacao'"
  )
}

// Invariantes que nao podem cair junto com a troca.
const invariantes = [
  ['paginacao da listagem preservada', "buscarTodasPaginas<any>(montarQueryEscalas, 500)"],
  ['paginacao das folhas preservada', "buscarTodasPaginas<any>(montarQueryFolhas)"],
  ['guarda de perfil irrestrito preservada', "isAccessUnrestricted(userProfile) && !unidadeId"],
  ['relato de listagem incompleta preservado', "escalasCompletas && folhasCompletas"]
]
for (const [nome, marca] of invariantes) {
  if (!src.includes(marca)) {
    console.error(`ABORTADO: invariante perdida — ${nome}`)
    process.exit(1)
  }
}

fs.writeFileSync(path, src)
console.log('OK: 2 ordenacoes e 2 retornos trocados; import acrescentado; 4 invariantes conferidas')
