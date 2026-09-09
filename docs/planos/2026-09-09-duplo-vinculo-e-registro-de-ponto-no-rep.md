# Duplo vínculo (duas matrículas, mesmo CPF) e registro de ponto no REP

**Data:** 09/09/2026
**Substitui:** [`2026-08-13-vinculo-duplo-e-identificacao-no-rele.md`](2026-08-13-vinculo-duplo-e-identificacao-no-rele.md),
que deixou três perguntas em aberto. **As três foram respondidas aqui**, medindo produção e
sondando o equipamento real.
**Estado:** ✅ **DECIDIDO E IMPLEMENTADO em 09/09/2026 (v2.53.0).** Migrations
`20260909130000` (a alocação considera os vínculos irmãos), `20260909140000` (sobreposição de
escala é por pessoa) e `20260909150000` (`fn_cadastros_irmaos`, para a grade avisar antes do
lote) e `20260909160000` (a fronteira entre vínculos, que nasceu do **ensaio** da correção de
dados) — **as quatro aplicadas e conferidas em produção em 09/09/2026**, e os dados de 09/2026
corrigidos por lista fechada. Diário em
[`../evolucao/2026-09-09-duplo-vinculo-a-batida-e-da-pessoa.md`](../evolucao/2026-09-09-duplo-vinculo-a-batida-e-da-pessoa.md).

**Decisões do usuário (09/09/2026):** desambiguar na **alocação** (refazível, acompanha correção
de escala); **não mexer na marcação** (ela é da pessoa, e o trigger de imutabilidade não ganha
exceção nova); **corrigir 09/2026 por lista fechada**, com ensaio antes/depois; e — mudando o
desenho para melhor — **a sobreposição de escala passa a ser proibida por pessoa**, porque
*"apesar da pessoa ter duplo vínculo essa pessoa continua sendo única, ela não pode ser alocada em
duas escalas no mesmo horário"*. Com a escala nunca sobrepondo, a batida nunca fica ambígua.

---

## Resumo em uma linha

O relógio **não pode** distinguir dois vínculos da mesma pessoa — e isso não é limitação do
iDClass, é da Portaria 671, que identifica a marcação pelo **CPF/PIS do trabalhador**, sem campo
de contrato. Mas o **SisEscala pode**: nos casos reais os dois vínculos têm turnos
**complementares** (40 de 41 dias medidos), então o horário previsto diz de qual matrícula é cada
batida.

---

## 1. O que o hardware faz e não faz — medido, não suposto

### 1.1 O equipamento RECUSA dois cadastros com o mesmo identificador

Não é hipótese: está gravado em `rep_cadastros_fila`, em produção. Os 42 cadastros das 21 pessoas
com CPF duplicado acumulam **1.531 falhas**, e as mensagens são do próprio equipamento:

```
add_users.fcgi recusou (formato users:[{pis}]): PIS já cadastrado: 25896334249
add_users.fcgi recusou (formato users:[{cpf}]): CPF já cadastrado: 88556093191
add_users.fcgi recusou (formato users:[{pis}]): Matrícula já cadastrada
```

Confirmado por leitura direta do REP da SMS (10.110.0.20, 09/09/2026): **300 usuários lidos, 300
`pis` distintos**. A unicidade é imposta pelo equipamento, e vale também para `registration`.

➡️ **Resposta à pergunta 1 do plano de 13/08:** o equipamento **não** aceita cadastrar a mesma
pessoa duas vezes sob o mesmo identificador. A direção "B" daquele plano está **descartada na forma
em que foi escrita**.

### 1.2 O AFD não tem campo de contrato — e isso é da NORMA

Portaria 671/2021, registro **tipo 3**, posições **035-046** (12 dígitos): *PIS, CPF ou sua
composição*. A linha de marcação carrega `NSR + data/hora + identificador(12) + CRC` e **nada
mais**. Não existe matrícula, não existe contrato, não existe "qual vínculo".

Esse é o teto de qualquer solução: **trocar de marca de relógio não resolve.** Qualquer REP-C
certificado tem exatamente o mesmo campo, porque é a norma que o define.

### 1.3 A digital é 1:N e não pode dizer qual vínculo

Mesmo que existissem dois cadastros, encostar o dedo produz **uma** identificação. A pessoa não tem
como dizer "agora estou batendo pela outra matrícula". Sondado no equipamento real (só leitura):

