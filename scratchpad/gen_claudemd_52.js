// Acrescenta a armadilha 52 ao CLAUDE.md e faz o bump de versao (05/09/2026).
const fs = require('fs')
const CR = String.fromCharCode(13), NL = String.fromCharCode(10)

// ---------------- CLAUDE.md ----------------
const P = 'CLAUDE.md'
let s = fs.readFileSync(P, 'utf8')
const CRLF = s.indexOf(CR + NL) >= 0
if (CRLF) s = s.split(CR + NL).join(NL)
const antes = s.length

const ANCORA = '## Convenções'
if (s.split(ANCORA).length - 1 !== 1) { console.error('ABORTA: ancora "## Convenções" nao unica'); process.exit(1) }

const TEXTO = [
'### 52. O indicador somava certo a coisa errada, e os relatórios cortavam em 1.000 (05/09/2026)',
'',
'⚠️ **Oito defeitos numa passada, e sete deles eram de LEITURA — nenhuma migration.** Começou com',
'o usuário desconfiando das 25.287h de plantão do painel em 09/2026. **O número estava certo**',
'(2.338 plantões de 318 servidores, 89% do HMI, ~6,6 plantões de 12h por pessoa; o "+742% contra',
'agosto" é implantação, não trabalho novo). Diário em',
'[`docs/evolucao/2026-09-05-indicadores-do-painel-e-corte-de-1000-nos-relatorios.md`](docs/evolucao/2026-09-05-indicadores-do-painel-e-corte-de-1000-nos-relatorios.md).',
'',
'🚨 **QUATRO relatórios agregados nunca paginaram** (armadilha 8). Medido em 05/09/2026:',
'',
'| tela | linhas reais | via | ausente |',
'|---|---|---|---|',
'| `/relatorios/rh` | 2.362 | 1.000 | **58%** |',
'| `/relatorios/plantao-sobreaviso` | 2.362 (ano) | 1.000 | **58%** |',
'| `/relatorios/distribuicao` (09/2026) | 2.338 | 1.000 | **57%** |',
'| `/relatorios/consolidado` (09/2026) | 1.384 | 1.000 | **28%** |',
'',
'⚠️ **Em 08/2026 os quatro cabiam em 1000 e pareciam corretos** — foi a entrada do HMI em 09/2026',
'que revelou o corte. **Relatório que hoje cabe não está seguro; só ainda não estourou.**',
'',
'⚠️ **O `.range` que existia em duas dessas telas engana**: era a paginação da lista de',
'**servidores do seletor**, não a das escalas. Ao auditar paginação, confira **qual** consulta',
'está paginada.',
'',
'⚠️ `/relatorios/rh` **não filtra período e não tinha `ORDER BY`** — o recorte de 1.000 era',
'arbitrário e sem garantia de ser o mesmo a cada carregamento. `plantao-sobreaviso` filtrava os',
'meses **em JS, depois da consulta**, então o corte acontecia sobre o ano inteiro.',
'',
'Fonte única: **`src/utils/paginacao.ts`**. ⚠️ **`.order(...)` não é detalhe** — sem ele o Postgres',
'não garante ordem entre páginas e a linha repete numa e falta noutra, o que dá resultado errado',
'*com* paginação. ⚠️ **Falha no meio devolve `completo: false`** e a tela mostra',
'`AvisoDadosIncompletos`: trocar um número errado por outro número errado não resolve nada',
'(armadilha 22).',
'',
'🚨 **O painel era o ÚLTIMO lugar a somar o vão do relógio no Regular** (armadilha 46) — a grade,',
'o `/relatorios/consolidado` e a folha já descontavam. Em 09/2026: painel **163.392h** contra',
'**126.175h** das outras três telas, **37.217h (22,8%)** de diferença na mesma competência, com o',
'número maior justamente na tela de decisão. Fonte única agora em',
'**`src/utils/escala/horasLinha.ts`**, compartilhada com o consolidado.',
'',
'| categoria | regra |',
'|---|---|',
'| `Regular` | `LEAST(horas_computadas, horas_totais − intervalo/60)` |',
'| `Plantão` · `Extra` | `horas_computadas` cheio — é trabalho **além** do expediente |',
'| `Sobreaviso` | **0** na carga; prontidão sai por `horasProntidaoSobreaviso`, com rótulo próprio |',
'',
'⚠️ **O teto é `LEAST`, nunca substituição** (`M4` de 4h vale 4h), **jornada irresolvível não vira',
'8h** (fica sem teto — inventar padrão muda a conta de quem faz 6h ou 12h) e **não replique',
'`decomporPlantao` ali** (armadilha 16): as unidades PL são das colunas de pagamento, o total é',
'`horas_computadas` somado.',
'',
'ℹ️ A fórmula do consolidado **já estava certa** — o defeito era ser a terceira cópia. **Duas',
'cópias certas e uma errada** foi o que produziu as 37 mil horas de divergência.',
'',
'⚠️ **Os outros quatro são todos a mesma classe de erro: o número não responde o que o rótulo',
'pergunta.**',
'',
'| card | dizia | era |',
'|---|---|---|',
'| "Escalas Ativas" | `113` grades **e** `694 fechadas` (08/2026) | grades × linhas por servidor, lado a lado |',
'| "Em serviço hoje" | 207 | **188 pessoas** — Regular + Plantão no mesmo dia contava 2x |',
'| barras do gráfico | piso de 4% | Sobreaviso 156h e Regular 13.218h na mesma altura |',
'| "Servidores" | 2.065 + 5 | os **10 `Afastado`** não entravam em nenhum dos dois |',
'',
'⚠️ **Contar PESSOAS custa o `head: true`**: deduplicar exige trazer `servidor_id`, e trazer linhas',
'exige paginar. Contagem exata é barata e imune ao corte de 1.000; deduplicação não é.',
'',
'⚠️ **Uma grade só é "fechada" quando TODAS as escalas dela estão Fechadas** — fechar 3 servidores',
'de 40 não fecha o setor. E o card "Servidores" passou a derivar o resto de uma contagem **total**',
'em vez de enumerar status: status novo passa a ser somado sozinho, em vez de sumir.',
'',
'⚠️ **O gráfico é escala PREVISTA, não hora trabalhada**, e agora diz isso. Sem essa palavra, a',
'variação percentual entre meses é lida como aumento de trabalho quando na maior parte é',
'implantação. Hora realizada é a folha.',
'',
'ℹ️ **Produção é viva**: remedindo uma hora depois, 09/2026 tinha ido de 19.361 para 19.373 linhas.',
'Não compare medições de horários diferentes como se fossem a mesma.',
'',
'ℹ️ Continua aberto: **13 pares (servidor, dia, categoria) com duas escalas em 09/2026, 126h em',
'dobro** (armadilha 23) — anteriores à trava `20260826220000`. Não foram tocados: é decisão de',
'escala, não de indicador.',
'',
'Portões: `node scratchpad/sim_horas_escala.js` (39 asserções) e',
'`node scratchpad/val_sim_horas_escala.js`, que injeta **5 regressões e exige reprovação nas 5**.',
'Transpile antes com',
'`npx tsc src/utils/escala/horasLinha.ts src/utils/paginacao.ts --outDir scratchpad/_sim --module commonjs --target es2020`.',
'`node scratchpad/an_confere_painel_novo.mjs` roda a consulta e a conta novas contra produção —',
'inclusive o embed `escala_mensal!inner(jornadas(...))`, que só se prova executando (armadilha 8b).',
'',
'🚨 **A lição que vale além destas telas: a soma estava certa; o que se somava, não.** Quando um',
'número parece grande demais, a primeira pergunta não é "a conta bate?" — é **"esse número responde',
'a pergunta que o rótulo faz?"**.',
'',
''
].join(NL)

s = s.split(ANCORA).join(TEXTO + ANCORA)
fs.writeFileSync(P, CRLF ? s.split(NL).join(CR + NL) : s)
console.log(P + ': armadilha 52 acrescentada, ' + antes + ' -> ' + s.length + ' bytes')

// ---------------- package.json ----------------
const PJ = 'package.json'
let pj = fs.readFileSync(PJ, 'utf8')
const de = '"version": "2.41.3"'
if (pj.split(de).length - 1 !== 1) { console.error('ABORTA: versao 2.41.3 nao encontrada'); process.exit(1) }
pj = pj.split(de).join('"version": "2.42.0"')
fs.writeFileSync(PJ, pj)
console.log('package.json: 2.41.3 -> 2.42.0')
