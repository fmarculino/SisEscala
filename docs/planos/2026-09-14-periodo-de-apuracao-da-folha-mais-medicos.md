# Período de apuração da folha diferente do mês civil (Mais Médicos, 21 → 20)

**Data:** 14/09/2026 · **atualizado em 16/09/2026**
**Estado:** ✅ **FASES 0 a 4 CONCLUÍDAS em 16/09/2026 (v2.67.0).** As duas migrations estão
**aplicadas e conferidas em produção**, executando as funções:
`ver_regime_apuracao_producao.mjs` (**26 de 26**) e `ver_apuracao_producao.mjs` (**20 de 20**).

| peça | onde |
|---|---|
| Fase 1 — o regime | `20260916110000_regime_de_apuracao_da_folha.sql` · `src/utils/folha/periodoApuracao.ts` · seção na ficha do servidor |
| Fase 2 — a montagem | `src/utils/folha/apuracaoPeriodo.ts` · `servidores/[id]/apuracaoActions.ts` · prévia na mesma seção |
| Fase 3 — o documento | `20260916120000_emitir_apuracao_do_periodo.sql` · `/folha-ponto/apuracoes` |
| Fase 4 — o manual | `ajuda/conteudo/pessoas.ts` (o regime) e `ponto.ts` (emitir/retificar) |
| portões | `sim_periodo_apuracao.js` (67) + `val_` (**9 de 9**) · `sim_apuracao_periodo.js` (**87**) + `val_` (**15 de 15**) · `sim_manual.js` (**914**) |
| medição real | `an_apuracao_mais_medicos.mjs --corte20` — ensaio sem gravar nada |

`tsc --noEmit`, `lint` e `build` limpos.

🚨 **NADA MUDOU DE VALOR EM PRODUÇÃO, e é assim que tem de ficar até alguém decidir o contrário:**
nenhum servidor foi atribuído ao regime (0 linhas em `folha_regime_vigencias`), nenhum documento foi
emitido (0 em `folha_apuracoes`), e os 2.647 ativos continuam no mês civil. **A Fase 5** (devolver os
4 médicos ao setor real) continua aberta, com medição própria.

**Decisões do usuário (14/09/2026), tomadas antes de escrever este plano:**

| pergunta | decisão |
|---|---|
| o documento 21→20 substitui a folha mensal? | **NÃO — convive.** A folha continua sendo mensal (competência = mês civil); o que nasce é o **documento de apuração do período** |
| onde o regime é informado? | **No servidor (vínculo), com vigência e histórico** — não no setor |
| origem da regra do dia 20 | ~~exigência do programa federal (ADAPS/Ministério)~~ — **corrigido em 16/09/2026, ver abaixo** |

## ✅ Fase 0 RESPONDIDA em 16/09/2026 — e a resposta melhorou o desenho

**Não existe norma nem ofício.** Decisão/esclarecimento do usuário: *"essa é uma convenção que já
vem de anos atrás, e a própria folha do município já foi assim em algum momento"*. A busca de
14/09 não achou a norma federal porque **ela não existe** — o que a documentação do programa diz é
outra coisa (lançamento **mensal** no e-Gestor/SGP, bolsa até o **5º dia útil** do mês seguinte).

Três consequências, e nenhuma é cosmética:

1. **A Fase 3 está desbloqueada.** Não há norma a esperar nem formato obrigatório a cumprir; o
   documento é da Secretaria, não do programa.
2. 🚨 **O corte pode voltar a valer para a REDE INTEIRA** — já valeu. Então o regime não pode ser
   só "4 linhas para 4 médicos": precisa de um jeito de ligar o corte para todos sem criar 2.647
   linhas, uma por servidor ativo. É o que a **vigência global** resolve (§4.1).
3. O corte continua sendo **cadastro**, nunca constante no código — se um dia for 25 ou 15, muda
   um número.

**E a convenção de nome está confirmada:** *"esse mês que está sendo fechado agora dia 20/09 é
referente ao mês que está dentro, ou seja mês 09"*. A competência é o mês em que o período
**FECHA** — 21/08→20/09 é a competência **09/2026**. É a leitura que o plano recomendava, e agora
está codificada em `fn_periodo_apuracao` e no portão.

---

## Resumo em uma linha

O regime de apuração é **propriedade do vínculo**, não do lugar; e o período 21→20 é uma **janela
de fechamento**, não uma competência nova. Então nada na folha mensal muda: cria-se o regime no
servidor e um **documento de apuração** que recorta as folhas mensais que já existem — os dias
21..31 de um mês somados aos 1..20 do seguinte.

---

## 1. O problema

O Mais Médicos exige a frequência fechada no dia 20: o período vai de **21 de um mês a 20 do
seguinte**. Hoje a folha do SisEscala é rigorosamente mensal, do dia 1 ao último dia, e não existe
nenhum recorte que atravesse a virada do mês.

E o pedido não é "só um" caso: o sistema tem de suportar **grupos de servidores com cortes
diferentes**, convivendo com o mês civil da maioria.

---

## 2. Situação atual — medido em produção em 14/09/2026

### 2.1 A folha é mensal, mas **não** é única por mês

```
folha_ponto: 2.107 folhas | 06/2026=71  07/2026=77  08/2026=710  09/2026=1.244  10/2026=4  02/2027=1
status: Revisada 861 · Gerada 457 · Rascunho 789
servidores com 2+ folhas na MESMA competência: 55
```

🚨 **`unique_servidor_mes_ano` foi DERRUBADA em `20260612100000`** e substituída por
`unique_escala_mensal_id`. Ou seja: a chave da folha é a **escala**, não o mês — e **55 servidores
já têm duas folhas na mesma competência hoje**, herança da divisão de escala por transferência
(armadilha 47). O modelo já aceita folha parcial no mês; é a **leitura** que assume uma por mês.

### 2.2 O registro do jsonb é indexado por `dia`, sem mês

```json
{ "dia": 1, "dia_semana": "Ter", "entrada": "", "saida": "", "jornada_nome": "18H ÀS 06H",
  "hora_extra_minutos": 0, "abono_minutos": 0, "afastamento_slots": null, "origem_entrada": null }
```

