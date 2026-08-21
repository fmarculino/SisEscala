# O dia incompleto na folha de ponto — o estado que não existia

**Data:** 21/08/2026
**Origem:** folha de ponto de LIVIA DA CONCEICAO GONCALVES (59314, RH/SMS), dias 18, 19 e 20 de
agosto, com apenas um ou dois passos preenchidos e **nenhuma sinalização**. Pergunta do usuário:
"não deveria estar aparecendo falta aguardando revisão do coordenador?"

**Resposta curta:** não, pela regra vigente — e a regra estava incompleta.

---

## 1. Como a falta automática funcionava (e continua funcionando)

Implementada em 14/08/2026 (`src/utils/folha/faltaAutomatica.ts`). Dispara quando **três**
condições valem juntas:

| condição | medida |
|---|---|
| o dia já passou | `dia < dia de hoje` — nunca marca dia corrente |
| havia turno previsto | tem `turno_codigo`, não é folga/feriado/afastamento |
| **`temMarcacao === false`** | **nenhum** dos 4 passos preenchido, real ou manual |

Nasce como `FALTA - AGUARDANDO JUSTIFICATIVA` e vira `FALTA` definitiva depois de
`justificativa_prazo_dias_uteis` dias úteis **após o fim do mês**.

⚠️ **É tudo-ou-nada.** Um passo preenchido tira o dia da regra inteira. Foi o caso da Livia: dia 18
só com saída, dia 19 só com entrada, dia 20 com retorno de intervalo e saída.

## 2. A premissa errada

O plano de 14/08 justificou excluir a batida parcial assim:

> "é distinto de uma batida parcial (só entrada, por exemplo), **que já tem tratamento próprio**"

**Não tem.** Medido no código em 21/08/2026: um dia parcial na folha não tem cor, não tem
observação, não tem contagem, e é indistinguível de um dia normal com células vazias. Pior — ele:

1. **conta a jornada cheia** em `total_horas_normais` (`actions.ts`, `totalHorasNormais +=
   horasNormaisDiarias` para todo dia com turno);
2. **gera hora extra a partir de uma saída solitária** — o cálculo compara **só a saída** com o fim
   previsto e nunca exige entrada. Foi daí que vieram os `00:11` do dia 18 e os `00:09` do dia 20
   da Livia: o sistema não sabia se ela trabalhou 10 horas ou 10 minutos e creditou extra do mesmo
   jeito.

## 3. O tamanho do buraco, medido em produção

SMS, agosto/2026, pares (servidor, dia) com turno e dia já passado — **2.307**:

| situação | dias | o que a folha fazia |
|---|---|---|
| completos, 4 de 4 | 951 (41,2%) | correto |
| **parciais** | **1.196 (51,8%)** | **nada** |
| vazios | 160 (6,9%) | `FALTA - AGUARDANDO JUSTIFICATIVA` |

E os 1.196 parciais **não são um problema só**:

| padrão | dias |
|---|---|
| entrada + saída, **sem intervalo nenhum** | **1.010** |
| **falta entrada ou saída** (inclui 80 de um passo só) | **151** |
| outros | 35 |

A SMS tem `permite_marca_intervalo = true` (`flexivel`): o sistema espera 4 batidas e recebe 2 na
maioria dos dias. Isso é hábito operacional, não defeito de software.

⚠️ **Achado grave, à parte:** dos 160 dias vazios que viram FALTA, **3 têm batida REP no banco** —
`escala_diaria` zerada, mas a marcação existe, com dono e NSR de AFD:

```
MESSIAS DA SILVA LEITE (54007)         dia 17  08:20  AFD NSR 268543
IVANA MARIA HERENIO DOS SANTOS (65717) dia 19  19:06  AFD NSR 17927
JANIA REGIA MILHOMEM CASAIS (1281)     dia 20  18:07  AFD NSR 269308
```

São faltas indevidas contra prova assinada. **Não foram corrigidas nesta rodada** — mexer nelas é
mexer em ponto passado e exige decisão à parte.

