import fs from 'node:fs'

const p = 'CHANGELOG.md'
let s = fs.readFileSync(p, 'utf8')
const EOL = s.includes('\r\n') ? '\r\n' : '\n'
const eol = t => t.split('\n').join(EOL)

const ancora = `## [2.59.0] - 2026-09-13`

const novo = `## [2.60.0] - 2026-09-14

Sem migration. Dois setores eram a mesma coisa em 27 unidades — \`SERVICOS GERAIS\` e
\`ASG AGENTE DE SERVICOS GERAIS\` —, e onde os dois existiam na mesma unidade a transferencia
oferecia as duas opcoes na arvore de destino. Diario em
\`docs/evolucao/2026-09-14-padronizacao-asg-e-aviso-de-nome-parecido.md\`.

### Added

- **Aviso de nome de setor parecido no cadastro e na edicao.** Ao digitar um nome semelhante a um
  ja cadastrado, a tela lista os parecidos, oferece botao para **usar o existente** e exige
  confirmacao explicita para criar nome novo. A recusa vive na server action, nao na tela (tela
  nao e defesa); a confirmacao **zera a cada tecla**, para nao passar sem a lista nova ter sido
  vista. Nome identico depois de normalizar acento, caixa e pontuacao (\`SERVICOS GERAIS\` x
  \`SERVIÇOS GERAIS\`) **reusa a entrada existente**, sem perguntar nada.
- Fonte unica em \`src/utils/setores/nomeSetor.ts\`, com portoes
  \`scratchpad/sim_nome_setor.js\` (40 assercoes) e \`val_sim_nome_setor.js\` (7 regressoes
  injetadas, 7 reprovadas).

### Changed

- **Dados de producao padronizados** (aplicado em 14/09/2026, conferido depois): 27 setores
  \`SERVICOS GERAIS\` e 1 \`ASG\` passaram a \`ASG AGENTE DE SERVICOS GERAIS\`, e as duas entradas
  saem do dicionario. **76 lotados, 91 escalas e 640 marcacoes preservados** — renomear setor e
  repontar \`dicionario_setor_id\`, entao o registro continua o mesmo. Na USF Pedro Cavalcante, a
  unica unidade com os dois, houve **fusao** (\`fn_fundir_setor\`, sem impedimentos): 1 servidora,
  1 historico, 1 solicitacao e 1 log movidos.
- Manual do usuario ganhou "Dois nomes para o mesmo setor" em *Os cadastros que definem as regras*.

### Notes

- 🚨 **O criterio do aviso saiu de medicao.** A primeira versao disparava em **94 dos 248** nomes
  do dicionario (37,9%) e acusava pares legitimos (\`CARDIOLOGIA\` x \`RADIOLOGIA\`, \`BLOCO A\` x
  \`BLOCO B\`). Tres cortes levaram a **35 de 248 (14,1%)**, media 1,2 sugestao, com o caso real
  continuando pego. Reproduzivel por \`node scratchpad/an_ruido_nome_setor.mjs\`.
- A transferencia **ja pedia** o setor de destino explicitamente e nao cria setor sozinha — o
  defeito era a lista ter duas opcoes validas. Nenhuma mudanca foi feita naquele fluxo.

${ancora}`

const achou = s.split(eol(ancora)).length - 1
if (achou !== 1) {
  console.error(`ABORTA: ancora achada ${achou}x, esperado 1x`)
  process.exit(1)
}
fs.writeFileSync(p, s.split(eol(ancora)).join(eol(novo)))
console.log('CHANGELOG.md: entrada 2.60.0 acrescentada')