`r.dia === day` é a chave em **~15 sítios** da folha, e há **4 sítios** que ordenam por
`sort((a, b) => a.dia - b.dia)` (`generateFingerprint`, `ocorrencias.ts`, a lista de plantões e
`consultar-escala/actions.ts:630`).

✅ **Sorte estrutural que torna tudo isto barato: num corte em dia fixo, os números de dia nunca
colidem.** 21..31 do mês A mais 1..20 do mês B são 31 valores distintos. Vale para qualquer corte
(26→25, 16→15): o período `dia N+1 → dia N` nunca repete um número.

⚠️ **Mas a ORDEM quebra.** `sort` por `dia` numérico coloca o dia 1 (mês seguinte) **antes** do dia
21 (mês da virada). O documento de apuração tem de ordenar por **data**, nunca por `dia` — e por
isso o registro da apuração carrega a data ISO ao lado do `dia` (§4.4).

### 2.3 Os 4 médicos, e o setor artificial que já foi criado

```
setor MAIS MEDICOS (a465e8bd) · USF ENFERMEIRA ZEZINHA · raiz · ativo
  T2600015 ANDRE BARBOSA      MEDICO CLINICO  Contratada
  T2600016 KETHURY CHAVES     MEDICO CLINICO  Contratada
  T2600017 ISAAC PRADO RAMOS  MEDICO CLINICO  Contratada
  T2600018 MARCELO CARDOSO    MEDICO CLINICO  Contratada
jornada dos 4: 08H ÀS 18H (10h, intervalo 120) -> 8h líquidas/dia
```

O setor **já está em uso**: em 08/2026 os 4 tinham escala em `AMBULATÓRIO CLÍNICO` e em 09/2026
estão em `MAIS MEDICOS`. A ideia do setor-por-regime não é hipótese — ela começou a ser executada.

E eles batem ponto de verdade: **147 marcações entre 21/08 e 20/09**, 141 de origem `rep` e 6
`ajuste_coordenador`.

🚨 **O setor `MAIS MEDICOS` não está vinculado a nenhum relógio — e só não deu problema por
acidente.** A USF ENFERMEIRA ZEZINHA tem **1 relógio** (`REP-iDClass-ENF-ZEZINHA`) com **zero
linhas** em `dispositivos_rep_setores`, o que significa "atende a unidade inteira". No dia em que
alguém vincular setores àquele relógio — que é a operação certa numa unidade multi-sítio, e já foi
feita no HMM — **os 4 médicos somem da Cobertura de Ponto e da fila de cadastro**, sem nada
reclamar. É exatamente o ponto cego do HMM-03 esperando acontecer, e nasce de usar setor como
âncora de regime.

### 2.4 O recorte 21→20 já é reproduzível com o dado que existe

Recortando as folhas reais de 08 e 09/2026 pelo corte no dia 20:

| servidor | 08/2026 dias > 20 | 09/2026 dias ≤ 20 | HE no período | dias com FALTA |
|---|---|---|---|---|
| T2600015 | 11 dias (6 com horário) | 20 dias (3 com horário) | 0 min | 0 |
| T2600016 | 11 (4) | 20 (5) | 20 min | 2 |
| T2600017 | 11 (5) | 20 (5) | **208 min** | 2 |
| T2600018 | 11 (4) | 20 (4) | 0 min | 3 |

Reproduzível por `node scratchpad/an_periodo_apuracao.mjs` (leitura pura de produção), que também
**confere** que os números de dia do recorte não colidem em vez de supor que não colidem.

⚠️ **As duas metades estão em estados diferentes, e é isso que o desenho tem de resolver:** as
folhas de 08/2026 estão **`Revisada`** e as de 09/2026 em **`Rascunho`**. A metade velha é
documento praticamente fechado; a metade nova ainda se move todo dia (batida nova, reconciliação,
decisão de compensação). `competencias_encerradas` hoje tem **06 e 07/2026** — 08 ainda está aberta.

### 2.5 O eixo (mês, ano) é onipresente — e é por isso que ele não vai ser mexido

- **16 arquivos** em `src/` filtram por `mes` + `ano` (grade, folha, portal, relatórios, autoClose,
  gerador inteligente, justificativas).
- `escala_mensal` é **uma escala por (servidor, mês, ano, unidade, setor)**, e `escala_diaria.dia`
  é relativo a ela — não há coluna de data.
- `fn_competencia_encerrada(mes, ano)` é consultada por **~15 migrations**, sempre como guarda de
  escrita.
- `justificativas_eventos` tem chave `(servidor, dia, mes, ano, categoria)`;
  `excecoes_escala_servidor` é `(servidor, mês, ano)`.

**Conclusão:** trocar a identidade da folha de (mês, ano) para (início, fim) não é uma mudança de
folha — é uma mudança de eixo do sistema inteiro. Ver §5.2.

---

## 3. O que as normas dizem

### 3.1 Fechar no dia 20 é legal, mas só as VARIÁVEIS rolam

**Portaria MTP nº 4.198/2022, art. 101-B** (regulamenta o art. 459 §1º da CLT):

> Não constitui infração ao disposto no § 1º do art. 459 da CLT o pagamento, no prazo para quitação
> do salário do mês subsequente, das seguintes verbas: I – **parcelas variáveis** da remuneração do
> empregado relativas ao trabalho realizado **após o dia vinte** de cada mês; e II – devoluções de
> descontos decorrentes de faltas, atrasos e de saídas antecipadas, quando justificados após o dia
> vinte de cada mês.
>
> [...] entende-se por parcela variável aquela cuja aferição dependa de parâmetros quantitativos
> relacionados à jornada ou à produtividade, **tais como horas extraordinárias**, comissões,
> gorjetas e produção.

E o próprio artigo exclui o principal: **"não se consideram parcelas variáveis o salário decorrente
da jornada regular"**.

