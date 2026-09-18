# A batida real que não alcança a escala certa

**Data:** 17/09/2026
**Status:** ✅ **aplicado e conferido em produção em 17/09/2026 (v2.73.0)** — as quatro migrations
(`20260917140000`, `150000`, `160000`, `170000`) e o frontend. `ver_batida_retida_producao.mjs`:
**18 de 18**, incluindo o dia da THAYNA.
Continua pendente: **D3** (o dia 17 da mat 68152) e restaurar as batidas já retidas.

⚠️ **Este cabeçalho é a foto do dia.** Antes de citar qualquer coisa daqui como pendência,
confira no código e no `CHANGELOG` — este projeto implementa rápido demais para isso envelhecer
bem.
**Origem:** três relatos do usuário no mesmo dia — (1) a saída não apareceu na célula do plantão
do CCE/HMM; (2) "depois que excluí os registros da escala errada e lancei a certa, o *Preencher
pelas Batidas* não enxerga mais as batidas reais"; (3) o caso THAYNA (mat 69051), com 7 batidas
listadas no modal e a linha da escala vazia.

São **dois defeitos independentes** com o mesmo sintoma — a batida existe, está gravada, está
correta, e a célula fica vazia sem ninguém reclamar — mais um **estrago pontual** criado hoje ao
consertar o primeiro caso pelo caminho errado.

---

## Sumário do que foi medido

| # | defeito | alcance medido |
|---|---|---|
| **D2** | reverter presença **retira a batida real de circulação**, e a tela responde "Nada a preencher neste dia" | **47 batidas `rep` retiradas só hoje**, 14 servidores; 173 no histórico; 16 dias em que a tela fica muda |
| **D1** | a batida da pessoa cai no cadastro A, o turno está no cadastro B, e a reconciliação da ingestão só toca A | 76 CPFs com 2+ cadastros Ativos; **10 pares (irmão, dia) recuperáveis, 14 horários** |
| **D3** | o dia 17/09 da matrícula 68152 está com uma **batida de teste** como saída oficial, e a correção tentada foi um no-op silencioso | 1 dia, 1 servidor |

Tudo medido contra **produção** em 17/09/2026, por leitura. Scripts em `scratchpad/`:
`an_irmao_reconcilia.mjs`, `an_irmaos_universo.mjs`, `an_batida_invisivel.mjs`,
`an_batida_retida.mjs`, `an_thayna.mjs`, `an_desc_hoje.mjs`, `an_estado_prod3.mjs`.

⚠️ **Produção é viva.** Reconfira antes de decidir com base nestes números.

---

## D2 — Reverter presença retira a batida real de circulação, e nada avisa

### O mecanismo

`fn_sincronizar_marcacoes_escala_diaria` grava um tratamento **`desconsiderar`** sempre que um
UPDATE em `escala_diaria` **zera** um passo de presença. É o que torna a reversão *durável* — sem
isso, a próxima reconciliação repõe a batida no passo.

O trigger não sabe **por que** o passo está sendo zerado:

| o coordenador fez | efeito | desejado? |
|---|---|---|
| reverteu porque o horário está errado / a batida é indevida | a batida sai de circulação | ✅ é para isso que existe |
| **reverteu para corrigir a escala e relançar o dia** | a batida real sai de circulação **e não volta pela tela dele** | ❌ |

Depois disso, `fn_alocar_marcacoes_dia` filtra a marcação, e o *Preencher pelas Batidas* responde
**"Nada a preencher neste dia."** — ou recusa por `conflito` sem dizer que a causa é batida
retida. As duas mensagens afirmam o contrário do que está no banco.

### 🚨 O caso THAYNA, flagrado ao vivo

THAYNA DE MORAES SILVA VIANA (mat 69051), **03/09/2026**, duas linhas no mesmo dia:
`Regular MT` (07:00→19:00) e `Plantão N` (19:00→07:00).

**Hoje, entre 15:46 e 15:47**, quatro batidas `rep` daquele dia foram desconsideradas:

| batida | NSR | situação |
|---|---|---|
| 07:08 | 27134 | **desconsiderada hoje** |
| 14:51 | 125716 | **desconsiderada hoje** |
| 15:51 | 125728 | **desconsiderada hoje** |
| 19:00 | 27294 | **desconsiderada hoje** |
| 19:05 · 22:01 · 23:01 | 27329 · 27354 · 27365 | vivas |

São exatamente as 7 que aparecem no modal da tela. As quatro retiradas são **o turno Regular MT
inteiro** (entrada, saída de intervalo, retorno, saída). Estado hoje:

- linha **Regular MT**: inteiramente vazia, `reconciliado_em` = **NUNCA**;
- linha **Plantão N**: com a saída gravada em **07:08 do dia 3** — doze horas *antes* da entrada
  das 19:05.

Com quatro das sete candidatas fora, a projeção fica pobre e propõe **trocar** a entrada em 176
min e **perder** o intervalo. Por isso o *Preencher pelas Batidas* recusa: ele está certo em
recusar, e a mensagem não diz que a causa é reversível.

### Medido

| | |
|---|---|
| tratamentos `desconsiderar` vigentes | **1.166** |
| deles com justificativa `Presenca revertida em escala_diaria (sincronizacao automatica)` | **1.092** |
| que são **batida física** (`rep` 146 + `terminal` não-sintética) | **173** |
| pares (servidor, dia) distintos | 118 |
| com escala hoje e passo vazio | 20 |
| deles em que o *Preencher* fica **mudo** | **16** |

Curva por dia: 10 · 14 · 5 · 4 · 22 · 70 · 19 · 26 · 25 · 10 · 66 · **247 (hoje)**.
Dos 247 de hoje, **47 são batidas `rep`** — THAYNA 12, GISELE DA SILVA GOMES 10, mais 12
servidores.

### 🚨 Isso passou a acontecer em 100% dos casos hoje

A migration [20260917110000](../../supabase/migrations/20260917110000_desconsiderar_na_reversao.sql)
— **já aplicada em produção** (conferido: `fn_marcacao_desconsiderada` responde) — removeu a
condição `confirmado_por_id IS NOT NULL` do `INSERT` do tratamento.

Ela está **certa** para o defeito que foi corrigir: reverter não durava em 39,8% das linhas com
saída `rep`. O efeito colateral é que aquelas mesmas 39,8% escapavam **por acidente** do
desconsiderar, e era isso que fazia o fluxo "reverti, corrigi a escala, preenchi pelas batidas"
funcionar parte do tempo. **Agora ele nunca funciona.**

### ✅ O conserto manual existe — mas ninguém sabe que precisa dele

