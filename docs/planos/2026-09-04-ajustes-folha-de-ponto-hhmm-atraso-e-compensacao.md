# Folha de ponto: HH:MM, rodapé no padrão do cartão antigo, e atraso/compensação

**Data:** 04/09/2026 (revisado no mesmo dia, com medição em produção)
**Origem:** o RH não consegue ler a folha atual. Duas queixas concretas: (1) as horas saem em
decimal (`0.8h` em vez de `00:48`); (2) faltam os campos do controle antigo (Control iD/SISREF) —
horas noturnas, dias de falta, atraso, abono, extra diurna/noturna. Junto veio o pedido de tratar
**atraso compensado no mesmo dia**, com autorização do coordenador/RH, e a
Portaria 382/2019-GAB-MAB/SMS, que regulamenta o ponto eletrônico da Secretaria.
**Estado:** ✅ **Fases 1 a 4 implementadas em 04/09/2026** — ver
[`docs/evolucao/2026-09-04-folha-em-hhmm-e-compensacao-de-atraso.md`](../evolucao/2026-09-04-folha-em-hhmm-e-compensacao-de-atraso.md).
A Fase 5 (compensação entre meses, Art. 7º caput; e autorização prévia de hora extra, Art. 8º)
continua **fora de escopo**, aguardando decisão. Medições feitas em produção **em 04/09/2026**
(somente leitura, autorizada pelo usuário) com `scratchpad/an_atraso_folha*.mjs`.

