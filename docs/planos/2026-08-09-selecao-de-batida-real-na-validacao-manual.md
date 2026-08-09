# Seleção da batida real na validação manual

**Data:** 09/08/2026 · **Versão alvo:** v1.26.0
**Origem:** observação do usuário na grade da USF ENFERMEIRA ZEZINHA, dia 09/08/2026,
servidor AGACY ROCHA DA CRUZ (`18H ÀS 06H`, plantão `MT`).

---

## 1. O problema, como ele apareceu

O coordenador abre "Validar Presença" numa célula onde o terminal **já registrou uma batida** e
mesmo assim tem de **digitar** o horário no campo `Horários Cumpridos`. O modal mostra a batida
das 07:06 num bloco vermelho — como informação, sem nenhuma ação associada.

Digitar quando o horário real existe produz três perdas:

| perda | consequência |
|---|---|
| os segundos (`07:06:43` → `07:06:00`) | indistinguível de horário sintético (armadilha 5) |
| a origem (`terminal` → `ajuste_coordenador`) | a folha deixa de dizer que houve batida do servidor |
| o vínculo com a marcação | `presenca_*_marcacao_id` fica nulo; a reconciliação perde o fio |

É o inverso da precedência de origem (`fn_precedencia_origem`: rep 1 → terminal 2 →
ajuste_coordenador 3 → ajuste_servidor 4). Onde existe horário real, ele tem de ganhar.

## 2. O que já existia, e o que faltava

| peça | estado antes desta mudança |
|---|---|
| `fn_aceitar_marcacao_pendente` (`20260808100000`) | **pronta e correta** — grava o horário real no passo escolhido, preserva origem `terminal`, cria tratamento append-only. **Nunca era chamada pelo frontend.** |
| botão `usar em <passo>` do bloco âmbar | só **copiava o HH:MM** para o input; o envio seguia por `fn_registrar_presenca_informada` |
| bloco vermelho (tentativas recusadas) | texto puro, sem controle |
| horário previsto no modal | **ausente** — o comentário dizia "aparece no placeholder", mas `<input type="time">` não tem placeholder e o atributo nem estava lá |

## 3. Os dois horários da tela, e qual estava errado

O bloco vermelho exibia `(Previsão: 18:00)` enquanto a grade pintava `06:00` em cinza atrás do
`MT`. Não é contradição: são coisas diferentes.

- **18:00** vem de `logs_tentativas_presenca.escala_prevista_inicio`, **gravado no instante da
  recusa**. É evidência histórica de que a batida foi recusada com base numa previsão errada — a
  do plantão diurno em jornada noturna, corrigida na v1.25.0 (`20260809000000`). **Não pode ser
  recalculado:** reescrever falsificaria o log.
- **06:00** é a previsão **vigente**, de `fn_blocos_previstos_mes` — a mesma fonte que o terminal
  usa, já com a âncora espelho (nível 2-A, armadilha 4). Essa é a que faltava no modal.

Só o **rótulo** do primeiro estava errado: `(Previsão: 18:00)` lê-se no presente.

**Isso é pré-requisito da seleção**, não enfeite: a sugestão automática de qual passo cada batida
preenche mede a distância ao previsto. Com 06:00, o 07:06 fica a **66 min** — dentro dos 90 min de
tolerância de `fn_batidas_reais_recusadas`, e o casamento com `Entrada` sai sozinho. Com 18:00,
ficaria a 654 min e nada casaria.

## 4. Modelo de dados da seleção

Não é "marcar/desmarcar": é **atribuição 1:1** entre batida e passo.

- uma batida serve **um** passo;
- um passo aceita **um** horário — selecionado **ou** digitado, nunca os dois;
- passo já tomado sai das opções das outras batidas.

Isso decide o controle conforme o escopo:

- **escopo de 1 passo** → checkbox puro, sem ambiguidade;
- **escopo de 2 ou 4 passos** → checkbox + seletor de passo, pré-preenchido pela sugestão.

Digitar **continua existindo** e é o caminho certo em um caso real: o servidor chegou às 06:00,
esqueceu de bater e só bateu às 06:50; o coordenador apura e acata as 06:00. Selecionar é usar o
fato; digitar é o coordenador declarar (tratamento do Art. 82, parágrafo único). Os dois são
legítimos e precisam ficar **distinguíveis no registro** — hoje sairiam idênticos, ambos como
`ajuste_coordenador`.

## 5. Nem toda linha vermelha pode ser selecionada

Auditoria de 07/08/2026 (911 tentativas): **378 eram `Matrícula ou PIN inválidos`** e 90 eram
`Nenhum plantão`. Nenhuma prova presença — a primeira nem sequer prova identidade, e o
`servidor_id` pode estar preenchido quando a matrícula bateu e só o PIN errou.

O filtro canônico já vive em `fn_batidas_reais_recusadas`:

```sql
(mensagem_erro ILIKE '%janela%' OR mensagem_erro ILIKE '%erro interno%')
AND mensagem_erro NOT ILIKE '%matr_cula ou pin%'
AND servidor_id IS NOT NULL
```