🚨 **Leitura que decide o desenho: a norma NÃO move a competência para 21→20.** Ela mantém a
competência mensal e autoriza que o que se apura **depois do dia 20** seja pago na competência
seguinte. Quem fecha no dia 20 está diferindo **variáveis**, não redefinindo o mês.

### 3.2 O eSocial é regime de competência — e a lacuna do Mais Médicos

O eSocial adota **regime de competência = mês calendário**; enviar folha com competência divergente
do período real de apuração é não-conformidade. Períodos herdados (21→20, 26→25) sobrevivem no DP
como **janela de apuração**, com a competência ainda mensal.

Do lado do programa, o que a documentação oficial publica é:

| fonte | o que diz |
|---|---|
| Pagamento Mais Médicos (gov.br) | bolsa-formação paga até o **5º dia útil do mês subsequente**, proporcional aos dias de atividade |
| Gestor — e-Gestor/SGP | o gestor municipal registra as atividades **mensalmente**, e anexa os comprovantes (**"Portaria de Gestão e folha de ponto"**) em **um único arquivo PDF/JPEG/PNG** |
| ADAPS / Médicos pelo Brasil | ponto eletrônico do médico validado pelo gestor até o **5º dia útil do mês subsequente** |

⚠️ **Nenhuma dessas fontes fixa o corte no dia 20.** Duas consequências práticas:

1. **O corte precisa ser configurável, não constante no código** — se a exigência real for outra
   (ou mudar), tem de ser um número no cadastro.
2. ✅ **E há um achado que valida a decisão de conviver:** o programa consome a folha de ponto como
   **documento comprobatório anexado em PDF**. Ele não consome a nossa folha como sistema — então a
   folha oficial não precisa trocar de identidade para atender o programa. Um documento de apuração
   do período, gerado a partir das folhas mensais, é exatamente o artefato que o SGP pede.

### 3.3 Modelagem: "período de apuração" é entidade de primeira classe

A prática de mercado em sistemas de RH é tratar o esquema de período como cadastro — início, fim,
data de corte, data de pagamento —, com **vários esquemas convivendo na mesma organização** para
populações diferentes, e o calendário de períodos **gerado** a partir da regra, não derivado
ad-hoc em cada tela. É o que o §4 faz.

---

## 4. O desenho

### 4.0 O invariante que não pode ser quebrado

🚨 **O regime de apuração muda a JANELA DO DOCUMENTO, nunca o cálculo do dia.**

Atraso, hora extra, compensação (Art. 7º), autorização de extra (Art. 8º), abono, falta,
pré-assinalação, intervalo — tudo continua sendo decidido **por dia**, pelas mesmas funções, com as
mesmas regras e as mesmas vigências. O regime só decide **quais dias entram em qual documento**.

Se em algum momento o regime começar a mudar quanto vale um dia, o desenho saiu dos trilhos: o
mesmo dia passaria a valer coisas diferentes na folha mensal e na apuração, e o servidor assinaria
dois números.

### 4.1 O regime, ancorado no vínculo (não no setor)

```
folha_regimes                        catálogo (ninguém digita o número solto)
  id, nome                           'Mês civil', 'Mais Médicos (21→20)'
  dia_corte  smallint NULL           NULL = último dia do mês (o padrão de hoje)
  descricao, ativo
  CHECK (dia_corte IS NULL OR dia_corte BETWEEN 1 AND 28)

servidores_regime_apuracao           a atribuição, COM VIGÊNCIA
  servidor_id, regime_id
  vigencia_inicio date, vigencia_fim date NULL
  motivo text NOT NULL, criado_por_id
  índice único parcial: um regime vigente por servidor numa data

servidores_regime_apuracao_historico append-only, sem policy de escrita
```

⚠️ **`dia_corte` para em 28 de propósito.** Corte em 29, 30 ou 31 não existe em fevereiro, e um
período que às vezes tem corte e às vezes não é um período que ninguém consegue conferir. Mês civil
não é "corte 31": é `dia_corte IS NULL`, que significa "último dia, qualquer que seja".

⚠️ **A vigência não é zelo — é a lição da jornada do mês (19/08/2026).** `escala_mensal.jornada_id`
não tem vigência, e trocá-la no dia 12 reescreve a premissa dos dias 1 a 11. Um regime sem vigência
faria a mesma coisa: quem entrasse no Mais Médicos em setembro teria as apurações de agosto
reinterpretadas. E remover a atribuição é ato registrado, como `fn_excluir_vigencia_jornada` já é.

⚠️ **Mês civil é ausência de linha, não uma linha para cada um dos 2.647 ativos.**
`fn_regime_apuracao_servidor` devolve o regime padrão quando não há atribuição vigente — senão
qualquer servidor novo nasce sem regime e a apuração dele falha em silêncio.

🚨 **A VIGÊNCIA GLOBAL (`servidor_id NULL`), acrescentada em 16/09/2026 depois da resposta da Fase
0.** Como o corte **já valeu para o município inteiro** e pode voltar, a resolução tem **três**
níveis, do mais específico ao mais geral — e os dois primeiros têm vigência:

| nível | de onde vem | para que serve |
|---|---|---|
| 1 | linha com `servidor_id = <servidor>` | o caso do Mais Médicos: 4 linhas |
| 2 | linha com **`servidor_id NULL`** | liga o corte para a **rede inteira** com **uma** linha, com vigência e histórico |
| 3 | `folha_regimes.padrao` (Mês civil) | o fallback duro, para quem não tem nem 1 nem 2 |

Sem o nível 2, voltar ao 21→20 no município exigiria 2.647 linhas — e a data de cada uma seria
uma chance de errar. Com ele, é um ato registrado só. ⚠️ **Atribuição global é só
`super_admin`/`rh`**: ela muda o documento de pagamento de toda a rede, então não entra no escopo
por unidade (que vale para o nível 1, por `fn_escopo_gestao_alcanca`).

**Por que não o setor** (a ideia inicial, e as quatro razões são medidas ou registradas):

