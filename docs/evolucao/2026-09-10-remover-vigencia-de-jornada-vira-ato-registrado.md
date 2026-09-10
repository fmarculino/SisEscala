# Remover alteração de horário por período vira ato registrado (10/09/2026)

**Migration:** `20260910100000_delete_vigencia_jornada_ato_registrado.sql`
**Versão:** v2.54.0
**Portões:** `node scratchpad/sim_vigencia_exclusao.js` (31) · `node scratchpad/val_sim_vigencia_exclusao.js` (9 regressões)
**Validado em homologação** contra o banco real, ensaio revertido: 8 de 8 cenários.

## Como começou

O usuário mandou duas telas — a ficha de uma servidora com oito "Alterações de Horário por
Período", todas de um dia, e a grade de setembro do RH do HMI — e a pergunta:

> quando se colocar um servidor numa escala temporária, a partir do momento que houver um
> registro no referido período não deve ser possível deletar essa jornada temporária, concorda
> comigo? [...] se já teve, se excluir vai dar problema na grade não vai?

A intuição do risco estava certa. A conclusão — bloquear — estava errada, e por um motivo que só
apareceu ao medir.

## O que estava aberto

`deleteJornadaTemporaria` (`servidores/actions.ts`) era um `DELETE` cru: sem checagem de ponto,
sem motivo, sem histórico. E **não existia trigger de `DELETE`** nessa tabela — o único era o
`BEFORE INSERT OR UPDATE` de sobreposição (`20260819240000`).

A assimetria só fica visível com as três operações lado a lado:

| operação | exige motivo? | deixa rastro? |
|---|---|---|
| **criar** vigência | sim (`MOTIVO_OBRIGATORIO`) | a própria linha |
| **trocar** a jornada do mês | sim, justificativa | `escala_mensal_jornada_historico` |
| **apagar** a vigência | **não** | **nenhum** |

A mais destrutiva das três era a única sem freio.

## O que a medição em produção mostrou

69 vigências, 33 servidores. **61 das 69 nasceram em 09/2026** — o recurso explodiu neste mês.
50 são de **um dia só** (motivo típico: "ajuste de escala"), ou seja, está em uso como ajuste
pontual, não como vigência longa.

| medida | valor |
|---|---|
| vigências que já cobrem dia com ponto | **38 de 69 (55%)** |
| dias com ponto sob vigência | **115** |
| desses, em folha `Revisada` | 68 |
| em folha fora de Rascunho **e** competência aberta | **32** |
| competências encerradas | 06 e 07/2026 |

Os 32 importam porque o botão **"Corrigir Todas"** da tela de folha pula competência encerrada
mas **não pula folha `Revisada`** — é por ali que a mudança chegaria a documento já fechado.

## 🚨 Medir em horas subestima, e por muito

A primeira ideia foi dimensionar o estrago somando a diferença de carga entre a jornada da
vigência e a do mês. Deu 76h — e é um número enganoso.

**Em 97 dos 115 dias batidos a carga é IDÊNTICA.** Delta zero. Mas em **43 deles a janela
inteira desloca**: 179h de deslocamento na entrada e 179h na saída.

O caso mais pesado é literal:

> **SILVIA MERCEDES (28558)** — vigência `10H ÀS 14H` contra jornada do mês `14H ÀS 18H`,
> 23/06 a 20/07, **20 dias já batidos**, folha `Revisada`.
> Mesma carga de 4h. Diferença de horas: **zero**. Entrada prevista: de 10:00 para 14:00.

Um aviso dizendo "0h de diferença" seria uma **mentira tranquilizadora** no caso mais comum. Por
isso `fn_vigencia_jornada_impacto` devolve a **janela** (de → para), nunca um total de horas.

## Por que não é bloqueio duro por "já tem batida"

Foi a primeira ideia, e o `CLAUDE.md` já registra ela como testada e recusada na operação irmã
(troca da jornada do mês, 19/08/2026): *proíbe a mudança legítima e não resolve o engano*.

Aqui o argumento é ainda mais forte: **desfazer um engano é a única razão legítima que existe
para apagar uma vigência.** Mudança real de horário daqui pra frente é vigência **nova**, nunca
apagar a antiga. Travar quem tem ponto congelaria para sempre a vigência cadastrada errada — e
os motivos já gravados provam que isso acontece: *"horário cadastrado indevido"*, *"registro
errado de horário de trabalho"*.

