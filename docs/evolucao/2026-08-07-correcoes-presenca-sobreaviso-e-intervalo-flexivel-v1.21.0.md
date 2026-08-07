# Correções de Presença, Isolamento do Sobreaviso e Intervalo Flexível — v1.21.0

**Data:** 06–07/08/2026
**Versão:** 1.21.0
**Escopo:** motor de presença (`fn_confirmar_presenca`, `fn_confirmar_presenca_manual`), grade de escala, cadastro de servidores, correção de dados de produção.

---

## Sumário

Esta versão fecha três frentes:

1. **Regressão do intervalo intrajornada** — jornadas de 4h e 6h recebiam fluxo de 4 batidas e gravavam a saída real como "saída para intervalo".
2. **Sobreaviso contaminando a presença** — o sobreaviso era fundido no bloco de trabalho contínuo, travando a saída do expediente, e gravava marcas de presença em `escala_diaria`.
3. **Intervalo flexível por servidor** — nova funcionalidade que permite gozar o intervalo em qualquer horário, mesmo em unidade de intervalo rígido.

Todas as correções foram validadas contra o banco de produção antes da implementação, e as migrations de dados foram calibradas pelo volume real de registros afetados.

---

## 1. Regressão do guard de intervalo intrajornada

### Diagnóstico

O plano original apontava para um limite `(v_end_min - v_start_min) > 240` na migração `20260804070000`, propondo ajustá-lo para `> 360`. **A auditoria do código vigente mostrou que esse limite não existia mais.**

A migração `20260804080000_fix_shift_n_18h_jornada_start.sql` recriou `fn_confirmar_presenca` com `CREATE OR REPLACE` e **descartou o guard inteiro**, nos dois laços (blocos de ontem, linha 413; blocos de hoje, linha 745):

```sql
-- 20260804070000 (correto)
IF r.permite_marca_intervalo AND (v_end_min - v_start_min) > 240
   AND COALESCE(r.intervalo_minutos, 0) > 0 THEN

-- 20260804080000 (regressão)
v_permite_int := r.permite_marca_intervalo;
```

Consequências que o diagnóstico original não capturava:

- Jornadas de **4h também estavam afetadas no backend**, não só as de 6h.
- A condição perdida `COALESCE(r.intervalo_minutos, 0) > 0` era, na prática, a que mais protegia: **toda jornada de até 6h no cadastro tem `intervalo_minutos = 0`**.
- `fn_confirmar_presenca_manual` **nunca teve** o guard, e como `fn_confirmar_presenca_manual_bulk` apenas delega para ela, a **Validação em Massa** herdava o defeito.

### Auditoria de produção (06/08/2026)

| métrica | valor |
|---|---|
| registros com marca de intervalo | 166 |
| competências envolvidas | apenas 08/2026 |
| em jornadas > 6h (legítimos) | 135 |
| **em jornadas ≤ 6h (indevidos)** | **31** |
| gravados por marcação manual | 124 de 166 |

21 dos 31 estavam em unidades com `permite_marca_intervalo = false` — prova de que o caminho manual ignorava por completo a configuração da unidade.

### Por que os timestamps não foram "movidos"

O plano original propunha mover o timestamp de `presenca_intervalo_saida_em` para `presenca_saida_em`. A auditoria mostrou que **esses horários não são batidas reais**: são sintéticos, gerados pela marcação manual como `início da jornada + 4h`, reconhecíveis por serem redondos (`:00:00`); 10 deles tinham `intervalo_saida == intervalo_retorno` (duração zero).

Mover criaria **registros de ponto falsos** — por exemplo, saída às 11h para um servidor com jornada `07H ÀS 13H`. A correção adotada limpa os campos de intervalo e reconstrói a saída faltante a partir do horário de término previsto da jornada.

### Implementação

**`20260806000000_restore_interval_guard_short_journeys.sql`**

- Cria `public.fn_jornada_tem_intervalo(duracao_min, intervalo_min)` como fonte única da regra (CLT Art. 71: duração > 360 min **e** `intervalo_minutos > 0`).
- Restaura o guard nos dois laços de `fn_confirmar_presenca`.
- Adiciona guard em `fn_confirmar_presenca_manual` nos ramos `intervalo_saida` e `intervalo_retorno`, cobrindo também o caminho `_bulk`.

**`20260806010000_fix_undue_interval_marks_short_journeys.sql`**

- Reconstrói a saída faltante a partir do fim previsto da jornada.
- Limpa os campos de intervalo, preservando entrada e saída.

**Frontend — `ScaleGrid.tsx`**

`isUnitInterval` passou a espelhar a regra do backend, respeitando jornada temporária do dia e usando a duração do turno (não da jornada regular) para Plantão/Extra.

### Resultado verificado

