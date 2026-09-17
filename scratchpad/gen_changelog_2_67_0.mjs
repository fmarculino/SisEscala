// Insere a entrada da v2.67.0 no topo do CHANGELOG, depois do cabeçalho.
// Aborta se a entrada ja existir (idempotente) ou se o cabecalho nao for o esperado.
import fs from 'node:fs'

const P = 'CHANGELOG.md'
const txt = fs.readFileSync(P, 'utf8')
const eol = txt.includes('\r\n') ? '\r\n' : '\n'

if (txt.includes('## [2.67.0]')) {
  console.error('A entrada 2.67.0 ja existe — nada a fazer.')
  process.exit(0)
}

const ancora = `## [2.66.0]`
const i = txt.indexOf(ancora)
if (i < 0) {
  console.error('Nao achei "## [2.66.0]" no CHANGELOG — o cabecalho mudou, reveja a ancora.')
  process.exit(1)
}

const entrada = [
  '## [2.67.0] - 2026-09-16',
  '',
  'Duas migrations: `20260916110000` (o regime de apuracao e a janela) e `20260916120000` (o',
  'documento emitido). Plano em',
  '`docs/planos/2026-09-14-periodo-de-apuracao-da-folha-mais-medicos.md`, Fases 0 a 4.',
  '',
  '🚨 **Nada mudou de valor.** Nenhum servidor foi atribuido ao regime, nenhum documento foi',
  'emitido, e os 2.647 ativos continuam com a folha apurada do dia 1 ao ultimo dia do mes. A',
  'conferencia dentro da migration **aborta** se isso deixar de ser verdade.',
  '',
  '### Added',
  '',
  '- **Periodo de apuracao da folha diferente do mes civil.** O Mais Medicos fecha a frequencia no',
  '  dia 20: o periodo vai de **21 de um mes a 20 do seguinte**. Nao e norma federal (procurada e',
  '  nao localizada) — e convencao de anos, e a folha do municipio ja operou assim. Por isso o corte',
  '  e **cadastro** (`folha_regimes`), nunca constante no codigo, e a **competencia e o mes em que o',
  '  periodo FECHA**: 21/08 a 20/09 e a competencia 09/2026.',
  '- **O regime mora no VINCULO, nao no setor**, com vigencia e historico append-only',
  '  (`folha_regime_vigencias`). Setor dita o escopo do relogio: um setor artificial por regime cria',
  '  ponto cego de biometria, e duas pessoas do mesmo setor podem ter regimes diferentes. A',
  '  resolucao tem tres niveis — linha do servidor, **linha global** (`servidor_id NULL`, que liga o',
  '  corte para a rede inteira com UMA linha) e o padrao do catalogo.',
  '- **Secao "Periodo de apuracao da folha"** na ficha do servidor (aba Alteracoes de Jornada), com',
  '  a janela escrita por extenso e previa dos numeros do periodo.',
  '- **Tela `/folha-ponto/apuracoes`**: previa, emitir, imprimir, retificar e revogar. O documento e',
  '  um **snapshot append-only por versao**, com autoria e fingerprint — reimprimir sai do snapshot,',
  '  nunca da folha de hoje, e e isso que faz o PDF de outubro ser identico ao entregue em setembro.',
  '',
  '### Fixed / decidido',
  '',
  '- 🚨 **A soma do periodo e feita POR METADE, nunca numa chamada unica.** O periodo 21->20',
  '  atravessa o corte de vigencia das regras de folha: medido nos 4 medicos, os dias de 08/2026',
  '  valem **10h/dia** (vao bruto, regra antiga) e os de 09/2026 **8h/dia** (liquido, desde',
  '  `horas_normais_liquidas_desde = 2026-09`). `totaisFolha` recebe UMA competencia e UMA carga por',
  '  dia — chama-la uma vez sobre os 31 dias tiraria **40h somando as 4 apuracoes**, num documento',
  '  que o servidor assina e divergindo da folha de agosto, que esta Revisada.',
  '- **A apuracao DERIVA da folha, nunca recalcula.** Uniformizar a regua daria um documento',
  '  internamente coerente e errado: o numero nao existiria em folha nenhuma.',
  '- **A folha NAO e congelada pela emissao.** Congelar impediria a correcao de batida mal alocada',
  '  (a licao de preservar campo `real`). Quando a folha muda depois, a tela **avisa o que mudou** e',
  '  o caminho e retificar — versao nova, com motivo —, nunca editar o que foi entregue.',
  '- **O inicio do periodo e "fim do periodo anterior + 1 dia"**, nunca "dia_corte + 1 do mes',
  '  anterior": com corte 28 em marco o dia 29 de fevereiro nao existe. Assim os periodos',
  '  consecutivos ficam contiguos, e nenhum dia cai em dois documentos nem em nenhum.',
  '',
  '### Portoes',
  '',
  '- `scratchpad/sim_periodo_apuracao.js` (67) + `val_` (**9 regressoes, 9 reprovadas**)',
  '- `scratchpad/sim_apuracao_periodo.js` (**87**) + `val_` (**15 regressoes, 15 reprovadas**)',
  '- `scratchpad/sim_manual.js` (**914**) — a secao nova do manual entrou no mesmo commit',
  '- producao, executando as funcoes: `ver_regime_apuracao_producao.mjs` (**26 de 26**) e',
  '  `ver_apuracao_producao.mjs` (**20 de 20**)',
  '- medicao real: `an_apuracao_mais_medicos.mjs --corte20` (ensaio sem gravar nada)',
  '',
  '',
].join(eol)

fs.writeFileSync(P, txt.slice(0, i) + entrada + txt.slice(i))
console.log('Entrada 2.67.0 inserida no CHANGELOG.')
