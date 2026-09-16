# Abrangência do relógio: setor de outra unidade, e setor novo que nasce órfão

**Data:** 15/09/2026
**Status:** ✅ **PARTE 1 IMPLEMENTADA E EM PRODUÇÃO em 15/09/2026 (v2.61.0)** — migrations
`20260915100000`, `20260915110000`, `20260915120000` e `20260915130000`, mais a tela e o manual.
Diário em
[`docs/evolucao/2026-09-15-relogio-que-atende-setor-de-outra-unidade.md`](../evolucao/2026-09-15-relogio-que-atende-setor-de-outra-unidade.md).
✅ **PARTE 2 TAMBÉM IMPLEMENTADA em 15/09/2026 (v2.64.0)** — migration `20260915140000`, a aba
Marcações → Setores sem Relógio, o aviso na criação do setor e o manual.

⚠️ **O desenho das seções 8 a 12 mudou num ponto durante a execução, e o motivo importa:** a
sugestão pela hierarquia **erra justamente no caso da Parte 1** (os polos do CAF sairiam "herdando"
os relógios da sede, que fica em outro bairro). Por isso ela ganhou FORÇA, e só o sinal vindo de
batida real vem pré-marcado. Ver o diário.

⚠️ A seção "POR ONDE RETOMAR" logo abaixo descreve o estado de ANTES da implementação e vale
hoje apenas para a Parte 2. Uma quinta peça apareceu durante a execução e não estava no desenho
original: `fn_definir_setores_dispositivo_rep` **recusava** setor de outra unidade e não gravava a
coluna nova — sem ela, a tela deixaria o relógio sem atender ninguém. Ver o diário.
**Motivador:** dois defeitos do mesmo eixo — **a abrangência do relógio**.

- **Parte 1:** o POLO MORADA NOVA (setor do CAF, unidade SMS) funciona fisicamente dentro da USF
  Carlos Barreto, que tem relógio. As duas pessoas de lá não conseguem registrar ponto.
- **Parte 2:** setor criado numa unidade cujo relógio trabalha com lista de setores fica **fora do
  relógio, em silêncio**, até alguém lembrar de ir nas configurações marcá-lo.

---

## POR ONDE RETOMAR (leia esta seção primeiro)

**Nada foi implementado.** Não há migration, não há mudança de código, não há dado alterado — só
este documento e os scripts de medição da seção 13. O parque está exatamente como antes do estudo.

**A tese em uma frase:** `dispositivos_rep.unidade_id` responde *de quem o relógio é*; falta
responder *quem ele atende*. Os dois defeitos saem daí.

**Os três achados que custaram a medição e que não devem ser redescobertos:**

1. 🚨 Cadastrar a digital na mão **não** é contorno — a batida seria gravada e morreria sem
   preencher a folha (§2, ponto 5). Hoje a pessoa sabe que não bate; ali bateria achando que
   registrou.
2. 🚨 `atende_toda_unidade` tem que virar coluna **antes** de qualquer vínculo cruzado, senão dar
   ao relógio do CB a primeira linha faz a USF Carlos Barreto inteira perder o relógio (§4.2). E
   `fn_ingerir_afd` passaria a carimbar o setor errado em toda batida daquele relógio (§4.3).
3. 🚨 A herança do ancestral resolve 37/37, mas **não pode ser automática**: ampliaria 13 setores
   em silêncio, incluindo a ALA - PSICOSSOCIAL, que tem relógio próprio em outro prédio (§10).

**Sequência sugerida:** §6 (Parte 1) e §12 (Parte 2). O primeiro passo das duas é leitura pura e
inerte — dá para aplicar e conferir sem mexer em comportamento nenhum.

**Se for retomar daqui a semanas:** reconfira os números contra produção antes de decidir. Todos os
scripts da §13 são reexecutáveis e só leem.

---

## 1. O caso, medido em produção (15/09/2026)

| fato | medição |
|---|---|
| relógio | `REP-iDClass-USF-CB`, unidade **USF Carlos Barreto**, ativo, comunicando (contato de hoje), `10.110.22.229`, "toda a unidade", `ponto_valido_desde = 29/08/2026` |
| setor | `SMS > ADMINISTRAÇÃO > CAF > POLO MORADA NOVA`, ativo, **sem subsetores** |
| gente | 2 lotados ativos: JAMESON (T2600028) e EWERTON (68450), os dois com escala em 08 e 09/2026 |
| ponto deles | **zero marcações**, de qualquer origem, em toda a base |
| cadastro no relógio | JAMESON: **nenhum relógio**. EWERTON: só no `REP iDClass - SMS`, **sem biometria** |

