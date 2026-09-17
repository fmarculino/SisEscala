# Correção de batida real pelo RH, e falta em plantão que tem registro

**Data:** 17/09/2026
**Status:** ✅ **Fases 0, 1, 2 e 3 implementadas (v2.72.0)** e validadas em homologação.
**Fase 4 (mutirão dos 46 casos) e a aplicação em produção continuam pendentes.**
Diário em [`docs/evolucao/2026-09-17-correcao-de-batida-real-pelo-rh.md`](../evolucao/2026-09-17-correcao-de-batida-real-pelo-rh.md).
**Motivado por:** dois relatos do usuário, os dois medidos em produção nesta data

> ⚠️ **Este cabeçalho é o estado de 17/09/2026.** Antes de citar qualquer coisa daqui como
> pendência, confira no código e no `CHANGELOG` — este projeto implementa rápido demais para um
> `Status:` envelhecer bem.
>
> **O que mudou em relação ao plano original, por medição:** a Fase 0 passou a honrar **apenas**
> `reclassificar_passo` (havia 1.686 `vincular_escala` em produção, 92 dos quais discordam do que
> está gravado), e apareceu um quinto defeito que o plano não previa — `created_at` com `now()`
> não desempata tratamentos da mesma transação, o que fazia `restaurar` nunca ter efeito ali.

---

## 1. Os dois casos, medidos

### 1.1 A rajada de batidas — JESSICA (HMI / BLOCO B, 09/2026)

O servidor bate várias vezes seguidas, o alinhamento distribui as batidas pelos passos e o
resultado sai errado. O RH tenta corrigir na grade e recebe:

> *Apenas administradores podem alterar ou reverter batidas presenciais registradas em terminal.*

A mensagem está **correta como regra** e **errada como destino**: quem apura a folha é o RH, e a
rede tem **5 contas** que passam nesse gate (2 `super_admin` + 3 `admin`) contra **18 de RH**
(8 `rh` + 10 `rh_unidade`) e **124 coordenadores**. Corrigir ponto virou fila num gargalo de
cinco pessoas.

### 1.2 A batida antecipada — EUZILENE DA SILVA RAMOS (mat. 68216), 12/09/2026

Medido em produção em 17/09/2026. Escala do dia: **Plantão `MT` 07:00→19:00** + **Regular `N`
19:00→07:00** (jornada `19H ÀS 07H`). As cinco batidas do relógio, todas origem `rep`, todas no
mesmo dispositivo:

| hora local | NSR | onde o sistema gravou |
|---|---|---|
| **12/09 18:21** | 29601 | **saída do Plantão `MT`** ← a batida antecipada |
| 12/09 19:24 | 29647 | entrada do Regular `N` |
| 12/09 21:03 | 29656 | saída do intervalo do `N` |
| 12/09 22:01 | 29662 | retorno do intervalo do `N` |
| 13/09 06:59 | 29710 | saída do `N` |

Ela **faltou ao plantão** e chegou cedo para o turno noturno. A batida das 18:21 está a **39 min**
do slot "saída do MT" (19:00) — muito dentro da tolerância configurada
(`rep_tolerancia_alocacao_minutos = 360`), e o DP prefere casar a não casar (custo de não casar =
tolerância × 2). O alinhamento fez exatamente o que foi projetado para fazer.

A linha do plantão ficou assim: **entrada NULL, saída 18:21, `presenca_confirmada = true`,
`confirmado_por_id = NULL`** — 12h de plantão com uma batida só e nenhuma entrada.

✅ Conferido: a projeção (`fn_projecao_marcacoes_dia`) **confirma** essa distribuição. Não é
resíduo — é o que o sistema recalcula hoje, e reporia depois de qualquer correção manual.

---

## 2. Extensão em produção (09/2026, dias já passados)

Medição paginada por `Range` (armadilha 8) sobre 1.707 escalas e 26.979 linhas de `escala_diaria`:

| medida | valor |
|---|---|
| linhas com **apenas um extremo** (entrada XOR saída) | **1.136** (Regular 942 · Plantão 82 · Extra 112) |
| destas, **só saída** — a assinatura do caso 1.2 | **511**, sendo **469 de origem `rep`** |
| pares (servidor, dia) com **2+ linhas de escala** | 947 |
| destes, com alguma linha de um extremo só | 194 |
| **padrão exato da EUZILENE** (uma linha só com saída + outra completa no mesmo dia) | **46** |
| plantões passados **`registrado`** (dois extremos → a fila **não** oferece falta) | **1.286** |
| plantões passados `em_avaliacao` (a fila oferece) | 264 |
| desfechos já registrados em **toda a base** | 130 `validado`, **1 `falta`** |

