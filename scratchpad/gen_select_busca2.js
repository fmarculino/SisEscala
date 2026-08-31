/**
 * Segunda leva: afastamentos, marcacoes/PendenciasTab e justificativas.
 *
 * Mesmo contrato do gen_select_busca.js — cada troca tem de casar EXATAMENTE uma vez e o
 * numero de <select> que SOBRA e' declarado, para uma troca a mais ou a menos abortar.
 *
 * Duas armadilhas deste lote:
 *   1. Os filtros de afastamentos usam sentinela 'todas'/'todos', nao string vazia. Ali o
 *      "todos" entra como OPCAO NORMAL, nunca como `placeholder` — placeholder emite '' e
 *      trocaria o valor do filtro em silencio.
 *   2. Justificativas ja' tem combobox proprio para servidor; so' unidade e setor mudam.
 */
const fs = require('fs')

const ARQUIVOS = [
  {
    path: 'src/app/(dashboard)/afastamentos/page.tsx',
    selectsMantidos: 7,
    classes: {
      A1: 'w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm',
      A2: 'w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm disabled:opacity-50',
      A3: 'bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold',
    },
    trocas: [
      {
        de: [
          '              <select',
          '                value={selectedUnidade}',
          '                onChange={e => {',
          "                  setSelectedUnidade(e.target.value)",
          "                  setSelectedSetor('')",
          "                  setBuscaServidor('')",
          '                }}',
          '                className="A1"',
          '              >',
          '                <option value="">Selecione a Unidade</option>',
          '                {unidades.map(u => (',
          '                  <option key={u.id} value={u.id}>{u.nome}</option>',
          '                ))}',
          '              </select>',
        ],
        para: [
          '              <SelectComBusca',
          '                value={selectedUnidade}',
          '                onChange={v => {',
          '                  setSelectedUnidade(v)',
          "                  setSelectedSetor('')",
          "                  setBuscaServidor('')",
          '                }}',
          '                placeholder="Selecione a Unidade"',
          '                opcoes={unidades.map(u => ({ value: u.id, label: u.nome }))}',
          '                className="A1"',
          '              />',
        ],
      },
      {
        de: [
          '              <select',
          '                value={selectedSetor}',
          '                disabled={!selectedUnidade}',
          "                onChange={e => { setSelectedSetor(e.target.value); setBuscaServidor('') }}",
          '                className="A2"',
          '              >',
          '                <option value="">Selecione o Setor</option>',
          '                {setores',
          '                  .filter(s => s.unidade_id === selectedUnidade)',
          '                  .map(s => (',
          '                    <option key={s.id} value={s.id}>{s.nome}</option>',
          '                  ))}',
          '              </select>',
        ],
        para: [
          '              <SelectComBusca',
          '                value={selectedSetor}',
          '                disabled={!selectedUnidade}',
          "                onChange={v => { setSelectedSetor(v); setBuscaServidor('') }}",
          '                placeholder="Selecione o Setor"',
          '                opcoes={setores',
          '                  .filter(s => s.unidade_id === selectedUnidade)',
          '                  .map(s => ({ value: s.id, label: s.nome }))}',
          '                className="A2"',
          '              />',
        ],
      },
      {
        de: [
          '              <select',
          '                value={selectedServidor}',
          '                disabled={!selectedSetor}',
          '                onChange={e => setSelectedServidor(e.target.value)}',
          '                className="A2"',
          '              >',
          '                <option value="">Selecione o Servidor</option>',
          '                {servidores.map(s => (',
          '                  <option key={s.id} value={s.id}>',
          "                    {s.nome} {s.matricula ? `(${s.matricula})` : ''}",
          '                  </option>',
          '                ))}',
          '              </select>',
        ],
        para: [
          '              <SelectComBusca',
          '                value={selectedServidor}',
          '                disabled={!selectedSetor}',
          '                onChange={setSelectedServidor}',
          '                placeholder="Selecione o Servidor"',
          '                opcoes={servidores.map(s => ({',
          '                  value: s.id,',
          '                  label: s.nome,',
          '                  detalhe: s.matricula ? `Matricula ${s.matricula}` : undefined,',
          '                }))}',
          '                className="A2"',
          '              />',
        ],
      },
      {
        // Sentinela 'todas' — opcao normal, NAO placeholder.
        de: [
          '              <select ',
          '                className="A3"',
          '                value={filterUnidade}',
          '                onChange={(e) => {',
          '                  setFilterUnidade(e.target.value)',
          "                  setFilterSetor('todos')",
          '                }}',
          '              >',
          '                <option value="todas">Todas as Unidades</option>',
          '                {unidades.map(u => (',
          '                  <option key={u.id} value={u.id}>{u.nome}</option>',
          '                ))}',
          '              </select>',
        ],
        para: [
          '              <SelectComBusca',
          '                className="A3"',
          '                value={filterUnidade}',
          '                onChange={(v) => {',
          '                  setFilterUnidade(v)',
          "                  setFilterSetor('todos')",
          '                }}',
          '                opcoes={[',
          "                  { value: 'todas', label: 'Todas as Unidades' },",
          '                  ...unidades.map(u => ({ value: u.id, label: u.nome })),',
          '                ]}',
          '              />',
        ],
      },
      {
        de: [
          '              <select ',
          '                className="A3"',
          '                value={filterSetor}',
          '                onChange={(e) => setFilterSetor(e.target.value)}',
          '              >',
          '                <option value="todos">Todos os Setores</option>',
          '                {setores',
          "                  .filter(s => filterUnidade === 'todas' || s.unidade_id === filterUnidade)",
          '                  .map(s => (',
          '                    <option key={s.id} value={s.id}>{s.nome}</option>',
          '                  ))}',
          '              </select>',
        ],
        para: [
          '              <SelectComBusca',
          '                className="A3"',
          '                value={filterSetor}',
          '                onChange={setFilterSetor}',
          '                opcoes={[',
          "                  { value: 'todos', label: 'Todos os Setores' },",
          '                  ...setores',
          "                    .filter(s => filterUnidade === 'todas' || s.unidade_id === filterUnidade)",
          '                    .map(s => ({ value: s.id, label: s.nome })),',
          '                ]}',
          '              />',
        ],
      },
    ],
  },

  {
    path: 'src/app/(dashboard)/marcacoes/PendenciasTab.tsx',
    selectsMantidos: 3,
    classes: { B1: 'rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm' },
    trocas: [
      {
        de: [
          '          <select',
          '            value={filtroUnidade}',
          "            onChange={(e) => { setFiltroUnidade(e.target.value); setFiltroSetor(''); setFiltroServidor(''); setPagina(1) }}",
          '            className="B1"',
          '          >',
          '            <option value="">Todas as unidades</option>',
          '            {opcoes.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}',
          '          </select>',
        ],
        para: [
          '          <SelectComBusca',
          '            value={filtroUnidade}',
          "            onChange={(v) => { setFiltroUnidade(v); setFiltroSetor(''); setFiltroServidor(''); setPagina(1) }}",
          '            placeholder="Todas as unidades"',
          '            opcoes={opcoes.unidades.map((u) => ({ value: u.id, label: u.nome }))}',
          '            className="B1"',
          '          />',
        ],
      },
      {
        de: [
          '            <select',
          '              value={filtroSetor}',
          "              onChange={(e) => { setFiltroSetor(e.target.value); setFiltroServidor(''); setPagina(1) }}",
          '              className="B1"',
          '            >',
          '              <option value="">Todos os setores</option>',
          '              {setoresDaUnidade.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}',
          '            </select>',
        ],
        para: [
          '            <SelectComBusca',
          '              value={filtroSetor}',
          "              onChange={(v) => { setFiltroSetor(v); setFiltroServidor(''); setPagina(1) }}",
          '              placeholder="Todos os setores"',
          '              opcoes={setoresDaUnidade.map((s) => ({ value: s.id, label: s.nome }))}',
          '              className="B1"',
          '            />',
        ],
      },
      {
        de: [
          '          <select',
          '            value={filtroServidor}',
          '            onChange={(e) => mudarFiltro(() => setFiltroServidor(e.target.value))}',
          '            className="B1"',
          '          >',
          '            <option value="">Todos os servidores ({servidores.length})</option>',
          '            {servidores.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}',
          '          </select>',
        ],
        para: [
          '          <SelectComBusca',
          '            value={filtroServidor}',
          '            onChange={(v) => mudarFiltro(() => setFiltroServidor(v))}',
          '            placeholder={`Todos os servidores (${servidores.length})`}',
          '            opcoes={servidores.map(([id, nome]) => ({ value: id, label: nome }))}',
          '            className="B1"',
          '          />',
        ],
      },
    ],
  },

  {
    path: 'src/app/(dashboard)/justificativas/JustificativasClient.tsx',
    selectsMantidos: 5,
    classes: { C1: 'w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-xs font-bold text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-indigo-500 outline-none' },
    trocas: [
      {
        de: [
          '            <select',
          '              value={selectedSetor}',
          "              onChange={(e) => { setSelectedSetor(e.target.value); setSelectedServidor(''); setCurrentPage(1) }}",
          '              className="C1"',
          '            >',
          '              <option value="">Todos os Setores</option>',
          '              {filteredSetores.map(s => (',
          '                <option key={s.id} value={s.id}>{rotularInativo(s as any)}</option>',
          '              ))}',
          '            </select>',
        ],
        para: [
          '            <SelectComBusca',
          '              value={selectedSetor}',
          "              onChange={(v) => { setSelectedSetor(v); setSelectedServidor(''); setCurrentPage(1) }}",
          '              placeholder="Todos os Setores"',
          '              opcoes={filteredSetores.map(s => ({ value: s.id, label: rotularInativo(s as any) }))}',
          '              className="C1"',
          '            />',
        ],
      },
    ],
  },
]