> **As três perguntas da seção 8 foram resolvidas assim:** "Horas Noturnas" ficou **só do
> expediente Regular** (plantão continua no anexo), o **percentual permanece no rótulo** ("Extra
> Diurna (50%)"), e o dia pendente **não mexe em valor nenhum**, com a decisão cobrada no
> fechamento. Duas coisas mudaram em relação ao que este plano previa: o indicador **Abono virou
> tempo em HH:MM** (contar dias daria 1.173 "abonos" que são férias e licenças — ver §3 do
> diário), e os **totais novos não foram persistidos** em colunas do banco, porque os dois
> renderizadores passaram a calcular direto dos `registros`.

---

## 1. Resumo executivo

A queixa do RH é de formato, mas a medição mostra que ela cobre um buraco maior: **a folha não
mede atraso, e por isso vem lançando como hora extra um tempo que apenas repõe atraso.**

Medido em 08/2026 (547 folhas, 6.412 dias com entrada e saída registradas):

| o que | quanto |
|---|---|
| dias com atraso na entrada (> 5 min) | **1.363 dias — 646h27** — hoje **invisíveis** na folha |
| dias em que a pessoa chegou atrasada **e** saiu depois do previsto | **622 dias, 141 pessoas** |
| hora extra lançada nesses 622 dias | **489h09** |
| parcela dessas horas que só repõe o atraso (`min(atraso, extra, 2h)`) | **253h21** |
| hora extra em dia **sem** atraso ("extra limpa") | 717 dias, 473h05 |

Ou seja: **51% da hora extra da competência nasce em dia que começou com atraso**, e metade dela
é, pela Portaria, caso de *compensação* — não de pagamento. O mesmo padrão aparece em 06/2026
(65h03 compensáveis) e 07/2026 (67h33), as duas já **fechadas**, e já apareceu em 09/2026 nos
primeiros dias (73 dias, 33h49 compensáveis, 55 pessoas) — competência **aberta**.

Recomendo tratar isso como três entregas separadas, do menor risco para o maior (seção 6):
formato → rodapé → atraso/compensação. Nenhuma delas altera valor de folha sem decisão humana.

---

## 2. O que foi medido (produção, 04/09/2026)

### 2.1 Números que sustentam o plano

```
08/2026 — 547 folhas, todas "Revisada", competência ABERTA
  dias de trabalho na folha ................................ 7.837
    com os 4 registros (ent/saída int/retorno/saída) ....... 3.628
    só entrada + saída ..................................... 2.688   (jornada ≤6h não tem intervalo)
    incompletos (falta entrada ou saída) ................... 1.521
  atraso na entrada > 5 min ................................ 1.363 dias — 646h27
    com entrada de origem 'real' (batida de terminal/REP) .. 1.318   (94%)
  padrão atraso + saída além do previsto ................... 622 dias, 141 pessoas
  noturno (22h-05h) dentro do expediente Regular ........... 76 dias — 430h20
  eventos de afastamento que tocam o mês ................... 320 (todos 'abonado'; 0 'a_compensar')
```

**94% dos atrasos vêm de batida real**, não de horário digitado por coordenador. Isso importa
muito: a compensação vai operar sobre fato registrado em equipamento (e, nos relógios REP, sobre
AFD assinado), não sobre declaração — é a diferença entre um controle auditável e um acordo de
boca.

### 2.2 Duas hipóteses minhas que a medição DERRUBOU

Registro porque elas quase entraram no plano como fato:

1. **"O regex da jornada está fabricando horário previsto em produção."** As jornadas
   `08H ÁS 20H` e `09H ÁS 21H` (com **Á** agudo, não crase) realmente **não** casam com o regex de
   `parseJornadaNome` e cairiam no default `08:00–17:00` — o que geraria ~3h de hora extra falsa
   por dia. **Mas nenhuma escala ativa usa essas duas jornadas**: 0 dias medidos em 06, 07 e
   08/2026. É uma mina no catálogo, não um incêndio (ver 7.2).
2. **"878 dias de 09/2026 estão sendo calculados contra um horário fabricado."** É o número de
   dias cujo registro tem `jornada_nome` **vazio** (13,7% do mês). Conferi um a um contra a jornada
   da escala: **as 878 têm jornada vinculada, e a hora extra gravada bate com ela** (58 de 61 casos
   com extra; os 3 restantes divergem por 2 min, dentro da tolerância do Art. 58 §1º). O cálculo
   está certo; o que falta é só o campo no snapshot. **Mas isso vira armadilha na hora de calcular
   atraso** — ver 7.3.

### 2.3 Um erro da própria medição, que vira requisito

Minha primeira conta de "saída antecipada" deu 582 dias / 1.150h — número absurdo. Olhando por
jornada, `18H ÀS 06H` aparecia com **média de 1.348 min/dia**: é a aritmética ingênua de minutos
quebrando em turno que cruza a meia-noite. Saneado, o número real e útil é, por exemplo,
`08H ÀS 18H`: **261 dias, 234h19, média 54 min**.

Requisito que sai daí: **a implementação não pode fazer conta de minutos na mão** — tem que usar
`src/utils/folha/sequenciaDia.ts`, que já resolve virada de dia e já é fonte única compartilhada
entre a tela, o `salvarFolhaPonto` e o Auto-Corrigir. Se eu errei isso num script de análise, o
código de produção erraria igual.

---

## 3. O achado central: o sistema mede *instante*, o RH pensa em *duração*

O cálculo de hora extra (`folha-ponto/actions.ts:962-1008`) compara o **instante** da saída real
contra o **instante** da saída prevista. Nunca olha a entrada.

O cartão antigo — e a cabeça do RH — trabalha com **duração**: quanto a pessoa trabalhou no dia
contra quanto ela devia. Nos dois modelos a mesma jornada dá resultados opostos:

| chegou 14:29, saiu 18:12, previsto 14H–18H | modelo de instante (hoje) | modelo de duração (cartão antigo) |
|---|---|---|
| atraso | não medido | 29 min |
| hora extra | **12 min pagos** | 0 (faltaram 17 min para fechar o dia) |

Esse caso é real — MARIA DE JESUS BARRA RODRIGUES (mat. 10370) tem **8 dias assim em 08/2026**,
todos com batida real nas duas pontas.

⚠️ **E o modelo de instante não está "errado" — ele é o juridicamente correto.** Hora extra é
tempo trabalhado além do fim da jornada, e a Portaria **proíbe** compensação automática: o Art. 7º
exige autorização da chefia para o atraso virar compensação. Trocar para o modelo de duração faria
o sistema compensar sozinho, sem autorização — que é exatamente o que a norma veda.

**A correção certa não é trocar de modelo: é medir as duas pontas e deixar a decisão explícita.**
É isso que a Fase 3 faz.

⚠️ Existe um segundo buraco, simétrico e maior, que **não está no pedido do RH** e eu não vou
resolver junto: o **Art. 8º** exige autorização prévia da chefia *e* convalidação do RH para
qualquer hora extra antes/depois da jornada — e hoje o sistema gera hora extra sozinho, sem gate
nenhum. As 473h05 de "extra limpa" de 08/2026 nasceram assim. Fica registrado como Fase 5
(seção 6), para você decidir depois; misturar as duas coisas nesta rodada dobraria o alcance.

---

## 4. Base legal (Portaria 382/2019-GAB-MAB/SMS) → o que cada artigo obriga no sistema

| artigo | regra | efeito no desenho |
|---|---|---|
| Art. 6º §4º | registros de entrada/saída de intervalo são **obrigatórios** conforme a escala | o indicador de atraso precisa considerar o intervalo, não só a entrada |
| Art. 7º caput | atraso/saída antecipada compensáveis **até o fim do mês subsequente** | compensação entre meses = Fase 5 (fora desta rodada, ver 6) |
| Art. 7º §1º | atraso **≤ 20 min**: compensável no mesmo dia, **com autorização da chefia** | é o caso do pedido — Fase 3 |
| Art. 7º §2º | atraso **> 20 min**: só compensa **mediante autorização** | **toda** compensação exige autorização; o limiar de 20 min não dispensa nada, só muda o rito |
| Art. 7º §3º | compensação limitada a **2h diárias** | teto no cálculo do compensável |
| Art. 7º §5º | sem **todos** os registros do dia, não entra no banco de compensação | dia incompleto não pode ser compensado — e são **1.521 dias** em 08/2026 |
| Art. 8º | hora extra antes/depois da jornada exige autorização prévia + convalidação do RH | Fase 5 |
| Art. 9º | registro de intervalo **inferior** ao previsto não gera crédito | já é o comportamento atual; nada muda |
| Art. 19º I | atrasos não autorizados são **descontados** | o sistema mede e expõe; o desconto é ato do RH, fora do SisEscala |

---

## 5. Decisões já confirmadas por você

1. **Layout:** indicadores novos vão para o **rodapé mensal**; a tabela diária perde só a coluna
   **Visto**. Observações fica.
2. **Autorização:** **botão inline** na própria folha, sem tela/fila nova.
3. **Rigidez:** **avisar e permitir override** — o sistema não bloqueia; sinaliza e registra a
   decisão.

⚠️ A decisão 1 se confirmou correta pela leitura do código: a coluna Observações **não é
redundante de exibição apenas** — é o campo onde moram `FALTA`, `FALTA - AGUARDANDO
JUSTIFICATIVA` e a pendência de revisão, e é dela que a página 2 é derivada
(`ocorrenciasDoMes`). Removê-la quebraria falta automática e o verso. A redundância que o RH vê é
consequência de o verso ser um extrato do mesmo dado — não de haver dado duplicado.

---

## 6. Plano por fases

### Fase 1 — HH:MM (isolada, sem risco de cálculo)

Trocar toda hora em decimal por `HH:MM` nos **dois** renderizadores: `FolhaPontoEditor.tsx`
(rodapé e o resumo do verso) e `folha-ponto/page.tsx` (impressão em lote).

Três detalhes que decidem se a mudança fica certa ou quase certa:

- ⚠️ **Não usar o `formatMinutesToTimeStr` que existe hoje.** Ele tem `% 24`
  (`FolhaPontoEditor.tsx:23`) — correto para a extra **de um dia**, errado para um total do mês:
  `210h` viraria `18:00`. O helper do rodapé precisa ser outro, sem `% 24`.
- ⚠️ **A impressão em lote não pode continuar lendo o total decimal do banco.** Os totais são
  gravados como `parseFloat((totalExtra50 / 60).toFixed(2))` em **oito** lugares — de `0.18h` não
  se recupera `11 min` exatos. A folha impressa e a folha na tela mostrariam valores diferentes
  (≤1 min, mas diferentes) para o mesmo documento. A impressão em lote **já carrega `registros`**:
  o certo é ela recalcular dali, com a mesma função do editor. Isso também elimina o risco de
  imprimir total desatualizado.
- O tipo das colunas no banco não precisa mudar nesta fase (só deixa de ser a fonte da impressão).

### Fase 2 — Tirar a coluna Visto e reorganizar o rodapé

Remove **Visto** nos dois renderizadores. O rodapé passa de 4 para 7 indicadores, em HH:MM, no
vocabulário do cartão antigo:

| indicador | de onde vem | novo? |
|---|---|---|
| Horas Normais | como hoje (soma de `horas_totais` por dia trabalhado) | não |
| Horas Noturnas | sobreposição entre o trabalhado e a janela 22h–05h | **sim** |
| Dias de Falta | como hoje (`isFaltaDefinitiva`) | não |
| Atraso / Saída Antecipada | Fase 3 (até lá, fica oculto ou zerado) | **sim** |
| Abono | eventos do mês com `regime_abono = 'abonado'` — 320 em 08/2026 | soma é nova |
| Extra Diurna (50%) | cálculo de hoje, renomeado | rótulo |
| Extra Noturna / Dom. e Feriado (100%) | cálculo de hoje, renomeado | rótulo |

⚠️ **Aviso que a medição obriga a dar:** "Horas Noturnas" vai aparecer **zerada para quase todo
mundo** — 76 dias em 6.412 no mês inteiro. Não é defeito: o trabalho noturno da SMS está quase
todo em **Plantão**, e plantão não entra nas linhas da folha (vai no *Anexo Plantões/Sobreavisos*,
por decisão anterior do projeto). Se o RH espera ver ali o noturno dos plantonistas, isso é uma
mudança de escopo da folha — bem maior — e precisa ser decidida antes, não descoberta depois que
o campo estiver na tela.

⚠️ **Recomendo manter o percentual no rótulo** ("Extra Diurna (50%)") em vez de trocar 50/100 por
diurna/noturna. O percentual é o que a folha de pagamento usa; e o bucket de 100% de hoje mistura
noite + domingo + feriado — chamá-lo só de "noturna" seria rótulo errado em dia de domingo.

### Fase 3 — Atraso e compensação no mesmo dia

Por dia, usando `sequenciaDia.ts` (nunca aritmética de minutos crua):

```
atraso_entrada   = entrada_real − entrada_prevista      (quando positivo)
saida_antecipada = saída_prevista − saída_real          (quando positivo)
excedente_saida  = saída_real − saída_prevista          (quando positivo; é a extra de hoje)

compensavel = min(atraso_entrada, excedente_saida, 120)   -- 120 = teto do Art. 7º §3º
```

Quando há **atraso e excedente no mesmo dia**, o dia entra como **pendente de decisão**, e o selo
inline (no estilo do `+1d` que já existe para plantão que cruza a meia-noite) oferece ao
coordenador/RH duas saídas, ambas registradas com autor e data:

- **Compensação autorizada** (Art. 7º §1º/§2º) — os minutos compensáveis deixam de ser hora extra
  e zeram o atraso do dia.
- **É hora extra mesmo** — mantém o valor atual; o atraso permanece como atraso, para desconto ou
  justificativa.

🚨 **O default não pode mudar valor nenhum sozinho, e essa é a decisão de desenho mais importante
desta fase.** As duas alternativas erram:

| default | efeito imediato | por que não |
|---|---|---|
| "é compensação até alguém autorizar" | tira **253h** de extra de **141 pessoas** de uma vez | folha é documento assinado pelo servidor; reduzir verba sem decisão humana é conflito garantido |
| "é hora extra até alguém compensar" | mantém tudo como está | continua pagando como extraordinário tempo que repôs atraso — o problema que motivou o pedido |

**Proposta: nenhum dos dois — o dia nasce `pendente` e o total não muda até a decisão**, e a
decisão é cobrada no **fechamento da folha**, reusando um mecanismo que já existe: hoje
`salvarFolhaPonto` devolve `requerConfirmacaoFaltas` e o editor abre um modal dizendo "fechar
agora confirma que não haverá justificativa" (`FolhaPontoEditor.tsx:484-494`). O mesmo padrão
serve aqui: *"há N dias com atraso reposto por saída posterior; fechar agora confirma que são
hora extra. Prefere revisar?"*. Isso respeita a decisão 3 (avisa, não trava), põe a escolha no
momento em que alguém está de fato olhando a folha, e nunca altera um número em silêncio.

**Campos novos por dia** (dentro do `registros` jsonb, como `hora_extra_minutos` já é — sem
migration): `atraso_entrada_minutos`, `saida_antecipada_minutos`, `compensacao_minutos`,
`compensacao_status` (`nenhum|pendente|autorizada|extra_confirmada`),
`compensacao_autorizado_por_nome`, `compensacao_autorizado_em`, `compensacao_justificativa`.

**Colunas novas em `folha_ponto`** (migration): `total_atraso_minutos` e
`total_horas_noturnas_minutos` — **em minutos inteiros**, não em decimal, justamente para não
repetir o problema de arredondamento da Fase 1.

⚠️ **Dia incompleto não entra em compensação** (Art. 7º §5º) — são 1.521 dias em 08/2026. E "dia
completo" depende da jornada: em jornada ≤6h o dia completo tem **2** registros, não 4 (2.688 dias
estão nessa situação, e são legítimos). Usar `fn_jornada_tem_intervalo` como critério, que já é a
fonte única dessa regra no projeto.

