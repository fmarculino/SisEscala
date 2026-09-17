const fs = require('fs')
const path = 'CHANGELOG.md'
let src = fs.readFileSync(path, 'utf8')
const EOL = src.includes('\r\n') ? '\r\n' : '\n'
const L = (...linhas) => linhas.join(EOL)

if (src.includes('## [2.70.0]')) {
  console.log('JA APLICADO — nada a fazer')
  process.exit(0)
}

const ANCORA = '## [2.69.0] - 2026-09-17'
if (src.split(ANCORA).length - 1 !== 1) {
  console.error('ABORTADO: ancora da versao anterior nao encontrada exatamente uma vez')
  process.exit(1)
}

const NOVO = L(
  '## [2.70.0] - 2026-09-17',
  '',
  'Sem migration. Fecha a issue #5. Diario em',
  '`docs/evolucao/2026-09-17-template-nao-preenche-feriado.md`.',
  '',
  '### Fixed',
  '',
  '- **O Aplicar Template preenchia feriado, e a marcacao retroativa daquele dia nao podia mais',
  '  ser apagada.** Preencher o feriado junto com "Validar dias passados" gravava presenca numa',
  '  celula que fica protegida depois ("Direito Adquirido"), e o coordenador nao tinha como',
  '  desfazer. O feriado passa a ficar de fora, como sabado e domingo ja ficavam na escala de',
  '  segunda a sexta. **Se houve trabalho no feriado, o dia e lancado a mao** — ou a caixa nova e',
  '  desmarcada, para a equipe que trabalha em todo feriado.',
  '  - Vale para **todos** os modelos, inclusive os ciclicos (12x36, 12x48, 6x1): e justamente o',
  '    plantonista que gera a presenca retroativa impossivel de apagar. O ciclo **nao se desloca**',
  '    — o dia fica vazio e a escala segue igual.',
  '  - O modal **mostra quais sao os feriados do mes**, e o relato do fim **lista os dias que',
  '    ficaram de fora** ao lado dos que ja eram relatados (ponto, afastamento, outro setor).',
  '- **O menu Ferramentas ficava cortado em escala com poucos servidores.** O painel era',
  '  `position: absolute` dentro do card da grade, que tem `overflow-hidden`: com um servidor so,',
  '  o card e baixo e o menu sumia na terceira opcao — **sem barra de rolagem e sem nenhum sinal**',
  '  de que havia mais. Na pratica, "Revezamento de Vigias", "Preencher pelas Batidas" e "Validar',
  '  em Massa" nao existiam para quem abria uma escala pequena. O menu passou a ser desenhado em',
  '  portal, fora do card, com abertura para cima quando nao cabe embaixo e rolagem por dentro',
  '  quando nao cabe inteiro.',
  '',
  '### Added',
  '',
  '- `diasDeFeriado` em `src/utils/scaleTemplates.ts` — compara **string `YYYY-MM-DD`**, nunca',
  '  `new Date`: o processo roda em UTC e `new Date(\'2026-09-07\')` e dia **6** em America/Sao_Paulo',
  '  (armadilha 12), o que pularia o dia errado.',
  '- `src/utils/ui/posicaoFlutuante.ts` — onde desenhar um painel ancorado num botao, com teto de',
  '  altura pelo espaco real. E ele que troca "item escondido" por "menu que rola".',
  '- Manual do usuario atualizado no mesmo commit (Ajuda > Escalas > Preenchendo rapido).',
  '',
  '### Portoes',
  '',
  '- `node scratchpad/sim_template_feriado.js` — 29 assercoes.',
  '- `node scratchpad/sim_posicao_flutuante.js` — 17 assercoes.',
  '- `node scratchpad/val_sim_template_feriado.js` — 10 regressoes injetadas, 10 reprovadas.',
  '- `node scratchpad/sim_manual.js` — 937 assercoes.',
  '',
  ANCORA
)

src = src.split(ANCORA).join(NOVO)
fs.writeFileSync(path, src)
console.log('OK: CHANGELOG 2.70.0')
