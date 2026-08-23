# O passo do bloco pertence a um turno só — e a batida de transição solitária espelha

**23/08/2026 · v2.9.0 · migration `20260823100000`**

Plano e medições: [`docs/planos/2026-08-23-turno-regular-emendado-com-plantao.md`](../planos/2026-08-23-turno-regular-emendado-com-plantao.md).

## O caso

**AGNA CRISTINA RIBEIRO DO ROSÁRIO** (mat. 205, LACEM/LIMPEZA), jornada `08H ÀS 14H` com Plantão
`T` emendado todo dia. Ela bate duas vezes — entra ~08:00, sai ~18:00 — e a folha cobrava
`EXTRA 04:03 (50%)` enquanto o anexo de plantões, na mesma competência, já pagava aquelas mesmas
horas como plantão. E o anexo mostrava o plantão começando às **08:03**, que é a entrada do
expediente.

Dois sintomas, um defeito só: os turnos fundem num bloco (`08:00 → 20:00`, armadilha 6) e
`fn_projecao_marcacoes_dia` gravava o par entrada/saída do **bloco** em **todas** as linhas dele.

**6h de jornada + 4h de extra + 6h de plantão = 16h creditadas para 10h trabalhadas.**

## O que já existia e por que não bastava

A `20260819200000` deu a cada fronteira interna do bloco dois slots opcionais, e **funciona**:
nos dias 17 a 21 a AGNA bateu 4 vezes e ficou `Regular 08:02→14:01`, `Plantão 14:06→18:02`.

Faltavam três coisas, todas medidas:

| lacuna | efeito |
|---|---|
| sem batida na fronteira, o par do bloco ia para todas as linhas | a dupla contagem acima |
| uma batida só na fronteira preenchia **um** dos dois slots | dias 3 e 4: o plantão ficava com a entrada do expediente |
| `rep_janela_duplicidade_segundos = 60` descarta a 2ª batida em menos de 1 min | dia 4, duas batidas às `14:00:00`: a segunda sumiu |

Daí a regra folclórica de "sair, esperar uns 5 minutos e bater de novo" — margem de segurança de
uma regra de **1 minuto** que ninguém tinha escrito.

## A correção

| | onde | o que faz |
|---|---|---|
| **C1** | `fn_projecao_marcacoes_dia` | o passo do bloco alcança só a linha do turno **dono**: entrada → primeiro turno, saída → último, intervalo → o turno cuja janela o contém. Critério **posicional**, sem tolerância de horário |
| **C2** | `fn_alocar_marcacoes_dia` | batida solitária na fronteira **espelha** para o slot irmão vazio. Uma batida na transição passa a fechar o expediente e abrir o plantão |

`fn_alocar_marcacoes_dia` passa a devolver a chave **`turnos`** (aditiva), com a ordem e a janela
de cada turno do bloco — é o que permite a C1 saber quem é o dono.

**Nada é fabricado.** Sem batida na fronteira, a saída do expediente fica **vazia** e vira
pendência de revisão. Decisão explícita do usuário em 23/08/2026: o sistema não preenche onde o
servidor **tem** como registrar (vedação 2 da Portaria 671/2021).

## Duas armadilhas que o processo pegou antes de virar produção

1. **`filtrado AS (...)` era a última CTE e não tinha vírgula.** A primeira versão gerada saía com
   erro de sintaxe. O gerador passou a inserir a vírgula junto com a CTE nova.
2. **Linha que perde todos os passos sumia da projeção.** `fn_reconciliar_marcacoes_dia` grava a
   projeção inteira, nulos inclusive, **mas só alcança as linhas que a projeção devolve** — o
   Plantão da AGNA nos dias 5, 6 e 7 ficaria para sempre com a entrada do expediente. Fechado com
   a CTE `linhas` + `LEFT JOIN`, e `count(cd.ed_id)` em vez de `count(*)`, senão a linha vazia
   sairia como confirmada.

## O que NÃO mudou

