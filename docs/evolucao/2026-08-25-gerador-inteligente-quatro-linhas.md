# Gerador Inteligente: as quatro linhas, e a mensagem que media a coisa errada

**25/08/2026**

## Como começou

Relato do usuário: *"o gerador inteligente não está funcionando, ele até chega a executar
alguma coisa mas não consigo achar a escala que ele supostamente gerou."* A tela dizia
**"111 turnos e jornadas correspondentes foram preenchidos localmente como rascunho"**.

## O gerador tinha funcionado. A mensagem é que estava errada.

`logs_sistema`, ação `GERAR_ESCALA_INTELIGENTE`: quatro execuções seguidas, todas em
**SMS → TECNOLOGIA DA INFORMAÇÃO, 08/2026, 111 células**. Reproduzindo o motor em JS sobre os
dados reais do setor chega-se exatamente a 111 — a simulação bate com o app. Seguindo as 111
até a tela:

| etapa | células |
|---|---|
| geradas pelo motor | **111** |
| descartadas no merge por já ter ponto batido | **81** |
| efetivamente escritas na grade | 30 |
| **que mudaram alguma coisa na tela** | **0** |

As 30 que passaram caíram nos dias 25–28 e 31, e esses dias **já estavam lançados com o mesmo
turno**. A escala de agosto da TI estava completa desde antes — `MT` de segunda a sexta para
quatro servidores, `M` para VICTOR, `T` para ANDRYA a partir do dia 19 (férias até 18/08). O
motor produziu uma cópia idêntica do que já estava na tela.

**A causa raiz**: o contador media `generatedGrid` — a saída do motor — e os dois `return` do
merge (presença e afastamento) descartavam célula sem contabilizar nada. Rodar num mês corrente,
com 23 dias já batidos, é o caso em que os dois números mais divergem.

> **Regra que fica:** nunca relatar o que foi calculado. Relatar o que **mudou**, e por que o
> resto não mudou.

Que o recurso funcionava está no mesmo log: em 24/08 às 15:52, setor `e939c0bc` para **09/2026**,
286 células geradas — e há **262 células lançadas** naquele mês.

## O que o usuário pediu depois

Gerar as **quatro linhas** (Regular, Hora Extra, Plantão, Sobreaviso), usar **estatística de
várias competências**, e poder gerar **vários meses de uma vez** — "como se fosse o próprio
coordenador". Com um pedido explícito: não sacrificar o desempenho do sistema.

## O que a medição disse — e onde ela contrariou a intuição

Backtest: prever **08/2026** a partir do que os coordenadores lançaram de fato, comparando com
o que eles lançaram em 08/2026.

### 1. Somar competências com peso igual PIORA

| fonte de histórico | Regular cobertura / precisão | Plantão |
|---|---|---|
| só o mês anterior | 83,7% / **84,6%** | 61,6% / 58,0% |
| 2 meses, peso igual | 74,2% / 81,4% | 57,1% / 54,3% |
| 2 meses, recência 5:1 | 82,6% / **85,2%** | 59,3% / **58,7%** |

O quadro muda de mês para mês — servidor troca de setor, jornada muda — e o mês antigo **vota
contra** o recente. Daí os pesos **5 / 2 / 1**.

### 2. E mesmo com recência, 1 mês ainda ganha de 3

Backtest de ponta a ponta do motor final (com limiar de confiança, que a comparação acima não
tinha), 96 setores, contando só os 11 com competência anterior:

| histórico | Regular | Plantão | Extra |
|---|---|---|---|
| **1 mês** | **76,1% / 94,1%** | **50,6% / 75,8%** | **39,8% / 66,2%** |
| 3 meses | 68,7% / 93,4% | 45,0% / 73,6% | 36,7% / 69,1% |

O motivo está no **denominador da confiança**: cada mês a mais aumenta o total de ocorrências
daquele dia da semana, então quem foi consistente no mês passado e diferente dois meses atrás
cai **abaixo do limiar** e para de ser sugerido. Mais histórico vira mais silêncio, não mais
acerto. Por isso o padrão da tela é **1 mês**, com 2 e 3 disponíveis para setor de rotina
muito estável.

⚠️ **Ressalva:** o sistema só tem três competências (06, 07 e 08/2026), e agosto teve entrada
em massa de UBS/USF. É uma observação, não uma lei. Refaça o backtest quando houver mais
histórico.

### 3. A qualidade do motor não é a mesma nas quatro linhas

