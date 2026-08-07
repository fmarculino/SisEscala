# Correção: Turnos de 4h e 6h Sem Intervalo

> [!NOTE]
> **Revisado em 06/08/2026** após auditoria do código vigente e do banco de produção.
> O diagnóstico original apontava para um limite (`> 240` → `> 360`) que **não existe mais no código**,
> e a correção de dados proposta atingiria apenas 1/3 dos registros afetados, além de gravar
> horários de saída falsos. As seções abaixo refletem o diagnóstico confirmado.
> O histórico do diagnóstico original está em [Anexo: o que mudou na revisão](#anexo-o-que-mudou-na-revisão).

## Contexto do Problema

Servidores com jornadas de **4 horas** (ex: `08H ÀS 12H`, `14H ÀS 18H`) ou **6 horas** (ex: `07H ÀS 13H`) **não têm direito a intervalo intrajornada** — pela CLT (Art. 71) o intervalo é obrigatório apenas para jornadas **superiores** a 6 horas.

O sistema estava oferecendo e gravando marcações de intervalo para essas jornadas, fazendo com que a saída real fosse registrada como "saída para intervalo".

### Causa raiz 1 — Regressão no backend do terminal

`fn_confirmar_presenca` possuía o guard correto na migração `20260804070000` (linha 691):

```sql
IF r.permite_marca_intervalo AND (v_end_min - v_start_min) > 240
   AND COALESCE(r.intervalo_minutos, 0) > 0 THEN
    v_permite_int := true;
```

A migração seguinte, `20260804080000_fix_shift_n_18h_jornada_start.sql`, recriou a função com `CREATE OR REPLACE` e **descartou o guard inteiro** — nos dois laços (blocos de ontem, linha 413; blocos de hoje, linha 745):

```sql
v_permite_int := r.permite_marca_intervalo;
```

Este é exatamente o tipo de regressão que o [`.agents/AGENTS.md`](../../.agents/AGENTS.md) já documenta ter ocorrido em 04/08/2026: omitir lógica ao recriar essas funções.

Consequência: **jornadas de 4h também ficaram afetadas no backend**, não apenas as de 6h. E a perda do `intervalo_minutos > 0` é ainda mais relevante que a do limite de duração — veja a seção de dados abaixo.

### Causa raiz 2 — Ausência de guard na marcação manual

`fn_confirmar_presenca_manual` **nunca teve** verificação de carga horária: aceita `p_tipo = 'intervalo_saida'` / `'intervalo_retorno'` para qualquer jornada, e grava horários sintéticos (`início da jornada + 4h` e `+ 5h`, fixos).

Como `fn_confirmar_presenca_manual_bulk` apenas **delega** para ela num laço, a funcionalidade **⚡ Validar em Massa** (v1.19.0) herdava o mesmo defeito. Esta é a origem dominante dos dados corrompidos em produção.

### Causa raiz 3 — Frontend não considera a jornada

Em `ScaleGrid.tsx`, `isUnitInterval` era calculada apenas pela configuração da unidade (`permite_marca_intervalo`) e pela categoria, exibindo 4 segmentos para todos os servidores da unidade independente da carga horária.

---

## Análise dos Dados Afetados (auditoria de produção, 06/08/2026)

| Métrica | Valor |
|---|---|
| Registros com marca de intervalo | 166 |
| Competências envolvidas | **apenas 08/2026** |
| Em jornadas > 6h (legítimos) | 135 |
| **Em jornadas ≤ 6h (indevidos)** | **31** |
| Gravados por marcação manual (`_manual = true`) | 124 de 166 |

**Distribuição dos 31 indevidos:**

| unidade | `permite_marca_intervalo` | afetados |
|---|---|---|
| USF ENFERMEIRA ZEZINHA | `true` | 10 |
| SMS - Secretaria Municipal de Saúde | `false` | 18 |
| LACEM | `false` | 3 |

> [!IMPORTANT]
> 21 dos 31 estão em unidades com `permite_marca_intervalo = false`. Isso confirma que o caminho de
> marcação manual ignorava por completo a configuração da unidade — o guard precisa ficar na função,
> não no chamador.

**Por jornada e categoria:** 08H ÀS 12H (6), 08H ÀS 14H Regular (6), 07H ÀS 13H (6), 13H ÀS 17H (3), 12H ÀS 18H (3), **08H ÀS 14H Plantão (3)**, 13H ÀS 19H (2), 14H ÀS 18H (1), 07H ÀS 11H (1).

### Cadastro de jornadas (produção)

Toda jornada de até 6h tem `intervalo_minutos = 0`; toda jornada com intervalo > 0 tem ≥ 8h:

| horas_totais | intervalo_minutos |
|---|---|
| 4h (5 jornadas) | 0 |
| 6h (5 jornadas) | 0 |
| 8h, 9h | 60 |
| 10h | 120 |
| 12h | 60 |

Ou seja: a condição `COALESCE(intervalo_minutos, 0) > 0`, sozinha, já bloqueava o bug. Ela também foi perdida na regressão. Não existe hoje jornada entre 6h e 8h, então `> 360` vs `> 240` não muda o resultado atual — mas `> 360` é a regra correta pela CLT e protege cadastros futuros.

> [!WARNING]
> **Os timestamps nos campos de intervalo NÃO são batidas reais.** São valores sintéticos gerados
> pela marcação manual (`início + 4h`), reconhecíveis por serem horários redondos (`:00:00`);
> 10 deles têm `intervalo_saida == intervalo_retorno`, ou seja, intervalo de duração zero.
> **Movê-los para `presenca_saida_em` criaria registros de ponto falsos** — por exemplo, saída às 11h
> para um servidor com jornada `07H ÀS 13H`.

---

## Proposed Changes

### 1. [NEW] `20260806000000_restore_interval_guard_short_journeys.sql`

Corpo das funções copiado byte a byte de `20260804080000`, com três alterações pontuais (diff verificado).

**a) Fonte única da regra:**