### Fase 4 — Aplicar nas oito cópias (é o grosso do trabalho, e o maior risco)

Os totais da folha são escritos em **oito** lugares:

| grupo | funções |
|---|---|
| geração (4) | `executeGerarFolhaPonto`, `sincronizarFolhaPonto` (`folha-ponto/actions.ts`), `gerarFolhaPontoServidor`, `sincronizarFolhaPontoServidor` (`consultar-escala/actions.ts`) |
| recálculo (4) | `salvarFolhaPonto`, `autoCorrigirFolhaPonto`, `autoCorrigirTodasFolhasPonto`, `salvarFolhaPontoServidor` |

Mais **dois** renderizadores que recalculam por conta própria no cliente (editor e impressão em
lote). O `CLAUDE.md` já registra que essas listas **se sobrepõem só em nome** e que elas já
divergiram entre si antes.

⚠️ **Elas já divergem hoje, e ninguém percebeu:** a geração usa a jornada **do dia**
(`horasNormaisDiarias`, que respeita jornada temporária), enquanto o editor usa
`jornada?.horas_totais || 8` da folha inteira (`FolhaPontoEditor.tsx:614`). Para quem tem jornada
temporária, o rodapé da tela já mostra um total diferente do que está gravado. É pequeno hoje
(poucas jornadas temporárias na base), mas é a mesma classe de defeito que essa rodada tende a
multiplicar por três indicadores novos.

