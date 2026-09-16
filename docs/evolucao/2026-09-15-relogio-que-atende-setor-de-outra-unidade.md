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

## Ainda aberto

**A Parte 2 do plano não foi implementada:** setor novo criado numa unidade cujo relógio trabalha
com lista continua nascendo **fora do relógio**, em silêncio. Medido em 15/09/2026: **37 setores
órfãos, 29 com gente, 115 lotados, 113 sem batida** — e os 37 foram criados depois de o relógio
estar configurado. A solução está desenhada e medida no plano (herança pelo ancestral resolve
37/37, **como sugestão**, nunca automática). Só SMS e HMM sofrem.
