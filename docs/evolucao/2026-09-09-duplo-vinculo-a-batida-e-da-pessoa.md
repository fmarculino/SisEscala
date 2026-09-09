# Duplo vínculo: a batida é da pessoa, a escala diz de qual matrícula

**09/09/2026 · v2.53.0** — migrations `20260909130000`, `20260909140000`, `20260909150000` e
`20260909160000`. ✅ **As quatro aplicadas e conferidas em producao no mesmo dia**, e os dados de
09/2026 corrigidos por lista fechada (113 pares, 0 erros; dias sem presenca de 149 para 131).

Pergunta do usuário: *"como vamos resolver o problema das batidas no relógio, já que no relógio
aparentemente não aceita dois cadastros com o mesmo CPF? Existe uma solução?"*

Resposta curta: **existe, e não é no relógio.** Investigação completa em
[`docs/planos/2026-09-09-duplo-vinculo-e-registro-de-ponto-no-rep.md`](../planos/2026-09-09-duplo-vinculo-e-registro-de-ponto-no-rep.md).

---

## O impedimento é real, e é da NORMA — não do iDClass

Três camadas, todas medidas, não supostas:

**1. O AFD não tem campo de contrato.** Portaria 671/2021, registro tipo 3, posições 035-046:
*PIS, CPF ou sua composição*. A linha carrega `NSR + data/hora + identificador(12) + CRC` e nada
mais. A marcação identifica a **pessoa física**. Trocar de marca de relógio não resolve — é a
norma que define o campo.

**2. O equipamento recusa o segundo cadastro.** Está gravado em `rep_cadastros_fila`: os 42
cadastros das 21 pessoas com CPF duplicado acumulam **1.531 falhas**, com a resposta do próprio
device — `PIS já cadastrado: 25896334249`, `CPF já cadastrado: 88556093191`,
`Matrícula já cadastrada`. Lido direto do REP da SMS: **300 usuários, 300 `pis` distintos**.

**3. A digital é 1:N e não pergunta nada.** Sondado no equipamento (só leitura):
`get_system_configuration` devolve `one_to_one_enabled: false`, e `set_identification_type`
existe (sonda com corpo vazio: `'one_to_one_enabled' em formato incorreto`). O modo 1:1 é real —
mas é configuração do equipamento **inteiro**: obrigaria os 323 usuários daquele relógio a
digitar antes do dedo, para resolver 10 pessoas.

➡️ Isso responde as três perguntas que o plano de 13/08/2026 deixou abertas. A **direção B**
daquele plano (dois cadastros com o mesmo identificador) está descartada, e o número de **110
CPFs** estava desatualizado: são **21**.

---

## Metade do problema já estava resolvida, e ninguém sabia

Dos 21 CPFs com dois cadastros Ativos, **11 têm os vínculos em unidades diferentes — e já
funcionavam**. `rep_vinculos_servidor` é único por `(dispositivo, identificador)`, não por
identificador: cada relógio resolve para a matrícula da sua unidade. Conferido: ANA LUCIA bate
**25× na SMS e 16× no HMI**, cada batida na matrícula certa, sem nada especial.

O problema são os **10 casos de mesma unidade**.

## O dano, medido em 09/2026

| medida | valor |
|---|---|
| matrículas com escala | 13 |
| delas, com **zero batida própria** | **6** |
| dias de escala | 174 |
| dias sem presença registrada | **149** (86%) |
| batidas REP no mês | 163 |
| **numa matrícula que não tinha turno naquele dia** | **29** |

Não é só ponto faltando — é ponto na matrícula errada:

```
ELIETE MATOS DIAS  02/09  previsto: mat 1009 = (nada) / mat 67766 = MT 07-19
                          batidas 06:54, 13:00, 19:03  →  TODAS na mat 1009
```

🚨 **E qual matrícula ganhava era acidente.** O vínculo nasce por ordem de chegada da fila de
cadastro, e no HMM os quatro relógios irmãos apontavam para matrículas **diferentes**:

```
PAULINO SANTOS VIEIRA   HMM-01/02 → mat 67469     HMM-03/04 → mat 65562
ELZENIR COSTA SOUSA     HMM-01/02/04 → mat 1013   HMM-03 → mat 68151
```

Os quatro atendem os mesmos setores do prédio principal. **Em qual matrícula o ponto caía
dependia de em qual dos quatro a pessoa encostou o dedo** — e nada em tela nenhuma dizia isso.

---

## A descoberta que abriu a solução

Nos casos reais, os dois vínculos são **turnos complementares**. Medido em 08 e 09/2026:

| dias com turno nas duas matrículas | 41 |
|---|---|
| janelas **disjuntas** | **40** |
| sobrepostas | **1** (erro de lançamento) |

Sempre o mesmo padrão: `MT 07:00→19:00` numa matrícula, `N 19:00→07:00` na outra. **Uma batida às
07:03 é do MT; às 19:04 é do N.** Não há ambiguidade real — o horário previsto decide.

---

## A solução

**No relógio não muda nada.** Uma pessoa, um cadastro, uma digital, zero fricção. O equipamento
continua registrando que *aquela pessoa* bateu às 07:03; quem decide **por qual matrícula** é o
SisEscala — que é exatamente o papel do PTRP na Portaria 671: complementar e tratar, **nunca**
alterar o dado original.

### `20260909130000` — a alocação considera os vínculos irmãos

Ao alocar o dia de uma matrícula, as batidas de **relógio** dos outros cadastros da mesma pessoa
também disputam os passos daquele dia, e os passos deles entram como **sombra**. É a mesma
mecânica da **regra do dono** de 19/08/2026 (batida disputada entre dois dias vizinhos), sem uma
linha nova de algoritmo — agora a disputa é entre dois **vínculos**.

⚠️ **Só a batida de RELÓGIO do irmão disputa.** Em origem `terminal`,
`marcacoes_ponto.unidade_id` é a **lotação** do servidor, não onde ele bateu — sem lugar
confiável não dá para afirmar que as duas matrículas disputam a mesma batida física.
`ajuste_coordenador`/`ajuste_servidor` são declaração sobre **uma** matrícula: nunca disputam.

⚠️ **Desempate por `servidor_id` quando o instante previsto empata.** Sem esse ramo, nenhum dos
dois "perde" e a **mesma batida** seria gravada nas duas matrículas — a dupla contagem da
armadilha 23, agora dentro da mesma pessoa. O critério é arbitrário, mas **determinístico e
simétrico**: os dois lados chegam a decisões opostas e exatamente um fica com ela.

⚠️ **`marcacoes_ponto` não é tocada.** A marcação continua com o dono que tem, o AFD original
continua intocado e o trigger de imutabilidade **não ganha exceção nova** (seguem três: reparse
de AFD, fusão de setor, mesclagem de cadastro). A batida é da pessoa; o que passa a ser resolvido
pela escala é em qual matrícula ela é **aplicada**.

### `20260909140000` — sobreposição de escala é por PESSOA

Decisão do usuário: *"apesar da pessoa ter duplo vínculo essa pessoa continua sendo única, ela não
pode ser alocada em duas escalas no mesmo horário."*

🚨 A trava de sobreposição (`20260826220000`) compara por `servidor_id` — e duas matrículas são
dois `servidor_id`. Ela **não enxergava o caso**. Foi assim que EDILEUZA (mat 67454 e 15892) ficou
com dois plantões `Regular N` simultâneos no mesmo setor do HMI em 01/09/2026.

`fn_check_shift_conflicts` e `fn_prevent_cross_sector_shift_overlap` passam a enxergar a pessoa.
E isso é o que **torna a desambiguação por horário confiável**: se a escala nunca sobrepõe, a
batida nunca fica ambígua. As duas migrations se sustentam.