```
get_system_configuration  → {"one_to_one_enabled": false, ...}
set_identification_type   → {"error":"'one_to_one_enabled' em formato incorreto"}   (sonda vazia)
```

O modo **1:1** (pré-identificação por senha ou cartão, e só então a digital) **existe** e está
desligado. ⚠️ Mas é configuração **do equipamento inteiro**: ligá-lo obrigaria os **323 usuários**
daquele relógio a digitar antes de encostar o dedo, para resolver o caso de 10 pessoas. Descartado
por desproporção.

### 1.4 O que o equipamento tem além da digital (achado de passagem)

`load_users.fcgi` devolve, e já existe uso real no parque (amostra de 300 usuários da SMS):

| campo | preenchidos |
|---|---|
| `password` | 25 |
| `bars` (código de barras) | 15 |
| `code` | 11 |
| `rfid` (cartão de proximidade) | 10 |

ℹ️ **Isto fecha, de graça, o Passo 1 do plano
[`2026-09-06-copia-de-cartao-codigo-e-senha-entre-relogios.md`](2026-09-06-copia-de-cartao-codigo-e-senha-entre-relogios.md):**
o equipamento **devolve** `rfid`, `code`, `bars` **e `password`** na listagem — a senha vem em
texto (`"0"` para quem não tem). A dúvida registrada lá — *"a senha aparece?"* — está respondida:
**aparece**. O coletor é que descarta os quatro campos hoje.

---

## 2. O tamanho real do problema — produção, 09/09/2026

**21 CPFs** com 2+ cadastros Ativos (o plano de 13/08 falava em 110; **reconferir sempre**). Todos
os 21 estão em unidade com relógio. E eles se dividem em dois grupos que **não têm o mesmo
problema**:

| grupo | quantos | situação |
|---|---|---|
| vínculos em **unidades diferentes** | **11** | ✅ **já funciona hoje** |
| vínculos na **mesma unidade** | **10** | 🚨 é aqui que quebra |

### 2.1 Unidades diferentes já estão resolvidas — o mecanismo é o vínculo por dispositivo

`rep_vinculos_servidor` é único por `(dispositivo_id, identificador_afd)`, **não** por
identificador sozinho. Então o mesmo CPF pode ter um vínculo no relógio da SMS apontando para a
matrícula de lá e outro no relógio do HMI apontando para a de cá. Conferido em produção: ANA LUCIA
bate nos dois (25 batidas na SMS, 16 no HMI), CARLEANE e LUCIANGELA idem — **cada batida na
matrícula certa, sem nada especial**. Não mexer nisso.

### 2.2 Mesma unidade: o dano, medido em 09/2026

| medida | valor |
|---|---|
| matrículas com escala em 09/2026 | 13 |
| delas, com **ZERO batida própria** | **6** |
| dias de escala | 174 |
| dias **sem presença registrada** | **149** (86%) |
| batidas REP no mês | 163 |
| **atribuídas a uma matrícula em dia SEM turno dela**, tendo a irmã turno | **29** |

Não é só ponto faltando: é **ponto na matrícula errada**. Exemplos verificáveis:

```
ELIETE MATOS DIAS  02/09  previsto: mat 1009 = (nada) / mat 67766 = MT 07-19
                          batidas 06:54, 13:00, 19:03  →  TODAS na mat 1009
ELAYNE PEIXOTO     02/09  previsto: mat 54464 = N 19-07 / mat 68140 = MT 07-19
                          batidas 07:01, 13:00, 14:00, 19:00, 19:05 → TODAS na mat 68140
DAIANE C. BRANCO   01/09  previsto: mat 53435 = (nada) / mat 68187 = MT 07-19
                          batidas 07:02, 20:13  →  TODAS na mat 53435
```

### 2.3 🚨 E qual matrícula ganha o ponto é decidido por acidente

O vínculo é criado por **ordem de chegada da fila de cadastro**, e em unidade com vários relógios
isso diverge entre equipamentos irmãos:

```
PAULINO SANTOS VIEIRA (HMM)   HMM-01 → mat 67469     HMM-03 → mat 65562
                              HMM-02 → mat 67469     HMM-04 → mat 65562
ELZENIR COSTA SOUSA   (HMM)   HMM-01/02/04 → mat 1013      HMM-03 → mat 68151
```

