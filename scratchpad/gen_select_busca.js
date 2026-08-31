/**
 * Troca <select> longo por <SelectComBusca> nas telas medidas como problematicas.
 *
 * Cada substituicao declara quantas ocorrencias espera e o script ABORTA na divergencia —
 * mesmo padrao dos geradores de migration (armadilha 1). Sem isso uma indentacao diferente
 * faria a troca passar em silencio em um arquivo e nao no outro.
 *
 * ⚠️ Meses/anos NAO sao convertidos de proposito: 12 opcoes cabem na tela e o <select> nativo
 * abre o seletor do sistema no celular. Ver o cabecalho de SelectComBusca.tsx.
 */
const fs = require('fs')

const ARQUIVOS = [
  {
    path: 'src/app/(dashboard)/relatorios/plantao-sobreaviso/_components/DiagnosticsFilters.tsx',
    // mes inicio, ano inicio, mes fim, ano fim (4) + "Foco de Escala" (3 opcoes fixas).
    // Listas curtas: o <select> nativo e' melhor. Ver o cabecalho de SelectComBusca.tsx.
    selectsMantidos: 5,
    importarApos: "import { formatSectorsHierarchy } from '@/utils/sectors'",
    trocas: [
      {
        de: `            <select
              value={unidadeId}
              onChange={(e) => {
                setUnidadeId(e.target.value)
                setSetorId('')
                setServidorId('')
              }}
              className="CLS"
            >
              <option value="">Todas as Unidades</option>
              {unidades.map(u => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>`,
        para: `            <SelectComBusca
              value={unidadeId}
              onChange={(v) => {
                setUnidadeId(v)
                setSetorId('')
                setServidorId('')
              }}
              placeholder="Todas as Unidades"
              opcoes={unidades.map(u => ({ value: u.id, label: u.nome }))}
              className="CLS"
            />`,
      },
      {
        de: `            <select
              value={setorId}
              onChange={(e) => {
                setSetorId(e.target.value)
                setServidorId('')
              }}
              className="CLS"
            >
              <option value="">Todos os Setores</option>
              {filteredSectors.map(s => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
            </select>`,
        para: `            <SelectComBusca
              value={setorId}
              onChange={(v) => {
                setSetorId(v)
                setServidorId('')
              }}
              placeholder="Todos os Setores"
              opcoes={filteredSectors.map(s => ({ value: s.id, label: s.nome }))}
              className="CLS"
            />`,
      },
      {
        de: `            <select
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
              className="CLS"
            >
              <option value="">Todos os Cargos</option>
              {cargos.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>`,
        para: `            <SelectComBusca
              value={cargo}
              onChange={setCargo}
              placeholder="Todos os Cargos"
              opcoes={cargos.map(c => ({ value: c, label: c }))}
              className="CLS"
            />`,
      },
      {
        de: `              <select
                value={servidorId}
                onChange={(e) => setServidorId(e.target.value)}
                className="CLS"
              >
                <option value="">Todos os Servidores</option>
                {filteredServidores.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.nome} {s.matricula ? \`(\${s.matricula})\` : ''}
                  </option>
                ))}
              </select>`,
        para: `              <SelectComBusca
                value={servidorId}
                onChange={setServidorId}
                placeholder="Todos os Servidores"
                opcoes={filteredServidores.map(s => ({
                  value: s.id,
                  label: s.nome,
                  detalhe: s.matricula ? \`Matrícula \${s.matricula}\` : undefined,
                }))}
                className="CLS"
              />`,
      },
    ],
  },
]

// A classe do <select> e' identica nos quatro sitios deste arquivo, entao ela vira placeholder
// nas trocas acima e e' reinjetada aqui — evita quatro copias de uma string de 260 caracteres.
const CLASSE = 'w-full pl-10 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-bold text-zinc-700 dark:text-zinc-300 focus:ring-2 focus:ring-indigo-500 transition-all appearance-none cursor-pointer'

let total = 0
for (const arq of ARQUIVOS) {
  let s = fs.readFileSync(arq.path, 'utf8')
  const crlf = s.includes('\r\n')
  const nl = (t) => (crlf ? t.replace(/\r?\n/g, '\r\n') : t)

  for (const t of arq.trocas) {
    const de = nl(t.de).split('CLS').join(CLASSE)
    const para = nl(t.para).split('CLS').join(CLASSE)
    const n = s.split(de).length - 1
    if (n !== 1) throw new Error(`ABORTA ${arq.path}: ${n} ocorrencias de\n${de.slice(0, 120)}`)
    s = s.split(de).join(para)
    total++
  }

  const imp = nl(arq.importarApos)
  if (s.split(imp).length - 1 !== 1) throw new Error(`ABORTA: ancora de import nao unica em ${arq.path}`)
  s = s.replace(imp, imp + nl("\nimport { SelectComBusca } from '@/components/ui/SelectComBusca'"))

  // Os <select> que SOBRAM sao os de mes/ano, mantidos de proposito. Conferir o numero exato
  // (e nao "sobrou algum") e' o que impede tanto uma troca esquecida quanto uma feita a mais.
  const restantes = s.split('<select').length - 1
  if (restantes !== arq.selectsMantidos) {
    throw new Error(`ABORTA ${arq.path}: sobraram ${restantes} <select>, esperado ${arq.selectsMantidos}`)
  }
  fs.writeFileSync(arq.path, s)
  console.log(`  ${arq.path}: ${arq.trocas.length} trocas`)
}
console.log(`total: ${total} <select> substituidos`)