🚨 **1 falta em toda a história do sistema.** O caminho para declarar falta existe e praticamente
ninguém o encontra — o que é coerente com o relato de que "o coordenador não consegue".

---

## 3. O que existe hoje (e por que ninguém chega lá)

| peça | onde | estado |
|---|---|---|
| clique no segmento verde | `ScaleGrid.tsx` · `handleSegmentClick` | batida real: só `admin`/`super_admin`; os demais recebem alerta |
| reverter passo | `fn_reverter_presenca_manual` (`20260804040000`) | limpa `presenca_*_em`, **sem justificativa** |
| selecionar batida real | `fn_validar_presenca_manual` → `fn_aceitar_marcacao_pendente` | grava com `COALESCE` — **nunca sobrescreve passo preenchido** |
| lista de batidas do dia | `fn_marcacoes_mes` (`20260908160000`) | já devolve **todas** as marcações do mês, com lugar |
| retirar batida de forma durável | `marcacoes_tratamentos` tipo `desconsiderar` | honrado pela alocação — **sem RPC e sem tela** |
| declarar falta em plantão | `justificativas_eventos.resultado = 'falta'` | funciona, e **vence o ponto completo** (passo 2 de `fn_desfecho_evento_dia`) |
| a fila oferecer a decisão | `JustificativaModal.tsx:83` | `pedeDecisao` só em `em_avaliacao` ou reversão |
| bloqueio na folha | `salvarFolhaPonto` | alterar horário `real`: **só `super_admin`** (régua diferente da grade) |

✅ **No caso 1.2 o plantão está `em_avaliacao` ("Sem registro de entrada"), então declarar falta já
é possível hoje em `/justificativas`.** Conferido chamando `fn_desfecho_evento_dia`. O que falta
ali é **caminho**: quem vê o problema está na grade, e a grade não leva até a fila.

---

## 4. Os quatro defeitos que qualquer tela nova herdaria

### D1 — reverter não limpa `origem` nem `marcacao_id`

`fn_reverter_presenca_manual` é de 04/08/2026 e as colunas `presenca_*_origem` /
`presenca_*_marcacao_id` nasceram em `20260808020000` — ela **nunca aprendeu que elas existem**.
Zera só `presenca_*_em` e `presenca_*_manual`.

Consequência: reverter e selecionar outra batida grava o **horário novo** com o **`marcacao_id` e
a origem antigos** (`fn_aceitar_marcacao_pendente` usa `COALESCE(presenca_*_origem, ...)`, e o
valor antigo continua lá). O passo passa a apontar para uma batida que não é a dele.

### D2 — apagar batida real é o único ato sem justificativa

No handler da grade, `isReverting` **pula todas as validações**: não pede motivo, não confere data
futura, não confere sequência. Num projeto onde trocar o turno de um dia com ponto exige
justificativa (`20260821110000`) e apagar vigência de jornada exige motivo (`20260910100000`),
**apagar o horário que o servidor realmente bateu não exige nada**.

### D3 — 🚨 a reversão é silenciosamente não-durável em 40% dos casos

O que dá durabilidade à reversão é o trigger `fn_sincronizar_marcacoes_escala_diaria`
(`20260808070000`), que grava `desconsiderar` sobre a marcação revertida. Mas o `INSERT` está sob:

```sql
IF NEW.confirmado_por_id IS NOT NULL OR OLD.confirmado_por_id IS NOT NULL THEN
```

**Batida de relógio nunca validada à mão tem `confirmado_por_id = NULL`** — é exatamente o caso da
linha do plantão da EUZILENE. Nesses casos o `desconsiderar` **não é gravado**, e a batida volta na
próxima reconciliação daquele dia.

**Medido: 4.471 de 11.242 linhas com saída de origem `rep` (39,8%) estão nessa condição.**

Dois defeitos menores no mesmo bloco: ele casa por `(servidor, ocorrido_em)` em vez de
`marcacao_id`, e o `NOT EXISTS (tipo = 'desconsiderar')` impede regravar depois de um `restaurar` —
o par `desconsiderar`/`restaurar` deixa de alternar.

