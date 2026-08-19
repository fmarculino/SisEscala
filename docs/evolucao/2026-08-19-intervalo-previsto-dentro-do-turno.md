# O intervalo previsto passa a cair dentro do próprio turno (19/08/2026)

## O que estava errado

`jornadas.intervalo_inicio_padrao` / `intervalo_fim_padrao` são **hora absoluta** — 12:00 e 14:00.
A montagem do turno usava esse padrão para qualquer categoria, inclusive um Plantão que começa às
19:00 e termina às 07:00 do dia seguinte. A janela de intervalo do plantão noturno nascia **antes
da própria entrada**.

Medido em produção (agosto/2026): **9 dos 3.626 blocos**, todos plantão `19:00 → 07:00` com
intervalo previsto às `12:00`. Efeito real, já gravado **antes** de qualquer mudança desta rodada —
não é regressão:

```
ICARO HENRIQUE CABRAL SOUZA, 18/08/2026, linha do Plantão
  entrada 19:03 | intervalo 13:02 / 13:37 | saída 06:55
```

Intervalo seis horas antes da entrada. O fallback relativo que já existia no código
(`v_start_min + 240`) daria a resposta certa, mas só era usado quando a jornada não tinha padrão
nenhum — nunca quando tinha um padrão que não servia àquele turno.

## A correção — `20260819220000`

Duas etapas, nesta ordem, aplicadas logo depois de o padrão ser lido:

1. **Turno que cruza a meia-noite.** Se a hora absoluta está antes do início do turno mas cabe
   somando um dia, ela pertence ao dia seguinte. `01:00` num turno `19:00 → 07:00` é uma da
   madrugada, não uma da tarde anterior.
2. **Ainda fora do turno.** O padrão não serve para este turno: cai para o relativo,
   **preservando a duração** que o padrão definia (12:00–14:00 continua valendo 2h). Se nem assim
   couber (turno curto com padrão absurdo), centraliza no turno.

Turno cujo padrão já cai dentro da janela — **3.617 dos 3.626 blocos** — não muda em nada: as duas
condições são falsas e o código passa direto.

Validado em Postgres real antes de aplicar:

| turno | padrão | resultado |
|---|---|---|
| Plantão 19:00→07:00 | 12:00–14:00 | 23:00 → 01:00 |
| Plantão 19:00→07:00 | 01:00–02:00 | 01:00 → 02:00 do dia seguinte |
| Regular 07:00–13:00 | 12:00–13:00 | inalterado |
| Regular 08:00–18:00 | 12:00–14:00 | inalterado |
| Turno curto 08:00–15:00 | 22:00–23:00 | 12:00 → 13:00 (centralizado) |

## Paridade — por que duas funções

O mesmo trecho existe em **`fn_confirmar_presenca`** (2 sítios: cursor de hoje e cursor de ontem) e
em **`fn_blocos_previstos_dia`** (1 sítio, cópia mecânica do primeiro). As duas foram corrigidas na
mesma migration: se só a cópia mudasse, o terminal aceitaria uma janela de intervalo e a
reconciliação preveria outra — exatamente o tipo de divergência que a armadilha 1 do `CLAUDE.md`
existe para evitar.

Gerada por `scratchpad/gen_intervalo_dentro_do_turno.js`, que copia os corpos vigentes byte a byte
e aborta se a contagem de ocorrências divergir. Invariantes conferidos antes e depois em
`fn_confirmar_presenca`: 14 guards `<> 'Sobreaviso'`, 2 `fn_jornada_tem_intervalo`, 3
`fn_ajuste_intervalo_flexivel`, 31 `dobra_diurna`. Em `fn_blocos_previstos_dia`: o guard de escopo,
os guards de Sobreaviso e os 3 `turnos_inicio` da batida de transição.

## Como aplicar

1. Aplicar `supabase/migrations/20260819220000_intervalo_previsto_dentro_do_turno.sql`.
   **Só troca funções — não escreve dado.**
2. `node scratchpad/portao_dono_piso.js` — dry-run.
3. `node scratchpad/portao_dono_piso.js --aplicar` — reconcilia os dias afetados.
4. "Sincronizar" nas folhas envolvidas.

⚠️ **Isto mexe em `fn_confirmar_presenca`**, a função do terminal de ponto. A mudança é aditiva e
condicional (só age quando o intervalo previsto cai fora do turno), mas o caminho real do terminal
não tem teste automatizado — vale bater um ponto de verdade numa unidade com marcação de intervalo
depois de aplicar.
