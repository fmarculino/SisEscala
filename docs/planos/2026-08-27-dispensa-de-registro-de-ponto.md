# Justificativa coletiva autorizada pelo RH (dispensa de registro de entrada)

**27/08/2026 — ✅ implementado (fases 1 a 4). Migration `20260827020000` aguardando aplicação.**

| fase | estado |
|---|---|
| 0 — confirmar com o coordenador que o Validar em Massa já resolve o volume | ✅ **confirmado em 27/08/2026**: o coordenador já conhece a validação em massa e sabe usá-la. O ganho desta entrega é a autorização e o modo que preserva a saída, não a mão de obra |
| 1 — tabela de autorizações + tela do RH Geral | ✅ `autorizacoes_ponto_coletivo`, aba **Autorizações do RH** em `/marcacoes` |
| 2 — modo "somente passos autorizados" no Validar em Massa | ✅ `fn_atestar_passos_autorizados_bulk` + botão 🔒 no modal da grade |
| 3 — folha cita o ofício | ✅ `src/utils/folha/autorizacaoPonto.ts`, aplicado nas **4** cópias da geração |
| 4 — relatório de autorizações vigentes | ✅ a própria aba lista vigentes e revogadas, com servidor, passos, vigência e ofício |

⚠️ **Nada disso tem efeito enquanto o RH não conceder a primeira autorização** — sem autorização
vigente, o modo novo nem aparece no modal e a folha não imprime nada de diferente.

Origem: Ofício nº 249/2026/SMS-PRO-ESP/SMS-PMM (Processo 050505164.000160/2026-10), pedindo
**dispensa do registro biométrico de entrada** para 7 técnicos de enfermagem do **Programa Porta
a Porta**, mantendo **obrigatória a batida de saída** na sede da SMS.

O que se quer resolver não é o registro em si — é o **trabalho manual**: no modo tradicional o
coordenador justifica dia a dia, servidor por servidor. A proposta é **uma justificativa só,
para todos os servidores naquela condição, cobrindo o mês inteiro**, já que a determinação é do
RH central e o motivo é o mesmo para todos.

---

## 1. O ponto mais importante: metade disso já existe

O botão **"⚡ Validar em Massa"** da grade de escala já faz:

| o que o ofício exige | o Validar em Massa já dá? |
|---|---|
| vários servidores de uma vez | ✅ lista com checkbox e "Marcar Todos" — o setor inteiro |
| mês inteiro | ✅ intervalo de dias (início → fim) |
| uma justificativa só para todo o lote | ✅ campo obrigatório, aplicado a todas as linhas |
| escolher o que validar | ⚠️ parcial — só "Dia Completo", "1º Período" e "2º Período" |
| autorização do RH como pré-condição | ❌ não existe |

Ou seja: **o coordenador não precisa justificar dia a dia hoje.** Vale conferir com ele se sabe
disso antes de qualquer desenvolvimento — pode ser que o problema real seja só de conhecimento
da ferramenta, e nesse caso as duas lacunas abaixo é que merecem código.

E o dado gravado assim já é legítimo: sai com origem `ajuste_coordenador` e `sintetica = true`, a
folha o rotula como **manual**, e o sistema não o apresenta como batida. É o coordenador
declarando, com justificativa — tratamento autorizado pelo Art. 82, parágrafo único da Portaria
671/2021. A vedação da Portaria é o *sistema* marcar sozinho, o que não é o caso.

---

## 2. As duas lacunas reais

### Lacuna A — não existe um modo que preserve a saída

Os três modos atuais gravam pares fechados:

| modo | grava |
|---|---|
| Dia Completo | entrada + saída do intervalo + retorno + **saída** |
| 1º Período | entrada + saída para o intervalo |
| 2º Período | retorno do intervalo + **saída** |

O ofício pede o oposto de todos eles: **declarar a entrada (e os intervalos) e deixar a saída
vir do relógio**, real. Falta um modo — chame-se "Somente entrada/intervalos" — que grave os
passos autorizados e **não toque na saída**.

ℹ️ A validação manual não sobrescreve o que já está gravado (`COALESCE(campo, sintético)`,
migration `20260807080000`), então validar **depois** que a saída do dia já entrou é seguro hoje.
O modo novo existe para que a ordem deixe de importar: validar o mês inteiro antes das batidas
chegarem não pode carimbar saída que ninguém bateu.

### Lacuna B — falta a autorização do RH como pré-condição

Hoje qualquer coordenador pode validar em massa qualquer coisa, com qualquer texto. A sua regra
é a inversa: **isso só vale se o RH Geral liberou expressamente**.

