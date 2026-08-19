# Mudança de jornada no meio da escala — 19/08/2026

## A pergunta

> "Se o horário regular de um servidor mudar no meio do mês — redução de jornada obtida na
> justiça, acordo, ou até por engano — isso altera todos os horários anteriores? Estou avaliando
> bloquear a alteração quando já existe marcação real. Essa preocupação é válida?"

A resposta curta: **o mecanismo é real, a ocorrência hoje é zero, e o bloqueio era o remédio
errado.** Este documento registra como isso foi medido e o que foi feito no lugar.

## O mecanismo

`escala_mensal.jornada_id` é **uma jornada por (servidor, mês)** — não tem vigência. Trocar no
dia 12 não muda "dali pra frente": reescreve a premissa dos dias 1 a 11 também, porque
`fn_blocos_previstos_dia`, `fn_confirmar_presenca` e a geração da folha leem essa coluna para
**todo** dia do mês.

| o que | muda retroativamente? |
|---|---|
| Batidas reais (`marcacoes_ponto`, `linha_bruta` do AFD) | **Não.** Insert-only, imutável |
| `escala_diaria.presenca_*` já gravados | **Não** sozinhos — são snapshot |
| Horário **previsto** de todos os dias do mês | **Sim, imediatamente** |
| Folha (intervalo pré-assinalado, hora extra, falta, total) | **Sim**, na próxima geração/sincronização |
| Janela de tolerância do terminal | Sim, para batidas novas |
| Alocação de batidas REP em dias passados | **Sim, mas só quando algo re-rodar** |

O último é o traiçoeiro. A reconciliação roda só para os dias das batidas do lote
(`reconciliacaoHelper.ts`), então dias passados não são realocados na hora — mas um lote atrasado
da fila offline ou um `fn_reparse_afd_dispositivo` re-roda com a jornada nova. O erro fica
latente.

E não havia **nenhum** registro da troca: `escala_mensal` não tinha trigger de auditoria.

## A medição (produção, competência 08/2026)

Sem auditoria, a frequência não era consultável — só inferível pelas batidas. Dois proxies, e um
descartado no caminho.

**Proxy descartado — `updated_at`.** 167 de 224 escalas (75%) foram editadas depois da primeira
batida real. **Não serve como evidência**: o `handleSave` da grade faz upsert de todas as linhas
a cada "Salvar Previsão", então o carimbo sobe com ou sem troca de jornada. Ficou registrado no
cabeçalho de `scratchpad/diag_troca_jornada.js` para ninguém reusar o número achando que mede
troca.

**Proxy que vale — quebra no horário praticado.** Para cada escala com ≥6 dias de batida real,
procura o ponto de corte no mês que maximiza a diferença entre a mediana de entrada antes e
depois, exigindo homogeneidade dos dois lados.

| sinal | resultado |
|---|---|
| Quebra ≥90 min dentro do mês | **0** de 134 escalas mensuráveis |
| Maior salto observado | 47 min — e *convergindo* para o previsto, não se afastando |
| Mediana dos maiores saltos | 7 min (variação normal de chegada) |
| Jornada desalinhada do praticado o mês inteiro >60 min | **0** de 145 |
| Desalinhamento ≤15 min | 109 de 145 (75%) |

**Jornada temporária — o instrumento datado quase não é usado:** 5 registros em toda a base, 4
servidores, zero sobreposições, duração mediana 16 dias. Os motivos são todos operacionais
("acordo interno", "necessidade de curso no LACEM", cobrir férias). **Nenhum** é redução
judicial — ou seja, o caso que motivou a pergunta nunca passou por lá.

### Junho e julho não são mensuráveis — e o motivo importa

`escala_diaria.presenca_*_origem` só existe desde `20260808020000`, então nos meses anteriores a
coluna é nula e o filtro por origem zera tudo. A heurística da armadilha 5 (segundos ≠ `:00`)
tampouco salva: a **validação em massa antiga gravou o instante da validação como se fosse a
batida**. HUGO MARCELO OSORIO tem os dias 1 a 17 de junho todos com entrada *e* saída em
`18/06 20:3x`, com segundos reais; LUCIA LAYANE, idem. Competências **Fechadas**.

É o comportamento que a v1.22.0 corrigiu, então não está mais acontecendo. Mas fica o registro:
**segundos reais não provam batida real em dado anterior a 08/08/2026.**

## Por que não bloquear

Bloquear a troca quando há batida resolveria o engano e **proibiria a redução judicial**, que é
justamente o caso que vai acontecer. E não resolveria bem nem o engano: sem registro, engano e
correção intencional são indistinguíveis.

A peça certa já existia e estava 80% pronta. `obter_jornada_servidor_data(servidor, data,
jornada_do_mês)` é chamada **de dentro** de `fn_confirmar_presenca` e `fn_blocos_previstos_dia`
— terminal, REP, reconciliação e folha já respeitam vigência por data. Faltava acabamento e um
caminho na tela.

## O que foi feito

### 1. Rastro (`20260819230000`)

`escala_mensal_jornada_historico` (append-only) + trigger + RPC.

A **trigger** pega qualquer troca, inclusive o upsert da grade; o filtro `IS DISTINCT FROM` evita
que o "Salvar Previsão" vire ruído. A **RPC** `fn_alterar_jornada_escala_mensal` existe para
carregar a justificativa, que a trigger sozinha não teria como receber: publica o texto num GUC
local à transação (`set_config(..., true)`) e a trigger o consome. Um ponto de gravação, dois
caminhos de entrada.

### 2. Vigência confiável (`20260819240000` + TypeScript)