🚨 **Não é um caso isolado — é o desenho do CAF.** O ramo tem 4 polos espalhados pela cidade,
e os 4 estão no mesmo estado:

| setor | lotados ativos | cadastrados em algum relógio | batidas 08+09/2026 |
|---|---|---|---|
| CAF (sede) | 29 | 29, com biometria | **batem normal** (Almox-Pat-CAF-01/02) |
| POLO I - SHOPPING | 6 | **0** | 0 |
| POLO II - VELHA MARABÁ | 6 | **0** | 0 |
| POLO MORADA NOVA | 2 | 1 (sem biometria) | 0 |
| POLO SÃO FÉLIX | 2 | 1 (sem biometria) | 0 |
| SERVIDORES SAAM | 2 | 2, com biometria | batem normal |

**16 pessoas em 4 polos, nenhuma batida.** A sede do CAF bate porque os relógios dela são da
unidade SMS; os polos não batem porque estão fisicamente em outro prédio, e o relógio daquele
prédio é de outra unidade.

ℹ️ A USF Carlos Barreto tem **1 lotado ativo**. O relógio de lá está praticamente ocioso, com
2 pessoas ao lado impedidas de usá-lo.

### Extensão no parque

- **81 setores / 337 pessoas** têm gente escalada, estão em unidade **que tem relógio**, e
  registraram **zero batidas REP em 09/2026**. Nem todos são este caso (muitos são falta de
  biometria), mas é a fila onde os casos análogos estão escondidos — POLO I e POLO II aparecem
  ali com 6 pessoas cada.
- **100 pares (pessoa, relógio)** já existem hoje com a pessoa cadastrada num relógio de unidade
  diferente da lotação dela — a prática já acontece, informalmente.
- Mas **só 12 batidas** (9 pares pessoa-relógio, 08+09/2026) caíram em relógio onde a pessoa não
  tinha escala nenhuma naquela unidade. As outras casam porque a pessoa é **Servidor Externo**,
  escalada onde bateu. Ou seja: **hoje o sistema já aceita batida "fora da lotação" — o que ele
  não aceita é batida fora da ESCALA.**

---

## 2. Por que não funciona hoje: a cadeia inteira é fechada por unidade

O bloqueio não é um ponto só, e não começa na batida. São seis portas em série, todas com o
mesmo predicado `= dispositivos_rep.unidade_id`:

| # | onde | efeito hoje |
|---|---|---|
| 1 | `fn_enfileirar_cadastros_rep` (lotação) | `s.unidade_id = v_unidade_id` → o pessoal do polo **nunca é enfileirado** para o relógio do CB |
| 2 | `fn_cobertura_ponto_dispositivo` | universo = lotados ∪ escalados **da unidade do relógio** → eles não aparecem na Cobertura de Ponto (conferido: o universo do CB tem **1 pessoa**) |
| 3 | `fn_enfileirar_cadastros_por_escala` | **deriva de (2)** — herda o mesmo universo |
| 4 | `fn_cobertura_escala_parque` | procura relógio em `d.unidade_id = e.uid` → o setor sai como `sem_relogio_no_setor` |
| 5 | `fn_alocar_marcacoes_dia` (armadilha 55, `20260908150000`) | mesmo que alguém cadastre a digital à mão e a pessoa bata, a batida **não casa com passo nenhum**: vira pendência `outra_unidade` e a folha fica vazia |
| 6 | `fn_higiene_usuarios_dispositivo` | quem não é da unidade aparece como cadastro estranho no relógio — candidato a ser **removido** à mão |

🚨 **O ponto 5 é o que torna "cadastrar na mão" uma armadilha, não um contorno.** O cadastro
manual resolve a porta física (a pessoa consegue encostar o dedo), a batida é gravada e ganha
dono por CPF — e depois **morre sem preencher a folha**, em silêncio. Seria pior que o estado
atual: hoje a pessoa sabe que não bate; ali ela bate todo dia achando que está registrando.

---

## 3. Opções consideradas

### A. Mover o setor para a unidade do relógio — **descartada**
Muda lotação, chefia, escala e folha. O CAF é da SMS, e os 4 polos iriam para 4 unidades
diferentes, desmontando a hierarquia do próprio CAF. É o erro que o CLAUDE.md já registra no
HMM ao contrário: *unidade não é lugar*.