```
jornada efetiva ≤ 6h ainda com marca de intervalo:   0
intervalos legítimos preservados (> 6h):           147
```

---

## 2. Sobreaviso isolado do fluxo de presença

### O problema

A servidora **LUCIA LAYANE ROSA SAMPAIO** (jornada `08H ÀS 18H`) não conseguia registrar a saída: o terminal recusava com "fora da janela", apesar de bater no horário correto.

`fn_confirmar_presenca` agrupa os turnos do dia em **blocos contínuos**: se um turno começa antes ou no instante em que o anterior termina, os dois viram um bloco só, e a janela de saída passa a ser o fim do último turno. Isso é **correto e desejado** para `Regular` + `Extra` + `Plantão`.

Só que o `start_hour` do Sobreaviso é alinhado ao fim do turno Regular — o terceiro elemento do `COALESCE` que calcula `start_hour` **não filtra por categoria** (foi feito para alinhar hora Extra). Resultado:

```
Regular    08:00 → 18:00   (480 → 1080 min)
Sobreaviso 18:00 → 06:00   (1080 → 1800 min)
merge: 1080 <= 1080  ⇒  bloco único 08:00 → 06:00 do dia seguinte
```

A janela de saída virou **05:30–06:30 do dia seguinte**.

### Evidência

`logs_tentativas_presenca` registrou as batidas recusadas com o horário que o sistema esperava:

| tentativa (local) | `escala_prevista_fim` | mensagem |
|---|---|---|
| 05/08 18:26 | **06:00** | Fora da janela de presença permitida |
| 05/08 18:29 | 06:00 | idem |
| 06/08 18:17 | **06:00** | idem |
| 06/08 18:18 | 06:00 | idem |

Nos dias 3 e 4, sem sobreaviso, a saída foi registrada normalmente (18:14 e 18:00).

**Alcance:** 27 servidor-dias em 08/2026 com Sobreaviso no mesmo dia de Regular/Plantão, distribuídos entre 3 servidores.

### Regra de negócio consolidada

O sobreaviso tem ciclo próprio, inteiramente em `logs_sobreaviso`:

```
acionamento → aceite (magic link via WhatsApp/e-mail/SMS) → chegada ao local (GPS ou validação manual)
```

**Nada disso entra na folha de ponto**, que lê apenas `Regular` e `Extra`. O sobreaviso **não marca presença**.

Dado decisivo: em **522 acionamentos registrados, nenhum usou o terminal** (514 Manual, 8 GPS). O caminho de terminal para sobreaviso era código morto que só produzia efeito colateral.

### Implementação — três camadas

| camada | onde | migration |
|---|---|---|
| `<> 'Sobreaviso'` nas 8 comparações de fusão de bloco | `fn_confirmar_presenca` | `20260807000000` |
| Sobreaviso fora da lista de categorias dos blocos; função manual não escreve em `escala_diaria` | ambas as funções | `20260807020000` |
| `CHECK chk_sobreaviso_sem_presenca` | tabela `escala_diaria` | `20260807030000` |

A constraint é a única camada que sobrevive a um `CREATE OR REPLACE` descuidado — e este projeto já perdeu lógica crítica duas vezes assim.

**Ponto de atenção:** as checagens de **acesso** do coordenador continuam aceitando `Sobreaviso` de propósito. Sem isso, quem tem só sobreaviso no dia perderia acesso ao terminal.

**Preservação da funcionalidade em uso:** `fn_confirmar_presenca_manual` continua registrando a chegada de sobreaviso em `logs_sobreaviso` (514 registros em produção). O que mudou é que ela deixou de escrever em `escala_diaria`.

### Correção de dados

**`20260807010000_recover_exits_blocked_by_sobreaviso_merge.sql`** — reconstrói as saídas a partir de `logs_tentativas_presenca`, usando o horário **real** da batida recusada:

```
LUCIA LAYANE, dia 5: entrada 08:11 → saída 18:26
LUCIA LAYANE, dia 6: entrada 08:22 → saída 18:17
```

Também remove as marcas de presença gravadas indevidamente nas linhas de Sobreaviso (critério conservador: só onde o timestamp é idêntico ao do turno de trabalho, provando ser artefato da fusão).

---

## 3. Intervalo flexível por servidor (nova funcionalidade)

### Motivação

O modo de intervalo era definido pela **unidade**. No modo rígido, o servidor precisa sair e voltar em horários fixos, resolvidos em cascata: personalizado do servidor → padrão da jornada → cálculo automático.

Existem servidores que, dentro de uma unidade rígida, precisam de liberdade de horário: podem sair às 11h e voltar às 13h, ou sair às 14h e voltar às 16h, desde que cumpram a carga horária líquida.

### Regra

```
saída_esperada = fim previsto da jornada + (intervalo real − intervalo previsto)
```