## O que muda de fato ao apagar

Nada se perde. `marcacoes_ponto` é INSERT-only, `escala_diaria.presenca_*` não é reescrita pelo
`DELETE` e `folha_ponto.registros` é snapshot. O que muda é o **julgamento** do dia:
`obter_jornada_servidor_data` deixa de achar a vigência e cai para `escala_mensal.jornada_id`.

⚠️ **E o pior modo de falha era a demora.** Como nada disparava reconciliação nem regeração, a
folha continuava com os números velhos até alguém clicar em "Sincronizar" — semanas depois, sem
causa visível.

## A correção

| peça | onde |
|---|---|
| histórico append-only (sem policy de escrita) | `servidores_jornadas_temporarias_historico` |
| o que a remoção causa, para a tela avisar antes | `fn_vigencia_jornada_impacto` |
| a remoção, com motivo e as duas recusas | `fn_excluir_vigencia_jornada` |
| rede de segurança contra o `DELETE` cru | `trg_vigencia_jornada_exclusao_registrada` |
| modal com o impacto e o campo de motivo | `ServidorDetalhesClient.tsx` |

As duas recusas duras são exatamente **onde o resto do sistema já recusa**, e as duas têm saída:
dia com ponto em **folha fora de Rascunho** (reabrir a folha — RH e Administrador podem, desde
04/09/2026) e em **competência encerrada** (reabrir em Configurações, que já é ato registrado).

⚠️ **A RPC não reconcilia nem sincroniza**, de propósito. Reconciliar em massa está medido e
recusado (4 ganhos contra 43 trocas e 7 perdas). Ela **devolve** os dias afetados, e a tela os
lista por extenso — a mudança passa a ser anunciada no clique em vez de aparecer sozinha depois.

## O que o ensaio em homologação achou, e o portão sozinho não acharia

🚨 **`set_config(..., true)` é local à TRANSAÇÃO, não à função.** No cenário 7 do ensaio, um
`DELETE` cru executado logo depois da RPC, na mesma transação, **passou direto pela trigger** —
o GUC continuava ligado.

Hoje não existe caminho na aplicação que faça isso (cada RPC do PostgREST é uma transação
própria), mas a janela não precisava existir. A RPC passou a desligar o GUC no statement
seguinte ao `DELETE`, e o portão reprova quem tirar essa linha.

ℹ️ **As funções irmãs têm a mesma folga e não foram tocadas**: `sisescala.fundir_setor`
(`20260829110000`), `sisescala.mesclar_servidor` (`20260904130000`) e `sisescala.reparse_afd`
(seis migrations) ligam o GUC e nunca o desligam. Fica registrado como pendência conhecida — o
risco é o mesmo, e a correção é a mesma linha.

## De passagem

⚠️ A coluna **DURAÇÃO** mostrava **"0 dias"** para período de um dia. As datas da vigência são
inclusivas nos dois extremos (`>= data_inicio AND <= data_fim`), e `calculateDuration` fazia
`fim − início` sem o `+ 1`. Como 50 das 69 vigências são de um dia, o valor errado era o caso
dominante da tela.

## Ensaio (homologação, revertido)

| # | cenário | resultado |
|---|---|---|
| 1 | impacto de dia com ponto em folha `Revisada` | `pode_excluir = false`, impedimento nomeando a folha |
| 2 | remover com folha fechada | recusado |
| 3 | motivo de 3 caracteres | recusado |
| 4 | `DELETE` cru na tabela | recusado |
| 5 | remoção com dia batido e folha em Rascunho | removeu, gravou histórico, devolveu `["01/06/2026"]` |
| 6 | `UPDATE` no histórico | recusado (append-only) |
| 7 | `DELETE` cru depois da RPC (vazamento de GUC) | recusado **após a correção** |
| 8 | período sem ponto nenhum | removeu, `dias_a_revisar = []` |

Conferido depois: 0 vigências, 0 linhas de histórico, 48/48 folhas com o status original — o
ensaio inteiro se desfez.