### D4 — 🚨 `reclassificar_passo` e `vincular_escala` não são honrados por ninguém

Os dois tipos existem no `CHECK` de `marcacoes_tratamentos` desde `20260808000000`, e
`fn_aceitar_marcacao_pendente` **grava** `vincular_escala`. Mas `fn_alocar_marcacoes_dia` só
consulta tratamentos para `desconsiderar`/`restaurar`.

Ou seja: **hoje existe exatamente uma alavanca durável — retirar.** "Esta batida é a saída, não a
entrada" não tem como ser dito de forma que a reconciliação respeite.

E a reconciliação sobrescreve sem dó: `fn_reconciliar_marcacoes_dia` faz `SET presenca_* = p.*`
**sem `COALESCE`** em toda linha que a projeção devolve. Correção escrita direto em `escala_diaria`
é transitória — dura até a próxima ingestão daquele dia, um reenvio de lote ou um clique em
**Preencher pelas Batidas**.

> 🚨 **A regra transferível: correção sobre dia com batida de relógio só é durável se for expressa
> como TRATAMENTO.** Escrever em `escala_diaria` é escrever no cache.

---

## 5. A solução

### 5.1 Princípio

**O RH rearranja FATOS; declarar horário onde há fato continua sendo ato restrito.**

É o que o usuário pediu, e é a linha que preserva a vedação 4 da Portaria 671/2021: o RH escolhe
**qual batida real** vai em **qual passo**, e retira a que não pertence ali. Onde não há batida real
nenhuma, nada muda — continua o caminho de hoje (digitar com justificativa).

### 5.2 Fase 0 — consertar a base (sem isto, nada dura)

| # | o quê |
|---|---|
| D1 | `fn_reverter_presenca_manual` passa a limpar `presenca_*_origem` e `presenca_*_marcacao_id` junto |
| D3 | o `desconsiderar` do trigger deixa de depender de `confirmado_por_id`; casa por `marcacao_id`; e passa a alternar com `restaurar` (olhar o **último** tratamento, não a existência de qualquer um) |
| D4 | `fn_alocar_marcacoes_dia` passa a **fixar** no passo/linha a marcação que tem `vincular_escala`/`reclassificar_passo` vigente: ela sai do DP e ocupa aquele slot |

⚠️ **D4 é a mudança de maior risco do plano.** A fixação precisa acontecer **antes** de montar
`v_m_id`/`v_m_ts` (a marcação fixada não entra no universo do DP) e o slot correspondente sai de
`v_slot_*`, senão o alinhamento monotônico passa a ter um buraco no meio. E o efetivo é o **último**
tratamento por `created_at`, como já é com `desconsiderar`.

⚠️ **A fixação vale só para a linha e o passo nomeados no tratamento.** Uma marcação fixada num dia
não pode ser desqualificada como sombra do dia vizinho (regra do dono) — senão uma correção do dia
12 muda o resultado do dia 13.

### 5.3 Fase 1 — uma operação declarativa, não o par reverter + revalidar

Nova RPC **`fn_corrigir_passos_com_batidas`**:

```
p_escala_diaria_id uuid
p_atribuicoes      jsonb   -- { "entrada": "<marcacao_id>", "saida": null, ... }
p_justificativa    text    -- obrigatória, mínimo 10 caracteres
p_validador_id     uuid
```

Ela recebe o **conjunto final dos quatro passos**, não uma operação por vez. Numa transação só:

1. confere papel, escopo, competência aberta e escala não Fechada;
2. confere que cada `marcacao_id` é **do mesmo servidor** e pertence à janela do dia (`[D−1, D]`, o
   mesmo alcance de `fn_aceitar_marcacao_pendente`);
3. recusa a mesma batida em dois passos e recusa ordem cronológica inválida **pelos instantes
   reais**, nunca por `HH:MM` (armadilha 45);
4. grava `desconsiderar` para as marcações retiradas e `vincular_escala` + `reclassificar_passo`
   para as designadas — **com o motivo escrito**;
5. aplica os quatro passos em `escala_diaria` **sem `COALESCE`**.

⚠️ **Tudo-ou-nada por `RAISE`, nunca por `RETURN` no meio** — mesma disciplina de
`fn_validar_presenca_manual`: meia correção é pior que nenhuma.