Os quatro relógios do HMM atendem **os mesmos setores** do prédio principal. **Em qual matrícula o
ponto cai depende de em qual dos quatro a pessoa encostou o dedo naquele dia** — e nada, em tela
nenhuma, diz isso.

---

## 3. A descoberta que abre a solução: a escala desambigua sozinha

Medido nos 10 casos, competências 08 e 09/2026:

| dias em que **as duas** matrículas têm turno | 41 |
|---|---|
| com janelas de horário **DISJUNTAS** | **40** |
| com janelas **sobrepostas** (>15 min) | **1** |

E o padrão é sempre o mesmo — os dois vínculos são **turnos complementares**:

```
YSLLENE LEMOS FARIAS    mat 33568 = N  19:00→07:00     mat 68316 = MT 07:00→19:00   (12 dias)
LETICIA C. F. PINHEIRO  mat 67654 = MT 07:00→19:00     mat 53565 = N  19:00→07:00   ( 8 dias)
ELAYNE DE S. PEIXOTO    mat 54464 = N  19:00→07:00     mat 68140 = MT 07:00→19:00   (13 dias)
DAIANE C. BRANCO        mat 53435 = N  19:00→07:00     mat 68187 = MT 07:00→19:00   ( 4 dias)
```

**Uma batida às 07:03 é do MT. Uma às 19:04 é do N. Não há ambiguidade real.**

⚠️ O único dia sobreposto é **EDILEUZA, 01/09**: `Regular N 19h-07h` nas **duas** matrículas, mesmo
setor. Ninguém faz dois plantões noturnos simultâneos — **é erro de lançamento de escala**, não um
caso legítimo a suportar. Corrige-se a escala, não o motor.

---

## 4. Proposta

### ✅ Solução principal — desambiguar pela ESCALA, no SisEscala

**Uma pessoa, um cadastro no relógio, uma digital. Zero fricção, zero hardware novo.** O relógio
continua fazendo o que a norma manda: registrar que **aquela pessoa** bateu às 07:03. Quem decide
**por qual matrícula** é o PTRP — que é exatamente o papel dele na Portaria 671: complementar e
tratar, nunca alterar o dado original.

É a mesma classe de solução já usada em 19/08/2026 na **regra do dono** (batida disputada entre
dois DIAS vizinhos): a batida é do candidato cujo passo previsto está mais perto dela. Aqui a
disputa é entre dois **vínculos** em vez de dois dias.

**Três invariantes que não podem ser quebrados** (os mesmos de sempre):

| regra | aqui significa |
|---|---|
| nunca fabricar horário | vínculo sem batida que case fica com **pendência**, nunca com timestamp |
| nunca descartar batida | batida que não casa com nenhum dos dois continua gravada e vira pendência |
| exatamente um dono | a mesma batida **não** pode ir para as duas matrículas — seria a dupla contagem da armadilha 23, agora dentro da mesma pessoa |

⚠️ **A decisão de projeto que falta tomar** (e que muda o custo): a resolução de identidade roda na
**ingestão do AFD**, e `marcacoes_ponto` é INSERT-only — o único UPDATE que o trigger libera é
*órfã → com dono*. Então, se a escala for lançada **depois** da batida (comum, ver armadilha 55), o
dono escolhido na ingestão não pode mais ser trocado. Duas saídas:

- **(a)** resolver na ingestão pela escala vigente e, quando ainda não houver escala, deixar
  **órfã** — órfã é recuperável por `fn_reparse_afd_dispositivo`, dono errado **não é**;
- **(b)** deixar a alocação (`fn_alocar_marcacoes_dia`) enxergar as batidas dos vínculos irmãos da
  mesma pessoa no mesmo dispositivo, e cada dia escolher a sua — com desempate simétrico, como o da
  regra do dono, para os dois vínculos decidirem o oposto e exatamente um ficar com ela.

**(b) é mais robusta** (refazível, acompanha correção de escala); **(a) é mais barata**. Recomendo
**(b)**, com **(a)** como degradação para quem não tem escala no dia.

⚠️ Achado a corrigir junto, em qualquer dos caminhos: o desempate atual em
`fn_servidor_por_identificador_afd` usa `extract(month from now())` — o **mês corrente**, não o mês
da batida. Reprocessar em outubro uma batida de setembro desempata pela escala errada.

