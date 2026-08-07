# Incoerências Cronológicas de Presença — 08/2026

**Levantado em:** 06/08/2026 (auditoria de produção, somente leitura)
**Status:** diagnóstico pendente — nenhuma correção aplicada

## Resumo

Durante a auditoria da [correção de intervalos em jornadas curtas](./implementation_plan.md), foram encontrados **7 registros de `escala_diaria` cuja sequência de batidas é cronologicamente impossível**.

Este é um problema **distinto** do intervalo indevido: afeta também jornadas de 10h, que têm direito legítimo a intervalo. Por isso foi separado do plano principal.

## Registros afetados

Horários em UTC, como armazenados. Marabá é UTC−3.

| # | jornada | h | categoria | dia | entrada | int. saída | int. retorno | saída | anomalia |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 08H ÀS 18H | 10 | Regular | 4 | 15:16 | **15:00** | — | 20:56 | intervalo antes da entrada |
| 2 | 13H ÀS 17H | 4 | Regular | 3 | 16:00 | **15:00** | 17:00 | **21:00** | intervalo antes da entrada; saída 4h após o fim da jornada |
| 3 | 08H ÀS 18H | 10 | Regular | 4 | 15:01 | **15:00** | 17:00 | 21:00 | intervalo 1 min antes da entrada |
| 4 | 07H ÀS 17H | 10 | **Extra** | 3 | 10:00 | 14:00 | 16:00 | **12:00** | saída antes do retorno do intervalo |
| 5 | 08H ÀS 14H | 6 | Regular | 4 | 17:08 | **15:00** | — | 17:08 | intervalo antes da entrada; saída == entrada |
| 6 | 08H ÀS 14H | 6 | **Plantão** | 3 | 17:00 | 21:00 | 21:00 | **20:57** | saída antes do intervalo; intervalo de duração zero |
| 7 | 07H ÀS 13H | 6 | Regular | 4 | 16:37 | 15:00 | **14:00** | 16:00 | retorno antes da saída do intervalo |

Os registros 2, 5, 6 e 7 têm jornada ≤ 6h e portanto **terão os campos de intervalo limpos** pela migration `20260806010000`. Isso resolve parte da incoerência, mas **não** explica a origem dos horários errados de entrada/saída (ex: registro 2, saída às 21:00 para jornada que termina às 17h).

## Hipóteses a investigar

1. **Colisão entre batida real e validação manual.** Registros 1, 3 e 5 têm entrada com segundos/microssegundos (batida real de terminal) e intervalo em horário redondo (`15:00`, sintético). A validação manual grava `início da jornada + 4h` sem verificar a entrada real já existente — o `COALESCE` protege o campo, mas não a coerência entre campos.

2. **`start_hour` resolvido incorretamente.** A hora de início é deduzida por regex sobre o **nome** da jornada (`substring(j.nome from '^([0-9]+)')`). Registros com entrada muito fora do previsto (ex: #5, entrada 17:08 para jornada `08H ÀS 14H`) sugerem que o turno da célula, e não a jornada, determinou a janela.

3. **Categoria `Extra` com alinhamento dinâmico.** O registro 4 é `Extra`; o alinhamento do `start_hour` de horas extras ao fim do turno regular é justamente o ponto sensível documentado no [`.agents/AGENTS.md`](../../.agents/AGENTS.md).

## Próximos passos sugeridos

1. Cruzar cada registro com `logs_tentativas_presenca` e `confirmado_por_id` para separar batida real de ajuste manual.
2. Decidir a política de correção: limpar e reabrir para validação manual, ou reconstruir pelo horário previsto da jornada.
3. Avaliar uma **constraint de coerência** em `escala_diaria` (`presenca_entrada_em <= presenca_intervalo_saida_em <= presenca_intervalo_retorno_em <= presenca_saida_em`, ignorando nulos) para impedir novas ocorrências na origem.

## Como reproduzir a auditoria

```sql
SELECT s.nome, j.nome AS jornada, j.horas_totais, ed.categoria, ed.dia,
       ed.presenca_entrada_em, ed.presenca_intervalo_saida_em,
       ed.presenca_intervalo_retorno_em, ed.presenca_saida_em
FROM escala_diaria ed
JOIN escala_mensal em ON ed.escala_mensal_id = em.id
JOIN servidores s ON em.servidor_id = s.id
LEFT JOIN jornadas j ON j.id = obter_jornada_servidor_data(
                            em.servidor_id, MAKE_DATE(em.ano, em.mes, ed.dia), em.jornada_id)
WHERE em.ano = 2026 AND em.mes = 8
  AND (
        ed.presenca_intervalo_saida_em   < ed.presenca_entrada_em
     OR ed.presenca_intervalo_retorno_em < ed.presenca_intervalo_saida_em
     OR ed.presenca_saida_em             < ed.presenca_intervalo_retorno_em
     OR ed.presenca_saida_em             < ed.presenca_entrada_em
      )
ORDER BY s.nome, ed.dia;
```