**Recomendação:** extrair o cálculo do dia (extra + atraso + noturno) para **um módulo puro**,
`src/utils/folha/calculoDia.ts`, e fazer as 8 cópias e os 2 renderizadores chamarem ele — em vez
de acrescentar um quarto bloco duplicado. A aplicação nas cópias deve ser feita por **script
gerador com contagem que aborta na divergência**, como o projeto já faz (`gen_autorizacao_folha.js`
é o modelo mais próximo).

### Fase 5 — uma metade DESCARTADA, outra em aberto

- 🚨 **Compensação entre meses: DESCARTADA (decisão do usuário, 04/09/2026).** "A compensação tem
  que ocorrer dentro do próprio mês, ela não pode ser compensada nos meses subsequentes." O
  Art. 7º caput *admite* compensar até o fim do mês subsequente — é teto, não obrigação.
  A implementação entregue já é compatível por construção (compensação do mesmo dia), e o atraso
  não compensado até o fechamento vira desconto/justificativa. **Não construir saldo que atravessa
  competência**: seria banco de horas por outro nome, e esbarra nas mesmas perguntas de regime
  jurídico sem resposta desde 14/08/2026
  ([estudo](2026-08-14-estudo-faltas-automaticas-e-banco-de-horas.md)).
- **Autorização prévia de hora extra** (Art. 8º): 473h em 08/2026 nasceram sem gate nenhum.
  **Continua em aberto.**

