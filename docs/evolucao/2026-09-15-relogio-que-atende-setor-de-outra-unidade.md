# O relógio que atende setor de outra unidade (15/09/2026, v2.61.0)

**Migrations:** `20260915100000` · `20260915110000` · `20260915120000` · `20260915130000`
**Plano:** [`docs/planos/2026-09-15-relogio-que-atende-setor-de-outra-unidade.md`](../planos/2026-09-15-relogio-que-atende-setor-de-outra-unidade.md)

---

## O caso

O **POLO MORADA NOVA** é um setor do CAF, da unidade SMS — e funciona fisicamente **dentro da USF
Carlos Barreto**, que tem relógio. As duas pessoas de lá não conseguiam registrar ponto de jeito
nenhum.

Medido em produção em 15/09/2026, o caso não era isolado: é o desenho do CAF.

| setor | lotados ativos | cadastrados em algum relógio | batidas 08+09/2026 |
|---|---|---|---|
| CAF (sede) | 29 | 29, com biometria | batem normal |
| POLO I - SHOPPING | 6 | **0** | 0 |
| POLO II - VELHA MARABÁ | 6 | **0** | 0 |
| POLO MORADA NOVA | 2 | 1, sem biometria | 0 |
| POLO SÃO FÉLIX | 2 | 1, sem biometria | 0 |

**16 pessoas em 4 polos, zero batidas.** A sede bate porque os relógios dela são da unidade SMS.
E a USF Carlos Barreto tem **2 lotados ativos** — o relógio de lá estava praticamente ocioso com
duas pessoas ao lado impedidas de usá-lo.

## A causa: seis portas em série, todas com o mesmo predicado

`dispositivos_rep.unidade_id` respondia *de quem o relógio é*. Faltava responder *quem ele atende*.
O bloqueio não começava na batida:

| # | onde | efeito |
|---|---|---|
| 1 | `fn_enfileirar_cadastros_rep` | o pessoal do polo nunca era enfileirado |
| 2 | `fn_cobertura_ponto_dispositivo` | o universo do relógio do CB tinha **1 pessoa** |
| 3 | `fn_enfileirar_cadastros_por_escala` | deriva de (2) — herdava o mesmo universo |
| 4 | `fn_cobertura_escala_parque` | o setor saía como `sem_relogio_no_setor` |
| 5 | `fn_alocar_marcacoes_dia` | mesmo cadastrado à mão, a batida virava pendência `outra_unidade` |
| 6 | `fn_definir_setores_dispositivo_rep` | **recusava explicitamente** setor de outra unidade |

🚨 **Cadastrar a digital à mão não era contorno, era armadilha.** A porta física abriria, a batida
seria gravada e ganharia dono por CPF — e morreria sem preencher a folha (ponto 5). Hoje a pessoa
sabe que não bate; ali bateria todo dia achando que registrou.

## A solução: abrangência em vez de propriedade

`unidade_id` continua sendo de quem o relógio **é** (dono, gestão, quem vê na tela).
`dispositivos_rep_setores` passa a dizer quem ele **atende** — podendo atravessar unidade.

Fonte única: **`fn_dispositivo_atende_setor(dispositivo, setor, unidade)`**.

```sql
(d.atende_toda_unidade AND d.unidade_id = p_unidade_id)
OR EXISTS (dispositivos_rep_setores onde dispositivo=d e setor=p_setor_id)
```

### 🚨 `atende_toda_unidade` tinha que virar coluna

Até aqui, **"0 linhas em `dispositivos_rep_setores`" = "toda a unidade"**. Dar ao relógio da USF CB
a **primeira** linha (o setor do polo) faria a USF Carlos Barreto inteira **perder o relógio**, em
silêncio. A coluna é o que torna as duas coisas independentes — e é o que permite um relógio
atender a unidade dona inteira **e** um setor de fora ao mesmo tempo.

### 🚨 `fn_ingerir_afd` carimbaria o setor errado

Ela deriva `marcacoes_ponto.setor_id` quando o dispositivo tem exatamente **1** setor vinculado.
Com o vínculo do polo, o relógio do CB teria 1 linha e **toda batida dele** — inclusive a da pessoa
da USF — sairia com `setor_id` de outra unidade, enquanto `unidade_id` continuava a USF. Marcação
internamente incoerente, sem erro nenhum. Agora o setor só é derivado quando o relógio atende
**exclusivamente** um setor.

### A restrição da alocação, sem reabrir a armadilha 55

`fn_alocar_marcacoes_dia` deixou de exigir "mesma unidade" e passou a exigir "o relógio da batida
atende o setor desta escala". Mudaram 8 trechos: o setor de cada slot, os **6** empilhamentos, a
reordenação, o dispositivo da batida e a matriz de compatibilidade.