| linha | resultado com os padrões de fábrica | decisão |
|---|---|---|
| **Regular** | 76,1% cobertura / 94,1% precisão | ligada por padrão, limiar 0,50 |
| **Plantão** | 50,6% / 75,8% | ligada por padrão, limiar 0,75 |
| **Extra** | 39,8% / 66,2% | **desligada** por padrão, limiar 1,00 |
| **Sobreaviso** | 33,3% / 68,8% | **desligada** por padrão, limiar 1,00 |

Na medição sem limiar, o Extra dava 86,7% de cobertura com **57,5% de precisão** — 43% da hora
extra que ele agendaria nunca aconteceu. Num sistema de ponto, **os dois erros não custam a
mesma coisa**: célula que falta o coordenador preenche, que é o trabalho normal dele; célula
sugerida a mais em Plantão ou Extra é hora paga que ninguém decidiu, e ele precisa *caçar* para
apagar. Por isso precisão vale mais que cobertura aqui.

## O desempenho, que era também um problema de correção

A busca de histórico **não paginava**. O maior setor tem **692 linhas** de `escala_diaria` num
mês; três meses dariam **2.076** e o PostgREST corta em 1000 **em silêncio** (armadilha 8).
Olhar mais meses do jeito antigo não seria só lento — devolveria estatística **errada**, sem
erro nenhum na tela.

A agregação foi para o banco: **`fn_estatistica_escala_setor`** (`20260825100000`), que devolve
`(servidor, categoria, dia da semana) → turno vencedor + confiança`. Medido em homologação:
**94 linhas de resumo para 390 células cruas** de um mês só, e o custo não cresce com o número
de meses olhados.

## Gerar vários meses

**Cada mês é previsto a partir do último mês REAL, nunca do mês que o próprio motor acabou de
inventar.** Encadear previsão sobre previsão multiplica o erro (~85% → 72% → 61% em três meses)
e congela um engano de setembro dentro de outubro e novembro. A exceção é o ciclo de passo fixo
(12x36 e parentes), que é determinístico e precisa mesmo andar — a fase atravessa a virada.

⚠️ **A competência aberta continua sendo rascunho local; as seguintes são gravadas.** Não há
grade aberta para segurá-las, então ou vão ao banco ou não existem. Decisão do usuário em
25/08/2026: gravar como **Rascunho**. Quatro travas em `persistirMesesGerados`, e nenhuma é
opcional:

1. Competência encerrada é pulada e dita no resumo.
2. `escala_mensal` que não esteja em Rascunho é pulada — escala Fechada de mês futuro é decisão
   de alguém, não do gerador.
3. **Célula que já existe nunca é sobrescrita**, só as que faltam são inseridas. É o que torna
   seguro rodar o gerador duas vezes e o que impede o palpite de apagar trabalho manual.
4. Dia de afastamento é removido antes — sem isso `fn_prevent_shift_during_event` derrubaria o
   lote inteiro (armadilha 14).

## Dois defeitos encontrados escrevendo a correção

⚠️ **O contador não pode viver dentro do updater do `setGridData`.** O React chama o updater na
fase de render, não na linha em que ele está escrito — os contadores ainda valeriam zero quando
o resumo e o `logAction` os lessem, e a tela voltaria a relatar um número que não é o que
aconteceu. Em modo estrito o updater roda duas vezes e dobraria a contagem. A mesclagem é feita
**de forma síncrona** e só o resultado pronto vai para o `setGridData`.

⚠️ **`closedPeriods` é declarada muito depois no corpo do componente.** Citá-la na lista de
dependências de um `useCallback` definido antes estoura a zona morta temporal já no primeiro
render. `persistirMesesGerados` lê `competencias_encerradas` do prop `configsGlobais`.

⚠️ **O filtro de afastamentos era um `.or(...)`.** `data_inicio.lte.X OR data_fim.gte.Y` é a
disjunção, não a sobreposição — trazia praticamente todo evento já cadastrado. O correto é
`início <= fim_da_janela E fim >= início_da_janela`.

## Portão

Não há framework de teste. O portão é `scratchpad/sim_gerador.mjs` / `sim_cenarios.mjs`, que
**carregam o módulo transpilado** e chamam `gerarEscalaInteligente` com um cliente Supabase
falso — não reimplementam o motor. A aritmética do peso por recência foi conferida à mão contra
o Postgres com um fixture em `VALUES` (4 segundas com peso 5 contra 4 segundas com peso 2:
peso 20, total 33, confiança 0,6061).

`fn_estatistica_escala_setor` foi aplicada e conferida em **homologação** antes de ir para
produção: faixa da confiança, determinismo entre duas execuções e detecção de ciclo em 93 de 94
linhas.