---

## 7. Riscos e armadilhas específicos desta mudança

### 7.1 Competência fechada e folha "Revisada"

06 e 07/2026 estão **encerradas** — nada retroage, e nem deveria. As **547 folhas de 08/2026 estão
todas "Revisada"**, com a competência ainda aberta: os indicadores novos só aparecem nelas se
alguém reabrir e sincronizar, folha a folha. **Planejar a virada para 10/2026**, deixando 09 (que
já tem 617 folhas em andamento) ganhar os campos naturalmente pela sincronização.

### 7.2 A mina no catálogo de jornadas

`08H ÁS 20H` e `09H ÁS 21H` (Á agudo) não casam com o regex e cairiam em `08:00–17:00` — 3h de
extra falsa por dia, em silêncio. Hoje não há escala usando, mas **estão selecionáveis no
cadastro**. Correção barata e independente: aceitar o acento no regex **e** fazer a folha
sinalizar quando o previsto veio do default, em vez de assumir 08:00–17:00 calado. Com o atraso
ligado, esse default deixa de ser um erro contido: viraria atraso fabricado para todo mundo com
jornada que começa depois das 08:00.

### 7.3 `jornada_nome` vazio no registro (878 dias em 09/2026)

O cálculo de hoje usa a jornada resolvida na geração, então está certo. Mas **13,7% dos registros
não têm o nome da jornada gravado no snapshot**, e o cliente lê `r.jornada_nome`. Quem calcular
atraso no editor precisa do mesmo fallback que a tela já usa
(`r.jornada_nome || jornada?.nome`) — sem isso, esses dias apanhariam o default `08:00–17:00` e
gerariam **atraso fabricado**, exatamente o defeito de 7.2 pela porta dos fundos.