const IMPORT = "import { SelectComBusca } from '@/components/ui/SelectComBusca'"

for (const arq of ARQUIVOS) {
  let s = fs.readFileSync(arq.path, 'utf8')
  const crlf = s.includes('\r\n')
  const EOL = crlf ? '\r\n' : '\n'
  const expandir = (linhas) => {
    let r = linhas.join(EOL)
    for (const [k, v] of Object.entries(arq.classes || {})) r = r.split(k).join(v)
    return r
  }

  let feitas = 0
  for (const t of arq.trocas) {
    const de = expandir(t.de)
    const para = expandir(t.para)
    const n = s.split(de).length - 1
    if (n !== 1) throw new Error('ABORTA ' + arq.path + ': ' + n + ' ocorrencias de\n' + de.slice(0, 160))
    s = s.split(de).join(para)
    feitas++
  }

  if (!s.includes(IMPORT)) {
    // Ancora: a ULTIMA linha de import do arquivo — nao depende de um import especifico existir.
    const linhas = s.split(EOL)
    let ult = -1
    for (let i = 0; i < linhas.length; i++) if (/^import /.test(linhas[i])) ult = i
    if (ult < 0) throw new Error('ABORTA: nenhum import em ' + arq.path)
    linhas.splice(ult + 1, 0, IMPORT)
    s = linhas.join(EOL)
  }

  const restantes = s.split('<select').length - 1
  if (restantes !== arq.selectsMantidos) {
    throw new Error('ABORTA ' + arq.path + ': sobraram ' + restantes + ' <select>, esperado ' + arq.selectsMantidos)
  }
  fs.writeFileSync(arq.path, s)
  console.log('  ' + arq.path + ': ' + feitas + ' trocas, ' + restantes + ' <select> nativos mantidos')
}