🚨 **O default continua fechado.** A batida só atravessa unidade onde alguém **declarou** o
vínculo. O caso que motivou a armadilha 55 (batida do HMI-02 virando ponto no CRISMU) continua
barrado — ninguém vinculou setor do CRISMU àquele equipamento.

Mantidos, e o gerador aborta se sumirem: **proibir e não penalizar** (o ramo do DP continua não
considerado — custo infinito, não custo alto), **nunca descartar batida** (o cursor segue sem
filtro de lugar; o que não casa vira pendência visível), o piso de meia-noite, a regra do dono e a
exceção da fronteira entre vínculos.

⚠️ **Performance:** a compatibilidade é pré-computada numa matriz, e o ramo que chama
`fn_dispositivo_atende_setor` só é alcançado quando as unidades **divergem**. No caso dominante
não há uma chamada a mais que hoje.

## 🚨 A quarta migration fechou um risco que as três primeiras abriram

Com a coluna criada e a tela ainda gravando **só as linhas**, dois estados errados ficaram
alcançáveis pela tela de Dispositivo REP:

- marcar "toda a unidade" num relógio que tinha lista → as linhas são apagadas e a coluna continua
  `false`: o equipamento passa a **não atender ninguém**, em silêncio;
- desmarcar e escolher setores num relógio "toda a unidade" → as linhas entram e a coluna continua
  `true`: **a restrição pedida simplesmente não acontece**.

`fn_definir_setores_dispositivo_rep` passou a gravar a coluna na **mesma transação** das linhas, e
**recusa** o primeiro caso no banco (a tela nunca é a defesa — armadilha 12).

⚠️ **Setor de fora exige escopo nas DUAS unidades.** O ato faz as pessoas daquele setor passarem a
ser enfileiradas e a bater naquele equipamento — quem só administra a unidade do relógio não decide
sozinho pela unidade do setor. É a mesma regra da avaliação de transferência (origem **e** destino
no escopo).

## O que isto NÃO resolve

🚨 **A biometria continua presencial, e é estrutural.** `fn_biometria_faltante_dispositivo` só busca
origem na mesma unidade, e afrouxar não adiantaria: a cópia é feita pelo coletor **dentro da rede da
unidade**, e nenhuma máquina do parque atende duas unidades. O relógio do CB não tem rota até o da
SMS.

**JAMESON e EWERTON vão precisar cadastrar a digital no relógio da USF Carlos Barreto, uma vez
cada.** A identidade chega sozinha pelo cron; a digital, não.

## Validação

Todas as quatro foram aplicadas em **homologação** antes de produção, com ensaio revertido por
`RAISE EXCEPTION`:

| ensaio | resultado |
|---|---|
| predicado de abrangência (9 casos, incluindo "toda a unidade" + setor de fora convivendo) | **9 de 9** |
| cobertura ao vincular setor de outra unidade | **1 → 19 pessoas** |
| alocação, **os dois sentidos** | sem vínculo → 0 alocações + pendência `outra_unidade`; com o setor vinculado → **1 alocação** |
| gravação | recusa relógio sem nenhum setor; aceita setor de fora; grava a coluna; **restaura o estado original** e prova a restauração |

Conferido em produção depois de aplicar (`scratchpad/ver_abrangencia_producao.mjs` e
`ver_gravacao_producao.mjs`, que **executam** as funções): backfill coerente nos 35 relógios,
`anon` recebendo 401 nas duas funções novas, cobertura e painel respondendo, alocação rodando em
dias reais, a sobrecarga de 2 argumentos derrubada, e o guard do relógio órfão recusando **sem
alterar o dispositivo**.

## Armadilhas encontradas no caminho

- ⚠️ **EOL por arquivo, nunca por convenção.** `20260909170000` está em **LF puro** enquanto a
  convenção do projeto é CRLF — e `actions.ts` é CRLF. Os geradores detectam; um padrão montado
  com o EOL errado vira **no-op silencioso**.
- ⚠️ **O gerador reprovou a minha própria contagem**: afirmei que `v_lugar` apareceria 4 vezes; são
  5. Um portão que não confere contagem não vale nada.
- ⚠️ **`has_function_privilege` com assinatura errada levanta erro em runtime.** A real é
  `fn_alocar_marcacoes_dia(uuid, date, integer, integer)`, não `(uuid, date, boolean)`.
- ⚠️ **`marcacoes_ponto` tem `CHECK chk_marcacao_rep_completa`** exigindo `nsr` para origem `rep` —
  lido antes de escrever, não adivinhado.
- 🚨 **O ensaio da conferência quase apagou configuração real.** Ele roda contra um dispositivo de
  produção: a primeira versão restaurava a coluna e **deixava o relógio sem os setores que
  atendia**. Hoje ele guarda a lista antes, restaura, e **prova a restauração** — se sobrar
  diferença, a migration aborta.