### 7.4 O que NÃO deve ser tocado

- A tolerância do Art. 58 §1º (`toleranciaExtra.ts`) é **limiar, não franquia** (Súmula 366 do
  TST) — o projeto já mediu que confundir os dois vale 102h31 num mês. O atraso entra como
  **medida nova**, sem alterar essa conta.
- A regra de preservação da folha (`src/utils/folha/preservacao.ts`): campo de origem `manual`/
  `ajuste_*` se preserva, `real`/`pre_assinalado` se regera. Os campos de compensação são
  **decisão humana** — entram na lista do que se **preserva**, senão a próxima sincronização apaga
  a autorização do coordenador.

---

## 8. O que ainda depende de você

1. **"Horas Noturnas" com plantão dentro ou só do expediente Regular?** Como está, o indicador
   nasce zerado para quase todos (76 dias em 6.412). Incluir plantão muda o escopo da folha.
2. **Rótulo Extra Diurna/Noturna** — manter o percentual junto (minha recomendação) ou substituir?
3. **Default do dia pendente** — confirma a proposta de "não muda valor, cobra a decisão no
   fechamento" (seção 6, Fase 3)?
4. **Fase 5 entra agora?** Especialmente o Art. 8º (hora extra sem autorização prévia), que é a
   exposição legal maior das duas.

As Fases 1 e 2 não dependem de nenhuma dessas respostas e podem começar já.

---

## 9. Portões (não há framework de teste no projeto)

- `src/utils/folha/calculoDia.ts` **puro** (sem React/Supabase), com
  `node scratchpad/sim_calculo_dia.js` cobrindo: atraso ≤20min, >20min, teto de 2h, dia incompleto,
  jornada ≤6h sem intervalo, turno que cruza a meia-noite, atraso sem excedente, excedente sem
  atraso, e a interação com a tolerância do Art. 58 §1º.
- Validar o portão **injetando regressão de propósito** (o projeto já adota isso): um caso em que a
  compensação passa sem autorização precisa **reprovar**.
- Reconferência em produção antes e depois: `scratchpad/an_atraso_folha.mjs` (os números desta
  seção 2 são a linha de base — a folha regerada não pode mudar nenhum total de competência
  fechada).