- Bloco de um turno só: nada muda.
- Dia com 4 batidas (2 na fronteira): nada muda — o espelho só age em slot **vazio**.
- Bloco `Regular + Extra`: a folha é **neutra**. `turnosDaFolha` mantém as duas linhas e o
  `min(entrada)/max(saída)` dá o mesmo resultado.
- `fn_confirmar_presenca` **não foi tocada** (armadilha 1). O terminal continua sem os slots de
  fronteira: a batida de transição segue virando marcação pendente, que a reconciliação aproveita.

## Portão e aplicação em produção (23/08/2026)

Sobre os **283 dias** de 08/2026 com 2+ turnos no mesmo dia:

| conferência | resultado |
|---|---|
| linhas invertidas na projeção | **0** |
| durações impossíveis (> 24h30) | **0** |
| dias em que a projeção diverge do gravado | 131, em 19 servidores |
| linhas de `escala_diaria` alteradas | **176** de 262 |
| linhas invertidas no gravado, mês inteiro (7.184 linhas) | **1** — preexistente, reconciliada em 18/08, fora do escopo |

Reconciliação **restrita à lista medida**, nunca em massa, com backup do estado anterior das 262
linhas antes de qualquer escrita.

Efeito na folha, nos 27 dias com hora extra em dia de plantão escalado:

| | horas |
|---|---:|
| como estava na folha | **75h12** |
| depois de C1+C2 e regeneração | **3h21** |

Auditoria de piora nos 131 dias reconciliados: **nenhuma real.**

- Os 9 dias que "perdem a saída" perdiam um horário **fabricado** (MARCOS, dia 3: saída `22:00`
  sem batida nenhuma além das `18:06`) ou uma saída que pertence ao Plantão (LUCAS, 6 dias;
  ANDRESA, dia 10) — exatamente a dupla contagem sendo desfeita.
- Os 20 dias que "ganham extra" são turnos **Extra escalados** que a folha, por estar num snapshot
  anterior ao `turnosDaFolha` de 19/08, simplesmente não tinha (IZABELLA, `07H ÀS 16H` + Extra 2h:
  `06:51 → 18:06`). Extra não tem anexo próprio, então não há dupla contagem.

Saldo nos 131 dias: **26h de hora extra a menos**.

## Regeneração das folhas — o passo que falta, e o alcance dele

`escala_diaria` está corrigida; **`folha_ponto` não**, porque é um snapshot jsonb (armadilha do
19/08). O caminho é o botão **"Gerar Rascunhos"** em `/folha-ponto` (`gerarFolhasEmLote` com
`forcarRascunho`), que regenera a competência inteira.

⚠️ **O efeito líquido de regerar 08/2026 inteira é +44h53 de hora extra**, não uma redução. Isso
não é regressão: a folha estava num snapshot antigo e **não tinha os dias 13 a 22**. Regerar traz
os horários reais desses dias — e com eles a hora extra que eles de fato produzem (IZABELLA, `07H
ÀS 16H` + Extra 2h escalado; HOLDA, `13:49 → 18:07`). As 59h45 de dupla contagem com plantão já
estão embutidas nesse saldo.

⚠️ **Erro de medição corrigido no meio desta sessão, registrado para não se repetir.** A primeira
simulação da regeneração deu **+134h02** e apontou um suposto segundo defeito — "dia com Plantão e
sem Regular contando o plantão inteiro como hora extra", 89h09 em 25 dias. **Não existe.** O
gerador tem um ramo `else if (!shift)` (`shift` = a linha **Regular** do dia) que manda o dia sem
turno Regular para SÁBADO/DOMINGO/FOLGA: ele não recebe horário **nem** hora extra. A simulação
não replicava esse ramo e inflava a conta em 89h. Com o ramo replicado, o número é 44h53.

**Ao simular a folha por fora, replique os ramos do gerador, não só a consolidação de horários.**
`totalHorasNormais`, hora extra e observação vivem todos dentro do `else { /* Work day! */ }`.

## A regeneração foi executada (23/08/2026)

Feita pela rota `POST /api/folha-ponto/regerar-competencia` (v2.10.1/2.10.2), unidade a unidade,
com backup das 356 folhas antes de qualquer escrita.