`fn_corrigir_passos_com_batidas` (v2.72.0, também já em produção) grava **`restaurar`** antes de
`reclassificar_passo`
([20260917130000:276-282](../../supabase/migrations/20260917130000_corrigir_passos_com_batidas.sql#L276-L282)),
e `fn_marcacoes_mes` **não filtra** desconsideradas — então a batida aparece no modal e pode
voltar. O problema é que a tela que o coordenador usa diz que não há nada a fazer, e a correção
de batida real é de **RH/admin**.

### Correção proposta, em duas metades

**(a) Parar de ficar mudo.** `fn_reconciliacao_pendente_escala` e `fn_reconciliar_dia_pendente`
passam a contar as batidas físicas desconsideradas do dia e a devolver status próprio
(`batida_retida`: quantas, de que origem, e que foi uma reversão que as tirou), em vez de
`sem_mudanca` ou de um `conflito` sem causa. A grade mostra o motivo e aponta a correção de
batida real. **Nada é escrito por conta própria** — restaurar batida continua sendo ato de quem
tem autoridade.

**(b) Dar a volta pela tela.** O trigger só distingue reversão-porque-errou de
reversão-para-relançar se **alguém disser qual é**. Duas saídas, e a escolha é do usuário:

| saída | o que muda | custo |
|---|---|---|
| **B1** — o modal de reversão pergunta o motivo: *"o horário está errado"* (desconsidera, como hoje) × *"vou relançar o dia"* (mantém a batida em circulação) | a decisão passa a ser explícita de quem reverte | um parâmetro em `fn_reverter_presenca_manual`, um GUC lido pelo trigger, e uma escolha no modal |
| **B2** — a grade ganha **"Restaurar batidas deste dia"** para quem já pode validar presença | o desfazer existe depois do fato, sem mexer no trigger de hoje | RPC nova que grava `restaurar`; não previne, remedia |

⚠️ **B1 sem B2 não resolve os 173 casos já criados.** B2 sem B1 deixa o coordenador criando o
problema toda vez e desfazendo depois.

---

## D1 — A reconciliação da ingestão não alcança o cadastro irmão

### O caso, confirmado batida a batida

RAIDANES BARROS BARROSO tem dois cadastros Ativos, mesmo CPF (`06004665312`) e mesmo PIS:
matrícula **53729** e matrícula **68152**.

| fato | valor medido |
|---|---|
| vínculo vigente no `REP-iDClass-CCE-01` | → **mat 53729**, `tem_biometria = true`, desde 06/09 |
| batida do dia 17 | `17:18` local, NSR 66151, gravada com `servidor_id` = **53729** |
| escala do dia 17 da mat **53729** | **não existe linha** — ela está de folga |
| escala do dia 17 da mat **68152** | Regular, entrada validada 07:00, **saída vazia** |

### Por que a batida não chegou na célula

1. `fn_servidor_por_identificador_afd` resolve pelo **vínculo vigente**, que é a porta de
   prioridade máxima. O desempate por escala existe, mas só no caminho de **CPF** e só quando não
   há vínculo — havendo vínculo, ele nunca é alcançado
   ([20260822210000](../../supabase/migrations/20260822210000_ponto_valido_desde_por_dispositivo.sql)).
2. `fn_ingerir_afd` fecha o lote reconciliando **apenas o `servidor_id` da marcação**
   ([20260915100000:287-303](../../supabase/migrations/20260915100000_abrangencia_do_relogio_estrutura.sql#L287-L303)).
3. `fn_alocar_marcacoes_dia` **sabe** do irmão desde
   [20260909130000:356-367](../../supabase/migrations/20260909130000_alocacao_considera_vinculos_irmaos.sql#L356-L367),
   mas é `STABLE`: os passos do irmão entram como **sombra** e só desqualificam candidata. A
   batida corretamente não é gravada em 53729 — e **ninguém escreve em 68152**.

É a mesma forma de "a alocação roda por dia e um dia não sabe do outro", agora **entre vínculos**:
a leitura enxerga os dois lados, a escrita enxerga um só.

🚨 **Nenhum dos 5 chamadores da reconciliação alcança irmão**, e corrigir só a ingestão deixa o
buraco aberto nos outros quatro:

| chamador | situação |
|---|---|
| `fn_ingerir_afd` ([20260915100000:298](../../supabase/migrations/20260915100000_abrangencia_do_relogio_estrutura.sql#L298)) | o caminho de hoje |
| `fn_reparse_afd_dispositivo` ([20260818080000:268](../../supabase/migrations/20260818080000_auto_reconcile_on_rep_ingestion.sql#L268)) | reprocessamento de AFD |
| reconciliar ao criar vínculo ([20260820010000:115](../../supabase/migrations/20260820010000_reparse_and_reconcile_on_vinculo_creation.sql#L115)) | Fase 5 |
| **`trg_reconciliar_apos_marcacao`** ([20260820020000:180](../../supabase/migrations/20260820020000_neutralize_direct_presence_write_in_rep_units.sql#L180)) | **inerte hoje, e vira o caminho principal quando a Fase 5 ligar** |
| `fn_reconciliar_dia_pendente` ([20260908110000:307](../../supabase/migrations/20260908110000_reconciliacao_pendente_na_grade.sql#L307)) | o botão da grade |

### 🚨 Reconciliar o irmão inteiro é perigoso — medido, não suposto

`fn_reconciliar_marcacoes_dia` escreve `presenca_* = projeção` **sem `COALESCE`**. Estendê-la ao
irmão significa reconciliar automaticamente dias que hoje nunca são tocados. Classificação dos
**425 pares (irmão, dia)** candidatos de 09/2026, por `fn_conferir_reconciliacao` (que não escreve
nada):

| resultado | pares |
|---|---|
| **só acréscimo** (preenche campo vazio) | **10** — 14 horários |
| **troca** de horário já gravado | **13** |
| **perda** (a projeção não reproduz o que está lá) | **4** |
| sem mudança | 398 |

As trocas não são ruído: há deslocamentos de **285 e 301 minutos** em passos de intervalo, e uma
saída indo de 19:00 para 16:10.

⇒ **A extensão só pode aplicar o que for acréscimo puro.**

### Correção proposta

Fonte única `fn_reconciliar_pessoa_dia(servidor, data)`, substituindo os 5 chamadores por gerador
com contagem (armadilha 1), com duas regras assimétricas de propósito:

| quem | regra |
|---|---|
| o servidor da batida | reconcilia como hoje — **comportamento inalterado** |
| cada irmão de `fn_cadastros_irmaos` com linha de `escala_diaria` no dia | aplica **só se for acréscimo puro**, reusando o critério de `fn_reconciliar_dia_pendente` |

O "só acréscimo" torna a extensão segura por construção e é coerente com a decisão de 08/09/2026:
o sistema preenche o que está vazio e devolve à validação manual o dia que ele mudaria. O
**desempate por `servidor_id`** da `20260909130000` já garante dono único, então não há risco de a
mesma batida cair nas duas matrículas.

⚠️ **Não mexer na resolução de identidade.** A batida é da **pessoa** (decisão de 09/09/2026); que
ela nasça no cadastro do vínculo está certo — `marcacoes_ponto.servidor_id` é imutável e quem
decide **onde aplicar** é a escala.

---

## D3 — Ação imediata: o dia 17 da matrícula 68152 está errado no banco

Cronologia medida (horário local):

| hora | evento |
|---|---|
| 09:57 | coordenador valida a **entrada** 07:00 (`ajuste_coordenador`) |
| 17:19 | chega a batida `rep` das **17:18** — no cadastro 53729 (D1) |
| **17:58** | **`fn_reconciliar_marcacoes_dia` executada à mão** contra produção → grava 17:18 como **saída** do 68152 |
| 18:07 | coordenador cria a saída real **19:00** (`ajuste_coordenador`) |
| 18:11 | coordenador seleciona 19:00 no modal de validação manual, justificativa **"BATIDA DE TESTE AS 17:18"** |

🚨 **A correção das 18:11 não teve efeito e não avisou.** `fn_aceitar_marcacao_pendente` usa
`COALESCE(presenca_saida_em, v_ocorrido)` — ela **não sobrescreve o que já existe**
([20260812160000](../../supabase/migrations/20260812160000_guard_aceitar_marcacao_pendente.sql)).
O tratamento `vincular_escala` foi gravado, a linha foi tocada (`updated_at` mudou), e o **valor
continuou 17:18**.

Estado hoje: a saída oficial do plantão é uma **batida de teste**.

**Conserto:** abrir o dia pela **correção de batida real** (v2.72.0), desconsiderar a batida das
17:18 e deixar a saída declarada das 19:00. É ato de RH/admin e fica registrado.

⚠️ **Lição de método.** A reconciliação das 17:58 foi feita direto em produção, sem ensaio
antes/depois e sem lista fechada. O botão **Ferramentas → Preencher pelas Batidas** (v2.49.0)
faria a mesma coisa pela tela — e, por rodar o mesmo critério, teria gravado a mesma batida de
teste. O que faltou não foi a ferramenta: foi **olhar o que seria gravado antes de gravar**.

---

## O que foi construído

Decisão do usuário em 17/09/2026: **B1 + B2** (perguntar no modal **e** dar o botão de
restaurar), implementar tudo, e **nenhuma escrita em produção sem aprovação caso a caso**.

| migration | o quê | ensaio em homologação |
|---|---|---|
| `20260917140000` | `fn_batida_fisica` e `fn_batidas_retidas_dia`; a prévia e a aplicação do *Preencher pelas Batidas* passam a **contar e dizer** as batidas retidas, com linha de diagnóstico própria e status `batida_retida` | ✅ **9 de 9** |
| `20260917150000` | `fn_reverter_presenca_manual` ganha `p_manter_batidas`; o trigger de sincronização poupa a batida **física** quando a intenção é declarada | ✅ **3 de 3** |
| `20260917160000` | `fn_restaurar_batidas_dia` — devolve à circulação só o que a **reversão automática** tirou | ✅ **4 de 4** (na própria conferência) |
| `20260917170000` | `fn_reconciliar_pessoa_dia` e os **três chamadores de máquina** passam a alcançar o cadastro irmão, **só em acréscimo puro** | ✅ **8 de 8** |

Frontend: a pergunta no modal de reversão, o aviso em âmbar com a lista de dias e o botão
**Restaurar Batidas** dentro do *Preencher pelas Batidas*, e `src/utils/reconciliacaoPendente.ts`
como fonte única da leitura.

**Portões:** `node scratchpad/sim_batida_retida.js` (53 asserções) e
`val_sim_batida_retida.js` (**8 regressões injetadas, 8 reprovadas**). Manual: 997 asserções,
56 seções — a seção nova é *"A batida existe e o sistema não a enxerga"*.

Geradores (cópia mecânica, armadilha 1): `gen_batida_retida.js`,
`gen_reversao_mantem_batidas.js` (duas fontes), `gen_reconciliar_pessoa_dia.js` (três fontes).

### O que os ensaios pegaram, e que uma leitura de código não pegaria

- `information_schema.parameters` **não** expõe coluna de `RETURNS TABLE` de forma confiável: a
  primeira conferência reprovou a função **já correta**. Passou a ler `pg_get_function_result`.
- `RAISE EXCEPTION 'a ' || 'b'` dá `42601` **na execução do `CREATE`** — a armadilha já
  registrada, cometida de novo.
- O `DROP` + `CREATE` da prévia devolveu a função a `PUBLIC`: o recorte da cópia mecânica vai até
  o delimitador e o `REVOKE` da fonte fica **fora** dele (armadilhas 24/41). A conferência pegou.
- `chk_marcacao_rep_completa` e `chk_marcacao_ajuste_justificado` só aparecem na execução.
- 🚨 O ensaio da Fase 3 **passou pelo motivo errado** na primeira versão: usava origem
  `terminal`, e **só batida de relógio disputa entre irmãos** (decisão 1 da `20260909130000`).

## Ordem de aplicação

| fase | o quê | estado |
|---|---|---|
| **1** | aplicar as 4 migrations em produção, na ordem | ✅ **feito em 17/09/2026**, conferido por execução (18/18) |
| **2** | D3: corrigir o dia 17 da mat 68152 pela correção de batida real | **pendente** — ato do usuário na tela |
| **3** | restaurar as batidas já retidas (173 físicas, 20 dias com escala e passo vazio) | **pendente** — o botão as alcança um a um, pela grade |

⚠️ **Ordem obrigatória**: a `150000`, a `160000` e a `170000` usam `fn_batida_fisica`, criada na
`140000`. Fora de ordem, a falha é em **runtime**, não no `CREATE`.

⚠️ **Os 173 casos já criados não se desfazem sozinhos.** O botão os alcança um a um, pela grade;
fazê-lo em massa é decisão própria, com ensaio antes/depois.