### B. Criar uma unidade por polo, com relógio próprio — **descartada por ora**
Custo de hardware para 2 pessoas, e o polo não é unidade administrativa. Não muda o modelo:
o relógio continuaria sendo de uma unidade só.

### C. Escalar o pessoal do polo como Servidor Externo na USF — **é o paliativo de hoje**
Funciona **sem nenhuma linha de código**, porque a restrição da armadilha 55 compara com a
**escala**, não com a lotação. Mas o preço é alto: a escala sai da grade do CAF e vai para a da
USF Carlos Barreto, sob outra chefia; a folha sai pelo setor da USF; e o coordenador do CAF
perde de vista as pessoas dele. **Resolve o ponto, distorce a gestão.**

### D. Exceção por servidor (tabela `(servidor, dispositivo)` autorizado) — **descartada**
Cirúrgica, mas envelhece: cada pessoa nova no polo precisaria de uma linha, e quem sair continua
autorizado. Gestão por pessoa para um fato que é **do lugar**.

### E. `setores.unidade_fisica_id` ("este setor funciona dentro da unidade X") — **considerada**
Mais declarativa, e uma linha por setor resolveria todos os relógios da hospedeira. Mas erra
onde a hospedeira tem vários relógios em sítios diferentes (o HMM tem 6, em 3 prédios): o
pessoal do polo só encosta no relógio do prédio onde está. Vincular ao **relógio** é mais
preciso.

### F. ✅ **RECOMENDADA — abrangência do relógio por setor, podendo atravessar unidade**

`dispositivos_rep_setores` já é a tabela certa ("quais setores este relógio atende") e já é FK
livre para qualquer setor. O que falta é (a) deixar de exigir que o setor seja da unidade dona,
(b) separar "toda a unidade dona" de "lista de setores", e (c) trocar o eixo
`unidade do dispositivo` → `abrangência do dispositivo` nas seis portas acima.

O conceito fica honesto: **`unidade_id` é de quem o relógio É (dono, gestão, quem vê na tela);
`dispositivos_rep_setores` é quem o relógio ATENDE (o lugar físico).**

---

## 4. Desenho da opção F

### 4.1 A regra, em um lugar só

```sql
-- fonte única, STABLE
fn_dispositivo_atende_setor(p_dispositivo_id uuid, p_setor_id uuid) RETURNS boolean
  (d.atende_toda_unidade AND s.unidade_id = d.unidade_id)
  OR EXISTS (SELECT 1 FROM dispositivos_rep_setores ds
              WHERE ds.dispositivo_id = d.id AND ds.setor_id = p_setor_id)
```

### 4.2 🚨 A coluna `atende_toda_unidade` NÃO é opcional

Hoje **0 linhas em `dispositivos_rep_setores` = "toda a unidade"**. Se o relógio do CB ganhar a
única linha `POLO MORADA NOVA`, ele passa a atender **só aquele setor** e a USF Carlos Barreto
inteira perde o relógio — regressão silenciosa, e justamente na unidade dona.

