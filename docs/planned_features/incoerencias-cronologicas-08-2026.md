# Incoerências Cronológicas de Presença — 08/2026

**Levantado em:** 06/08/2026
**Reverificado em:** 07/08/2026, após aplicar `20260806000000` e `20260806010000` em produção
**Status:** 4 registros pendentes de diagnóstico — nenhuma correção aplicada a eles

## Situação atual

Eram 7 registros com sequência de batidas cronologicamente impossível. Após a correção de intervalos indevidos, **restam 4** — os outros 3 tinham a incoerência causada pelos campos de intervalo, que foram limpos.

Este é um problema **distinto** do intervalo indevido: 3 dos 4 restantes são jornadas de 10h, com direito legítimo a intervalo.

| # | servidor | jornada efetiva | h | dia | entrada | int. saída | int. retorno | saída | anomalia |
|---|---|---|---|---|---|---|---|---|---|
| 1 | LAUREN MONTEIRO MINUZZ… | 08H ÀS 18H | 10 | 4 | 15:16 | **15:00** | — | 20:56 | intervalo 16 min antes da entrada |
| 2 | CLAUDIO LOPES MARÇAL | 08H ÀS 18H *(temporária)* | 10 | 3 | 16:00 | **15:00** | 17:00 | 21:00 | intervalo 1h antes da entrada |
| 3 | VALDEMIR ALECAR DA SIL… | 08H ÀS 18H | 10 | 4 | 15:01 | **15:00** | 17:00 | 21:00 | intervalo 1 min antes da entrada |
| 4 | NOEMIA NAZARE TEIXEIRA | 07H ÀS 13H | 6 | 4 | **16:37** | — | — | 16:00 | saída 37 min antes da entrada |

Horários em UTC. Marabá é UTC−3.

> [!NOTE]
> O registro 4 merece atenção especial. Os campos de intervalo dele foram limpos e a saída
> (16:00 UTC = **13:00 local**) foi reconstruída pela migration `20260806010000` a partir do fim
> previsto da jornada `07H ÀS 13H` — o valor está correto para a jornada. A incoerência vem da
> **entrada**, que já estava anômala antes: 16:37 UTC = 13:37 local, para uma jornada que
> termina às 13h. A reconstrução não criou o problema, mas o tornou visível.

## Padrão observado

Os registros 1, 2 e 3 compartilham a mesma assinatura:

- **entrada** com segundos/minutos "quebrados" (`15:16`, `15:01`) ou redonda porém tardia — batida real de terminal ou ajuste;
- **saída do intervalo** exatamente em `15:00` — horário sintético;
- os três são da mesma jornada `08H ÀS 18H`, nos dias 3 e 4 de agosto.

`15:00 UTC` = 12:00 local = `08h + 4h`, que é exatamente a fórmula usada pela validação manual para derivar a saída do intervalo. Ou seja: **a validação manual gravou o intervalo sem considerar a entrada real já registrada**. O `COALESCE` das funções protege cada campo individualmente contra sobrescrita, mas nada garante coerência *entre* os campos.

## Hipótese principal

A validação em massa (⚡) foi executada nos dias 3 e 4 de agosto sobre servidores que **já haviam batido o ponto**. Para cada campo ainda nulo, ela preencheu o valor teórico derivado da jornada, sem confrontar com os campos já preenchidos. Onde a batida real divergiu do previsto, o resultado ficou fora de ordem.

Isso é consistente com os 186 registros de saída com minuto `:00` (sintéticos) convivendo com batidas reais no mesmo conjunto.

## Próximos passos sugeridos

1. **Decidir a política de correção** para os 4 registros: limpar os campos sintéticos e reabrir para validação manual com horário real, ou aceitar o previsto da jornada.
2. **Prevenir na origem** — adicionar validação de coerência em `fn_confirmar_presenca_manual`: antes de gravar, recusar (ou ajustar) valores que violem a ordem `entrada ≤ intervalo_saída ≤ intervalo_retorno ≤ saída`.
3. **Barreira no banco** — avaliar `CHECK` constraint em `escala_diaria` com a mesma ordem, ignorando nulos. Impede a reincidência independente do caminho de escrita.

## Observação separada (não é defeito confirmado)

Na distribuição de 476 registros `Regular` com saída em 08/2026, comparando a saída real com o fim previsto da jornada:

| diferença | qtd | % |
|---|---|---|
| exatamente no horário | 360 | 75,6% |
| **−1h** | 92 | **19,3%** |
| +1h | 20 | 4,2% |
| outros | 4 | 0,8% |

Os 19,3% saindo exatamente 1 hora antes podem ser realidade operacional (liberação antecipada) ou indicar algo sistemático num subconjunto. Não é um erro de fuso — se fosse, atingiria os 100%, não 19%. Fica registrado para eventual análise; não há evidência de defeito.

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