Jornada `08H ÀS 18H`, intervalo previsto 2h:

| saída | retorno | intervalo real | saída esperada |
|---|---|---|---|
| 11h | 13h | 2h | 18h |
| 14h | 16h | 2h | 18h |
| 14h | 17h | **3h** | **19h** |
| 12h | 12h30 | **30min** | **16h30** |
| — | — | não marcou | 18h |

O excedente adia a saída; o tempo a menos antecipa. Em todos os casos a carga líquida de 8h é cumprida.

### Configuração

Nova coluna `servidores.intervalo_flexivel` (boolean, default `false`), com checkbox no cadastro do servidor logo abaixo dos campos de horário de intervalo.

Quando ativa, `intervalo_inicio_personalizado` / `intervalo_fim_personalizado` deixam de ser horários obrigatórios e passam a definir apenas a **duração prevista**.

### Comportamento no terminal

- **Saída para intervalo**: qualquer momento após a entrada, mas **antes** de abrir a janela de saída final. Essa restrição impede que a batida de fim de expediente seja confundida com saída para intervalo — exatamente a classe de defeito corrigida no item 1.
- **Retorno do intervalo**: qualquer momento, desde que a saída para intervalo já tenha sido registrada.
- **Saída final**: tolerância normal, aplicada sobre o horário **ajustado**.

Servidores com `intervalo_flexivel = false` mantêm comportamento idêntico ao anterior.

### Implementação

- **`20260807040000_add_intervalo_flexivel_to_servidores.sql`** — coluna e documentação.
- **`20260807050000_support_flexible_interval_per_servidor.sql`** — cria `public.fn_ajuste_intervalo_flexivel(flexivel, int_saida, int_retorno, previsto_min)`, que devolve os minutos a somar à saída prevista; aplica o ajuste nas janelas de saída (incluindo turnos que cruzam a meia-noite) e adiciona os ramos de flexibilidade aos passos 2 e 3.
- **Frontend** — checkbox em `EditServidorForm.tsx` e `servidores/novo/page.tsx`; persistência em `servidores/actions.ts`; tipo em `src/types/database.ts`.

---

## Método de trabalho adotado

As funções de presença têm ~1.500 linhas e são recriadas inteiras a cada migration. Este projeto **já perdeu lógica crítica duas vezes** ao recopiar essas funções à mão.

Para eliminar esse risco, todas as migrations desta versão foram geradas **por script**: cópia byte a byte do arquivo vigente, com substituições pontuais e **verificação de contagem de ocorrências**, seguida de conferência por `diff`. Nenhum corpo de função foi redigitado.

Verificações adicionais aplicadas:

- Balanceamento de parênteses conferido por script nas condições `IF` reescritas.
- Simulação das migrations de dados contra a produção (somente leitura) antes da execução.
- `npx tsc --noEmit` e `npm run build` a cada alteração de frontend.

---

## Pendências conhecidas

1. **`intervalo_nao_usufruido` não é preenchido.** A coluna existe desde `20260804000000`, mas nenhuma função a alimenta. Marcar o dia em que o servidor não gozou intervalo exige alterar `fn_salvar_saida_bloco`, compartilhada com os servidores de intervalo rígido. Fica para rodada própria.

2. **4 registros com ordem cronológica impossível** em 08/2026 — ver [`incoerencias-cronologicas-08-2026.md`](../planned_features/incoerencias-cronologicas-08-2026.md). Causa provável: a validação em massa preencheu campos vazios sem confrontar com as batidas reais já existentes.

3. **`data_hora_chegada` do sobreaviso registra `now()`** — o momento em que o coordenador validou, não a chegada real do servidor. Corrigir exige mudança de UI e da assinatura da função.

4. **Divergência entre homologação e produção.** Os dois bancos têm schemas diferentes (`escala_diaria` de homologação não possui `justificativa_manual` / `confirmacao_manual`), o que enfraquece homologação como ambiente de teste.

---

## Ordem de aplicação das migrations

```
20260806000000_restore_interval_guard_short_journeys.sql
20260806010000_fix_undue_interval_marks_short_journeys.sql
20260807000000_isolate_sobreaviso_from_work_block.sql
20260807010000_recover_exits_blocked_by_sobreaviso_merge.sql
20260807020000_remove_sobreaviso_from_presence_flow.sql
20260807030000_enforce_sobreaviso_without_presence.sql
20260807040000_add_intervalo_flexivel_to_servidores.sql
20260807050000_support_flexible_interval_per_servidor.sql
```

A ordem é obrigatória: `20260806010000` depende de `fn_jornada_tem_intervalo`; `20260807030000` exige a limpeza prévia para validar a constraint; `20260807050000` depende da coluna criada em `20260807040000` e do corpo de função instalado em `20260807020000`.