### 🔷 Solução complementar — dois cadastros com identificadores legítimos diferentes

Para o caso residual em que os dois vínculos **realmente** trabalhem no mesmo horário (hoje: **zero
casos**), há um caminho que **não falsifica nada**:

A Portaria aceita **PIS ou CPF** no mesmo campo. Então: vínculo A cadastrado pelo **CPF**, vínculo
B pelo **PIS** — dois números distintos, ambos legítimos da pessoa, ambos já resolvidos por
`fn_servidor_por_identificador_afd`, e **dois vínculos vigentes no mesmo dispositivo sem violar
`uq_vinculo_vigente`**, porque o identificador difere.

⚠️ **Mas isso não resolve a biometria**: a digital continua identificando a pessoa, não o cadastro.
O segundo cadastro precisaria de meio próprio — **cartão RFID** (o parque já usa: 10 de 300) ou
**código + senha**. Custo: cartões, treinamento, e o risco de a pessoa bater pelo meio errado —
erro **silencioso**, vai para a matrícula errada sem avisar ninguém.

**Não implementar sem antes testar em campo**, contra o descartável
`SISESCALA TESTE - PODE APAGAR`: confirmar que o equipamento aceita dois cadastros com o CPF e o
PIS da mesma pessoa. Enquanto não houver caso real, **não vale construir**.

### ❌ Descartados, com o motivo

| direção | por quê |
|---|---|
| identificador **sintético** (ex.: CPF com outro prefixo) | falsificaria um campo do artefato legal — mesma razão pela qual `nsr_offset` foi descartado em 06/09/2026 |
| ligar o modo **1:1** no equipamento | é global: 323 pessoas digitando antes da digital para resolver 10 |
| **dedos diferentes** por matrícula (direção C de 13/08) | erro silencioso: bate com o dedo errado e o ponto vai para a outra matrícula, sem aviso |
| **proibir** duplo vínculo no REP (direção D de 13/08) | tira a prova mais forte (AFD assinado) justamente de quem tem o cadastro mais difícil de auditar |
| trocar de **marca** de relógio | o limite é a Portaria 671, não o iDClass |

---

## 5. Ação operacional, independente de código

Duas coisas que valem **antes** de qualquer migration, porque são de cadastro:

1. **Dividir o vínculo por relógio, onde a unidade tem vários.** No HMM isso já acontece por
   acidente (PAULINO, ELZENIR). Feito **de propósito** — relógio X para a matrícula A, relógio Y
   para a B — resolve o caso sem uma linha de código. ⚠️ Só funciona onde a pessoa alcança os dois
   equipamentos e onde a divisão não conflita com o escopo de setores do relógio.
2. **Corrigir a escala da EDILEUZA em 01/09/2026** (dois `N` simultâneos), o único dia sobreposto
   de toda a medição.

---

## 6. O que ainda não foi verificado

- Se o equipamento aceita dois cadastros com CPF e PIS **da mesma pessoa** — a solução complementar
  depende disso. Teste barato, contra o descartável, ainda não feito.
- Se `add_users.fcgi` / `update_users.fcgi` aceitam `rfid` / `password` na escrita — hoje o coletor
  nunca mandou esses campos.

---

## 7. Como reproduzir as medições

| script | responde |
|---|---|
| `scratchpad/an_duplo_vinculo_rep.mjs` | quem tem CPF duplicado, em que unidade, com que relógio e PIS |
| `scratchpad/an_duplo_batidas.mjs` | cadastro, vínculo, batidas e escala de cada matrícula |
| `scratchpad/an_duplo_por_relogio.mjs` | qual matrícula ganhou o vínculo em **cada** relógio |
| `scratchpad/an_duplo_fila.mjs` | o que o equipamento respondeu ao tentar o 2º cadastro |
| `scratchpad/an_duplo_horarios.mjs` | os turnos das duas matrículas, dia a dia |
| `scratchpad/an_duplo_sobrepos.mjs` | quantos dias têm janela sobreposta de verdade |
| `scratchpad/an_duplo_quant.mjs` | o dano agregado de 09/2026 |
| `scratchpad/sonda_idclass.sh` · `sonda_users.sh` | leitura pura do equipamento (nada é escrito) |