⚠️ **O critério continua sendo SLOT sobreposto, nunca "mesmo dia"** — `MT` numa matrícula e `N` na
outra é o arranjo que essas pessoas praticam (40 dos 41 dias). Proibir por dia quebraria
exatamente o que se quer preservar.

⚠️ **A exclusão da própria linha no trigger precisou mudar.** Era
`ed.escala_mensal_id <> NEW.escala_mensal_id`, com o comentário *"outra escala = outro
setor/unidade"*. Deixou de bastar: a escala da **outra matrícula** também tem `escala_mensal_id`
diferente — e é justamente ela que precisa conflitar. Quem exclui a própria linha agora é
`ed.id IS DISTINCT FROM NEW.id`, que já estava ali.

⚠️ **Limpar vem antes de ligar a trava** (armadilha 23). O único caso da base inteira (89 pares
medidos, competências 06 a 10/2026) é a EDILEUZA em 01/09, escala em **Rascunho**.

### `20260909150000` — `fn_cadastros_irmaos`, para a grade avisar antes

O banco recusando sozinho não basta: o "Salvar Previsão" é upsert **em lote**, e uma linha
recusada pelo trigger derruba o mês inteiro de todos os servidores da grade, com a mensagem crua
do Postgres. É a mesma razão de existir de `src/utils/conflitoEscala.ts`.

⚠️ **`fn_get_monthly_occupancy` NÃO foi tocada de propósito** — ela foi criada fora do
versionamento (armadilha 2) e só existe no banco; recriá-la exigiria transcrever um corpo que
ninguém tem em arquivo. A grade passa a mandar os ids dos irmãos **junto** em `p_servidor_ids`.

⚠️ **A mensagem diz que é a outra matrícula.** Sem isso, o coordenador lê "conflito com o turno X"
e vai procurar na grade dele um lançamento que não está lá — está na escala da outra matrícula,
que ele pode nem saber que existe.

---

### `20260909160000` — a fronteira entre vínculos (achada pelo ENSAIO)

🚨 **É o melhor argumento a favor de ensaiar antes de aplicar.** O ensaio da correção de dados
acusou **5 perdas**, e ler linha a linha revelou um furo real do desenho. ELAYNE, 02/09:

```
previsto:  mat 68140  MT 07:00 → 19:00        mat 54464  N 19:00 → 07:00
batidas:   07:01  13:00  14:00  19:00  19:05
```

A do noturno ficou com a 19:00 como entrada; a do MT ficou **sem saída**; e a batida das **19:05
não foi usada por ninguém** — a regra do dono a desqualificava dos dois lados, porque o instante
previsto empata (19:00 = 19:00) e o desempate por `servidor_id` entrega a candidata a um só.

A correção é o princípio que o sistema **já** aplica entre blocos encostados (armadilha 6): uma
batida na fronteira **fecha um turno e abre o seguinte**. A exceção é estreita de propósito —
mesmo instante **e** um lado `entrada` **e** o outro `saida` **e** sombra de irmão. Disputa pelo
MESMO passo continua desempatada por `servidor_id`, e sombra de dia vizinho não é afetada.

Depois dela: ganhos **51 → 60**, perdas **5 → 4**.

### A correção dos dados de 09/2026

Por **lista fechada**, com ensaio antes/depois campo a campo (armadilha 46 — nunca reconciliar em
massa): **113 pares reconciliados, 0 erros**. 59 ganhos, 15 trocas (horário sintético `12:00`
dando lugar à batida real `11:47`) e 1 perda correta — batida a 6h12 do previsto, fora da
tolerância de 360 min, virando pendência visível. **Dias sem presença: 149 → 131.** Rodar de novo
dá diferença zero: é idempotente.

⚠️ **Um dia ficou de fora, de propósito:** EDILEUZA, 01/09 — o dia com escala sobreposta.
Reconciliar contra previsto errado troca um erro por outro e apagaria entrada e intervalo já
gravados. **Corrija a escala e rode o script de novo**; a exclusão está explícita e comentada.

