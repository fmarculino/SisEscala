const fs = require('fs')
const path = 'CHANGELOG.md'
let src = fs.readFileSync(path, 'utf8')
const EOL = src.includes('\r\n') ? '\r\n' : '\n'
const L = (...linhas) => linhas.join(EOL)

const ANCORA = '## [2.68.0] - 2026-09-16'
if (src.split(ANCORA).length - 1 !== 1) {
  console.error('ABORTADO: ancora da versao anterior nao encontrada exatamente uma vez')
  process.exit(1)
}

const NOVO = L(
  '## [2.69.0] - 2026-09-17',
  '',
  'Sem migration. Fecha a issue #4. Diario em',
  '`docs/evolucao/2026-09-17-navegacao-entre-folhas-de-ponto.md`.',
  '',
  '### Added',
  '',
  '- **Navegacao entre folhas de ponto**, no mesmo molde da grade de escala: setas',
  '  **Anterior / Proxima**, contador **X de N** e o nome de quem vem a seguir. As setas percorrem',
  '  **a mesma lista** que o usuario viu em Folha de Ponto — mesmo filtro, mesma ordem —, entao',
  '  conferir uma competencia deixou de exigir voltar a listagem e reescolher unidade, setor e mes',
  '  a cada servidor.',
  '- **Voltar a lista preserva os filtros E a pagina.** Quem estava na pagina 7 de uma unidade',
  '  grande volta para a pagina 7. Os filtros viajam na query `origem` da folha aberta; a URL vence',
  '  o `sessionStorage`, que continua valendo para visitas avulsas.',
  '- **Caminho de volta para a grade da escala** — o inverso do clique no nome do servidor, que ja',
  '  existia na grade. Por dois lugares: o botao **Ver na Escala** na barra e o **nome do setor** no',
  '  cabecalho do documento.',
  '- Fonte unica do filtro, da ordem e dos filtros na URL em **`src/utils/folhaNavegacao.ts`**,',
  '  compartilhada pela listagem, pelas duas actions que montam a lista e pela barra. Sem ela,',
  '  "proxima folha" pularia ou repetiria gente em relacao a lista de origem.',
  '- Manual do usuario atualizado no mesmo commit (Ajuda > O Ponto > A Folha de Ponto).',
  '',
  '### Fixed',
  '',
  '- **A ordem da lista de folhas era `nome.localeCompare(nome)` PURA, e a base tem nomes',
  '  identicos** — duplo vinculo e a mesma pessoa em duas matriculas. Empate sem desempate deixa a',
  '  ordem indefinida: toleravel numa lista que se le de uma vez, inaceitavel numa seta "proxima",',
  '  onde duas visitas percorreriam ordens diferentes. Desempate por matricula, escala e servidor.',
  '',
  '### Changed',
  '',
  '- `getServidoresFolhaPonto` teve o miolo extraido para uma funcao interna, e a barra consome',
  '  `getSequenciaFolhasPonto` — **a mesma consulta, sem o `autoCloseExpiredScalesAndTimesheets`**.',
  '  O fechamento automatico continua atrelado a abrir a lista; roda-lo a cada seta seria varrer a',
  '  competencia inteira para desenhar um contador. O que nao se podia fazer era dar a barra uma',
  '  consulta propria.',
  '',
  '### Portoes',
  '',
  '- `node scratchpad/sim_folha_navegacao.js` — 60 assercoes.',
  '- `node scratchpad/val_sim_folha_navegacao.js` — 10 regressoes injetadas, 10 reprovadas.',
  '- `node scratchpad/sim_manual.js` — 931 assercoes.',
  '',
  ANCORA
)

src = src.split(ANCORA).join(NOVO)
fs.writeFileSync(path, src)
console.log('OK: CHANGELOG 2.69.0')