⚠️ **Não reusar `fn_aceitar_marcacao_pendente`**: o `COALESCE` dela é proposital (não sobrescreve o
que já existe) e é exatamente o que impede trocar a batida de um passo. Envelopá-la aqui
significaria reverter antes — o par que este plano existe para eliminar.

**Quem pode o quê:**

| papel | passo vazio | trocar/retirar batida real | digitar por cima de batida real |
|---|---|---|---|
| `super_admin` · `admin` | ✅ | ✅ | ✅ |
| `rh` · `rh_unidade` (no escopo) | ✅ | ✅ **(novo)** | ❌ |
| `coordenador` · `ass_adm` | ✅ | ❌ | ❌ |

⚠️ **A régua da folha (`salvarFolhaPonto`, hoje `super_admin` puro) tem de acompanhar**, senão o RH
corrige na grade e a folha recusa a mesma correção — duas respostas para a mesma pergunta. Fonte
única num módulo (`src/utils/folha/correcaoBatidaReal.ts`), aplicada na grade, na action da folha e
espelhada na RPC.

### 5.4 Fase 2 — a tela

O modal já tem quase tudo: `fn_marcacoes_mes` devolve **todas** as batidas do mês,
`batidaVisivelNaCelula` já resolve a janela do turno que cruza a meia-noite, e
`classificarLugarDaBatida` já rotula batida de outra unidade.

O que muda:

- o clique no segmento verde deixa de ser recusado para RH e abre o modal em **modo correção**;
- cada passo vira um seletor com as batidas do dia, **incluindo as já usadas em outro passo**,
  rotuladas com onde estão (`hoje é a saída do Plantão MT`) — hoje elas entram em
  `horariosJaUsados` e somem da lista;
- existe a opção **"deixar vazio (batida não pertence a este turno)"** por passo, que é o
  `desconsiderar`;
- justificativa obrigatória, com o texto deixando claro que a batida **continua registrada**.

⚠️ **Mostrar a distância do previsto ao lado de cada batida.** Foi um casamento por proximidade que
produziu o erro; sem ver os 39 min, o RH decide às cegas.

⚠️ **Nunca mandar o horário — mandar o `id`** (regra da v1.26.0). O servidor relê o instante da
fonte.

### 5.5 Fase 3 — falta declarada sobre plantão que tem registro

`fn_desfecho_evento_dia` já diz, em comentário e em código: *"DESFECHO EXPLÍCITO VENCE TUDO.
Inclusive o ponto completo"*. **O banco já aceita.** Só a tela não oferece:
`pedeDecisao = estado === 'em_avaliacao' || ehReversao` deixa de fora os **1.286** plantões
`registrado` de 09/2026.

Proposta:

| regra | por quê |
|---|---|
| a decisão passa a ser oferecida também em `registrado` | é onde está o caso que não tem saída nenhuma hoje |
| havendo batida real no dia, o modal **mostra a batida** e exige confirmação explícita | declarar falta contra registro é contradizer o relógio: tem de ser deliberado, não um clique |
| texto obrigatório (já é) e **autoria gravada** (já é, `resultado_definido_por_*`) | é registro sobre a conduta de um servidor público |
| o coordenador **declara**; reverter continua sendo do RH | `podeReverterDesfecho` já é assim, e não muda |
| o modal sugere **primeiro corrigir a batida** quando ela pertence a outro turno do mesmo dia | declarar falta deixando a batida apontando para o plantão grava a contradição |

⚠️ **A ordem importa, e é a resposta certa para o caso 1.2.** Retirar a batida das 18:21 do plantão
resolve **os dois lados**: o plantão fica sem registro nenhum (falta legítima, e o desfecho já cai
em `em_avaliacao` sozinho) e a batida volta a ser candidata do turno `N` — onde o coordenador decide
se ela é a entrada real (18:21, adiantada) ou se a entrada é a das 19:24. **Declarar falta é o
caminho para quando a batida É do plantão e mesmo assim não houve serviço.**

⚠️ Marcar falta hoje **não muda a célula da grade** (continua verde) nem o total previsto — só o
relatório de plantão e o anexo. Vale um selo na célula junto com a Fase 3, senão quem declara não vê
efeito nenhum e conclui que não funcionou (o que ajuda a explicar 1 falta em toda a base).

### 5.6 Fase 4 — os 46 casos de 09/2026

