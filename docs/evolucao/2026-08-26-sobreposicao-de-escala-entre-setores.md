# Sobreposição de escala entre setores — o Aplicar Template nunca olhou para fora da própria grade

**26/08/2026.** Competência 08/2026, todas as escalas envolvidas em **Rascunho**. 06 e 07/2026
estão fechadas e **não foram tocadas por nada deste diário**.

Caso que originou: **FAGNER SOARES CARDOSO** (mat. 15234), motorista, aparecendo na grade do
**PATRIMÔNIO** ao mesmo tempo em que estava escalado no **TRANSPORTE**.

---

## 1. O que aconteceu

### 1.1 Não foi o template que inseriu o servidor no outro setor

A primeira hipótese — "o Aplicar Template inseriu ele lá" — está errada, e o `logs_sistema`
mostra a ação explícita:

| quando | ação | setor |
|---|---|---|
| 01/08 11:12 | `ADICIONAR_SERVIDOR` | **PATRIMÔNIO** (servidor externo; a lotação era TRANSPORTE) |
| 03/08 18:41 | `APLICAR_TEMPLATE` 5x2, 20 dias | PATRIMÔNIO |
| 04/08 11:54 | `APLICAR_TEMPLATE` 5x2, 19 dias | PATRIMÔNIO |
| 14/08 19:35 | `APLICAR_TEMPLATE` 5x2, 16 dias, **`dias_protegidos: 0`** | TRANSPORTE |
| 18/08 12:47 | `APLICAR_TEMPLATE` 5x2, 17 dias | TRANSPORTE → criou os dias 3–7 |

O template **nunca adiciona servidor**. O que ele fez foi preencher os dias nas duas grades sem
que nenhuma das duas enxergasse a outra.

### 1.2 A causa raiz foi uma transferência de setor

Informação do usuário, confirmada pelos dados: o FAGNER esteve no **PATRIMÔNIO até o dia 7** e
passou ao **TRANSPORTE a partir do dia 10**. O recorte é exato:

```
PATRIMÔNIO   3M 4M 5M 6M 7M                          <- exatamente o período em que esteve lá
TRANSPORTE   3MT 4MT 5MT 6MT 7MT 10MT 11MT ... 31MT  <- o template varreu o mês desde o dia 3
```

E as batidas reais de terminal existem **só nos dias 3 a 7**. Do dia 10 em diante há apenas
`ajuste_coordenador` 08:00/14:00 — os horários sintéticos que o "validar dias passados" do
template do TRANSPORTE gravou.

### 1.3 A mesma batida foi projetada nas duas linhas

Os `presenca_entrada_marcacao_id` dos dias 4, 5, 6 e 7 eram **idênticos** nos dois setores
(`08289dbc`, `eadd39e6`, `1c18003c`, `7e2ce328`). Uma batida física, duas escalas, **duas folhas
de ponto**: PATRIMÔNIO 30h (já *Gerada*) + TRANSPORTE 126h.

---

## 2. Por que nada barrou

`fn_check_shift_conflicts` existe, funciona e detectaria o caso (`M` ∩ `MT` compartilham o slot
`M`). Ela tinha **um único chamador em todo o repositório**: `handleCellChange`, ou seja, só a
digitação célula a célula.

| caminho | afastamento | presença | **sobreposição entre setores** |
|---|---|---|---|
| digitar na célula | ✅ | ✅ | ✅ |
| **Aplicar Template** | ✅ | ✅ | ❌ |
| **Gerador Inteligente** | ✅ | ✅ | ❌ |
| **Salvar Previsão** | ✅ | — | ❌ |
| banco (trigger) | ✅ `fn_prevent_shift_during_event` | ✅ | ❌ **não existia nada** |

É a **armadilha 14** um eixo adiante: lá o furo do template era afastamento (fechado em
`20260820120000`), aqui é sobreposição — e desta vez **não havia rede de segurança no banco**.

Três agravantes fecham o ciclo:

1. **A grade já sabia.** `fn_get_monthly_occupancy` carrega a ocupação externa do mês inteiro no
   `mount`, e o `externalOccupancy` era usado **só para pintar a célula e montar tooltip**. O dado
   que bloquearia já estava em memória — foi usado para avisar, nunca para recusar.
2. **A projeção não filtra setor.** `fn_alocar_marcacoes_dia` roda por (servidor, dia) e grava o
   par em todas as linhas de `escala_diaria` daquele dia. Havendo duas escalas, a batida vai para
   as duas, sem erro.
3. **A validação passou por cima.** O "validar dias passados" do template e o Validar em Massa
   gravam a partir do horário previsto sem consultar outras escalas.

---

## 3. Extensão medida

Base inteira: 5 competências (06 a 10/2026), **21.031 linhas** de `escala_diaria`.

| padrão | pares | a regra alcança? |
|---|---|---|
| dentro da **mesma** `escala_mensal` (Extra×Regular 556, Plantão×Regular 538, Regular×Sobreaviso 103, Extra×Plantão 27, Plantão×Sobreaviso 15) | **1.239** | ❌ — todos adjacentes, zero sobrepostos |
| cross-setor **adjacente** (dobra legítima) | **9** | ❌ preservados |
| cross-setor **sobreposto** | **24** | ✅ bloqueados |

Os 24, em duas servidoras:

| servidora | lotação | dias | folhas em 08/2026 |
|---|---|---|---|
| **CLEONEIDE MENEZ FRANK** (61399) | E-SUS/CARTÃO SUS | **19** — `MT` × `MT` | E-SUS **210h** + PSE **190h** |
| **FAGNER SOARES CARDOSO** (15234) | TRANSPORTE | **5** — `MT` × `M` | TRANSPORTE 126h + PATRIMÔNIO 30h |