| | |
|---|---:|
| escalas ativas em 08/2026 | 432 |
| folhas **regeradas** | **406** |
| **puladas** por status (24 `Gerada` + 2 `Revisada`) | 26 |
| falhas | **0** |

**Delta de hora extra: +66h53 líquido** (subiu 70h02, caiu 3h09). Decomposto:

| natureza do dia | delta | dias |
|---|---:|---:|
| turno **Extra** escalado | +11h17 | 14 |
| dia com **Plantão** | +0h30 | 1 |
| **sem Extra nem Plantão** | **+55h06** | **380** |

⚠️ **As 55h06 em 380 dias são "extra de minutos": média de ~9 min por dia.** É o horário real
chegando à folha, que estava num snapshot velho — mas revela que **não existe tolerância nenhuma
no cálculo de sobrejornada**. Cada minuto além do fim da jornada vira hora extra. As três chaves
de tolerância que existem servem a outra coisa: `folha_ponto_variacao_minutos` era para os
horários fictícios (removidos na v1.22.0), `janela_presenca_minutos` decide se o terminal aceita
a batida, e `rep_tolerancia_alocacao_minutos` é da alocação. **Decisão de RH, não de software** —
a CLT Art. 58 §1º admite 5 min por marcação, limitados a 10 min/dia; se isso valer aqui, precisa
ser dito e configurado.

⚠️ **10 dias continuam com hora extra em dia de plantão, 13h30, e a regeneração não os alcança**
— todos têm campo de origem `manual`, que `preservacao.ts` preserva por desenho (alguém decidiu
aquele horário). Só o coordenador desfaz:

| servidor | dia | folha | extra |
|---|---:|---|---:|
| ANDRESA MELO PEREIRA (54594) | 10 | `08:21 → 18:00` | 6h00 |
| LUCAS REIS CAMPOS (58822) | 3, 4, 5, 10, 11, 19 | `00:00 → 18:00` (entrada 00:00 é lixo) | 1h00 cada |
| ILMAR DA SILVA DE OLIVEIRA (54457) | 16 | `06:00 → 06:00` | 1h01 |
| MAISA (32269) · ELIZABETH (1133) | 17 | — | 0h23 · 0h06 |

Os outros 14 dias que ainda somam extra em dia de plantão são residuais de **1 a 23 minutos**
(saída 1-2 min depois do fim do turno) — hora extra legítima, não dupla contagem.

## Achados registrados, sem correção nesta rodada

⚠️ **`fn_salvar_saida_bloco` FABRICA** os horários de transição a partir da escala — o comentário
dela diz isso literalmente. É por isso que ANDRESA tinha `Regular 08:01 → 12:00` sem nunca ter
batido às 12:00, e a folha exibia origem **`real`**. Em 08/2026 há **533 marcações
`sintetica = true` com origem `terminal`**, 51 servidores, **244 já gravadas como presença**.
Parte é backfill de `20260808030000`, parte é fabricação viva. **Auditoria própria pendente** —
é a mesma vedação 2, e é mais grave que a hora extra.

⚠️ **A escala da AGNA não descreve o que ela faz.** Nos dias com relógio, o plantão real foi de
`14:06 → 18:02` ≈ **3h55**, e o código escalado é `T` = 6h (o dia 4 já está `T4` e fecha certo).
Enquanto for `T`, o terminal espera saída às 20:00 e recusa a das 18:00 — 13 tentativas recusadas
em agosto, e nos dias 5, 6 e 7 ela desistiu de bater. Decisão do coordenador/RH.

⚠️ **Turnos com a MESMA janela prevista.** FAGNER (mat. 15234) tem **duas** `escala_mensal` na
mesma unidade, com dois Regulares idênticos no dia 6. O bloco funde os dois e "primeiro" e
"último" viram arbitrários: uma linha fica só com a entrada, outra só com a saída. A folha é
neutra (consolida as duas), mas a grade fica pela metade. É defeito de cadastro de escala, não da
projeção.