```sql
CREATE OR REPLACE FUNCTION public.fn_jornada_tem_intervalo(
    p_duracao_minutos integer,
    p_intervalo_minutos integer
) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $fn$
    SELECT COALESCE(p_duracao_minutos, 0) > 360
       AND COALESCE(p_intervalo_minutos, 0) > 0;
$fn$;
```

**b) Guard restaurado em `fn_confirmar_presenca`** (nos dois laços):

```sql
v_permite_int := COALESCE(r.permite_marca_intervalo, false)
    AND public.fn_jornada_tem_intervalo(v_end_min - v_start_min, r.intervalo_minutos);
```

**c) Guard novo em `fn_confirmar_presenca_manual`**, nos ramos `intervalo_saida` e `intervalo_retorno` — cobre automaticamente o caminho `_bulk`:

```sql
IF NOT public.fn_jornada_tem_intervalo((COALESCE(v_horas_totais, 0) * 60)::integer, v_intervalo_minutos) THEN
    RETURN jsonb_build_object('success', false, 'message',
        'Jornada de ' || COALESCE(v_horas_totais::text, '?') || 'h nao possui intervalo intrajornada.');
END IF;
```

### 2. [MODIFY] `ScaleGrid.tsx` — exibição de segmentos

`isUnitInterval` passa a espelhar a regra do backend, respeitando jornada temporária do dia e usando a duração do turno (não da jornada regular) para Plantão/Extra:

```tsx
const jornadaDoDia = dayTempJourney?.jornadas || jornadas.find(j => j.id === em.jornada_id)
const duracaoHoras = cat === 'Regular'
  ? Number(jornadaDoDia?.horas_totais || 0)
  : Number(turnos.find(t => t.id === turnoId)?.horas_computadas || 0)
const jornadaTemIntervalo = duracaoHoras > 6 && Number(jornadaDoDia?.intervalo_minutos ?? 60) > 0

const isUnitInterval = (cat === 'Regular' || cat === 'Plantão')
  && (unidadedata?.permite_marca_intervalo || false)
  && jornadaTemIntervalo
```

Servidores com jornada ≤ 6h passam a ver **2 segmentos** (Entrada + Saída); jornadas > 6h seguem com **4**.

### 3. [NEW] `20260806010000_fix_undue_interval_marks_short_journeys.sql`

Corrige os 31 registros de 08/2026, em duas etapas, dentro de um bloco `DO` idempotente:

1. **Reconstrói a saída faltante** (10 registros) a partir do horário de término previsto da jornada, tratando jornadas que cruzam a meia-noite, e marca `presenca_saida_manual = true`.
2. **Limpa** `presenca_intervalo_saida_em` / `presenca_intervalo_retorno_em` e as flags `_manual` nos 31, **preservando entrada e saída**.