Por **lista fechada, com ensaio antes/depois campo a campo**, nunca reconciliação em massa
(armadilha 46: medido em 03/09/2026, massa deu 4 ganhos contra 43 trocas e 7 perdas).
`scratchpad/fix_pos_nivel2b.mjs` é o modelo. 08/2026 fica de fora (competência fechada).

---

## 6. O que NÃO fazer

| ideia | por que não |
|---|---|
| **apagar a marcação errada** | `marcacoes_ponto` é INSERT-only e é o artefato legal. A porta é `desconsiderar`, que é append-only e reversível |
| **baixar `rep_tolerancia_alocacao_minutos`** para 18:21 não alcançar as 19:00 | medido em 19/08/2026: baixar o teto até fechar a brecha desliga a flag `ignora_janela_presenca` e quebra dias saudáveis |
| **mexer no custo do DP** (penalizar casar mal) | simulado e descartado em 19/08/2026: corrige 2 duplicações e quebra 3 dias saudáveis, entre eles uma entrada real a 3 min do previsto |
| **recusar saída em bloco que não teve entrada** | são **511 linhas** em 09/2026 nessa forma, e a maioria é gente que esqueceu de bater a entrada. Viraria perda de ponto legítimo em massa |
| **deixar o RH digitar horário sobre batida real** | é a vedação 4 da Portaria 671/2021 pela porta do RH. Rearranjar fato ≠ declarar horário |
| **reconciliar tudo depois de corrigir** | armadilha 46 |
| **marcar falta por padrão onde falta a entrada** | o `pendente` que não altera valor nenhum é o desenho das duas últimas decisões de folha (compensação de atraso e autorização de extra). Falta é declaração de pessoa |

---

## 7. Portões

Sem framework de teste, o padrão do projeto: simulação + validador que injeta regressões.

| portão | o que cobre |
|---|---|
| `scratchpad/sim_correcao_batida_real.js` | a matriz de papéis, a recusa de digitar sobre real, ordem cronológica por instante, mesma batida em dois passos, janela `[D−1, D]` |
| `scratchpad/val_sim_correcao_batida_real.js` | injeta ≥ 6 regressões e **exige reprovação nas 6** — entre elas o RH voltando a poder digitar sobre batida real, e o `COALESCE` voltando a impedir a troca |
| conferência das migrations | **EXECUTA** as funções (armadilha 42), nos **dois sentidos**: a correção passa a durar **e** o coordenador continua sem alcançar batida real |
| ensaio em homologação | cenário sintético revertido por `RAISE EXCEPTION`, reproduzindo o dia 12/09 da EUZILENE: 5 batidas, 2 linhas, correção, e **reconciliar de novo sem que o valor volte** |

🚨 **O ensaio do D4 tem de incluir "reconciliar duas vezes depois de corrigir".** É exatamente o que
hoje desfaz a correção, e é o único jeito de provar que passou a durar.

---

## 8. Ordem sugerida

1. **Fase 0** (D1, D3, D4) — sozinha já torna durável a correção que o admin faz hoje
2. **Fase 3** (falta sobre plantão registrado) — a de menor risco, e destrava o caso relatado
3. **Fase 1** (RPC declarativa)
4. **Fase 2** (tela)
5. **Fase 4** (mutirão dos 46)

⚠️ **Fases 0 e 3 são independentes e podem ir juntas.** Fases 1 e 2 dependem da 0 — subir a tela
antes do D4 entrega ao RH um botão cujo efeito desaparece sozinho, que é pior que o bloqueio de
hoje.

---

## 9. Scripts de medição desta sessão

| script | o que mede |
|---|---|
| `scratchpad/an_euzilene_1209.mjs` | o caso 1.2 inteiro: escalas, linhas do dia e as 5 marcações |
| `scratchpad/an_euz3.mjs` | o desfecho das duas linhas e as justificativas do mês |
| `scratchpad/an_euz4.mjs` | `confirmado_por_id` nulo — o alcance do D3 |
| `scratchpad/an_extensao_correcao.mjs` | linhas de um extremo só, pares com 2+ linhas |
| `scratchpad/an_extensao2.mjs` | o padrão exato do caso, isolado |
| `scratchpad/an_extensao3.mjs` | plantões `registrado` × `em_avaliacao`, perfis, desfechos |

⚠️ Produção é viva — **reconfira os números antes de decidir com base neles.**