| item | o que era | o que passou a ser |
|---|---|---|
| resolução | `LIMIT 1` **sem `ORDER BY`** | `ORDER BY created_at DESC, data_inicio DESC, id DESC` — a decisão mais recente vence |
| sobreposição | nada impedia | trigger `trg_vigencia_jornada_sem_sobreposicao` |
| totais da folha | jornada do mês para todo dia | `horasNormaisDoDia` resolve pelo `jornada_nome` do registro |
| herança do mês seguinte | `escala_mensal.jornada_id` do mês anterior | a jornada vigente no **último dia** do mês anterior |
| rótulo | "Jornada Temporária" | "Alteração de Jornada por Período (vigência)" |

⚠️ **A herança era o que fazia a correção durar só 30 dias.** O Gerador Inteligente copia a
jornada do mês anterior e não consultava a vigência — então quem mudou de horário por vigência
voltava **silenciosamente** ao horário antigo no mês seguinte. O critério é o *último dia* do mês
anterior de propósito: uma vigência curta no meio do mês (um curso de 5 dias) não alcança essa
data e corretamente não é herdada.

⚠️ **O recálculo de totais tinha QUATRO cópias, não duas.** `salvarFolhaPonto`,
`autoCorrigirFolhaPonto`, `salvarFolhaPontoServidor` e — a que quase passou —
`autoCorrigirTodasFolhasPonto`, que roda sobre **todas as folhas de uma vez**. Fonte única agora
em `src/utils/folha/cargaDiaria.ts`. Mesma armadilha das quatro cópias da geração de folha.

**Portão antes de mexer nos totais**: das 12 folhas dos 4 servidores com vigência, **uma** muda —
CLAUDIO LOPES MARÇAL, 08/2026, status Rascunho, 76h → 100h (4 dias de jornada maior que a do
mês). **Nenhuma folha Revisada é afetada.** As 18 jornadas cadastradas têm nomes distintos, então
resolver por `jornada_nome` não é ambíguo.

### 3. O caminho na grade

`AlterarJornadaModal` aparece **só quando há batida no mês**. Sem batida, troca direto como antes.

| o coordenador escolhe | o que acontece | quando usar |
|---|---|---|
| "Passou a cumprir o novo horário a partir do dia X" | cria vigência, **não** toca no mês | redução judicial, acordo, mudança de setor |
| "A jornada estava errada desde o dia 1" | reescreve o mês, justificativa obrigatória, vai para o histórico | engano de cadastro |

O default do dia de início é **o dia seguinte à última batida** — a leitura mais provável de
"mudou agora", e deixa intacto todo dia já cumprido no horário antigo.

Achado colateral fechado no caminho: **o select de jornada nunca teve guard de escala fechada**.
Dava para trocar a jornada de uma escala `Fechada` ou de competência encerrada na tela — só o
botão Salvar barrava depois. Agora usa o mesmo guard das células de turno.

## Verificação

`tsc`, `lint` e `build` limpos. As duas migrations foram aplicadas em **homologação** e
exercitadas pelo caminho real (plpgsql não valida nada na criação — armadilha 1). 13 asserções:

| teste | resultado |
|---|---|
| troca direta (grade) grava histórico | 1 linha ✅ |
| reenvio do mesmo valor não gera ruído | continua 1 ✅ |
| RPC grava a justificativa | 1 ✅ |
| troca pela grade fica sem justificativa | 1 ✅ |
| de-para preenchido nas duas linhas | 2 ✅ |
| RPC recusa justificativa vazia | recusou ✅ |
| RPC recusa escala Fechada | recusou ✅ (descoberto por acidente na 1ª rodada) |
| sobreposição parcial de vigência | recusada ✅ |
| período encostado sem sobrepor | aceito ✅ |
| resolução dentro de cada vigência | correta nas duas ✅ |
| fora de qualquer vigência cai no padrão | ✅ |
| homologação sem resíduo | ✅ |

## O que continua em aberto

- **A reforma estrutural não foi feita.** Dar vigência de verdade à jornada (`data_inicio`/
  `data_fim` na relação servidor↔jornada, em vez de uma coluna por mês) continua sendo o modelo
  correto. Não foi feito porque é reforma de modelo em sistema de ponto em produção; o que foi
  entregue cobre o caso real sem esse custo.
- **`data_fim` continua obrigatória** em `servidores_jornadas_temporarias`. Para mudança
  permanente, a vigência vai até o fim do mês e a herança (item 2c) carrega adiante. Se isso se
  mostrar frágil na prática, `data_fim` nullable é o próximo passo.
- **A trigger de sobreposição só olha dado novo.** Produção tem 0 sobreposições hoje (conferido);
  se alguma aparecer por migração de dados, resolva na mão — a consulta de conferência está no
  rodapé de `20260819240000`.
- **Nenhum backfill de histórico.** Trocas anteriores a esta migration não existem em lugar
  nenhum e não são recuperáveis.

## Scripts

Todos somente leitura, em `scratchpad/`:

| script | o que responde |
|---|---|
| `diag_troca_jornada.js` | os dois proxies, com o limite de cada um documentado no cabeçalho |
| `diag_troca_jornada_poder.js` | poder do teste — sem isso, "0 quebras" não distingue "não acontece" de "não dá para ver" |
| `diag_troca_jornada_origens.js` | distribuição de `presenca_entrada_origem` (calibra o filtro de batida real) |
| `diag_troca_jornada_caso.js` | abre um caso dia a dia — foi ele que separou troca real de artefato de validação em massa |
| `diag_troca_jornada_desalinho.js` | jornada cadastrada × horário praticado o mês inteiro |
| `portao_totais_vigencia.js` | portão da correção dos totais: quais folhas mudam e em quanto |