Proposta: uma tabela pequena de **autorizações**, cadastrada só por RH Geral / Administrador
Geral, contendo:

| campo | papel |
|---|---|
| servidores (nominal) | a autorização do ofício é por pessoa, não por setor |
| passos autorizados | `entrada`, `intervalo_saida`, `intervalo_retorno` — **nunca `saida`** |
| vigência (início e fim) | evita virar permanente sem revisão |
| documento | número do ofício/processo — é o que a fiscalização pede |
| motivo | vira o texto padrão da justificativa, já preenchido |
| autorizado por / revogado por | ato administrativo: revoga-se, não se apaga |

Com ela, o modal de validação em massa muda de comportamento: o coordenador vê o aviso
*"Autorização do RH — Ofício 249/2026 — entrada e intervalos"*, a justificativa vem preenchida
com o texto oficial, e o modo restrito fica disponível **só** para os servidores autorizados e
**só** dentro da vigência. Sem autorização, tudo continua como hoje.

**Por que a autorização não pode ser só um aviso na tela:** a RPC `fn_atestar_jornada_bulk` é
chamável direto por qualquer autenticado (armadilha 12 do CLAUDE.md — tela filtrada não protege
RPC). A checagem do modo restrito precisa estar dentro da função, no banco.

---

## 3. O que NÃO muda

- **A saída continua obrigatória e real**, batida no REP-C. É o que o ofício preserva e é o
  mínimo que sustenta a folha como prova (Súmula 338 do TST).
- **Batida real vence declaração.** Se o servidor bater a entrada num dia, aquele horário vale —
  `fn_precedencia_origem` põe `rep` (1) acima de `ajuste_coordenador` (3).
- **Nada de horário fabricado pelo sistema sozinho.** O que existe é declaração do coordenador,
  rotulada como manual, com justificativa e autorização anexadas.
- `fn_confirmar_presenca` e `fn_confirmar_presenca_manual` não são alteradas — o modo novo entra
  por fora, como `fn_atestar_jornada_bulk` já entrou (armadilha 1 do CLAUDE.md).

---

## 4. Fases

| fase | entrega | critério de saída |
|---|---|---|
| 0 | **confirmar com o coordenador** que o Validar em Massa atual já resolve o volume | se resolver, as fases 1–2 continuam valendo pela autorização, não pela mão de obra |
| 1 | tabela de autorizações + tela do RH Geral (conceder, revogar, listar) | RH cadastra a autorização do Ofício 249/2026 para os servidores conferidos |
| 2 | modo "somente entrada/intervalos" no Validar em Massa, liberado pela autorização | um mês do Porta a Porta validado num clique, com a saída vinda do relógio |
| 3 | folha e relatório citam o ofício na justificativa do período | folha do grupo conferida à mão com o RH |

A fase 1 é **inerte**: cadastrar autorização não muda nada em folha até a fase 2 entrar.

---

## 5. Estado medido em produção (27/08/2026)

| medida | valor |
|---|---|
| marcações `ajuste_coordenador` em 08/2026 | 18.041 |
| pares (servidor, dia) validados à mão em 08/2026 | 6.176 |
| servidores atingidos | 537 |
| Porta a Porta — servidores ativos no setor | 10 |
| Porta a Porta — escalas de 08/2026 | 10, **todas em Rascunho** |
| Porta a Porta — dias lançados e marcações | **0 e 0** |

O grupo ainda não entrou no fluxo de ponto: dá tempo de acertar antes do primeiro mês real.

⚠️ **3 dos 7 nomes do ofício não casam com o cadastro**: "Gessica Francielle Almeida Barbosa"
está como **GÉSSICA FRANCIELE ALMEIDA BARBOSA** (mat. 68246); **Luzinete Martins da Silva** e
**Nídia Evilyn Souza Costa** não aparecem lotadas no setor. Como a autorização é nominal, isso
precisa ser resolvido com o RH antes do cadastro.

---

## 6. Decisões pendentes

1. **A autorização libera quais passos?** O ofício fala só da entrada; você mencionou entrada e
   intervalos. Proposta: os dois, com `saida` proibida por `CHECK` no banco.
2. **Vigência máxima.** Sugestão: exigir data de fim (até 12 meses), renovável por novo ato — sem
   isso, dispensa vira permanente e ninguém revisa.
3. **Quem dispara a validação depois de autorizada:** o coordenador do setor (com a autorização
   já preenchida) ou o próprio RH? O ofício autoriza; ele não diz quem opera.
