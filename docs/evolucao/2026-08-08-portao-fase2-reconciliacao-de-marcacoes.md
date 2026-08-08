# Portão de qualidade da Fase 2 — reconciliação de marcações

**Data:** 08/08/2026 · **Banco:** produção · **Status: APROVADO**

O plano de integração com relógio de ponto ([`docs/planos/2026-08-08-integracao-relogio-de-ponto-rep.md`](../planos/2026-08-08-integracao-relogio-de-ponto-rep.md))
define que a Fase 2 só passa quando **cada linha do diff tiver explicação escrita** — ou é bug
da função nova, ou é defeito conhecido do caminho antigo. Como o projeto não tem framework de
testes, este documento é o registro dessa análise.

Verificação feita por RPC sobre produção, chamando apenas funções `STABLE`.
`fn_reconciliar_marcacoes_dia` **não foi executada** — nenhum dado foi alterado.

---

## Portão 1 — backfill: bateu exato

| | esperado | obtido |
|---|---|---|
| marcações retroativas | 7.142 | **7.142** |
| origem `terminal` | 6.681 | 6.681 |
| origem `ajuste_coordenador` | 461 | 461 |
| `sintetica = true` | 1.912 | 1.912 |
| em linha `Sobreaviso` | 0 | 0 |

## Portão 2 — execução

`fn_blocos_previstos_dia`, `fn_alocar_marcacoes_dia` e `fn_projecao_marcacoes_dia` executam,
e a alocação é **determinística** (duas chamadas devolvem jsonb idêntico).

Dois defeitos foram encontrados e corrigidos aqui — ambos só apareceriam em execução, porque
`LANGUAGE plpgsql` não valida o corpo no `CREATE FUNCTION`:

1. **`text[] || 'entrada'`** → `22P02 malformed array literal`. Literal sem tipo faz o Postgres
   escolher a sobrecarga `anyarray || anyarray`. Corrigido com `::text`.
2. **Janela de busca de marcações ancorada no calendário** (meia-noite de ontem até amanhã +
   tolerância, ~48h) em vez de nos slots. Batidas dos dias vizinhos entravam na disputa pelos
   slots de hoje e o DP as encaixava. Produzia erros de 1440 e 2880 minutos — 1 e 2 dias
   exatos — e criava horário em linha que não tinha nenhum. Corrigido amarrando a janela ao
   primeiro e ao último slot, com a tolerância nas pontas.

Efeito da segunda correção sobre 01–07/08:

| | antes | depois |
|---|---|---|
| divergências totais | 663 | **286** |
| com cara de deslocamento de dia | ~166 | **1** |
| `ausente_no_atual` (projeção inventando horário) | 209 | **16** |

## Portão 3 — o diff, classe por classe

286 divergências em 01–07/08/2026. Todas explicadas:

### (a) Intervalo em unidade que não exige marcação — 185 casos (65%)

`ausente_na_projecao / intervalo_saida` (105) e `intervalo_retorno` (80).

**Causa.** Das 16 unidades, **apenas `USF ENFERMEIRA ZEZINHA` tem `permite_marca_intervalo = true`**.
Ainda assim, 103 linhas de `escala_diaria` têm intervalo gravado em unidade que não exige —
96 na SMS e 7 no LACEM — e **todas em 08/2026**.

A concentração num único mês aponta para a regressão já documentada no `CLAUDE.md` (armadilha 1):
`20260804080000` perdeu o guard de intervalo, corrigido só em `20260806000000`. Nessa janela a
validação manual gravou intervalo sem checar `unidades.permite_marca_intervalo`. Coerente com o
fato de 115 das 168 marcações de intervalo terem `presenca_intervalo_saida_manual = true`.

**Veredito.** A projeção está **correta** ao não reproduzi-las — ela aplica
`fn_jornada_tem_intervalo` e o guard da unidade. São artefatos de bug.

⚠️ **Bloqueador para a Fase 5.** A reconciliação escreve os quatro campos a partir da projeção,
inclusive anulando o que ela não tem. Ligar a reconciliação numa dessas unidades **apagaria as
103 marcações de intervalo**. Isso precisa de decisão explícita antes da virada de chave — não
pode ser efeito colateral.

### (b) Timestamps sintéticos de fronteira de bloco — 60 casos

`horario_diferente` acima de 90 min, concentrados em 37 dias de servidor. Exemplo real:

```
LEILANE em 2026-08-04
  escala_diaria: Extra 16:00 -> 17:42  |  Regular 06:59 -> 16:00
  bloco previsto: Regular 06:59-17:42 (Extra e Regular fundidos, contiguos em 16:00)

  projeção: entrada 06:59 e saída 17:42 nas DUAS linhas
  divergências:
    entrada da linha Extra    : atual 16:00 -> projetado 06:59  (540 min)
    saída   da linha Regular  : atual 16:00 -> projetado 17:42  (103 min)
```

Os dois `16:00` são exatamente os horários **fabricados por `fn_salvar_saida_bloco`**
(`20260706115000`), que preenche as fronteiras internas do bloco com os limites previstos de
cada turno — horários que ninguém bateu. A pessoa entrou uma vez às 06:59 e saiu uma vez às 17:42.

**Veredito.** Divergência **esperada e desejada**, já antecipada no cabeçalho da migration
`20260808060000`. A projeção nunca fabrica horário.

**A folha de ponto não muda.** Ela consolida o dia por `MIN(entrada)` e `MAX(saída)` sobre todos
os turnos:

| | MIN(entrada) | MAX(saída) |
|---|---|---|
| modelo atual | `MIN(06:59, 16:00)` = 06:59 | `MAX(16:00, 17:42)` = 17:42 |
| projeção | `MIN(06:59, 06:59)` = 06:59 | `MAX(17:42, 17:42)` = 17:42 |

Idênticos.

### (c) Duplicadas e excedentes — subproduto de (b)

O alocador reporta `duplicada` quando duas marcações da mesma origem caem a menos de 60s —
é o caso do check-in, que `fn_confirmar_presenca` grava com o **mesmo timestamp em todas as
linhas do bloco**. E reporta `excedente` para as fronteiras internas fabricadas (09:00, 11:00,
13:00 num dia com vários Extra contíguos), todas com segundos zerados, isto é, `sintetica = true`.

**Veredito.** Comportamento correto: identifica artefato como artefato, e **nenhuma marcação é
descartada** — todas continuam registradas como pendência.

### (d) Deslocamento de dia — 1 caso residual

De ~166 para 1 após a correção da janela. Resíduo isolado, sem padrão.

---

## Conclusão

O portão da Fase 2 está **aprovado**: nenhuma divergência sem explicação, e nenhuma indicando
que o alocador põe batida no passo errado.

### Pendências registradas para as fases seguintes

| # | assunto | fase |
|---|---|---|
| 1 | Decidir o destino das 103 marcações de intervalo em unidades que não exigem marcação. Apagar é defensável (são artefatos de bug), mas exige decisão explícita — não pode ser efeito colateral da reconciliação. | **antes da 5** |
| 2 | Convergir as três regras de intervalo (terminal, validação manual, folha). Enquanto divergirem, a classe (a) continuará aparecendo. | 8 |
| 3 | Investigar o 1 caso residual de deslocamento de dia. | 3 |

### Como reproduzir

Scripts de verificação em `scratchpad/`: `portoes_fase2.js`, `intervalo_incoerente.js`,
`explicar_diffs.js`. Todos somente leitura, via PostgREST com service role.

Em SQL, o equivalente está no rodapé de cada migration — comece pela consulta 1 de
`20260808060000`.
