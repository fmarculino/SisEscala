# Feriado com escala é dia de trabalho, e a folha tratava todo feriado como folga (17/09/2026, v2.71.0)

**Arquivos:**
- `src/app/(dashboard)/folha-ponto/actions.ts` (modificado — `executeGerarFolhaPonto`, `sincronizarFolhaPonto`, `salvarFolhaPonto`, `checkIfFolhaHasPendingPastTimes`)
- `src/app/consultar-escala/actions.ts` (modificado — `gerarFolhaPontoServidor`, `sincronizarFolhaPontoServidor`, `checkIfFolhaHasPendingPastTimes`)
- `src/app/(dashboard)/folha-ponto/[id]/FolhaPontoEditor.tsx` (modificado)
- `src/app/(dashboard)/folha-ponto/page.tsx` (modificado — impressão em lote)
- `src/utils/folha/normalizarHorarios.ts` (modificado — Auto-Corrigir)

Sem migration. Nenhum dado foi reescrito por esta mudança: as folhas afetadas se corrigem ao
**Sincronizar** ou **Gerar** de novo.

---

## 1. O relato

Um técnico de radiologia do **RAIO-X / HMI – Hospital Materno Infantil**, escalado no plantão
noturno (`19H ÀS 07H`) de **07/09/2026 — Independência do Brasil**, tinha a linha daquele dia
**em branco** na folha de ponto: entrada, saída de intervalo, retorno e saída todos `-`, hora extra
`-`, e na observação apenas `FERIADO: INDEPENDÊNCIA DO BRASIL`.

A grade de escala do mesmo setor mostrava o `N` daquele dia normalmente, e o resumo dela previa
**124h** no mês — carga que incluía o feriado. A folha não.

Hospital não fecha no dia 7 de setembro. Ele trabalhou o plantão inteiro.

---

## 2. Onde estava o defeito

### 2.1 A ordem do `if` — o ramo de trabalho nunca rodava

As quatro cópias da geração da folha classificam o dia numa cadeia de `if/else`:

```
afastamento → feriado → ponto facultativo dia inteiro → sem turno (folga) → dia de trabalho
```

O ramo do feriado **não olhava se havia turno escalado**. Qualquer feriado saía por ali, com uma
observação e mais nada. E é o ramo de **dia de trabalho**, lá no fim, que faz todo o resto:

- `resolverMarcacaoDoDia` — lê as batidas reais de `escala_diaria` e as coloca nos quatro passos;
- a pré-assinalação do intervalo;
- o laço minuto a minuto da hora extra (que, aliás, **já** classificava feriado como 100%).

Nada disso acontecia. A batida real do relógio existia no banco e era descartada em silêncio.

**Correção:** o ramo passou a ser `registro.feriado && !shift`. Feriado **sem** escala continua
sendo dia não útil, como sempre foi. Feriado **com** escala cai no ramo de trabalho e apenas herda
a observação `FERIADO: …` — que é o que mantém a falta automática longe do dia e o que faz o verso
listar a ocorrência "Trabalho em Feriado" (`ocorrencias.ts`, que já previa esse caso desde sempre).

### 2.2 A carga do dia — sete sítios contavam de um jeito, a geração de outro

A geração somava `totalHorasNormais` **dentro** dos ramos do `if`. Os ramos de feriado e de
afastamento não somavam nada.

Todo o resto do sistema conta pela mesma regra — **tem `turno_codigo`, conta**:

| onde | regra |
|---|---|
| `totaisFolha` (rodapé da folha e impressão em lote) | `if (r.turno_codigo)` |
| `apuracaoPeriodo.ts` (período 21→20, v2.67.0) | chama `totaisFolha` — herda a regra |
| `salvarFolhaPonto` | `if (r.turno_codigo)` |
| `autoCorrigirFolhaPonto` | `if (r.turno_codigo)` |
| `autoCorrigirTodasFolhasPonto` | `if (r.turno_codigo)` |
| `salvarFolhaPontoServidor` | `if (r.turno_codigo)` |
| `calculateTotals` (grade de escala) | soma o Regular do dia, sem olhar feriado |
| `fn_carga_mensal_servidor` (banco) | soma `escala_diaria`, sem olhar feriado |
| **a geração da folha** | **dentro dos ramos — feriado e afastamento valiam zero** |