Esta mudança **extrai esse predicado** para `fn_tentativa_recusada_elegivel` e faz
`fn_batidas_reais_recusadas` passar a chamá-lo, para não existirem duas cópias da regra. Linhas
inelegíveis continuam **visíveis** no modal (nunca descartar batida), porém sem controle de
seleção e com o motivo da inelegibilidade à vista.

A checagem é aplicada **no banco**, não só na tela: a RPC é chamável direto.

## 6. A mesma batida aparece nos dois blocos

Desde a v1.22.0, `fn_registrar_ponto` faz duas coisas quando a batida cai fora da janela:
`fn_confirmar_presenca` grava a tentativa em `logs_tentativas_presenca` (vermelho) **e** o wrapper
grava a marcação pendente em `marcacoes_ponto` (âmbar). É o mesmo evento físico, exibido duas
vezes com cores opostas.

Duas providências:

1. **Unificar os blocos** numa lista só de "batidas do dia", deduplicada por timestamp
   (tolerância de 5 s, porque os dois `now()` não são o mesmo instante), preferindo a marcação
   quando existir — ela é a que tem id em `marcacoes_ponto`.
2. **Deduplicar também no banco**: ao aceitar uma tentativa, se já existir marcação `terminal`
   naquele instante, reusar em vez de criar uma segunda.

## 7. Implementação

### 7.1 Migration `20260809100000_selecao_de_batida_real_na_validacao_manual.sql`

| função | papel |
|---|---|
| `fn_tentativa_recusada_elegivel(uuid, text)` | fonte única do filtro de elegibilidade |
| `fn_batidas_reais_recusadas(...)` | recriada trocando **só** o predicado inline pela chamada acima |
| `fn_tentativas_recusadas_mes(uuid[], int, int)` | lista do mês com a coluna `elegivel`; substitui o `select` direto na tabela feito pelo frontend |
| `fn_aceitar_tentativa_recusada(...)` | materializa (ou reusa) a marcação `terminal` a partir do log e **delega** a `fn_aceitar_marcacao_pendente` |
| `fn_validar_presenca_manual(...)` | entrada única do modal: aplica as seleções, depois delega os passos digitados a `fn_registrar_presenca_informada` |

**Por que um wrapper em vez de estender `fn_registrar_presenca_informada`:** uma chamada só, uma
transação só, e nenhuma das funções existentes precisa ser reescrita — armadilha 1.

**Guardas que o wrapper acrescenta ao caminho de seleção.** `fn_aceitar_marcacao_pendente` não
checa Sobreaviso nem competência encerrada (só `fn_registrar_presenca_informada` checava). O
wrapper valida os dois **antes** de qualquer escrita, para os dois caminhos.

**Nada é sobrescrito:** todo `UPDATE` a jusante usa `COALESCE`. Corrigir horário já gravado exige
reverter antes — alterar dado registrado é a vedação 4 da Portaria 671.

### 7.2 Frontend (`ScaleGrid.tsx`)

1. `fetchLogsTentativas` passa a chamar `fn_tentativas_recusadas_mes`.
2. O modal calcula o previsto por passo a partir de `blocoDaCelula` (→ `fn_blocos_previstos_mes`)
   e o exibe ao lado de cada rótulo.
3. Bloco âmbar + bloco vermelho viram uma lista só, deduplicada, com checkbox e seletor de passo.
4. Campo com seleção fica **bloqueado**, mostrando `HH:MM:SS` e um ✕ que libera para digitação.
5. O rótulo do previsto histórico vira `previsão vigente na época: HH:MM`.
6. `handleConfirmManualPresence` chama `fn_validar_presenca_manual` com seleções + digitados;
   aceita salvar quando houver **ao menos um** dos dois.

## 8. Conferência

Não há framework de testes. A migration traz as consultas de conferência no rodapé; os pontos que
precisam de execução real:

1. Selecionar uma tentativa recusada elegível → `escala_diaria.presenca_entrada_em` com **os
   segundos originais**, `presenca_entrada_origem = 'terminal'`, `presenca_entrada_marcacao_id`
   preenchido, e uma linha em `marcacoes_tratamentos`.
2. Selecionar a mesma batida que aparece nos dois blocos → **uma** marcação, não duas.
3. Tentar aceitar uma tentativa de `Matrícula ou PIN inválidos` pela RPC direta → recusa.
4. Misturar: um passo selecionado + outro digitado na mesma validação → origens diferentes na
   mesma linha (`terminal` e `ajuste_coordenador`).
5. Sobreaviso e competência encerrada → recusa nos dois caminhos.
6. `fn_batidas_reais_recusadas` recriada: rodar a validação em massa num mês fechado e comparar o
   resultado com o de antes — o predicado extraído tem de ser equivalente.

## 9. Fora de escopo

- A fila global de revisão (`fn_marcacoes_pendentes_revisao`) continua sem tela própria; esta
  mudança só cobre a decisão dentro da célula da grade.
- O portal do servidor não muda: ele continua **solicitando** ajuste (`fn_solicitar_ajuste_ponto`),
  nunca gravando.