## 4. O recorte, e por que não é "todo dia incompleto"

Decisão do usuário em 21/08/2026, com os dois números na frente:

> **pendência só quando falta ENTRADA ou SAÍDA** — os passos sem os quais não dá para saber quanto
> a pessoa trabalhou. Intervalo ausente continua como está.

Marcar os 1.196 afogaria o coordenador e ele ignoraria o conjunto, inclusive os 151 que importam.

## 5. O que foi implementado

| peça | onde |
|---|---|
| fonte única da regra | [`src/utils/folha/diaIncompleto.ts`](../../src/utils/folha/diaIncompleto.ts) |
| aplicação nas **4 cópias** da geração | `folha-ponto/actions.ts` (2) e `consultar-escala/actions.ts` (2) |
| recálculo ao editar na tela | `FolhaPontoEditor.tsx` — usa a **mesma** função |

Textos gravados em `registro.observacao`:

```
REVISAR: SEM REGISTRO DE ENTRADA
REVISAR: SEM REGISTRO DE SAÍDA
REVISAR: SEM REGISTRO DE ENTRADA E DE SAÍDA
```

⚠️ **O texto não pode conter a palavra FALTA** — `isFaltaDefinitiva` conta falta por
`observacao.includes('FALTA')`. Um marcador com "FALTA" no meio somaria em `total_faltas`
silenciosamente. Por isso `REVISAR:`.

**O que ela não faz:** não conta falta, não desconta hora, não bloqueia nada. Sinaliza. Quem decide
continua sendo o coordenador (Portaria 671/2021, art. 82).

**Como sai da tela:** preenchendo o horário que falta. A pendência é recalculada a cada
geração/sincronização e **não é preservada**, então se cura sozinha — ao contrário de `FALTA`, que
é preservada explicitamente. Na tela, preencher só a entrada de um dia sem saída **troca** o texto
para `SEM REGISTRO DE SAÍDA` em vez de sumir.

### O gerador pegou uma divergência real entre as cópias

O script (`scratchpad/gen_pendencia_revisao.js`, modelo da armadilha 1) **abortou na primeira
execução**: as duas cópias do portal não eram iguais. Uma usa `folha.ano`/`folha.mes`, a outra usa
`ano`/`mes` puros. Sem contagem-e-aborta, o 4º sítio teria ficado de fora e o portal divergiria da
folha do coordenador — exatamente o histórico que criou `sequenciaDia.ts` e `preservacao.ts`.

Divergência que **continua existindo** e não foi mexida: o `temMarcacao` das duas cópias do portal
inclui `saida_intervalo`/`retorno_intervalo`, o das duas da folha não. Em unidade com
pré-assinalação isso pode fazer o mesmo dia virar FALTA de um lado e não do outro.

## 6. Alcance medido antes de aplicar

Simulação da regra sobre **toda a produção**, agosto/2026, 3.731 pares (servidor, dia) com turno:

| resultado | dias | % |
|---|---|---|
| vazios → `FALTA` (regra que já existia) | 321 | 8,6% |
| **→ `REVISAR` (regra nova)** | **349** | **9,4%** |
| entrada e saída presentes, sem observação | 3.061 | (1.727 sem intervalo — não sinalizam, por decisão) |

Por texto: 191 sem saída · 144 sem entrada · 14 sem os dois.

Por unidade — só as 5 com relógio REP são atingidas, o que é coerente:

```
152  SMS - Secretaria Municipal de Saúde      (de 2.307 dias)
103  USF ENFERMEIRA ZEZINHA                   (de   618)
 76  LACEM                                    (de   549)
 17  CEI                                      (de   229)
  1  USF JOSE PEREIRA DE ARAUJO               (de    14)
```

⚠️ A simulação lê `escala_diaria.presenca_*`; a folha lê `registro.entrada/saida`, que também pode
vir de edição manual preservada. Os números são a ordem de grandeza, não o valor exato.

## 7. A hora extra fantasma — resolvida logo em seguida (mesma data)