O resultado era pior que um número errado: era **o mesmo documento com dois números**. O rodapé da
própria folha, calculado na tela, mostrava as mesmas 124h da grade; a coluna `total_horas_normais`
gravada pela geração ficava abaixo disso; e bastava alguém abrir e **salvar** para ela pular para
124h, porque o recálculo do save usa a regra certa.

⚠️ **O tamanho do buraco não foi medido no banco** — esta sessão não tem acesso ao Postgres de
produção. A diferença, por servidor, é a carga de cada dia de feriado em que ele estava escalado.

**Correção:** a soma virou **uma só, antes do `if`**, pela mesma regra dos outros sete. Isso também
encerra o pulo do afastamento, que sofria exatamente do mesmo defeito na direção oposta.

### 2.3 A tela escondia o horário mesmo quando ele existia

`FolhaPontoEditor.tsx` (usado também pelo portal do servidor) e a impressão em lote pediam
`isWorkDay && !r.afastamento && !r.feriado` em cada um dos quatro passos. Corrigir só a geração
deixaria o dado certo no banco e o `-` na tela.

O termo `!r.feriado` era **redundante** para feriado sem escala — que não tem `turno_codigo` e já
cai fora pelo `isWorkDay` — e **errado** para feriado com escala. Foi podado nos dois arquivos.

### 2.4 Os três guards que também pulavam o feriado

- `normalizarHorarios.ts`: o **Auto-Corrigir** pulava o dia inteiro — a batida mal alocada num
  feriado não tinha quem a realinhasse.
- `checkIfFolhaHasPendingPastTimes` (duas cópias): o feriado trabalhado e sem batida **não era
  cobrado de ninguém**; a folha ia para revisão como se estivesse completa.
- A validação cronológica de `salvarFolhaPonto` e do editor: agora o feriado é conferido como
  qualquer outro dia, já que passou a aceitar horário.

---

## 3. O que deliberadamente NÃO mudou

**A regra de pagamento.** O plantão do feriado é carga **regular**: a escala 12x36 gira sobre o
calendário e o feriado cai no rodízio como qualquer outro dia. Os 100% valem para o que **excede**
a saída prevista — e o laço minuto a minuto já fazia isso certo, ele é que nunca era alcançado.

Transformar "todo feriado é 100%" seria criar verba que nenhuma das três fontes citadas em
`cargaDiaria.ts` (Portaria 382/2019-GAB-MAB/SMS, Lei 17.331/2008 e CLT Art. 71) autoriza.

---

## 4. Divergência conhecida que fica de fora

`totaisFolha` usa a jornada do **mês** para todo dia (`opcoes.horasNormaisPorDia`), enquanto as
quatro cópias do recálculo usam `horasNormaisDoDia` — a jornada **do dia**, que respeita
`servidores_jornadas_temporarias`. Para quem tem vigência no meio do mês, rodapé e coluna do banco
divergem.

Não entrou nesta correção porque exige levar o mapa de jornadas até o editor, e o defeito é de outra
natureza. Está anotado na armadilha 72 do `CLAUDE.md`.

---

## 5. Verificação

`npx tsc --noEmit` e `npm run build` passam. Não há testes automatizados no projeto.

**Conferência manual sugerida** numa competência com feriado em dia útil (09/2026, dia 07):

1. Abrir a grade do setor e anotar a **PREVISÃO** de um servidor escalado no feriado.
2. **Sincronizar** a folha dele e conferir que o dia do feriado agora mostra os horários, que a
   observação continua dizendo `FERIADO: …` e que o verso lista "Trabalho em Feriado".
3. Conferir que `total_horas_normais` bate com o rodapé da folha **e** com a previsão da grade —
   e que **salvar não muda mais o número**, que era o sintoma mais fácil de reproduzir.
4. Conferir que um servidor **sem** escala no feriado continua com o dia limpo e sem carga.
