/**
 * Monta a barra de navegacao na page da folha e passa o slot ao editor.
 */
const fs = require('fs')
const path = 'src/app/(dashboard)/folha-ponto/[id]/page.tsx'
let src = fs.readFileSync(path, 'utf8')

function trocarUnica(de, para, nome) {
  const n = src.split(de).length - 1
  if (n !== 1) {
    console.error(`ABORTADO: ${nome} — esperava 1 ocorrencia, achei ${n}`)
    process.exit(1)
  }
  src = src.split(de).join(para)
}

trocarUnica(
  "import { FolhaPontoEditor } from './FolhaPontoEditor'",
  "import { FolhaPontoEditor } from './FolhaPontoEditor'\r\nimport { NavegacaoFolhas } from './NavegacaoFolhas'",
  'import da barra'
)

trocarUnica(
  [
    "  return (",
    "    <FolhaPontoEditor ",
    "      folha={mappedFolha}",
    "      profile={userProfile}",
    "    />",
    "  )"
  ].join('\r\n'),
  [
    "  return (",
    "    <FolhaPontoEditor",
    "      folha={mappedFolha}",
    "      profile={userProfile}",
    "      navegacao={",
    "        <NavegacaoFolhas",
    "          folhaId={folha.id}",
    "          mes={folha.mes}",
    "          ano={folha.ano}",
    "          servidorNome={(folha.servidores as any)?.nome}",
    "          escala={{",
    "            unidadeId: escala.unidade_id,",
    "            setorId: escala.setor_id,",
    "            unidadeNome: (escala.unidades as any)?.nome || '',",
    "            setorNome: resolvedSetor?.nome || ''",
    "          }}",
    "        />",
    "      }",
    "    />",
    "  )"
  ].join('\r\n'),
  'slot da barra no editor'
)

const invariantes = [
  ['guard de acesso ao setor preservado', "if (!hasSectorAccess(userProfile, escala.setor_id, escala.unidade_id))"],
  ['auto-sync preservado', "checkIfFolhaHasPendingPastTimes(folha, escala)"],
  ['folha nao encontrada preservada', "Folha não encontrada"]
]
for (const [nome, marca] of invariantes) {
  if (!src.includes(marca)) {
    console.error(`ABORTADO: invariante perdida — ${nome}`)
    process.exit(1)
  }
}

fs.writeFileSync(path, src)
console.log('OK: page da folha monta a barra')