⚠️ **O ensaio mentiu na primeira rodada, e isso também é lição:** ele acusou **193 perdas e 0
ganhos**. Não eram os dados — `fn_projecao_marcacoes_dia` devolve `entrada_em` / `int_saida_em` /
`int_ret_em` / `saida_em`, e não os nomes de `escala_diaria`. Lendo pelo nome errado, todo campo
virava `null` e era classificado como perda. **Resultado absurdo demais para ser verdade é sinal
de erro na medição antes de ser sinal de erro no dado.**

---

## O que ficou de fora, e por quê

| direção | motivo |
|---|---|
| identificador **sintético** (CPF com outro prefixo) | falsificaria o campo do artefato legal — mesma razão do `nsr_offset`, descartado em 06/09 |
| ligar o modo **1:1** no equipamento | é global: 323 pessoas digitando antes da digital para resolver 10 |
| **dedos diferentes** por matrícula | erro silencioso: bate com o dedo errado e o ponto vai para a outra matrícula |
| **proibir** duplo vínculo no REP | tiraria a prova mais forte de quem tem o cadastro mais difícil de auditar |

🔷 **Caminho complementar, hoje sem nenhum caso que o exija:** cadastrar o vínculo A pelo **CPF** e
o B pelo **PIS** — dois identificadores legítimos, que o SisEscala já resolve e que cabem em dois
vínculos no mesmo relógio sem violar `uq_vinculo_vigente`. Não resolve a biometria (a digital
continua identificando a pessoa), então exigiria cartão RFID ou senha para o segundo. **Não
construir sem caso real e sem teste em campo** contra o descartável.

---

## Achado de brinde

Ao sondar o cadastro do equipamento, `load_users.fcgi` devolveu `rfid`, `code`, `bars` **e
`password` em texto** (`"0"` para quem não tem). Isso responde o **Passo 1** do plano
[`2026-09-06-copia-de-cartao-codigo-e-senha-entre-relogios.md`](../planos/2026-09-06-copia-de-cartao-codigo-e-senha-entre-relogios.md)
sem ninguém precisar ir ao HMM. Medido na SMS (300 usuários): 25 com senha, 15 com código de
barras, 11 com `code`, 10 com cartão. O coletor é que descarta os quatro campos na leitura.

## Achado ainda aberto

`fn_servidor_por_identificador_afd` desempata por escala usando `extract(month from now())` — o
**mês corrente**, não o mês da batida. Reprocessar em outubro uma batida de setembro desempata
pela escala errada. Não foi tocado nesta leva.

---

## Portões

| portão | o que cobre |
|---|---|
| `node scratchpad/sim_conflito_pessoa.js` | 26 asserções sobre `conflitoEscala.ts` |
| `node scratchpad/val_sim_conflito_pessoa.js` | injeta **5 regressões** e exige reprovação nas 5 |
| conferência de `20260909130000` | executa a alocação e prova que **nenhuma batida** fica em duas matrículas |
| conferência de `20260909140000` | executa a RPC e confere os **dois sentidos** (acusa o sobreposto, não acusa o complementar) |
| conferência de `20260909150000` | executa a função e confere **simetria** e privilégios |

Transpile antes:
```bash
npx tsc src/utils/conflitoEscala.ts --outDir scratchpad/_sim --module commonjs --target es2020
```

Geradores (não editar as migrations à mão): `scratchpad/gen_alocacao_duplo_vinculo.js` e
`scratchpad/gen_pessoa_unica_sobreposicao.js` — o segundo lê **duas** fontes e aborta se a
contagem divergir.

## Medições

`an_duplo_vinculo_rep.mjs` · `an_duplo_batidas.mjs` · `an_duplo_por_relogio.mjs` ·
`an_duplo_fila.mjs` · `an_duplo_horarios.mjs` · `an_duplo_sobrepos.mjs` ·
`an_duplo_sobrepos_total.mjs` · `an_duplo_quant.mjs` · `an_duplo_competencia.mjs`
(sondas do equipamento, só leitura: `sonda_idclass.sh`, `sonda_users.sh`).