- ⚠️ **`listarOpcoesFormulario` não paginava os setores** (699 de 1000, armadilha 8). Antes o modal
  só usava setores da unidade; agora depende da lista conter setores de **outras** unidades — um
  setor cortado viraria "não dá para vincular" sem nenhuma mensagem. Paginado.

---

# PARTE 2 — o setor que nasce órfão (v2.64.0, migration `20260915140000`)

## O problema

Setor criado numa unidade cujo relógio trabalha com **lista** nasce fora dele, em silêncio, até
alguém lembrar de ir nas configurações marcá-lo. Medido em 15/09/2026: **37 setores órfãos, 29 com
gente, 115 lotados, 113 sem uma única batida** — e os 37 criados **depois** de o relógio da unidade
estar configurado.

ℹ️ **Entre a medição e a implementação, o usuário corrigiu 565 vínculos à mão** (HMM-01/02/04 de
160 para 178 setores, CCE-01 de 11 para 25), o que derrubou os órfãos de 37 para **5**. Isso não
enfraquece o caso — é a prova dele: o trabalho existia e era manual.

## 🚨 O achado que mudou o desenho

A medição de 15/09 dizia "a herança pelo ancestral resolve 37/37". **Resolve — e erra exatamente
no caso que a Parte 1 existe para tratar.** Os 3 polos do CAF sairiam "herdando" os relógios da
**sede** do CAF, que fica em outro bairro. Vincular ali espalharia cadastro por um equipamento
onde aquela gente nunca põe o dedo.

Por isso a sugestão carrega a **força do sinal**, e a tela só pré-marca o forte:

| força | de onde vem | na tela |
|---|---|---|
| **2 — evidência** | a gente deste setor **já bate** naquele relógio (60 dias) | vem **pré-marcada** |
| **1 — palpite** | o ancestral mais próximo é atendido por ele | aparece, **não** vem marcada |
| **0 — nenhuma** | ninguém bate e nenhum ancestral é atendido | a tela diz que **não sabe** |

O caso 0 é o dos polos, e dizer "não sei" é a resposta honesta: chutar mandaria cadastrar gente
num prédio onde ela não está.

## As peças

| peça | o quê |
|---|---|
| `fn_relogios_sugeridos_para_setor` | a sugestão, com força e motivo legível |
| `fn_setores_sem_relogio` | a lista de órfãos do escopo, com lotados/escalados |
| `fn_setor_sem_relogio` | um setor só — para o aviso logo depois de criar |
| `fn_vincular_setor_a_relogios` | **acrescenta** o setor a relógios |
| Marcações → **Setores sem Relógio** | a rede de segurança |
| Aviso na tela de Setores | pega no momento da criação (`/setores?criado=<id>`) |
| `src/utils/setores/sugestaoRelogio.ts` | fonte única da regra de pré-marcação |

⚠️ **`fn_vincular_setor_a_relogios` NÃO reusa `fn_definir_setores_dispositivo_rep` de propósito:**
aquela **substitui** a lista inteira do dispositivo. Aplicar em lote com ela exigiria ler a lista de
cada relógio e somar no cliente — e um engano ali apagaria a configuração de um equipamento
inteiro. Esta só acrescenta.

⚠️ **O formulário não basta sozinho, e por isso as duas telas existem.** Setor entra por outros
caminhos (fusão, correção de hierarquia, script) e o `parent_id` muda **depois** da criação. Quem
só confia no caminho feliz não enxerga o que escapou dele.

⚠️ **Setor de unidade SEM relógio nenhum não é listado.** Ali o problema é outro, e acusar seria
alarme fabricado em toda linha — aviso que grita à toa é o caminho mais curto para ninguém mais ler
nenhum.

## Validação

Aplicada em **homologação**, com ensaio de 4 atos revertido por `RAISE EXCEPTION`:

```
cria subsetor de um setor atendido  -> órfãos 1 -> 2   (nasceu fora do relógio)
sugestão                            -> força 1, apontando o relógio do PAI
vincula                             -> órfãos 2 -> 1   (saiu da lista)
vincula de novo                     -> 0 vinculados, 1 já vinculado  (relata o que MUDOU)
```

A conferência embutida na migration confere, executando, que **as duas funções de detecção
concordam nos dois sentidos** — duas respostas para a mesma pergunta divergem na primeira mudança
se ninguém conferir.

**Portões:** `node scratchpad/sim_sugestao_relogio.js` (23 asserções) e
`val_sim_sugestao_relogio.js`, que injeta **6 regressões e exige reprovação nas 6** — entre elas a
que importa: o palpite voltando a vir pré-marcado.
