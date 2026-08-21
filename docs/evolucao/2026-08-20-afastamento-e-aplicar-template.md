# Aplicar Template escrevia em cima de afastamento — 20/08/2026

## O relato

Cadastrar um afastamento na grade, depois usar **Aplicar Template**, escolher o servidor e um
padrão (12×36, 5×2, 6×1): o `MT` aparecia no meio das férias. Pela célula, digitar o mesmo `MT`
naquele dia sempre foi recusado.

## O que estava acontecendo

O bloqueio existia em **três** camadas — e o template não passava por nenhuma delas:

| camada | onde | o template passava? |
|---|---|---|
| validação local da célula | `handleCellChange` (`ScaleGrid.tsx`) | não passava: escreve direto em `gridData` |
| RPC de conflito | `fn_check_shift_conflicts`, chamada por `handleCellChange` | idem |
| trigger do banco | `fn_prevent_shift_during_event`, `BEFORE INSERT OR UPDATE ON escala_diaria` | **este pegava — só que no "Salvar Previsão"** |

Medido em produção em 20/08/2026 antes de mexer: **131 afastamentos na base, 2.340 linhas de
`escala_diaria` dos servidores afastados, ZERO linhas gravadas dentro de afastamento
bloqueante**, em qualquer categoria. O banco nunca deixou passar. `fn_check_shift_conflicts`,
consultada ao vivo para um caso real de férias, recusa `MT`, `M` e `N` nas quatro categorias.

Ou seja: o dado nunca chegou a ser gravado — **mas o estrago era outro e é pior do que parece.**
O `handleSave` monta um upsert em lote com o mês inteiro de todos os servidores da grade. Uma
única linha em dia de afastamento faz o trigger abortar **todo** o salvamento, com a mensagem
crua do Postgres. O coordenador via o template aplicado na tela, salvava, e perdia o resto do
trabalho sem entender qual dia era o culpado.

## O que mudou

**Fonte única da regra: `src/utils/afastamentos.ts`.** A mesma regra estava copiada em quatro
lugares do frontend, cada um com uma diferença:

- `handleCellChange` ignorava os slots do afastamento e o afastamento por horas — recusava o que
  o banco aceita (declaração de comparecimento de 2h bloqueava o dia inteiro);
- o render da célula, o portal do servidor e a impressão respeitavam os slots, mas nenhum
  reconhecia `periodo_tipo = 'horas'` (migration `20260817210000`), então pintavam de vermelho e
  travavam um dia que o banco deixa escalar;
- o gerador inteligente apagava o dia inteiro para **qualquer** evento, inclusive o de horas.

Os cinco passaram a chamar `encontrarAfastamentoBloqueante`, que espelha o SQL:

1. afastamento por **horas** não bloqueia nada;
2. afastamento por **slot** bloqueia só os turnos cujos slots cruzam o período afastado;
   integral bloqueia qualquer turno;
3. **`Regular` e `Sobreaviso` nunca** são liberados pela configuração
   `permitir_plantao_extra_durante_eventos` — que, pelo nome, sempre foi sobre plantão e extra.

Nos caminhos que escrevem:

| caminho | comportamento novo |
|---|---|
| **Aplicar Template** | dia de afastamento entra no mesmo conjunto de dias pulados que a presença confirmada; o alerta final diz quantos e quais dias ficaram de fora |
| **Aplicar Template** | dia com presença confirmada deixou de ser **apagado** quando o padrão diz folga — a tela já prometia que ele "não será sobrescrito" |
| **Gerador Inteligente** | não escreve em dia de afastamento nem com "Evitar Dias de Afastamento" desmarcado: aquela opção governa o padrão de folgas, não a regra legal |
| **Salvar Previsão** | valida antes de mandar ao banco e lista servidor, dia, linha e tipo de afastamento, em vez de deixar o trigger derrubar o lote |

## Banco (`20260820120000_block_all_categories_during_leave.sql`)

Cópia mecânica de `20260817210000` por `scratchpad/gen_afastamento_categorias.js` (armadilha 1):

- `fn_prevent_shift_during_event` e `fn_check_shift_conflicts`: `Sobreaviso` passa a ser barrado
  junto com `Regular`, independentemente da configuração de governança;
- `fn_clean_conflicting_shifts`: ao cadastrar afastamento com a configuração ligada, limpa
  `Regular` **e** `Sobreaviso`, não só `Regular`;
- o `RAISE EXCEPTION` do trigger usava `%s` onde plpgsql só entende `%` — a mensagem saía com um
  `s` solto colado ao nome do afastamento;
- o gatilho `trigger_prevent_shift_during_event` é recriado no fim, para a migration não depender
  de o ambiente já tê-lo instalado.

Nenhuma linha existente passa a violar a regra nova (a medição de zero conflitos acima cobre
todas as categorias), então o trigger não quebra `UPDATE` de linha já gravada.

## O que deliberadamente NÃO mudou

Afastamento **parcial** continua parcial. Bloquear o dia inteiro seria mais simples, e foi
descartado: inutilizaria a declaração de comparecimento por horas — quem se ausenta 2h ficaria
sem escala no dia, e a folha de ponto do dia inteiro iria junto.
