# Pendências e cronograma

Índice único do que está aberto. Atualizado em **23/08/2026**.

Cada item aponta para o plano ou o diário que tem a medição — este arquivo é só o mapa, nunca a
fonte. Ao fechar um item, **mova-o para "Concluído"** com a data e a versão.

---

## Próxima rodada — semana de 24–28/08/2026

### 1. Auditoria de segurança e LGPD 🔴

**Plano:** [`docs/planos/2026-08-23-auditoria-de-seguranca-e-lgpd.md`](planos/2026-08-23-auditoria-de-seguranca-e-lgpd.md)

Pedida pelo usuário em 23/08/2026: o sistema está escalando rápido, guarda dado pessoal
**sensível** (saúde, biometria, localização) e roda em órgão público.

Ordem por dependência: **Fase 0** (inventário) → **Fase 1** (RLS/RPC/server action/rota) →
**Fase 3** (segredos e repositório público) → 2 → 4 → 5.

⚠️ Auditoria é **leitura**. Achado vira item de plano, não correção no ato.

---

## Aberto, sem data

### 2. Auditoria das marcações sintéticas 🔴

`fn_salvar_saida_bloco` **fabrica** os horários de transição de um bloco a partir da escala — o
comentário da própria função diz isso. A folha exibe o resultado com origem **`real`**.

Medido em 08/2026: **533 marcações `sintetica = true` com origem `terminal`**, 51 servidores,
**244 já gravadas como horário de presença**. Parte é backfill de `20260808030000` (histórico),
parte é fabricação viva — separar as duas é o primeiro passo.

É a vedação 2 da Portaria 671/2021 (marcação automática com horário predeterminado) e é
**juridicamente mais grave** que a hora extra que motivou a sessão de 23/08.

Diário: [`docs/evolucao/2026-08-23-dono-do-passo-do-bloco.md`](evolucao/2026-08-23-dono-do-passo-do-bloco.md) §"Achados registrados".

### 3. C4 — reclassificar batida real entre linhas do mesmo dia 🟡

`fn_reclassificar_passo_presenca` (`20260812150000`) move batida real entre os 4 passos da **mesma**
linha de `escala_diaria`. Falta levantar esse limite para mover **entre linhas** do mesmo dia
(Regular ↔ Plantão) — proposta do usuário em 23/08/2026.

É o **remédio residual** dos dias que o C1 deixa em pendência, não a correção principal.

Plano: [`docs/planos/2026-08-23-turno-regular-emendado-com-plantao.md`](planos/2026-08-23-turno-regular-emendado-com-plantao.md) item C4.

### 4. Teste de campo do C3 🟡

`20260823130000` está aplicada e confirmada em produção (`c3_aplicada = true`), mas **não há como
validá-la por simulação** — só executando o caminho real.

Num dia de Regular emendado com Plantão, bater no horário da fronteira deve responder
*"Saída do turno confirmada às HH:MM. Registre a entrada do próximo turno."*

Acompanhar na semana seguinte a queda de `Fora da janela de presença permitida` em unidades com
turnos fundidos (consulta 3 no rodapé da migration).

### 5. Vínculo duplo e identificação no relógio 🟡

110 CPFs com duas matrículas, e `uq_vinculo_vigente` só aceita **um** vínculo vigente por
`(dispositivo, identificador)`. Limitação de hardware/protocolo AFD, não só de schema.

Plano: [`docs/planos/2026-08-13-vinculo-duplo-e-identificacao-no-rele.md`](planos/2026-08-13-vinculo-duplo-e-identificacao-no-rele.md)

### 6. Pendrive nunca testado ponta a ponta 🟡

Nem a coleta (`afd-exportar`) nem o envio de cadastros por esse canal foram exercitados contra
hardware real em ciclo completo. Falta também decidir como higienizar um relógio que só recebe
pendrive.

---

## Operacional — não é software

### 7. 10 dias com campo `manual` na folha de 08/2026

13h30 de hora extra que **nem a correção de banco nem a regeneração alcançam** —
`preservacao.ts` preserva campo que alguém decidiu, por desenho. Só o coordenador desfaz:

| servidor | dias |
|---|---|
| ANDRESA MELO PEREIRA (54594) | 10 — 6h00 |
| LUCAS REIS CAMPOS (58822) | 3, 4, 5, 10, 11, 19 — 1h cada, entrada `00:00` (lixo) |
| ILMAR DA SILVA DE OLIVEIRA (54457) | 16 — 1h01 |
| MAISA (32269) · ELIZABETH (1133) | 17 — 0h23 · 0h06 |

### 8. Escala da AGNA: `T` (6h) para um plantão de ~3h55

✅ **Confirmado pelo usuário em 23/08/2026: ela realmente saiu mais cedo.** Enquanto o código for
`T`, o bloco prevê saída às 20:00 e a batida das 18:00 segue recusada (âmbar). Decisão do
coordenador: manter e justificar, ou trocar para `T4`.

### 9. Tolerância de hora extra — acompanhar

`20260823120000` entrou com o padrão da CLT (5 min por marcação / 10 min diários) e é editável em
Configurações → Regras. Não recalcula folha nenhuma: o efeito aparece na próxima geração.

Sobre 08/2026 seriam **485h11 → 466h47**. Vale reconferir depois da primeira competência inteira
sob a regra nova.

---

## Concluído em 23/08/2026

| item | versão | migration |
|---|---|---|
| Passo do bloco pertence a um turno só (C1) + espelho da fronteira (C2) | v2.9.0 | `20260823100000` |
| Fuso horário único vindo da configuração global | v2.10.0 | `20260823110000` |
| Rota de regeração de folhas por competência | v2.10.1 / v2.10.2 | — |
| Tolerância do Art. 58 §1º da CLT, configurável | v2.11.0 | `20260823120000` |
| Terminal aceita a batida de transição (C3) | v2.12.0 / v2.12.1 | `20260823130000` |

Hora extra em dia com plantão escalado, 08/2026: **75h12 → 3h21**.
406 folhas regeradas, 26 preservadas, 0 falhas. 131 dias reconciliados, 176 linhas.