A CLEONEIDE foi criada **em 25/08**, com 15 minutos entre as duas: `ADICIONAR_SERVIDOR` +
`APLICAR_TEMPLATE` 5x2 (21 dias, `dias_protegidos: 0`) em cada setor.

⚠️ Os 9 pares adjacentes preservados são todos da **ERIKA SOUZA LIMA** (53609), 09/2026:
`Regular MT` em ENFERMEIROS + `Plantão N` em CLASSIFICAÇÃO DE RISCO. É a dobra que a armadilha 15
registra como funcionando, e o critério de slot sobreposto a preserva de propósito. **Proibir por
dia quebraria o que o dicionário de turnos existe para suportar.**

---

## 4. A limpeza teve três atos, não um

### 4.1 Apagar a linha do setor errado não bastava

O "validar dias passados" gravou presença na grade, e o trigger de
`20260808070000_sync_marcacoes_from_escala_diaria` converte isso em `marcacoes_ponto` **sintéticas
de origem `ajuste_coordenador` — uma série por setor**. Em 08/2026: **128 da CLEONEIDE** e **27 do
FAGNER**, contra 5 e 7 batidas reais.

`marcacoes_ponto` é **INSERT-only**. Apagar a linha de `escala_diaria` deixaria as sintéticas vivas
e a reconciliação as reprojetaria na linha que sobrou. A porta correta é `marcacoes_tratamentos`
com `tipo = 'desconsiderar'`, que `fn_alocar_marcacoes_dia` já honra.

### 4.2 O achado que só apareceu na conferência

Ao conferir o resultado, os dias 4 a 7 do FAGNER voltaram **sem timestamp** — a projeção devolvia
vazio. O motivo não era a migration: em **26/08 às 21:49**, ao limpar as células do PATRIMÔNIO na
grade (quando aquele ainda parecia ser o setor errado), o app registrou `desconsiderar`
automático — **e ele alcança também a batida real de terminal**, não só o horário sintético:

```
10:49:13 terminal -> desconsiderar @ 21:49:44 :: "Presenca revertida em escala_diaria (sincronizacao automatica...)"
```

Como o PATRIMÔNIO é quem fica com esses dias, a batida real precisava voltar: `restaurar` desfaz
o `desconsiderar` (o último tratamento por `created_at` é o efetivo). **6 batidas restauradas.**

⚠️ **Só batida REAL volta.** O horário sintético declarado pelo coordenador (a saída das 14:00)
fica desconsiderado de propósito: batida é fato e não pode se perder; declaração é juízo, e o
coordenador acabou de retirar o dele. Se quiser declarar de novo, valida pela tela.

### 4.3 Resultado

```
dia 3  entrada 08:02  sem saída
dia 4  entrada 07:49  sem saída
dia 5  entrada 07:47  sem saída
dia 6  entrada 07:54  saída 17:38
dia 7  entrada 07:54  saída 16:00
```

As saídas ausentes são **fato** (ele não bateu), não falha da limpeza. Os dias 6 e 7 passam a ter
saída bem depois das 14:00 da jornada — vira hora extra e **precisa da revisão do coordenador**.
Era o efeito previsto ao decidir não desconsiderar batida real.

Conferência final: **0** pares sobrepostos na base, PSE da CLEONEIDE vazio, E-SUS com 21 dias,
**0** batidas reais desconsideradas pela limpeza.

⚠️ **Falta clicar em "Sincronizar" nas 4 folhas** de 08/2026. `folha_ponto.registros` é snapshot
jsonb, não view — corrigir `escala_diaria` não alcança a folha sozinho.

---

## 5. A trava

`20260826220000` cria `trg_escala_diaria_sem_sobreposicao_setor` (`BEFORE INSERT OR UPDATE`).

⚠️ **O guard de UPDATE não é otimização, é corretude.** `handleSave` faz upsert da linha inteira,
presença incluída, a cada "Salvar Previsão", e mais de 20 migrations têm funções que dão `UPDATE`
em `escala_diaria` só para gravar presença. Sem o `IS DISTINCT FROM` sobre
`escala_mensal_id/dia/categoria/dicionario_turnos_id`, **toda batida do terminal passaria a
atravessar a checagem** — e qualquer linha herdada em conflito passaria a derrubar o registro de
ponto. Só mexer na identidade do turno reavalia.

⚠️ **A ordem importa:** com as 24 linhas ainda no lugar, a trava impede os 4 setores de salvar
qualquer coisa em 08/2026. Limpeza (`20260826210000`) **antes** da trava (`20260826220000`).

No frontend, fonte única em **`src/utils/conflitoEscala.ts`**, ligada nos três caminhos de escrita
(célula, Aplicar Template, Gerador Inteligente) **mais** a barreira do `handleSave` — que **relê a
ocupação do banco**, porque aba desatualizada é justamente o caso que a checagem local não cobre.
Sem a barreira, uma linha recusada pelo trigger derrubaria o upsert em lote inteiro com uma
exceção crua do Postgres, e o coordenador perderia o mês de todo mundo da grade.

---

## 6. O que a regra NÃO resolve, e tem data marcada

Os 9 pares adjacentes da ERIKA em 09/2026 são exatamente onde o **outro** defeito conhecido vai
bater: a fusão de bloco (`MT` 07–19 + `N` 19–07) grava o mesmo par de batidas nas duas linhas, em
dois setores, duas folhas. É o plano
[`2026-08-23-turno-regular-emendado-com-plantao.md`](../planos/2026-08-23-turno-regular-emendado-com-plantao.md),
agora atravessando setor. Hoje não há dano — competência futura, sem ponto.

**Não tente resolver com esta regra**: proibir adjacência quebraria a dobra legítima.