O conjunto alvo é definido pela própria `fn_jornada_tem_intervalo`, com a mesma resolução de duração do backend (`horas_totais` para Regular, `horas_computadas` para Plantão/Extra) e resolução de jornada via `obter_jornada_servidor_data` (respeita jornadas temporárias).

---

## Resumo das Alterações

| Componente | Arquivo | Mudança |
|---|---|---|
| Regra de negócio | `fn_jornada_tem_intervalo` (novo) | Fonte única: duração > 360 min **e** `intervalo_minutos` > 0 |
| Backend (Terminal) | `fn_confirmar_presenca` | Guard **restaurado** nos dois laços (regressão de `20260804080000`) |
| Backend (Manual + Massa) | `fn_confirmar_presenca_manual` | Guard **novo**; cobre `_bulk` por delegação |
| Frontend | `ScaleGrid.tsx` | `isUnitInterval` considera jornada do dia, turno e `intervalo_minutos` |
| Dados | `20260806010000` | Limpa 31 registros; reconstrói 10 saídas a partir da jornada prevista |

---

## Decisões Tomadas

1. **Jornadas de exatamente 6h não têm intervalo.** Limite `> 360` minutos, conforme CLT Art. 71.
2. **Correção de dados restrita a 08/2026.** Auditoria confirmou não haver registros afetados em outras competências.
3. **A regra vale para Plantão também.** O guard é por duração e `intervalo_minutos`, sem filtro de categoria.
4. **Saídas faltantes são reconstruídas pelo fim previsto da jornada**, não movendo timestamps sintéticos.

---

## Verification Plan

### Pré-requisito

> [!WARNING]
> Nenhuma das migrations foi executada contra um banco. **Aplicar primeiro em homologação**
> (`.env.local` → `mtgfmxsbsyknotvwzdcr.supabase.co`) para validar sintaxe PL/pgSQL antes de produção.
> Atenção: o banco de homologação diverge do de produção (16 unidades em prod vs 5 em homolog,
> e a tabela `escala_diaria` de homolog não possui as colunas `justificativa_manual` /
> `confirmacao_manual` que as funções escrevem).

### Automated

- `SELECT public.fn_jornada_tem_intervalo(360, 60)` → `false`; `(361, 60)` → `true`; `(720, 0)` → `false`.
- Consulta de conferência ao final da migration `20260806010000` deve retornar **zero linhas**.
- `SELECT * FROM fn_varredura_anomalias_presenca(8, 2026)` antes e depois.

### Manual

- Grade (ScaleGrid): jornada `08H ÀS 12H` mostra **2 segmentos**; `07H ÀS 19H` mostra **4**.
- Marcação manual de intervalo em servidor de 4h deve ser **recusada** com mensagem explicativa.
- Terminal: servidor de 4h vai direto de entrada para saída.
- Servidor com **jornada temporária** > 6h sobre jornada fixa ≤ 6h deve voltar a exibir 4 segmentos.

---

## Pendências Fora do Escopo

**7 registros com ordem cronológica impossível** em 08/2026 — causa distinta, afeta também jornadas de 10h. Ver [`incoerencias-cronologicas-08-2026.md`](./incoerencias-cronologicas-08-2026.md).

---

## Anexo: o que mudou na revisão

| Ponto do plano original | Situação real |
|---|---|
| "Alterar `> 240` para `> 360` na migração `20260804070000`" | Essa migração foi superseded por `20260804080000`, onde o guard **não existe**. Precisa ser reescrito, não ajustado. |
| "Turnos de 4h: problema é só no frontend e na marcação manual" | Sem o guard, o backend do terminal também afeta 4h. |
| "`fn_confirmar_presenca` já possui proteção parcial" | Não possui. A proteção foi removida na regressão. |
| Guard citado apenas como `> 240` | O guard original tinha **duas** condições; a segunda (`intervalo_minutos > 0`) era a que efetivamente bloqueava, dado o cadastro atual. |
| `fn_confirmar_presenca_manual_bulk` não mencionado | É a origem dominante dos dados corrompidos (124 de 166 registros são manuais). |
| `UPDATE` com `AND presenca_saida_em IS NULL` | Atingiria 10 de 31 registros (32%), falhando em silêncio nos outros 21. |
| `WHERE ed.categoria = 'Regular'` | Descartaria os 3 registros de Plantão afetados. |
| "Mover o timestamp para o campo correto" | Os timestamps são sintéticos, não batidas reais. Mover criaria registros de ponto falsos. |