| razão | evidência |
|---|---|
| o setor **dita o escopo do relógio** | o setor `MAIS MEDICOS` não está em `dispositivos_rep_setores`; vincular setores àquele relógio cria o ponto cego do HMM-03 (§2.3) |
| **dois regimes no mesmo setor são inevitáveis** | um médico do programa e um concursado dividindo o `AMBULATÓRIO CLÍNICO`; um setor não tem dois regimes |
| tira a pessoa do lugar onde ela atende | dimensionamento (`servidores_manha_min/ideal/max`), Cobertura da Escala e relatórios por setor passam a mentir |
| trocar de regime passaria a **mexer em escala** | mudar de setor move ou divide `escala_mensal` (armadilha 47); mudar de regime não deveria tocar em escala nenhuma |

E a razão conceitual, que é a mais forte: **regime de apuração é propriedade do contrato.** Como
`servidores` é uma linha por vínculo (armadilha 50), quem tem duplo vínculo pode ser Mais Médicos
num e concursado no outro — que é o certo, e é impossível de expressar no setor.

### 4.2 O período, derivado por função pura

```sql
fn_periodo_apuracao(p_regime_id uuid, p_mes int, p_ano int)
  RETURNS (inicio date, fim date, rotulo text)
```

Convenção: **a apuração é nomeada pela competência em que ela FECHA.** A apuração de **09/2026** do
regime 21→20 vai de **21/08/2026 a 20/09/2026**.

⚠️ **Essa convenção tem de ser escolhida uma vez e escrita em toda tela.** A outra leitura (nomear
pelo mês em que abre) é igualmente defensável e produz um documento deslocado de um mês — e a
diferença só aparece quando alguém compara o PDF com o extrato do pagamento. O rótulo impresso
nunca é só "09/2026": é **"Apuração 21/08/2026 a 20/09/2026"**, com as duas datas por extenso.

Para `dia_corte IS NULL`, a função devolve o primeiro e o último dia do mês — ou seja, **o mês civil
é um caso do período**, não um caminho separado. Isso é o que impede as duas metades do código de
divergirem (a lição das 37 mil horas de 05/09/2026: duas cópias certas e uma errada).

### 4.3 A apuração é um SNAPSHOT emitido, não uma folha nova

```
folha_apuracoes                      o documento, append-only por versão
  id, servidor_id, regime_id
  competencia_mes, competencia_ano    a competência em que fecha
  periodo_inicio, periodo_fim
  versao smallint                     1, 2, 3... retificação nunca sobrescreve
  registros jsonb                     o snapshot dos dias, exatamente como impresso
  totais jsonb                        horas normais, extra 50/100, faltas, abono — em MINUTOS
  folhas_origem uuid[]                as folha_ponto que a alimentaram
  fingerprint text                    para detectar divergência depois
  emitido_por_id, emitido_em
  revogado_em, revogado_por_id, revogado_motivo
```

🚨 **Por que snapshot e não view: a folha é viva, e o documento assinado não pode ser.** A metade de
setembro ainda recebe batida, reconciliação e decisão de compensação. Se o documento fosse uma view,
o PDF entregue ao programa em 21/09 e o mesmo PDF reimpresso em 05/10 poderiam divergir — e nenhum
dos dois saberia dizer qual foi entregue.

🚨 **E por que NÃO congelar a folha:** a tentação é travar os dias ≤ 20 assim que a apuração sai.
Isso está **descartado** (§6.3) — é a mesma armadilha de preservar campo de origem `real`, que
"parece conservador e é o oposto": congelar impede a folha de receber a correção de uma batida mal
alocada. O snapshot resolve o problema sem congelar nada, e uma correção posterior aparece como
**divergência**, resolvida por uma **retificação** (versão 2), que é justamente o que a Portaria
4.198/2022 art. 101-B II descreve — desconto devolvido depois do dia 20.

### 4.4 O recorte, com fonte única

```
src/utils/folha/periodoApuracao.ts     (espelho de fn_periodo_apuracao)
  janelaDoPeriodo(regime, mes, ano)      -> { inicio, fim, rotulo }
  diasDoPeriodo(janela)                  -> [{ data, dia, mes, ano }]  em ordem de DATA
  montarApuracao(janela, folhas)         -> { registros, totais, lacunas, pendencias }
```

Cada linha do snapshot carrega **a data ISO ao lado do `dia`**:

```json
{ "data": "2026-08-21", "dia": 21, "dia_semana": "Sex", "competencia": "2026-08" }
```

⚠️ **O `dia` fica, e não por preguiça:** é ele que casa com `folha_ponto.registros` e com
`escala_diaria.dia` na hora de rastrear a origem. O que a `data` faz é dar **ordem** e **leitura
humana** — sem ela, ordenar por `dia` põe setembro antes de agosto (§2.2), e um "dia 5" no meio do
documento não diz de que mês é.

⚠️ **Os totais vão em MINUTOS no snapshot.** `folha_ponto.total_horas_*` é `NUMERIC(6,2)`, e de
`0.18h` não se recupera `11 min` — a folha já aprendeu isso (v2.47.0) e os dois renderizadores
recalculam de `registros`. A apuração **nunca** soma `total_horas_*`: ela soma os registros.

### 4.5 Os cinco casos de borda que a montagem tem de tratar, não ignorar

| caso | o que a apuração faz |
|---|---|
| **falta uma das metades** (servidor admitido dia 05/09) | emite **parcial**, listando explicitamente os dias sem folha. Não é erro, e não é zero |
| **duas folhas na mesma metade** (transferência dividiu a escala) | soma as duas e **imprime as duas lotações**, com a data da mudança. Escolher uma é apagar metade do mês de alguém |
| **setor/unidade/jornada diferentes entre as metades** | o cabeçalho diz "de X até dd/mm, Y a partir de dd/mm" — nunca um só, nunca o mais recente |
| **metade em competência encerrada** | entra normalmente (**é leitura**), marcada como congelada. É o estado desejável: o lado velho não se move mais |
| **decisão pendente no período** (compensação Art. 7º, autorização de extra Art. 8º) | a emissão **lista as pendências e exige confirmação**, exatamente como `salvarFolhaPonto` já cobra no fechamento. Emitir com pendência é entregar número que ainda vai mudar |

