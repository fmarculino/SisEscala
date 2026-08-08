# Conformidade da marcação de ponto com a Portaria 671/2021 — v1.22.0

**Data:** 08/08/2026

Esta versão corrige duas práticas que a Portaria 671/2021 veda expressamente e que o SisEscala
executava. Não é ajuste cosmético: uma delas fazia o sistema **impedir** o servidor de registrar
o horário real, e a outra **preenchia** a folha com horário contratual como se tivesse sido
cumprido.

---

## O enquadramento

A Portaria veda, em qualquer registrador eletrônico de ponto:

1. restrições de horário à marcação do ponto;
2. marcação automática usando horários predeterminados ou contratuais;
3. exigência de autorização prévia para marcar sobrejornada;
4. qualquer dispositivo que permita alterar o dado registrado pelo empregado.

A vedação alcança REP-C, REP-A e **REP-P**. O REP-P é o registrador **via programa** — o terminal
web do SisEscala (`/presenca`) se enquadra na mesma regra do relógio físico.

O sistema incorria na **1** e na **2**. E havia um encadeamento perverso entre elas: o terminal
recusava a batida fora da janela (vedação 1), o horário real se perdia, e depois alguém preenchia
a folha com horário derivado da jornada (vedação 2) — a segunda infração cometida para consertar
a primeira.

Consequência prática, além da administrativa: controle de ponto que impede a marcação real é
imprestável como prova e inverte o ônus contra o empregador (CLT Art. 74 §2º, Súmula 338 do TST).

---

## O que foi medido antes de decidir

Competências fechadas, em produção:

| campo | real | gerado | validação manual | vazio |
|---|---|---|---|---|
| entrada (07/2026) | 939 (71%) | 68 (5%) | 310 (24%) | 0 |
| saída (07/2026) | 852 (65%) | 79 (6%) | 386 (29%) | 0 |
| saída intervalo | 0 | 499 (38%) | 268 | 550 |
| retorno intervalo | 0 | 471 (36%) | 296 | 550 |

Dois achados orientaram o desenho:

- **A validação manual era o problema maior**, não o horário fictício: 24–29% contra 5–6%.
  Restringir só o fictício teria movido a fabricação de porta, sem ganho real.
- **O intervalo não tinha alternativa**: 15 das 16 unidades não exigem marcação de intervalo, e
  ali o servidor simplesmente não tem como registrar o repouso.

---

## As três regras que saíram disso

O critério único que as organiza: **o sistema só preenche onde o servidor não tem como
registrar.** Onde ele tem meio de registrar, preencher é fabricar.

### 1. A batida nunca é recusada por horário

`fn_registrar_ponto` (`20260808100000`) envolve `fn_confirmar_presenca` sem reescrevê-la.
Confirmada a identidade, a batida é sempre registrada. Fora da janela, nasce **pendente de
revisão** em vez de virar presença aprovada — o que o Art. 82, parágrafo único, autoriza: o
programa de tratamento pode complementar omissões, desde que não altere nem elimine o original.

Continua sendo recusada uma única coisa: **matrícula ou PIN inválidos**. Isso não é restrição de
horário, é falta de identificação — e a auditoria de 07/08/2026 mostrou que 378 das 911
tentativas eram exatamente digitação errada.

**A cor mudou junto.** Âmbar para registrado-fora-do-previsto, vermelho só para o que não foi
registrado. Manter vermelho no que foi aceito ensinaria o servidor a não insistir, produzindo na
prática o efeito que a lei quer evitar.

### 2. Entrada e saída do turno nunca são geradas

Regra em [`src/utils/folha/preAssinalacao.ts`](../../src/utils/folha/preAssinalacao.ts), aplicada
por script nas **quatro** cópias da geração de folha. Dia sem batida fica vazio.

O que resta é **pré-assinalação do intervalo**, e só onde a unidade não exige marcação — nome que
a CLT Art. 74 §2º dá ao mecanismo: *"com a pré-assinalação do período de repouso"*. Não é
contorno da vedação; é o instituto que a lei prevê.

O offset aleatório de ±1 a 14 minutos foi removido: pré-assinalação pressupõe horário
pré-anotado, e o sorteio era justamente o que fazia o campo parecer batida fabricada. Origem
renomeada de `ficticio` para `pre_assinalado`.

> O sorteio provavelmente existia para escapar da Súmula 338, III, que invalida cartão com
> **entrada e saída** uniformes. Retirar a geração de entrada e saída resolve isso na raiz: o que
> resta nesses campos são batidas reais, que variam sozinhas. E o intervalo fixo não é alcançado
> pela Súmula, que trata de entrada e saída.

### 3. A validação manual grava o horário informado

`fn_registrar_presenca_informada` (`20260808110000`). O coordenador digita o horário que o
servidor **declara ter cumprido**, em vez de o sistema herdar o da jornada. Campos não vêm
pré-preenchidos.

No modal da grade, as batidas registradas fora da janela aparecem em âmbar com um botão que joga
o horário real no campo — o coordenador não redigita. É onde a fila de revisão encontra o
coordenador: no mesmo lugar onde ele já decide sobre presença.

A função **nunca sobrescreve** horário já gravado (`COALESCE` em todos os campos): alterar dado
já registrado é a quarta vedação.

---

## Uma correção de rota registrada

Durante a decisão, afirmei que "não existe nenhuma marcação real de intervalo na base" e
recomendei tratar a USF ENFERMEIRA ZEZINHA como caso especial. **Estava errado.**

O número vinha da folha, cuja detecção de origem era justamente a que foi consertada na Fase 0 do
módulo de marcações — ela lia `logs_sobreaviso` por comparação de string. Conferido em
`escala_diaria`: das 65 marcações de intervalo daquela unidade, **54 têm segundos diferentes de
`:00`**, o que só acontece em batida real de terminal. A unidade começou a marcar intervalo em
agosto e o processo funciona.

Consequência: nenhum tratamento especial foi necessário, e a conversão de marcações geradas para
"real" — que teria sido falsificação — foi descartada.

---

## Decisões de implementação

**`fn_confirmar_presenca` e `fn_confirmar_presenca_manual` não foram alteradas.** Todo o
comportamento novo entra por funções que as envolvem. As duas somam mais de 1.500 linhas e
respondem pelas seis regressões registradas no `CLAUDE.md`, cinco delas saídas de uma única
migration que as recriou.

---

## Exposição residual

A validação **em massa** (`fn_confirmar_presenca_manual_bulk`) continua gravando horário derivado
da jornada. Ela faz sentido para **ausências justificadas** — férias, licença, falta —, não para
afirmar horários cumpridos. Redesenhar com esse recorte é o próximo passo natural.

---

## Verificação

`npx tsc --noEmit` e `npm run build` limpos. Roteiros de conferência no rodapé de cada migration;
o mais importante é o item 3 da `20260808110000` — confirmar que um horário já gravado **não** é
sobrescrito, que é a garantia da quarta vedação.

Fontes consultadas: Portaria 671/2021 (MTP), Perguntas e Respostas REP do gov.br, CLT Art. 74
§2º e Súmula 338 do TST.