`dispositivos_rep.atende_toda_unidade boolean NOT NULL DEFAULT true`, com backfill
`:= NOT EXISTS (linhas daquele dispositivo)`. Retrocompatível com os 34 relógios (24 em "toda a
unidade", 10 com lista) e, a partir daí, a lista deixa de ter duplo sentido.

⚠️ A alternativa sem coluna ("linhas da unidade dona restringem, linhas de fora somam") é
retrocompatível também, mas cria uma armadilha nova: marcar um setor restringe ou não dependendo
da unidade dele, sem nada na tela dizendo isso. **Não vale economizar a coluna.**

### 4.3 🚨 `fn_ingerir_afd` grava o setor errado hoje se o relógio tiver 1 setor

```sql
IF v_n_setores = 1 THEN SELECT setor_id INTO v_setor_id FROM dispositivos_rep_setores ...
```

Com a mudança, o relógio do CB teria exatamente **1** linha (o polo) e continuaria "toda a
unidade" — então **toda batida do relógio**, inclusive a da pessoa da USF, seria carimbada com
`setor_id = POLO MORADA NOVA`, um setor de outra unidade, enquanto `unidade_id` continua sendo a
USF. Marcação internamente incoerente, sem erro nenhum.

Correção junto: derivar o setor só quando `atende_toda_unidade = false` **e** houver exatamente
um setor. Nos demais casos, `NULL` — que é o valor honesto.

### 4.4 O que muda, por arquivo

| # | função | mudança | como |
|---|---|---|---|
| 1 | `fn_dispositivo_atende_setor` | **nova** | fonte única |
| 2 | `dispositivos_rep.atende_toda_unidade` | **nova coluna** + backfill | |
| 3 | `fn_cobertura_ponto_dispositivo` | universo passa a ser a abrangência | ⚠️ arrasta `fn_cobertura_ponto_resumo` **e** `fn_enfileirar_cadastros_por_escala` de graça (as duas derivam dela) |
| 4 | `fn_enfileirar_cadastros_rep` | predicado de lotação | |
| 5 | `fn_alocar_marcacoes_dia` | a restrição de lugar (armadilha 55) | **cópia mecânica por gerador** — armadilha 1 |
| 6 | `fn_ingerir_afd` | derivação do `setor_id` (4.3) | |
| 7 | `fn_cobertura_escala_parque` | deixar de dizer `sem_relogio_no_setor` | |
| 8 | `fn_higiene_usuarios_dispositivo` | não classificar como cadastro estranho | |
| 9 | `DispositivoRepModal.tsx` | seção "Setores de outras unidades" + o checkbox "Toda a unidade" passa a gravar a coluna | |

### 4.5 A restrição da alocação — como mexer sem reabrir a armadilha 55

A comparação de hoje é `v_m_uni[k] = v_slot_unidade[s]`, em **dois** pontos: o ramo 3 do DP e o
marcador `v_m_cross` (que é quem produz a pendência `outra_unidade` com a mensagem certa). Os
dois precisam do mesmo critério novo, senão a batida casa e mesmo assim é rotulada como de outra
unidade, ou o contrário.

O critério novo é **aditivo**: `mesma unidade` **OU** `o relógio da batida atende o setor da
escala daquele passo`. Isso exige carregar `v_slot_setor[]` (análogo a `v_slot_unidade[]`) e o
dispositivo da marcação.

⚠️ **`v_slot_setor` entra na REORDENAÇÃO dos slots** junto com os outros arrays — reordenar sete
e deixar o oitavo parado faz a restrição comparar a batida com o setor de **outro passo**
(a mesma nota que a `20260908150000` já registra para `v_slot_unidade`).

⚠️ **Não chamar a função dentro do laço O(n_marc × n_slots) do DP.** Pré-computar a
compatibilidade antes, como o laço de `v_m_cross` já faz.

🚨 **Isto NÃO afrouxa a armadilha 55.** O default continua fechado: a batida só atravessa
unidade onde **alguém declarou explicitamente** que aquele relógio atende aquele setor. O caso
que motivou a 55 (JEOSEANE, batida do HMI-02 virando ponto no CRISMU) continua barrado —
ninguém vincularia setor do CRISMU ao relógio do HMI. A diferença é que hoje a regra é
*"o lugar é a unidade"* e passaria a ser *"o lugar é o que foi declarado"*.

---

## 5. O que a solução NÃO resolve

🚨 **A biometria continua presencial, e isso é estrutural.** `fn_biometria_faltante_dispositivo`
só busca origem na **mesma unidade**, e afrouxar isso não adiantaria: a cópia é feita pelo
coletor **dentro da rede da unidade**, e nenhuma máquina do parque atende duas unidades. O
relógio do CB não tem rota até o relógio da SMS.

**Consequência prática: JAMESON e EWERTON vão precisar cadastrar a digital no relógio da USF
Carlos Barreto, uma vez cada.** A identidade (nome/matrícula/CPF) chega sozinha pelo cron depois
da mudança; a digital, não. Vale para os 16 dos 4 polos.

ℹ️ Pendência que permanece: a pendência de revisão de uma batida aparece para quem cuida da
unidade **onde a pessoa bateu** (`fn_marcacoes_pendentes_revisao` filtra por `m.unidade_id`) —
ou seja, sobra para o coordenador da USF, não para o do CAF. Depois da correção o caso normal
casa e não vira pendência, então isso só morde na exceção.

---

## 6. Ordem sugerida

1. **Paliativo hoje, se houver urgência:** escalar os dois como Servidor Externo na USF Carlos
   Barreto (opção C) e cadastrar a digital lá. Funciona sem deploy, ao custo de a escala sair do
   CAF. **Não cadastrar a digital sem isso** — sem escala na unidade do relógio, a batida é
   gravada e não preenche a folha (seção 2, ponto 5).
2. Migration 1 (estrutura): coluna `atende_toda_unidade` + backfill + `fn_dispositivo_atende_setor`
   + correção de `fn_ingerir_afd`. **Inerte** — nenhum relógio tem setor de outra unidade hoje
   (medido: 0 vínculos cruzados), então nada muda de comportamento.
3. Migration 2 (leitura): cobertura, enfileiramento, painel de escala, higiene.
4. Migration 3 (alocação): a restrição de lugar, por gerador, com conferência nos dois sentidos
   — a batida de setor atendido passa a casar **e** a de setor não atendido continua recusada.
5. Frontend: seção "Setores de outras unidades" no modal, com aviso explícito de que as pessoas
   daquele setor passam a poder registrar ponto naquele relógio.
6. Manual do usuário, no mesmo commit.

**Portões:** simulador do predicado de abrangência (tabela-verdade: unidade dona com/sem
"toda a unidade", setor de fora, setor não vinculado) + validador com regressões injetadas, no
padrão dos `sim_*.js` / `val_sim_*.js` do projeto.

---

---

# PARTE 2 — o setor novo que nasce órfão

## 8. Medido em produção (15/09/2026)

🚨 **37 setores ativos estão em unidade que TEM relógio e não são atendidos por relógio nenhum.
29 deles têm gente: 115 lotados ativos, dos quais 113 não registraram uma única batida em
09/2026.**

**Os 37 foram criados em 08 ou 09/2026** — depois de o relógio daquela unidade já estar
configurado. Não é resíduo de implantação: é o defeito acontecendo, agora.

| unidade | relógios | setores ativos | órfãos | órfãos com gente |
|---|---|---|---|---|
| SMS | 4, todos com lista (5, 31, 6, 6) | 46 | 4 | 4 — são os polos do CAF da Parte 1 |
| HMM | 6, com lista (11, 160, 160, 11, 160, 161) | 212 | 33 | 25 |

As outras 22 unidades não têm o problema: os relógios delas estão em "toda a unidade", então setor
novo já nasce coberto.

ℹ️ **Isto explica boa parte dos "81 setores / 337 pessoas com zero batida" da Parte 1.** Em muitos
casos a causa não é falta de biometria — é o setor não estar no relógio. Do HMM: `ENFERMAGEM >
TÉCNICOS > TRIAGEM` (9 lotados), `> ENFERMEIROS > PRONTO SOCORRO` (8) e `> UTI ADULTO` (8), todos
criados em **07/09/2026**.

## 9. A herança pelo ancestral resolve 100% — como SUGESTÃO

✅ **Subindo a árvore até o ancestral mais próximo que tenha relógio, os 37 de 37 são resolvidos**
(115 lotados). Nenhum caso fica sem resposta.

⚠️ **Olhar só o PAI DIRETO resolve apenas 14.** Os outros 23 têm "pai também órfão" — mas é
cascata: `ENFERMAGEM > ENFERMEIROS` está órfão e o avô `ENFERMAGEM` tem os 4 relógios do prédio
principal. Quem mede pelo pai direto conclui que a herança não serve; quem sobe a árvore vê que
serve para tudo.

É a mesma regra que o CLAUDE.md já usa para decidir sítio físico: **o nome do setor não diz o
sítio; o CAMINHO diz.**

## 10. 🚨 Por que a herança NÃO pode ser regra automática

Se a herança virasse regra viva no predicado ("o relógio atende o setor se atende qualquer
ancestral dele"), **13 setores que JÁ têm relógio ganhariam relógio A MAIS, em silêncio** — e os
dois piores são justamente sítios físicos separados:

```
HMM  ENFERMAGEM > ENFERMEIROS > AMENT - ALA PSICOSSOCIAL  += HMM-01, HMM-02, HMM-03, HMM-04
HMM  ENFERMAGEM > TÉCNICOS   > AMENT - ALA PSICOSSOCIAL  += HMM-01, HMM-02, HMM-03, HMM-04
```

A ALA - PSICOSSOCIAL tem **relógio próprio** (`REP-iDClass-ALA-AMENTE`), em outro endereço. Pela
árvore administrativa ela está sob `ENFERMAGEM`; pelo lugar físico, não. A herança automática
desfaria essa separação sem ninguém pedir, espalhando cadastro e biometria para quatro
equipamentos de outro prédio — literalmente o erro que o CLAUDE.md registra no HMM-03 × CCE.

**Herdar é a resposta certa; virar regra silenciosa é a forma errada de aplicá-la.** A herança
entra como **default pré-marcado numa decisão explícita**, nunca como vínculo automático.

## 11. Desenho da Parte 2

| peça | o quê |
|---|---|
| `fn_relogios_sugeridos_para_setor(setor_id)` | sobe a árvore até o ancestral mais próximo com relógio e devolve os relógios dele **com o motivo** ("herdado de `CCE`"). Sem ancestral: os relógios ativos da unidade, marcados como palpite fraco |
| `fn_setores_sem_relogio(...)` | os órfãos do escopo, com lotados/escalados e a sugestão — a **rede de segurança** |
| formulário de setor | ao criar, e ao **mudar o pai**, mostra os relógios sugeridos **pré-marcados** e editáveis |
| aba/aviso em `/marcacoes` | lista os órfãos com gente e aplica a sugestão em lote, com revisão |

⚠️ **"Nenhum relógio" tem que continuar sendo uma escolha possível, e explícita.** É o caso legítimo
da ALA - PSICOSSOCIAL enquanto aguardava equipamento próprio. O que não pode existir é o setor sair
da tela **sem que ninguém tenha decidido**.

⚠️ **O formulário não basta sozinho.** Setor entra por outros caminhos (fusão, correção de
hierarquia, script) e o `parent_id` pode mudar depois da criação — por isso a detecção é
obrigatória, não um extra. Mesma lição da armadilha 22: quem só confia no caminho feliz não
enxerga o que escapou dele.

⚠️ **A Parte 1 reduz o alcance deste problema, mas não o elimina.** Com `atende_toda_unidade`
explícito, os 24 relógios em "toda a unidade" cobrem setor novo sozinhos. Sobram SMS e HMM — as
duas maiores unidades da rede, e onde a lista é **deliberada** (o CCE e a ALA têm relógio próprio).

### Considerado e adiado: vínculo por RAMO (`inclui_descendentes`)

Marcar `ENFERMAGEM` com "inclui descendentes" resolveria o setor novo de forma estrutural, sem
sugestão nenhuma. Adiado porque reintroduz o problema da seção 10: o CCE-01 marcaria o ramo `CCE`,
e os 13 subsetores do CCE que ficam no prédio principal passariam a ser atendidos pelos dois
sítios. Exigiria **exclusões por ramo** junto — modelo bem mais caro que a sugestão, que resolve
37 de 37 hoje.

## 12. Ordem sugerida da Parte 2

1. `fn_relogios_sugeridos_para_setor` + `fn_setores_sem_relogio` (leitura pura, inertes).
2. Aba de detecção em `/marcacoes` + aplicação em lote revisada → **resolve os 37 de hoje**.
3. Sugestão pré-marcada no formulário de setor → impede os próximos.
4. Manual do usuário, no mesmo commit.

**Portão:** simulador da escolha do ancestral (cadeia de 3 níveis, pai órfão com avô atendido, raiz
sem ancestral, ramo com dois relógios) + validador com regressões injetadas — entre elas a que
importa: **herança virando vínculo automático**, com a ALA ganhando os relógios do prédio principal.

---

## 13. Medições reproduzíveis

| script | o que mede |
|---|---|
| `scratchpad/an_relogio_cruza_unidade.mjs` | o relógio, o setor, e quantos vínculos cruzados existem hoje (0) |
| `scratchpad/an_polo_morada_nova.mjs` | os 2 servidores, escalas e batidas |
| `scratchpad/an_caf_polos.mjs` | o ramo CAF inteiro: cadastro e batida por pessoa |
| `scratchpad/an_batida_sem_escala_na_unidade.mjs` | batidas que não casam por unidade (12) |
| `scratchpad/an_setores_que_nao_batem.mjs` | os 81 setores / 337 pessoas com zero batida |
| `scratchpad/an_cb_tamanho.mjs` | relógios por unidade e tamanho de cada uma |
| `scratchpad/an_setor_orfao_de_relogio.mjs` | os 37 setores órfãos, por unidade e data de criação |
| `scratchpad/an_heranca_relogio_do_pai.mjs` | herança pelo pai direto — resolve só 14 |
| `scratchpad/an_heranca_ancestral.mjs` | herança pelo ancestral (37/37) **e** os 13 setores que seriam ampliados em silêncio |

⚠️ Produção é viva — reconfira antes de decidir com base nestes números.