🚨 **Compensação de atraso NÃO atravessa a fronteira das metades.** A compensação é **do próprio
dia** (decisão de 04/09/2026), e "não construir saldo que atravessa competência" é regra escrita.
Um atraso do dia 22/08 não pode ser reposto com hora extra do dia 03/09 dentro da apuração — isso
seria banco de horas por outro nome, que segue sem decisão jurídica.

### 4.6 A tela

`/folha-ponto` ganha, **sem mudar nada do que já faz**, uma aba **Apurações**:

- lista os servidores com regime diferente do mês civil na competência escolhida, com a janela
  escrita por extenso;
- **prévia antes de emitir** — os dias, os totais, as lacunas e as pendências —, e nada é gravado
  até o clique (o padrão de "Preencher pelas Batidas");
- emitir → PDF do período (reusa a impressão em lote, que **já aceita vários ids**);
- reimprimir uma versão emitida sai do **snapshot**, nunca da folha de hoje;
- **divergência sinalizada**: "emitida em 21/09 com 176h20; a folha hoje diz 177h05" → botão
  *Retificar*, que cria a versão 2 com motivo escrito.

Quem emite: o mesmo público que fecha folha (`super_admin`, `rh`, `rh_unidade` no escopo, `admin`
no escopo) — resolvido por `src/utils/escopoGestao.ts`, nunca por allowlist nova (armadilhas 44 e
62).

### 4.7 🚨 O período atravessa o corte de VIGÊNCIA das regras de folha (achado em 16/09/2026)

**Isto não estava no plano de 14/09 e é a coisa mais importante para quem escrever a Fase 2.**

As três chaves que regem o cálculo do dia valem **desde 2026-09**:
`horas_normais_liquidas_desde`, `compensacao_atraso_vigente_desde` e
`autorizacao_extra_vigente_desde`. O período 21/08→20/09 fica com uma metade de cada lado do
corte. Medido nas folhas reais dos 4 médicos:

| metade | horas normais por dia | regra |
|---|---|---|
| dias 21..31/**08** (folha `Revisada`) | **10,00 h** | vão bruto da jornada `08H ÀS 18H` |
| dias 1..20/**09** (folha `Rascunho`) | **7,58–7,60 h** | líquido, descontado o intervalo de 120 min |

E **`totaisFolha(registros, opcoes)` recebe UMA competência e UMA carga por dia.** Chamá-la uma
vez sobre os 31 dias aplicaria a régua de setembro aos dias de agosto:

| servidor | pela folha (10h) | recalculado (8h) | diferença |
|---|---|---|---|
| T2600015 | 60h | 48h | **−12h** |
| T2600016 | 40h | 32h | −8h |
| T2600017 | 50h | 40h | −10h |
| T2600018 | 50h | 40h | −10h |
| | | | **−40h nas 4 apurações** |

Num documento que o servidor assina, e divergindo da folha de agosto que já está `Revisada`.

🚨 **A regra: `montarApuracao` chama `totaisFolha` UMA VEZ POR METADE e soma os resultados.** A
apuração **deriva** da folha; nunca recalcula. `metadesDoPeriodo(janela)`
(`src/utils/folha/periodoApuracao.ts`) devolve exatamente o recorte de cada competência, e o
portão tem uma regressão injetada que reproduz este defeito (*"metadesDoPeriodo devolve UMA
metade"*).

⚠️ **Não "conserte" isso uniformizando a régua.** Recalcular tudo pela regra nova daria um
documento internamente coerente e **errado**: o programa receberia um número que não existe em
folha nenhuma. Duas réguas dentro do período é o que a realidade tem, porque a mudança de regra
aconteceu no meio — e a folha mensal de cada lado está certa.

---

## 5. Opções consideradas

### 5.1 Âncora do regime

| opção | veredito |
|---|---|
| **servidor (vínculo) com vigência** | ✅ **escolhida** — §4.1 |
| setor | ❌ quatro razões medidas em §4.1; e o setor artificial que existe hoje é um ponto cego de relógio esperando acontecer |
| cargo | ❌ `MEDICO CLINICO` são **34 ativos** na rede e só 4 são do programa; o cargo não distingue |
| `financiamento_saude_blocos` | ❌ existe (18 blocos, 2.420 servidores) e a intuição de "grupo" é a certa — mas é **fonte orçamentária**, não há bloco do Mais Médicos, e um servidor tem um bloco só. Misturar orçamento com regime de ponto cria duas verdades |
| `vinculo` (`Contratada`) | ❌ **758 ativos** são `Contratada`; o campo não tem nada a ver com apuração |

### 5.2 Identidade da folha

| opção | veredito |
|---|---|
| **apuração convive com a folha mensal** | ✅ **escolhida** — não toca no eixo (mês, ano), respeita competência encerrada, é o que o SGP consome (PDF anexo) e é o que o art. 101-B descreve |
| `folha_ponto` ganha `periodo_inicio/fim` e atravessa duas escalas | ❌ quebra `unique_escala_mensal_id`, `fn_competencia_encerrada`, as **4 cópias da geração**, as **4 do recálculo**, o editor (`r.dia === dia`), os dois renderizadores e o Portal; e cria atrito com o regime de competência do eSocial |
| duas folhas parciais por mês (1..20 e 21..fim) para quem é do regime | ❌ a folha é única por `escala_mensal_id`, então exigiria **dividir a escala todo mês** — operação que mexe na grade e na folha (armadilha 47) por uma razão que é só de documento |
| planilha manual fora do sistema | ❌ é o que acontece hoje na prática, e é justamente o que produz número que ninguém consegue reconciliar com o ponto |

---

## 6. O que NÃO será feito, e por quê

### 6.1 A competência não muda

A folha de 08/2026 continua sendo 01→31/08. Nenhum total mensal, nenhuma hora extra, nenhuma falta
muda de lugar. **Conferência obrigatória da Fase 1:** `total_horas_normais` de todas as folhas de
08 e 09/2026 idêntico antes e depois — zero folhas alteradas.

### 6.2 A escala não muda

A grade continua mensal. O coordenador lança 09/2026 como sempre; a apuração recorta depois.

### 6.3 A folha não é congelada pela apuração

Ver §4.3. Congelar os dias já apurados impediria a correção de batida mal alocada, que é a coisa
que mais aparece nesta base. O snapshot + retificação dá o mesmo resultado sem esse preço.

### 6.4 Sem saldo que atravessa período

Ver §4.5. Nem compensação entre metades, nem banco de horas.

### 6.5 O setor `MAIS MEDICOS` não é apagado por este plano

Depois que o regime estiver no servidor, o setor perde a função — e o certo é os 4 voltarem a
`AMBULATÓRIO CLÍNICO`, que é onde atendem. Mas isso é **transferência de lotação com escala
lançada**, e o caminho é `fn_mover_escala_mensal` / `fn_dividir_escala_mensal` (nunca DELETE), com
`fn_fundir_setor` para o setor vazio no fim. **Fase 5, separada, com medição própria** — e só depois
que a apuração estiver funcionando, porque hoje o setor é o único marcador de quem é do programa.

---

## 7. Fases

### ✅ Fase 0 — Confirmar a norma e o formato — RESPONDIDA em 16/09/2026

- [x] **não existe norma nem ofício** — é convenção de anos, e a folha do município já operou
      assim. Ver o bloco no topo deste documento
- [x] **dia do corte: 20**; **competência = o mês em que o período FECHA** (21/08→20/09 é 09/2026)
- [x] quem assina: o documento é da Secretaria, não do programa — não há modelo obrigatório do SGP
- [ ] confirmar se os **4 medidos são a lista completa** do Mais Médicos hoje (fica para a hora de
      atribuir o regime; não bloqueia nada)

### ✅ Fase 1 — O regime (migration + cadastro) — IMPLEMENTADA em 16/09/2026

- `folha_regimes` com seed: `Mês civil` (`dia_corte NULL`, padrão) e `Mais Médicos (21→20)`
  (`dia_corte = 20`)
- `servidores_regime_apuracao` + histórico append-only sem policy de escrita
- `fn_regime_apuracao_servidor(servidor, data)` — fonte única, devolve o padrão sem atribuição
- `fn_periodo_apuracao(regime, mes, ano)` — pura
- `fn_atribuir_regime_apuracao` / `fn_encerrar_regime_apuracao` — motivo obrigatório
- `REVOKE ... FROM PUBLIC` nas quatro, na **mesma** migration (armadilha 24)
- espelho em `src/utils/folha/periodoApuracao.ts`
- tela: o regime vigente na ficha do servidor, com a janela escrita por extenso

**Portão:** `sim_periodo_apuracao.js` — **67 asserções**: janela de 21→20 nos 12 meses, virada de
ano, fevereiro (28 e 29 dias), `dia_corte NULL` = mês civil exato, **contiguidade dos períodos em
5 anos para 4 regimes**, vigência resolvida por data, os três níveis da resolução, e a varredura
que **reprova qualquer sítio novo** que derive a janela sem passar pela fonte única.
`val_sim_periodo_apuracao.js` injeta **9 regressões e exige reprovação nas 9**.
**A conferência da migration EXECUTA as funções** (armadilha 42) e confere os dois sentidos:
regime atribuído devolve 21→20, e servidor sem atribuição continua devolvendo o mês civil.

⚠️ **O início é "fim do período anterior + 1 dia", nunca "dia_corte + 1 do mês anterior".** Com
corte 28 em março o mês anterior é fevereiro e o dia 29 não existe — a formulação ingênua produz
data inválida. Somando um dia ao fim anterior a propriedade que importa sai de graça: **os períodos
consecutivos são contíguos e não se sobrepõem**, então nenhum dia de trabalho cai em dois
documentos nem em nenhum. O portão cobre isso, e o validador injeta a versão errada.

⚠️ **A leitura na ficha do servidor TOLERA a ausência das tabelas** (`regimeDisponivel`), e isso é
obrigatório: o deploy é automático a cada push e a migration é manual. Sem o guard, a ficha de todo
servidor quebraria na janela entre os dois. Pode sair depois que a migration estiver aplicada.

**Nada é visível ao usuário nesta fase além da ficha** — e nada muda de valor: enquanto ninguém
atribui regime, todos os 2.647 ativos continuam no mês civil, e a conferência da migration aborta
se isso deixar de ser verdade.

### ✅ Fase 2 — A montagem (leitura pura) — IMPLEMENTADA em 16/09/2026

- **`src/utils/folha/apuracaoPeriodo.ts`** — `montarApuracao`, `descreverApuracao`,
  `requerConfirmacao`, com os cinco casos de borda de §4.5
- **`apuracaoActions.ts`** — `previaApuracaoPeriodo`, leitura pura com `createClient()` (a RLS da
  folha é o que impede ler folha fora do escopo)
- **prévia em tela**, na própria seção da ficha, sem botão de emitir

🚨 **A montagem ficou em TypeScript, NÃO numa RPC — e isso é uma mudança em relação ao esboço
deste plano.** A razão: os totais exigem `totaisFolha`/`calcularDia`, que são a fonte única do
cálculo do dia (atraso, compensação, autorização de extra, abono, falta). Reimplementar aquilo em
SQL seria uma segunda opinião sobre a mesma pergunta — exatamente o que produziu as 37 mil horas
de divergência em 05/09/2026. **O banco entrega as peças (janela, folhas, vigências); o TypeScript
monta.**

⚠️ **A prévia confere o espelho contra o banco e ABORTA se divergirem.** Se `janelaDoPeriodo` (TS)
e `fn_periodo_apuracao` (SQL) discordarem do recorte, a prévia recusa em vez de mostrar número —
senão o documento sairia com um recorte que a emissão não usaria.

**Medição obrigatória — feita em 16/09/2026** (`scratchpad/an_apuracao_mais_medicos.mjs`, com
`--corte20` para ensaiar o regime sem gravar nada). Bate com §2.4 e com §4.7:

| servidor | 08/2026 (11 dias, 10h/dia) | 09/2026 (20 dias, 8h/dia) | total | com régua única |
|---|---|---|---|---|
| T2600015 | 60h00 | 88h00 | **148h00** | 136h00 (−12h) |
| T2600016 | 40h00 | 96h00 | **136h00** | 128h00 (−8h) |
| T2600017 | 50h00 | 96h00 | **146h00** | 136h00 (−10h) |
| T2600018 | 50h00 | 88h00 | **138h00** | 128h00 (−10h) |
| | | | | **−40h** |

As −40h são **o mesmo número** que a medição independente de §4.7 achou por outro caminho — duas
contas diferentes chegando ao mesmo lugar.

✅ **E o caso de borda 3 apareceu sozinho no dado real:** a lotação muda no meio do período
(`AMBULATÓRIO CLÍNICO` em 08/2026 → `MAIS MEDICOS` em 09/2026, por causa da transferência de
09/09). As duas vão no documento, como o §4.5 exige.

⚠️ **Achado ao escrever a medição:** a primeira versão do script comparava usando `diasComRegistro`
(dias com **linha** na folha, que são 31) em vez de dias com **turno** (17). O "prejuízo" saía como
100h em vez de 12h. Número errado em script de medição é o que produz relatório falso — a conta
certa divide `normaisMinutos` pela carga da metade.

**Portões:** `node scratchpad/sim_apuracao_periodo.js` (**67 asserções**) e
`val_sim_apuracao_periodo.js` (**10 regressões injetadas, 10 reprovadas**), entre elas a que
aplica a régua de uma competência ao período todo. Transpile antes com
`npx tsc src/utils/folha/apuracaoPeriodo.ts --outDir scratchpad/_sim --module commonjs --target es2020 --skipLibCheck`.

### ✅ Fase 3 — Emitir, imprimir e retificar — IMPLEMENTADA em 16/09/2026

`20260916120000_emitir_apuracao_do_periodo.sql` — **aplicada e conferida em produção**
(`scratchpad/ver_apuracao_producao.mjs`, **20 de 20**, executando as funções).

| peça | o quê |
|---|---|
| `folha_apuracoes` | o documento: snapshot por versão, append-only, com autoria e `fingerprint` |
| `fn_pode_emitir_apuracao` | allowlist de papel + escopo (`admin` e `rh_unidade` só na unidade deles) |
| `fn_apuracao_conferencia` | o que o banco vê no período — é ela que recusa payload forjado |
| `fn_emitir_apuracao` / `fn_retificar_apuracao` / `fn_revogar_apuracao` | os três atos |
| `fn_apuracoes_competencia` | a listagem da tela |
| `fingerprintApuracao` / `compararComEmitido` | a detecção de divergência, no TypeScript |
| `/folha-ponto/apuracoes` | a tela: prévia, emitir, imprimir, retificar, revogar |

🚨 **Onde mora a confiança, já que os totais vêm do TypeScript.** Não dá para o SQL recalcular
(seria a segunda opinião que o §4.7 proíbe), então a RPC **confere o que o SQL sabe**: a janela vem
do banco (nunca do payload), o número de dias tem de ser o do período, e **`dias_com_linha` é
conferido contra `folha_ponto`**. Um documento que afirma 20 dias trabalhados onde a folha tem 5 é
recusado. O que passa fica com autoria, versão e fingerprint — auditável contra a folha.

⚠️ **Append-only com UMA exceção estreita: revogar.** A comparação do trigger é **estrutural**
(`to_jsonb(NEW)` menos as três colunas de revogação), não uma lista de campos que envelhece —
acrescentar coluna à tabela não abre brecha. E revogação **não se desfaz**.

⚠️ **Reimprimir sai do SNAPSHOT, nunca da folha de hoje.** É isso que faz o PDF de outubro ser
idêntico ao entregue em setembro. Se a folha mudou, a tela **avisa o que mudou** e oferece
retificar; ela não corrige o documento por conta própria.

⚠️ **O fingerprint NÃO inclui o id da folha**, de propósito: sincronizar a folha sem alterar
horário nenhum não pode aparecer como divergência, senão o aviso vira ruído e ninguém mais olha.

⚠️ **A verificação em produção NÃO testa o append-only, e isso é decisão registrada.** Testar por
fora exigiria inserir uma linha que depois não sairia (o trigger recusa `DELETE`, e revogar exige
papel): a sonda ficaria para sempre numa tabela de documento, indistinguível de emissão real. Quem
garante o append-only é a conferência **dentro** da migration, que aborta e não deixa rastro.

**Portões:** `sim_apuracao_periodo.js` (**87 asserções**) e `val_sim_apuracao_periodo.js`
(**15 regressões, 15 reprovadas**).

⚠️ **Duas regressões ESCAPARAM na primeira rodada, e as duas eram defeito do portão** — vale
guardar, porque é a armadilha 48/57 aparecendo de novo:
- *"o fingerprint ignora os horários"* passou porque o teste mudava um campo via
  `montarApuracao`, e mudar a entrada muda o **atraso**, que entra nos totais, que também estão no
  hash. O hash mudava mesmo com o campo fora dele. A correção foi comparar dois documentos com
  **totais idênticos** que diferem só no campo — hoje os 8 campos do dia são testados um a um.
- *"o fingerprint ignora a janela"* escapou **com razão**: cada linha já carrega `d.data`, então a
  janela no texto é redundante. A injeção foi **removida** em vez de forçada — injeção que não muda
  comportamento observável é injeção inútil.

### ✅ Fase 4 — Manual do usuário — FEITA no mesmo commit

🚨 Toda mudança que altera o que o usuário vê ou faz entra no manual **no mesmo commit** (decisão
de 06/09/2026). Aqui: o que é regime de apuração, por que a folha mensal **não muda**, como emitir,
o que significa divergência, e **por que retificar não é corrigir a folha**.

O portão do manual (`sim_manual.js`) tem checagem de cobertura das telas e **reprova tela nova não
citada** — então a aba Apurações precisa entrar na lista `TELAS` junto com o texto.

### Fase 5 — Devolver os 4 ao setor real (opcional, medição própria)

Ver §6.5. Só depois de a Fase 3 estar em produção.

---

## 8. Armadilhas antecipadas

| # | armadilha | defesa |
|---|---|---|
| 1 | **`sort` por `dia`** põe setembro antes de agosto | ordenar por `data`; o portão testa a ordem numa virada de mês |
| 2 | **fuso**: `new Date(iso).getDate()` no servidor erra por 3h (o container roda em UTC) | `dataISOLocal()` / `formatarData` da fonte única de `horario.ts`; nunca `toLocale*` cru |
| 3 | **PostgREST corta em 1000 linhas em silêncio** — 1.244 folhas só em 09/2026 | `src/utils/paginacao.ts`, com `order` (sem ele a linha repete numa página e falta na outra) |
| 4 | ler `total_horas_*` (decimal de 2 casas) em vez de recalcular | somar `registros`, em minutos (§4.4) |
| 5 | **função nova nasce executável por `anon`** (`CREATE FUNCTION` concede a PUBLIC) | `REVOKE ... FROM PUBLIC` na mesma migration, com a conferência checando os dois sentidos |
| 6 | `RETURNS TABLE` cria variável com o nome da coluna → `42702` na execução | `#variable_conflict use_column`, e a conferência **executa** a função |
| 7 | escrever numa coluna sem ler a definição dela (`NOT NULL`, CHECK) | `grep` na definição antes; restrição só aparece na execução |
| 8 | **relatar o que foi calculado, não o que mudou** | a emissão relata dias emitidos, lacunas e pendências, com o motivo de cada exclusão |
| 9 | tela filtrada não protege a RPC (server action é POST chamável direto) | cada RPC autoriza sozinha; a tela é conveniência |
| 10 | assinatura nova de função é objeto novo — `GRANT` não é herdado, e duas sobrecargas dão `PGRST203` | `DROP` da antiga + `REVOKE`/`GRANT` reescritos |
| 11 | **regime sem vigência reescreve o passado** | vigência obrigatória, e remover é ato registrado |
| 12 | dois regimes para a mesma pessoa na mesma data | índice único parcial, e a RPC recusa nomeando o vigente |

---

## 9. Conferências que a implementação tem de passar

1. **Nada mudou na folha mensal** — `total_horas_normais`, `total_horas_extras_50/100` e
   `total_faltas` idênticos em todas as folhas de 08 e 09/2026, antes e depois da Fase 1.
2. **O recorte bate com o dado real** — §2.4, dia a dia, nos 4 médicos.
3. **Servidor sem regime continua no mês civil** — `fn_periodo_apuracao` com `dia_corte NULL`
   devolve exatamente 01→último dia, nos 12 meses e em ano bissexto.
4. **`anon` recebe 401** em todas as funções novas, conferido por fora com a chave pública.
5. **Competência encerrada não é escrita** — emitir apuração que cobre 06 ou 07/2026 não altera
   nada naquelas folhas.
6. **Reemitir é idempotente na versão** — segunda emissão sem mudança não cria versão 2.
7. **Escopo** — `rh_unidade` só vê e emite apuração de servidor das unidades dele.

---

## 10. Pendências e riscos

- 🚨 **A norma do corte não foi localizada** (§3.2). O desenho aceita qualquer dia, mas o documento
  para o programa depende dela. **Fase 0.**
- ⚠️ **A convenção de nome da apuração** (fecha em 09/2026 = 21/08→20/09) é escolha, não dedução.
  Confirmar com o RH antes da Fase 3.
- ⚠️ **O setor `MAIS MEDICOS` é hoje o único marcador do grupo.** Enquanto a Fase 1 não tiver
  atribuído o regime aos 4, não mexa nele.
- ⚠️ **O relógio da USF ENFERMEIRA ZEZINHA atende a unidade inteira** (§2.3). Se alguém vincular
  setores àquele relógio antes da Fase 5, os 4 médicos saem da Cobertura de Ponto em silêncio.
- ℹ️ **Produção é viva** — 1.244 folhas em 09/2026 e crescendo. Remeça antes de decidir com base em
  qualquer número deste plano.
- ℹ️ Em aberto, fora do escopo: se o RH quiser **fechar a folha mensal no dia 20** (e não só emitir
  o documento), isso é a Opção 5.2-b e exige decisão jurídica sobre a competência do eSocial.

---

## Fontes

- [Portaria MTP nº 4.198, de 19/12/2022 (texto)](https://www.normaslegais.com.br/legislacao/portaria-mtp-4198-2022.htm)
- [Fechamento de ponto no dia 20 — Portaria nº 4.198/22 (art. 101-B comentado)](https://www.insoft4.com.br/blog/fechamento-de-ponto-no-dia-20)
- [Apuração do ponto de 21 a 20 no eSocial](https://vanin.com/noticias/apuracao-do-ponto-de-21-a-20-no-esocial)
- [Período de apuração de ponto e pagamento da folha em vias de eSocial](https://www.contabeis.com.br/artigos/3963/periodo-de-apuracao-de-ponto-e-pagamento-da-folha-do-mes-em-vias-de-esocial/)
- [Pagamento Mais Médicos — Ministério da Saúde](https://www.gov.br/saude/pt-br/composicao/sgtes/mais-medicos/medico-e-medica/pagamento)
- [Gestor e Gestora — Mais Médicos (e-Gestor/SGP)](https://www.gov.br/saude/pt-br/composicao/sgtes/mais-medicos/gestor-e-gestora)
- [Procedimentos aos gestores municipais — Médicos pelo Brasil (COSEMS/SP)](https://www.cosemssp.org.br/noticias/procedimentos-a-serem-adotados-pelos-gestores-municipais-aderidos-ao-programa-medicos-pelo-brasil/)
- [Payroll schedules e cutoff dates (modelagem de período)](https://www.playroll.com/blog/payroll-schedule)
