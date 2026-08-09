# Triagem das solicitações dos usuários — 08/08/2026

Origem: lista de solicitações e questionamentos enviada pelo HMM, acompanhada de três documentos:

| documento | o que é | para que serve aqui |
|---|---|---|
| `PLANTÕES - FUNDAMENTAL, MÉDIO E SUPERIOR - 06/2026.pdf` | relação consolidada de plantões/sobreavisos com valores | define as **colunas e os valores** que o pedido REL‑1 quer no sistema |
| `1 - FREQUÊNCIA de JULHO - CONCURSADOS.pdf` | folha de frequência de 601 servidores | mostra o que hoje é preenchido **à mão** (HE 100%/50%, adic. noturno, faltas, observações de afastamento) |
| `SEI_2207801_Oficio_Circular_1.pdf` | Ofício nº 1/2026/SMS‑DMAC | **norma externa** que especifica o formato obrigatório da relação a partir da competência de julho/2026 |

> **Este documento não implementa nada.** Ele classifica os 24 pedidos, registra o que foi
> conferido no código e no banco, e isola as decisões que dependem do usuário.

## Status — 08/08/2026

**Aguardando as respostas do solicitante. Nenhuma linha de código foi escrita**, inclusive a
Onda 1, por decisão do usuário (evitar retrabalho caso alguma ressalva mude o entendimento).

O formulário respondível está publicado como artifact de **link público**:
<https://claude.ai/code/artifact/77287398-114e-4a33-b40e-c1699b4a5f3e>

Ele espelha este documento e coleta, por pergunta, a opção escolhida + texto livre, mais uma
ressalva por pedido. O retorno vem por **copiar-e-colar** — o solicitante envia o texto de volta.

⚠️ **Anexo de arquivo dentro da página é incompatível com link público.** A plataforma recusa a
capacidade `downloads` (e a `mcp`) em artifact compartilhado publicamente, e não há capacidade de
armazenamento nesta conta — ou seja, **as respostas nunca chegam sozinhas**, em nenhum cenário.
A página detecta a capacidade em tempo de execução e esconde os botões de anexo quando ela falta.
Prints devem vir por e-mail, citando o número da pergunta (R‑11, R‑22, R‑31, R‑34 são os que mais
dependem disso).

---

## 1. Legenda de classificação

| símbolo | significado | o que acontece a seguir |
|---|---|---|
| 🟢 | **Procede — escopo claro** | fundamento confirmado no código; pode virar especificação |
| 🟡 | **Procede com ressalva** | o pedido é válido, mas existe uma escolha que muda o resultado |
| 🔵 | **Já existe / é configuração** | provavelmente não é mudança de código |
| 🟠 | **Ambíguo** | não dá para decidir sem esclarecimento do solicitante |
| 🔴 | **Não implementar como pedido** | conflita com regra legal ou com defesa existente |

## 2. Placar

| classificação | quantidade | quais |
|---|---|---|
| 🟢 Procede — escopo claro | 13 | FL‑1, FL‑5, FL‑6, ESC‑1, ESC‑2, ESC‑5, ESC‑6, ESC‑7, ESC‑8, ESC‑10, REL‑2, REL‑3, REL‑4 |
| 🟡 Procede com ressalva | 9 | FL‑3, FL‑4, ESC‑3, ESC‑4, ESC‑9, AF‑1, REQ‑1, SRV‑1, REL‑1 |
| 🔵 Já existe / configuração | 1 | FL‑2 (metade A) |
| 🟠 Ambíguo | 1 | ESC‑11 |
| **total de pedidos** | **24** | |
| 🔴 Não implementar como pedido | 1 | **sub‑item** ESC‑1b — não é um dos 24 |

**Resíduos:** 36 perguntas ao todo, das quais **21 bloqueiam** a implementação do item
correspondente (marcadas 🔴 na seção 10).

Nenhum pedido é descartável por completo. Um único sub‑item (elevar o teto de 2h de hora extra)
esbarra em regra legal e não pode ser atendido sem decisão jurídica.

---

## 3. Módulo Férias e Licenças

### FL‑1 · Corrigir layout de impressão da programação — 🟢