Estava listada aqui como "fica de fora"; o usuário mandou atacar em seguida. Registrado nesta
mesma seção porque é o outro lado do mesmo dia incompleto.

**O defeito:** a geração creditava hora extra comparando **só a saída** com o fim previsto, sem
nunca exigir entrada. Um dia com uma batida solitária às 18:11 e nada mais virava 11 minutos de
extra — o sistema afirmando quanto a pessoa trabalhou sem saber quando ela chegou. E isso vira
**verba na folha**.

**Não era decisão de política, era divergência entre implementações.** Havia três cálculos de hora
extra no projeto e **dois já exigiam entrada**:

| implementação | exigia entrada? |
|---|---|
| `recalculateOvertimeForDay` (`FolhaPontoEditor.tsx`) | **sim** — `if (!entrada \|\| !saida) return { minutes: 0 }` |
| `normalizarRegistrosFolha` (`normalizarHorarios.ts`) | **sim** — `if (r.entrada && r.saida) { … } else { 0 }` |
| **geração da folha (4 cópias)** | **não** |

Efeito colateral disso: a mesma folha mudava de valor **só por alguém tocar na célula na tela** —
a geração gravava o extra, o editor recalculava para zero.

**A correção** é uma condição a mais nas 4 cópias, aplicada por script com contagem-e-aborta
(`scratchpad/gen_extra_exige_entrada.js`):

```ts
if (evalExit && registro.entrada && evalExit > effectiveScheduledExit) {
```

**Impacto medido em produção antes de aplicar** (`folha_ponto.registros`, 06–08/2026, 460 folhas):

| competência | dias com extra | **dias com extra e sem entrada** | folhas afetadas |
|---|---|---|---|
| 06/2026 (71 folhas, todas Revisadas) | 463 (606h22) | **0** | 0 |
| 07/2026 (77 folhas) | 744 (556h06) | **0** | 0 |
| **08/2026** (312 folhas, 300 em Rascunho) | 814 (477h29) | **31 (12h16)** | **27** |

A exposição é inteiramente do mês corrente — apareceu com o REP, que é o que produz dia parcial.
**2,6% da hora extra de agosto.** Os 783 dias restantes com extra têm entrada e não mudam: a
condição só acrescenta uma exigência, nunca cria extra novo.

O maior caso isolado: ELIZABETH COELHO MARQUES (1133), 17/08 — entrada vazia, saída 18:53,
**353 minutos (5h53) de extra 50%** creditados sem nenhuma entrada registrada.

**Os 31 dias se curam sozinhos** na próxima geração/sincronização da folha — nenhuma correção de
dado foi feita à mão, e competência fechada não é regerada.

⚠️ **O que NÃO mudou, e é decisão consciente:** o extra continua sendo medido do **fim previsto**
até a saída, sem descontar atraso na entrada. Quem chega 2h atrasado e sai 11 min depois do
previsto continua ganhando 11 min de extra. Isso é regime de apuração, não defeito — mexer nisso é
decisão de RH/jurídico, não de código.

## 8. O que ficou de fora, de propósito

1. **As 3 faltas indevidas continuam.** Mexem em ponto passado.
2. **Observação de texto livre não é preservada na regeneração.** Só textos contendo `MANUAL` ou
   `FALTA` sobrevivem — defeito anterior a esta mudança. Consequência prática: justificar uma
   pendência digitando texto não a resolve de forma durável; o caminho que funciona é **preencher o
   horário**.
3. **Nenhuma migration.** Mudança 100% em TypeScript; o banco não foi tocado.

## 9. Verificação

- `npx tsc --noEmit` — limpo.
- `npm run build` — executado.
- Simulação sobre produção (seção 6), só leitura.
- Sem teste automatizado: o projeto não tem. Conferir na folha de agosto da SMS depois de
  sincronizar — os dias 18 e 20 da Livia devem passar a dizer `REVISAR: SEM REGISTRO DE ENTRADA` e
  o dia 19, `REVISAR: SEM REGISTRO DE SAÍDA`.