**Conferido.** [`ferias-licencas/page.tsx:545`](../../src/app/(dashboard)/ferias-licencas/page.tsx#L545)
chama `window.print()` **cru**, sem folha de estilo de impressão, sem `@page`, sem view dedicada.
Imprime a tela inteira — filtros, abas, botões, cores de tema escuro.

Já existe o modelo certo no projeto: [`ScalePrintView.tsx`](../../src/components/ScalePrintView.tsx)
usa `createPortal` + `@page` + supressão da árvore da aplicação. É replicar o padrão.

**Esforço:** baixo. **Risco:** nenhum (só apresentação).
**Resíduos:** R‑01.

### FL‑2 · Coordenador vê apenas a programação do próprio setor — 🔵 + 🟡 (pedido duplo)

O pedido tem **duas metades com vereditos diferentes**.

**Metade A — "apenas o próprio setor": 🔵 provavelmente já é o comportamento.**
A policy `coordenador_solicitacoes_all`
([`20260724000000`](../../supabase/migrations/20260724000000_add_solicitacoes_ferias_licencas.sql#L199))
já restringe por `profile_setores`, **exceto** quando `acesso_todos_setores = true`. Em homologação
o único coordenador está com `acesso_todos_setores = false` — ou seja, já vê só o próprio setor.
Se em produção o coordenador está vendo tudo, a causa é o **flag do perfil**, não o código.

**Metade B — "incluindo servidores externos que executam no setor": 🟡 é funcionalidade nova.**
Hoje `solicitacoes_ferias_licencas.setor_id` é o setor da **lotação**. Um servidor lotado em outro
setor mas escalado neste não aparece. O sistema tem como saber quem "executa no setor" —
`escala_mensal.setor_id` é independente de `servidores.setor_id` — mas falta definir o critério.

**Esforço:** A = zero (config); B = médio. **Risco:** B alarga visibilidade de dado pessoal.
**Resíduos:** R‑02, R‑03.

### FL‑3 · RH (Administrador) vê todos os setores da unidade — 🟡

**Conferido.** A policy `admin_solicitacoes_all` exige **unidade permitida E setor permitido**
(`acesso_todos_setores = true` OU o setor estar em `profile_setores`). Um admin com setores
restritos hoje **não** vê a unidade inteira. Em homologação os 2 admins estão com
`acesso_todos_setores = true`, então na prática já veem tudo.

Atender ao pedido literalmente significa **mudar a policy**: para `role = 'admin'`, escopo passa a
ser só a unidade, ignorando `profile_setores`. É uma decisão de segurança, não um ajuste de tela —
e afeta todas as telas que leem essa tabela.

**Esforço:** baixo (uma migration). **Risco:** médio — amplia acesso de forma permanente.
**Resíduos:** R‑04.

### FL‑4 · Coordenador insere período sem solicitação do portal — 🟡

Justificativa legítima e conhecida: servidor sem acesso ou sem familiaridade com tecnologia.

**A ressalva é de natureza probatória, não técnica.** Hoje a solicitação de férias nasce de um ato
do próprio servidor no portal. Se o coordenador passa a lançar em nome dele, o registro deixa de
ser declaração do servidor e vira declaração de terceiro — o mesmo padrão que já obrigou a
`fn_registrar_presenca_informada` a gravar origem e justificativa separadas, e que motivou a
v1.23.0 a tirar a folha editável do portal.

O caminho seguro já tem precedente no próprio sistema: **gravar a origem** (`portal` ×
`coordenador`), **quem lançou**, e **exigir justificativa** — como já se faz em
`ajuste_coordenador`. Isso não é burocracia: é o que permite responder "quem pediu estas férias?"
seis meses depois.

**Esforço:** médio. **Risco:** médio se a origem não for registrada; baixo se for.
**Resíduos:** R‑05, R‑06.

### FL‑5 · Coordenador emite o requerimento — 🟢 (depende de FL‑4)

[`RequerimentoPrintView.tsx`](../../src/components/RequerimentoPrintView.tsx) já existe e monta o
requerimento a partir de `solicitacao` + `servidor`. Só é usado no portal
([`PortalFeriasLicencasSection.tsx:305`](../../src/app/consultar-escala/PortalFeriasLicencasSection.tsx#L305)).
Reaproveitar na tela do dashboard é trabalho pequeno — o componente não depende do portal.

**Esforço:** baixo. **Risco:** baixo.
**Resíduos:** R‑07.

### FL‑6 · Portal não deve mostrar o 1/3 em Licença‑Prêmio — 🟢 **bug confirmado**

**Conferido.** Em
[`PortalFeriasLicencasSection.tsx:643‑655`](../../src/app/consultar-escala/PortalFeriasLicencasSection.tsx#L643)
o bloco do checkbox está **fora** do condicional `tipoBeneficio === 'ferias'`, que fecha na linha
imediatamente anterior. Renderiza sempre.

O Adicional Constitucional de 1/3 é da **Constituição, art. 7º, XVII — férias**. Não incide sobre
licença‑prêmio. Oferecer a opção induz o servidor a pedir algo que não existe.

Em homologação nenhuma licença‑prêmio foi gravada com `adicional_terco = true` (1 registro, sem a
marcação). **Produção não foi consultada** — precisa de autorização.

**Esforço:** trivial (mover uma chave). **Risco:** nenhum na correção; o resíduo é o passivo.
**Resíduos:** R‑08.

---

## 4. Módulo Escalas

### ESC‑1 · Legendas definidas para EXTRA não são aceitas — 🟢 causa raiz encontrada / 🔴 num sub‑item

Este foi o achado mais importante da triagem. **São dois problemas empilhados**, e só o primeiro
é bug.

**Causa 1 — comparação estrita contra um campo multivalorado (é bug).**
`dicionario_turnos.tipo` é uma **string separada por vírgula**. O sistema trata isso de forma
inconsistente:

| onde | como lê o `tipo` | efeito |
|---|---|---|
| montagem da lista de legendas — [`ScaleGrid.tsx:3911`](../../src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx#L3911) | `tipo.split(',').includes('Extra')` | o código **aparece** na lista |
| validação ao lançar — [`ScaleGrid.tsx:1192`](../../src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx#L1192) | `currentTurno.tipo !== 'Extra'` | o código é **recusado** |

O usuário vê a legenda na lista, clica, e recebe *"Apenas turnos do tipo Extra podem ser inseridos
na linha de Extras"*. Exatamente o sintoma relatado.

Medido em homologação — 64 códigos, 7 multivalorados, 2 deles com `Extra`:

```
MT   | Normal,Plantão,Extra | 12h  ← aparece na lista, é recusado
MT4  | Normal,Plantão,Extra | 10h  ← aparece na lista, é recusado
1, 1.5, 2, 1N, 1.5N, 2N | Extra (puro) | ≤2h  ← funcionam
```

**Causa 2 — teto de 2 horas (é regra, não bug).**
[`ScaleGrid.tsx:1198`](../../src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx#L1198)
recusa hora extra acima de 2h/dia (CLT art. 59). Mesmo corrigida a Causa 1, `MT` (12h) e `MT4`
(10h) **continuariam recusados** — e corretamente.

Ou seja: o pedido só é plenamente atendido pela Causa 1 se as legendas que o usuário quer usar
forem de até 2h. Se ele quer lançar `MT` de 12h como hora extra, o pedido real é **elevar o teto
legal — 🔴, não implementar sem decisão jurídica.** A hipótese mais provável é outra: `MT` e `MT4`
receberam o tipo `Extra` **por engano no cadastro de turnos**, e a correção é no cadastro.

**Bônus:** a linha [`1226`](../../src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx#L1226)
tem o mesmo defeito para `Sobreaviso`. Hoje não quebra porque nenhum código de sobreaviso é
multivalorado — quebra no dia em que criarem um.

**Esforço:** correção da Causa 1 = trivial. **Risco:** baixo.
**Resíduos:** R‑09, R‑10.

### ESC‑2 · Versão impressa corta informações — 🟢

**Conferido.** [`ScalePrintView.tsx:146‑148`](../../src/components/ScalePrintView.tsx#L146) define
`table-layout: fixed`, `overflow: hidden` e `white-space: nowrap`, com a coluna
`SERVIDOR / CARGO` travada em **150px** e cada dia em **26px**. Em paisagem, com 31 dias, texto
que não cabe é **cortado por construção** — não é falha eventual.

**Esforço:** médio (mexe em layout de impressão validado em uso).
**Resíduos:** R‑11 — **precisa do PDF real com o corte marcado.** Sem saber qual campo corta, a
correção vira tentativa e erro.

### ESC‑3 · Incluir NOME, CARGO, MATRÍCULA e REGISTRO PROFISSIONAL — 🟡

**Os dados já existem.** A tabela `servidores` tem `matricula`, `registro_profissional` e
`registro_profissional_orgao`. O PDF hoje imprime só nome + cargo
([`ScalePrintView.tsx:246‑249`](../../src/components/ScalePrintView.tsx#L246)).

**A ressalva:** este pedido e o ESC‑2 puxam para lados opostos. Acrescentar duas informações à
mesma coluna de 150px **agrava** o corte. Os dois precisam ser resolvidos juntos, com uma decisão
de layout — não em sequência.

**Esforço:** baixo isolado, médio junto com ESC‑2.
**Resíduos:** R‑12.

### ESC‑4 · Inserir turno Intermediário (I) no bloco SERVIDORES POR TURNO — 🟡

**Conferido, e o problema é maior que o pedido.**
[`ScaleGrid.tsx:817‑865`](../../src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx#L817)
conta os servidores por turno testando **letras no código** (`code.includes('M')`), e não o campo
`slots`, que é a fonte de verdade usada na detecção de conflito.

Dados de homologação:

| código | slots | conta hoje em | observação |
|---|---|---|---|
| `I` (11:00, 4h) | `[]` | **nada** | invisível no bloco — é o pedido |
| `IT4` (11:00, 8h) | `["T"]` | T | por acidente: a letra `T` está no código |
| `M4I` (07:00, 8h) | `["M"]` | M | idem |
| `1N` (1h extra noturna) | `[]` | **N** | conta como um servidor inteiro na noite |

Duas consequências que o pedido não menciona mas decorrem da mesma raiz:

1. `I` tem `slots = []` → **não gera conflito com nada**. Um servidor pode receber `I` (11h–15h) e
   `M` (manhã) no mesmo dia sem nenhum alerta.
2. `setores` só tem dimensionamento para manhã/tarde/noite
   (`servidores_manha_min/ideal/max`, …). Uma linha `I` no bloco **não teria alvo** de
   dimensionamento — apareceria sempre sem cor.

**Esforço:** médio. **Risco:** mexer em `shiftTotals` afeta o semáforo de dimensionamento da grade.
**Resíduos:** R‑13, R‑14.

### ESC‑5 · Escolher quais turnos aparecem no bloco — 🟢
### ESC‑6 · PDF com e sem os quantitativos — 🟢

Mesma família: opções de impressão. O bloco é renderizado incondicionalmente em
[`ScalePrintView.tsx:317‑363`](../../src/components/ScalePrintView.tsx#L317).

**Esforço:** baixo. **Risco:** nenhum.
**Resíduos:** R‑15 (escolha por impressão × preferência salva por setor — vale para ESC‑5, ESC‑6 e ESC‑9).

### ESC‑7 · Legenda com abreviações e siglas — 🟢

`dicionario_turnos` tem `codigo`, `descricao`, `horas_computadas` e `horario_inicio`. Dá para gerar
a legenda automaticamente — o exemplo do pedido (`MT — Manhã: 6h e Tarde: 6h`) é montável a partir
de `slots` + `horas_computadas`.

**Esforço:** baixo. **Resíduos:** R‑16.

### ESC‑8 · Bloco de detalhes de afastamento no PDF — 🟢 com alerta

Os dados existem (`servidores_eventos` + `tipos_eventos`) e já são carregados pelo componente de
impressão (`servidoresEventos`), hoje usados só para pintar a célula com a sigla de 3 letras
([`ScalePrintView.tsx:272`](../../src/components/ScalePrintView.tsx#L272)).

**Alerta:** o exemplo do pedido é `Atestado no período de 01/06 a 15/06`. A folha de frequência
anexada mostra que hoje já se escreve bem mais que isso à mão — *"Licença Saúde: 04/11/2024 a
11/07/2025 — Laudo Ipasemar nº 38/25. Perícia agendada para 13/10/2025"*. Motivo de afastamento é
**dado de saúde**. A escala circula por muito mais mãos que a folha de frequência.

Não é impedimento — é uma escolha que deve ser **consciente e registrada**, não um efeito colateral
do formato do relatório.

**Esforço:** baixo. **Resíduos:** R‑17.

### ESC‑9 · Não mostrar formatos de trabalho que o servidor não executa — 🟡

**O pedido parte de uma premissa que não se confirma.** Ele diz *"Servidor foi definido (no
cadastro) que só pode executar Carga Horária e Plantões"* — **esse campo não existe.** A tabela
`servidores` tem 52 colunas e nenhuma delas registra quais categorias o servidor pode executar. O
PDF imprime as 4 linhas (Regular / Extra / Plantão / Sobreaviso) para todo mundo, sempre
([`ScalePrintView.tsx:235`](../../src/components/ScalePrintView.tsx#L235)).

Então o pedido embute **duas coisas**: criar o cadastro dessa restrição, e depois usá‑lo na
impressão. A primeira é a parte grande.

**Esforço:** médio‑alto. **Risco:** se a restrição também **travar** o lançamento na grade (e não
só ocultar na impressão), vira regra de negócio com efeito sobre escalas já montadas.
**Resíduos:** R‑18, R‑19, R‑20.

### ESC‑10 · Renomear PLANEJADO para PREVISÃO — 🟢

`totalPlanejado` existe em
[`ScaleGrid.tsx:1553`](../../src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx#L1553)
e forma par com `totalValidado`. Trocar só o rótulo visível é trivial.

**Atenção pequena:** o par vira "Previsão × Validado", que mistura substantivo e particípio.
**Resíduos:** R‑21.

### ESC‑11 · Colocar cada quantitativo na sua respectiva linha — 🟠 **ambíguo**

Leitura mais provável: hoje os quantitativos (CH, HE 100%, HE 50%, PL12, PL6, PL4, SOB12) aparecem
agrupados num bloco lateral único, e o pedido é que o total de plantões apareça **na linha
"Plantões"**, o de extras **na linha "Extras"**, e assim por diante — alinhando o resumo às 4
linhas do servidor.

Não dá para confirmar sem ver a tela. **Resíduos:** R‑22.

---

## 5. Módulo Afastamentos

### AF‑1 · Lançamento e remoção apenas pelo RH — 🟡

**Conferido.** A policy atual é `"Coordinators and Admins can manage relevant servant events"`
([`20260528180000:224`](../../supabase/migrations/20260528180000_add_servidores_eventos.sql#L224)).
Restringir é tecnicamente simples — policy + condicional na tela.

**A ressalva é operacional, e é séria.** Atestado chega no sábado à noite; escala do domingo
depende dele. Hoje o coordenador resolve na hora. Passando ao RH, cria‑se uma fila com horário
comercial, e a escala fica errada no intervalo — justamente o dado que alimenta a folha de ponto.

Há também um efeito de segunda ordem: a tela já impede lançar afastamento sobre dia com presença
confirmada ([`afastamentos/page.tsx:369`](../../src/app/(dashboard)/afastamentos/page.tsx#L369)).
Quanto mais tarde o afastamento é lançado, mais provável que já exista batida no dia — e mais casos
caem nesse bloqueio, que exige intervenção manual.

O desenho que preserva as duas coisas: **coordenador solicita, RH homologa** — o mesmo padrão que a
v1.23.0 adotou para o ajuste de ponto do portal.

**Esforço:** baixo para restringir; médio para o fluxo solicita/homologa.
**Resíduos:** R‑23, R‑24, R‑25.

---

## 6. Novo módulo — requerimentos de outras licenças

### REQ‑1 · Emissão de requerimentos dos outros tipos de licenças — 🟡 escopo indefinido

O pedido não lista quais licenças. Isso não é detalhe: **cada licença tem base legal, prazo,
documento comprobatório e efeito próprio** sobre escala e folha. Maternidade (120–180 dias),
paternidade, nojo, gala, licença para tratar de interesse particular e acompanhamento de familiar
não compartilham nem o fluxo de aprovação nem o efeito no ponto.

**O sistema já tem as duas pontas.** Falta só o meio:

```
tipos_eventos (catálogo)  →  [requerimento: ausente]  →  servidores_eventos (afastamento na grade)
```

Isto é: um requerimento deferido deveria **gerar** o `servidores_eventos` correspondente, em vez de
alguém relançar à mão. Vale desenhar assim desde o início.

**Esforço:** alto. **Risco:** alto se o catálogo for aberto sem regra por tipo.
**Resíduos:** R‑26, R‑27, R‑28.

---

## 7. Módulo Servidores

### SRV‑1 · Definir nível de escolaridade/cargo para cálculo de valores — 🟡 **a distinção importa**

**O pedido junta duas coisas que o Ofício SMS separa.**

`servidores.escolaridade` **já existe** — um select de 9 opções (Fundamental Incompleto →
Doutorado). É atributo **da pessoa**.

Mas o Ofício nº 1/2026 classifica por **nível do cargo**: *Médicos / Nível Superior / Nível Médio /
Nível Fundamental*. E o PDF de plantões tem título *"PROFISSIONAIS DE NÍVEL FUNDAMENTAL E MÉDIO"* —
uma relação por faixa.

Não são a mesma coisa, e a diferença vale dinheiro: a folha de frequência anexada tem servidores
com "Ensino Superior Completo" ocupando cargo de *Agente de Serviços Gerais*. Se o valor do plantão
seguir a **escolaridade da pessoa**, essa pessoa é paga como nível superior. Se seguir o **cargo**,
é paga como fundamental. **Provavelmente é o cargo — mas isso precisa ser afirmado, não presumido.**

Já existe `cargos.nivel` (inteiro) e `cargos.codigo` na tabela `cargos`, mas `nivel` está
**fixado em 1** para todos ([`CargosClient.tsx:54`](../../src/app/(dashboard)/cargos/CargosClient.tsx#L54)) —
o campo existe e nunca foi usado. É o lugar natural para a faixa.

**Esforço:** baixo para o campo; o peso está em classificar os cargos existentes.
**Resíduos:** R‑29, R‑30.

---

## 8. Módulo Relatórios

> Observação transversal: [`relatorios/page.tsx:11`](../../src/app/(dashboard)/relatorios/page.tsx#L11)
> devolve `AcessoNegado` para **todo** coordenador. Se os pedidos abaixo vieram de coordenadores,
> eles hoje não têm acesso a relatório nenhum. Ver R‑35.

### REL‑1 · Relatórios com valores contábeis — 🟡 o maior item da lista

**Metade do caminho já existe.** `calculateTotals`
([`ScaleGrid.tsx:1421‑1560`](../../src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx#L1421))
já produz, por servidor, exatamente os quantitativos que o Ofício exige:

| coluna do Ofício / PDF | variável no sistema |
|---|---|
| PL 12H | `pl12` / `p_pl12` |
| PL 06H | `pl6` / `p_pl6` |
| PL 04H | `pl4` / `p_pl4` |
| SOB 12H | `so12` / `p_so12` |
| matrícula, nome, cargo, lotação | já em `servidores` |

**A metade que falta: não existe um único valor monetário em todo o sistema.** Varri
`configuracoes_globais` (22 chaves), `cargos`, `dicionario_turnos` e as migrations — nenhuma tabela
de preços. Do PDF se extrai a tabela de junho/2026 para nível Fundamental/Médio:

```
PL 12H = R$ 160,00     PL 06H = R$ 80,00     PL 04H = R$ 53,00     SOB 12H = R$  —
```

Falta também o agrupamento que o Ofício impõe: **três anexos** (Hospital Geral, CCE, UTI), cada um
com os servidores ordenados por Médicos → Superior → Médio → Fundamental, com total por setor e
total geral.

**A decisão mais séria do documento inteiro está aqui.** `calculateTotals` devolve dois números por
categoria: `p_pl12` (**planejado** — o que está na grade) e `pl12` (**validado** — o que teve
presença confirmada). Um relatório de pagamento construído sobre o planejado paga plantão que pode
não ter sido cumprido. Ver R‑32.

Vale registrar: o PDF anexado tem os subtotais **inconsistentes** com as linhas — o setor
"Núcleo de Formalização" soma `3 / 15 / 2` plantões mas só três servidores com 1 cada, e o TOTAL
GERAL acusa 60 sobreavisos com R$ 0,00. É uma planilha preenchida à mão. **Isso reforça o pedido em
vez de enfraquecê‑lo** — é exatamente o tipo de erro que a geração automática elimina.

**Esforço:** alto. **Risco:** alto — o resultado vira valor pago a servidor público.
**Resíduos:** R‑31, R‑32, R‑33, R‑34.

### REL‑2 · Personalização do relatório em tempo real — 🟢

Mostrar/ocultar colunas por checkbox (valores, HE, PL 04H…). Escopo claro, sem risco: é
apresentação sobre dado já calculado. Combina naturalmente com REL‑1.

**Esforço:** baixo. **Resíduos:** nenhum bloqueante.

### REL‑3 · Separar setores por blocos — 🟢

Além de melhorar a leitura, é **exigência do Ofício** (item 1.3: "valor total geral do respectivo
setor"). Deve ser tratado como parte de REL‑1, não como pedido cosmético.

**Esforço:** baixo dentro de REL‑1.

### REL‑4 · Comparativo de períodos personalizados — 🟢 com um esclarecimento

Escopo claro. Falta dizer **o que** se compara e **em que granularidade**.

**Esforço:** médio. **Resíduos:** R‑36.

---

## 9. Achados que ninguém pediu

Encontrados durante a triagem. Não fazem parte da lista do usuário; ficam registrados para decisão.

| # | achado | onde | gravidade |
|---|---|---|---|
| B‑1 | `tipo !== 'Sobreaviso'` tem o mesmo defeito do Extra (ESC‑1). Latente: quebra quando criarem um código de sobreaviso multivalorado | [`ScaleGrid.tsx:1226`](../../src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx#L1226) | média |
| B‑2 | O código `I` tem `slots = []` → **não conflita com nada**. `I` (11h–15h) e `M` no mesmo dia passam sem alerta | `dicionario_turnos` | média |
| B‑3 | `shiftTotals` conta por letra do código, não por `slots`. `1N` (1h extra noturna) conta como **um servidor inteiro** na noite, inflando o dimensionamento | [`ScaleGrid.tsx:840‑845`](../../src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx#L840) | média |
| B‑4 | `getProgramacaoAnualSetor` não aplica escopo no servidor — depende **exclusivamente** da RLS. Funciona hoje, mas não tem defesa em profundidade | [`ferias-licencas/actions.ts:426`](../../src/app/(dashboard)/ferias-licencas/actions.ts#L426) | baixa |
| B‑5 | Coordenador não acessa **nenhum** relatório | [`relatorios/page.tsx:11`](../../src/app/(dashboard)/relatorios/page.tsx#L11) | informativo |

---

## 10. Plano de resíduos — perguntas a responder

Agrupadas por quem consegue responder. **As marcadas 🔴 bloqueiam a implementação do item.**

### Bloco A — Impressão da escala (ESC‑2, ESC‑3, ESC‑7, ESC‑8)

| # | pergunta | por que muda o resultado |
|---|---|---|
| R‑11 🔴 | **Enviar o PDF impresso com o corte circulado.** Qual campo corta — nome, cargo, nome da jornada, código do turno? | corte é por `overflow:hidden` em coluna fixa; sem saber a coluna, a correção é chute |
| R‑12 🔴 | Matrícula e registro profissional devem entrar **na mesma coluna** (3ª/4ª linha sob o nome), em **coluna nova**, ou só no **cabeçalho**? | a coluna tem 150px e já corta (ESC‑2); os dois pedidos competem pelo mesmo espaço |
| R‑16 | A legenda deve trazer **só os códigos usados no mês** ou os 64 do dicionário? | 64 códigos ocupam página inteira |
| R‑17 🔴 | O bloco de afastamentos deve mostrar **o tipo** ("Licença Saúde") ou só "Afastado"? Quem recebe esse PDF? | motivo de afastamento é dado de saúde; a escala circula mais que a folha de frequência |
| R‑01 | A programação de férias imprime em **retrato ou paisagem**? Agrupada por setor? Inclui indeferidas/canceladas? Precisa de campo de assinatura? | define a estrutura da view de impressão |

### Bloco B — Grade e turnos (ESC‑1, ESC‑4, ESC‑9, ESC‑10, ESC‑11)

| # | pergunta | por que muda o resultado |
|---|---|---|
| R‑09 🔴 | **Quais legendas exatamente foram recusadas na linha de Extra?** | se forem ≤2h, é só o bug da vírgula; se forem `MT`/`MT4`, o pedido real é outro |
| R‑10 🔴 | `MT` (12h) e `MT4` (10h) estão marcados como tipo `Extra` no cadastro. Isso foi **intencional**? | se foi engano → corrige o cadastro. Se foi intencional → o pedido é elevar o teto de 2h, o que **não** será feito sem parecer jurídico |
| R‑13 🔴 | O turno `I` (11h–15h) deve contar como **Manhã**, como **Tarde**, em **ambos**, ou em **linha própria**? | define se é ajuste de contagem ou nova linha + novo dimensionamento |
| R‑14 | Se `I` virar linha própria: quais são o mínimo/ideal/máximo por setor? | `setores` só tem parâmetros para M/T/N; sem números a linha fica sempre sem cor |
| R‑18 🔴 | Os "formatos que o servidor executa" devem ser definidos **por servidor**, **por cargo** ou **por jornada**? | não existe nenhum campo hoje; a escolha define onde nasce o cadastro |
| R‑19 🔴 | A restrição **oculta apenas na impressão** ou também **impede o lançamento** na grade? | ocultar é cosmético; impedir é regra de negócio com efeito sobre escalas já montadas |
| R‑20 | E se já houver lançamento numa linha que passaria a ser oculta? Some do PDF, ou aparece com alerta? | ocultar silenciosamente esconde plantão já trabalhado — e pago |
| R‑21 | "Previsão × Validado" está bom, ou prefere "Previsto × Realizado"? | par de rótulos deve ser coerente |
| R‑22 🔴 | **Print da tela** mostrando onde os quantitativos aparecem hoje e onde deveriam aparecer | pedido não é interpretável sem a tela |
| R‑15 | ESC‑5/ESC‑6/ESC‑9: escolha **na hora de imprimir** (caixas no diálogo) ou **preferência salva por setor**? | muda de opção de UI para configuração persistida |

### Bloco C — Férias, licenças e afastamentos (FL‑2 a FL‑5, AF‑1, REQ‑1)

| # | pergunta | por que muda o resultado |
|---|---|---|
| R‑02 🔴 | **Autorização para consultar produção:** quais coordenadores estão com `acesso_todos_setores = true`? | se estiverem, FL‑2 é ajuste de perfil, não desenvolvimento |
| R‑03 🔴 | "Servidor externo que executa no setor" = tem **escala no setor** em qualquer mês do ano? no mês da férias? no mês corrente? | define a consulta; sem isso a lista fica errada nas bordas |
| R‑04 🔴 | Confirma que o Administrador (RH) deve ver **toda a unidade**, ignorando os setores atribuídos a ele? | é mudança permanente de policy, afeta todas as telas que leem a tabela |
| R‑05 🔴 | No lançamento pelo coordenador, o sistema deve registrar **quem lançou** e **por quê**? | sem isso não há como distinguir pedido do servidor de decisão de terceiro |
| R‑06 | A antecedência mínima (`antecedencia_minima_ferias_dias`) vale também para o lançamento manual? | hoje só vale no portal |
| R‑07 | O requerimento emitido pelo coordenador sai **em branco para assinatura** ou já preenchido com os dados do servidor? | muda o valor probatório do documento |
| R‑08 | Existe licença‑prêmio já gravada com o 1/3 marcado **em produção**? Se sim, corrigir retroativamente? | homologação tem 0 casos; produção não foi consultada |
| R‑23 🔴 | Com afastamento restrito ao RH, **quem lança o atestado que chega no fim de semana**? | escala do dia seguinte depende disso |
| R‑24 | Coordenador continua podendo **solicitar** (com RH homologando), ou perde o acesso por completo? | define se é restrição simples ou fluxo novo |
| R‑25 | Os afastamentos **já lançados por coordenadores** permanecem válidos? | há histórico em produção |
| R‑26 🔴 | **Lista exata** das licenças a incluir no novo módulo | cada tipo tem base legal, prazo e efeito distintos; sem a lista não há escopo |
| R‑27 | Para cada tipo: quem requer, quem defere, qual documento comprobatório, quantos dias? | é o corpo da especificação |
| R‑28 | O requerimento deferido deve **gerar automaticamente** o afastamento na grade? | é a integração que evita relançar à mão — e evita divergência |

### Bloco D — Valores, níveis e relatórios (SRV‑1, REL‑1, REL‑4)

| # | pergunta | por que muda o resultado |
|---|---|---|
| R‑29 🔴 | O valor do plantão segue o **cargo ocupado** ou a **escolaridade da pessoa**? | há servidor com Ensino Superior em cargo de nível fundamental — a escolha muda o valor pago |
| R‑30 🔴 | Confirma as 4 faixas do Ofício (Médicos / Superior / Médio / Fundamental)? Quem classifica os cargos existentes? | `cargos.nivel` existe e está fixo em 1 para todos; alguém precisa preencher |
| R‑31 🔴 | **Tabela de valores vigente e sua base legal** (decreto/portaria), por faixa e por tipo de plantão | o PDF só traz Fundamental/Médio de junho/2026. Falta Superior e Médicos |
| R‑32 🔴 | O relatório de valores usa o quantitativo **planejado** (o que está na grade) ou o **validado** (com presença confirmada)? | o sistema calcula os dois. Pagar pelo planejado paga plantão possivelmente não cumprido |
| R‑33 🔴 | SOB 12H tem valor? No PDF aparece **R$ 0,00** para 60 sobreavisos | se tem valor, qual; se não tem, por quê |
| R‑34 🔴 | "Hospital Geral", "CCE" e "UTI" correspondem a **unidades** ou a **setores** no SisEscala? Qual setor entra em qual anexo? | o Ofício exige três relações separadas; sem o mapa não há como agrupar |
| R‑35 | Coordenador deve passar a acessar relatórios? Quais? | hoje é `AcessoNegado` para todos |
| R‑36 | O comparativo (REL‑4) compara **horas, valores ou nº de plantões**? Por servidor, por setor ou total? | define as colunas do relatório |

---

## 11. Sequenciamento sugerido

Não é compromisso de entrega — é a ordem que minimiza retrabalho.

**Onda 1 — correções com causa confirmada, sem dependência de resposta**
`FL‑6` (checkbox 1/3) · `ESC‑1 Causa 1` (comparação de tipo, e o mesmo em Sobreaviso / B‑1) ·
`ESC‑10` (rótulo) · `FL‑1` (impressão da programação)

Quatro itens fechados, três deles triviais, todos com causa raiz localizada no código.

**Onda 2 — impressão da escala, tratada como um bloco só**
`ESC‑2` + `ESC‑3` + `ESC‑5` + `ESC‑6` + `ESC‑7` + `ESC‑8`

Depende de R‑11, R‑12, R‑15, R‑16, R‑17. Fazer em blocos separados significa mexer no mesmo layout
seis vezes.

**Onda 3 — escopo e permissão**
`FL‑2` · `FL‑3` · `FL‑4` · `FL‑5` · `AF‑1`

Depende do Bloco C. FL‑2/FL‑3 podem se resolver em configuração — vale checar antes de codificar.

**Onda 4 — contagem por turno**
`ESC‑4` (+ B‑2, B‑3, que têm a mesma raiz)

Depende de R‑13 e R‑14.

**Onda 5 — valores contábeis**
`SRV‑1` → `REL‑1` → `REL‑2` → `REL‑3` → `REL‑4`

Nesta ordem obrigatoriamente: sem a faixa do cargo (SRV‑1) não há como precificar. Depende de todo
o Bloco D. É o item de maior risco da lista — o resultado é valor pago a servidor público.

**Onda 6 — módulo novo**
`REQ‑1` · `ESC‑9`

Os dois exigem cadastro que ainda não existe. Não começam antes das ondas anteriores estabilizarem.

---

## 12. O que este documento não faz

- Não altera código nem banco.
- Não consultou **produção** — todas as medições são de homologação
  (`mtgfmxsbsyknotvwzdcr`). Os schemas divergem; ver armadilha 3 do `CLAUDE.md`.
- Não estima prazo. "Esforço baixo/médio/alto" é ordem de grandeza relativa, não hora.
