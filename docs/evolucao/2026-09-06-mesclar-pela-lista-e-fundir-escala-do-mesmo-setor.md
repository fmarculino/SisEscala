# Mesclar a partir da lista de duplicidades, e fundir a escala do mesmo setor (06/09/2026)

**Versão 2.43.0.** Uma migration (`20260906100000`), **aplicada e conferida em produção em
06/09/2026**. Nenhum horário, hora normal, falta ou folha se move por conta dela: o que muda é
quais mesclagens são possíveis e o que a tela diz sobre as que não são.

## Como começou

Duas coisas na mesma sessão, as duas na tela `/servidores/pendencias`.

Primeiro o seletor de setor da avaliação de transferência:

> "podemos melhorar essa tela, ao definir a nova lotação do servidor deixa pra mostrar os setores
> só depois do usuario escolher a unidade, da maneira que esta ta muito confuso pois mostras todos
> os setores de todas as unidades e muitos se repetem"

Depois, a lista de duplicidades:

> "nessa tela temos que ter um botão dando a possibilidade de mesclar os possiveis servidores
> duplicados, nessa mesclagem tem que prever a possiblidade de já existir escalas ativas e nesse
> caso tudo seria migrado para o servidor que ficaria ativo e o outro excluido ou inativado
> conforme vc decidir o risco de excluir"

---

## 1. O seletor de setor listava a rede inteira antes de a unidade ser escolhida

`filteredSetores` (`SolicitacoesTransferenciaSection.tsx`) tinha um fallback:

```ts
(selectedUnidade ? setores.filter(s => s.unidade_id === selectedUnidade) : setores)
```

Sem unidade escolhida, **os 646 setores da rede**. E como a árvore exibe o nome da **folha** (a
hierarquia sai no recuo, decisão de 03/09/2026), o mesmo rótulo aparecia dezenas de vezes —
"ACS AGENTE DE SAÚDE" uma vez por unidade, sem nada na linha distinguindo um do outro. Escolher
ali era escolher às cegas a **lotação de um servidor**.

O `placeholder` já dizia "Selecione a unidade primeiro", e a árvore aparecia do mesmo jeito.

⚠️ **O modal "Transferir Escala" (`ScaleGrid`) sempre filtrou estrito por unidade** — sem unidade,
`s.unidade_id === ''` dá lista vazia e o `SeletorSetorArvore` já esconde busca, botões e lista
sozinho. A tela de pendências era a única com o fallback.

### A mensagem de vazio mentia no outro caso

`"Selecione a unidade primeiro."` era literal dentro do componente. Com a unidade **já escolhida**
e sem setor ativo, ela manda fazer o que a pessoa acabou de fazer. Virou a prop `mensagemVazia`,
com o texto antigo como default, e os dois consumidores passam a mensagem de cada estado.

---

## 2. A mesclagem já existia — e ninguém a encontrava

O pedido era construir do zero. **Ela foi construída em 04/09/2026** (`fn_mesclar_servidores`,
migration `20260904130000`), e a seção "Cadastros duplicados" que a oferece fica na **mesma
página**, logo acima. Entre as duas há "Documentos com dígito inválido" e "Servidores sem CPF" —
duas seções longas. Quem rola até a lista de baixo, onde o problema tem nome, não tinha o que
fazer com a informação.

É a **armadilha 44** numa terceira forma: lá o sistema mandava "solicite a um Administrador" sem
existir como solicitar; aqui ele nomeia o problema numa tela e esconde a saída noutra.

### O que foi ligado

| onde | o quê |
|---|---|
| cabeçalho do grupo (fechado) | selo **"dá para mesclar"** |
| rodapé do grupo (aberto) | botão **"Mesclar cadastros"** → `#dup-<cpf>` |
| grupo da seção de ação | `id` ancorável, abre sozinho e rola até si, com destaque (`target:`) |
| quando não dá | **o motivo escrito**, no lugar do botão |

⚠️ **O critério é o CPF, nunca o do agrupamento.** Medido em 05/09/2026, nos 40 grupos de
`fn_possiveis_duplicidades_servidor`:

| critério | grupos | mescláveis |
|---|---|---|
| cpf | 13 | 13 |
| nome | 16 | **16** — todos com o mesmo CPF dos dois lados |
| telefone | 6 | 3 (os outros 3 têm **CPF diferente**) |
| e-mail | 5 | 3 (um deles é um endereço compartilhado por **12 pessoas**) |

Recusar por causa do rótulo do agrupamento esconderia os 16 grupos por nome; aceitar por causa do
telefone mesclaria **duas pessoas diferentes**, e o ponto de uma viraria ponto da outra.

⚠️ **Sem botão, com o motivo escrito.** Botão cinza sem explicação ensina a contornar a tela
(mesma lição da armadilha 31) — e prometer ação que não existe é exatamente o defeito que a
mesclagem veio corrigir.

ℹ️ `fn_cadastros_duplicados` traz **16** grupos contra os 13 por CPF do diagnóstico. Os 3 a mais
são aqueles em que os **dois** lados estão marcados como vínculo duplo confirmado — o diagnóstico
os filtra, a ferramenta de ação **não**, de propósito: foi uma confirmação marcada por engano que
criou o caso de 04/09/2026.

---

## 3. Escalas ativas: já migravam. O que travava eram duas coisas diferentes sob a mesma mensagem

`fn_mesclar_servidores` sempre moveu escala junto — **11 dos 16 grupos passavam direto**. Os
outros 5 morriam em:

```
escala_mensal: 2 registro(s) do cadastro duplicado ja existem no cadastro que vai absorver
(escala_mensal_mes_ano_servidor_id_unidade_id_setor_id_key). Mover criaria duplicidade -
resolva esses registros antes.
```

Que não diz **qual** competência, **qual** setor, nem **qual** dia. Medindo os 5, eram dois
problemas opostos:

| caso | quantos | o que é |
|---|---|---|
| dias **disjuntos** no mesmo mês/setor | 1 | uma escala só, lançada metade sob cada matrícula. **ELIETE MATOS DIAS**: 26 dias num cadastro, 20 no outro, em 9 e 10/2026, **sem um dia em comum** |
| **mesmo dia, turnos diferentes** | 4 | `MT` num cadastro e `N` no outro, categoria Regular. YSLLENE 24 dias, ELAYNE 18, LETÍCIA 8, EDILEUZA 2 |

🚨 **O segundo caso não passa por `escala_sobreposta`**, e é o que faz ele parecer inofensivo:
aquela checagem exige `dto.slots && dtd.slots`, e `MT` (`{M,T}`) não cruza com `N` (`{N}`). São
dois lançamentos legítimos isoladamente que, juntos, dizem que a pessoa trabalha 24h em dias
alternados.

### A fusão

`escala_diaria` **não tem `servidor_id`** — herda de `escala_mensal` (armadilha 47). É isso que
torna a fusão barata: repontar `escala_diaria.escala_mensal_id` e apagar a `escala_mensal` que
ficou vazia. Nada é fabricado, nada é apagado, e **a presença viaja na própria linha do dia**.

⚠️ **Roda ANTES do laço genérico**, por necessidade: é ele que faria
`UPDATE escala_mensal SET servidor_id`, e a unique derrubaria a transação inteira. O gerador tem
invariante que **aborta** se a ordem inverter.

### O que continua recusado, e por que não deve deixar de ser

| recusa | motivo |
|---|---|
| `escala_em_conflito` — (dia, categoria) nos **dois** lados | ficar com um turno e descartar o outro é decisão de quem escala. Medido sobre as **35.566** linhas: **zero** violações da tripla `(escala_mensal_id, dia, categoria)`, e 2.083 pares (escala, dia) com mais de uma linha — sempre de categorias diferentes |
| `competencia_encerrada` / `escala_fechada` | mesma regra de `fn_validar_destino_escala`: a porta é reabrir, que já é ato registrado |
| `folha_na_escala_fundida` | `folha_ponto.escala_mensal_id` é único e o destino tem a folha dele na mesma competência (`unique_servidor_mes_ano`). Juntar dois documentos de folha não é mesclagem de cadastro |

A mensagem nova nomeia setor, competência, dia e o turno de **cada lado**:

```
Os dois cadastros estao escalados no mesmo dia em CENTRO OBSTÉTRICO \ ENFERMEIROS (09/2026):
dia 3 (53565: N x 67654: MT), dia 10 (53565: N x 67654: MT), ...
Os dois turnos nao cabem na mesma linha da folha - abra a grade, apague na competencia o
lancamento que nao aconteceu, e volte aqui.
```

⚠️ **A escala que muda de lugar é relatada em separado** na tela (`descreverEscalasFundidas`).
Diluída na contagem de vínculos movidos, ninguém a encontraria depois na grade — é a armadilha 22
aplicada à mudança mais visível que a operação produz.

---

## Excluir ou inativar o cadastro que sai

O usuário perguntou de novo, delegando a decisão. **Continua inativando**, e o motivo não é
conservadorismo abstrato:

A linha errada carrega uma **matrícula**, e ela pode já ter sido impressa em folha de ponto,
escala e relatório. O dado migra; o número no papel continua dizendo `T2600095`. Sem a linha, esse
número fica sem explicação possível em lugar nenhum — num sistema que é prova legal (Portaria
671/2021).

E o cadastro mesclado **já não atrapalha**: desde `20260904140000` ele sai de
`fn_cpf_ja_cadastrado` e de `fn_possiveis_duplicidades_servidor`, fica `Inativo` e some de toda
tela que filtra por ativo.

✅ Medido: em **13 dos 16 grupos**, o lado que seria excluído ainda tem batida, escala, folha ou
vínculo de relógio próprios. Não são cadastros vazios.

---

## Conferência em produção (06/09/2026, depois de aplicar)

| conferência | resultado |
|---|---|
| grupos sem impedimento | **11 → 12** (ELIETE destravou; nenhum regrediu) |
| grupos travados | 4, todos por `escala_em_conflito` |
| `escala_mensal` órfã de servidor | **0** (de 2.373) |
| `escala_diaria` apontando para escala inexistente | **0** (de 35.566) |
| triplas `(escala_mensal_id, dia, categoria)` repetidas | **0** |

`fn_setor_caminho` no texto da recusa confirmada em campo: `BLOCOS \ BLOCO B`,
`CENTRO OBSTÉTRICO \ ENFERMEIROS` — nome de folha sozinho não identificaria o setor.

## Portões

- `node scratchpad/sim_mesclagem_da_lista.js` — 21 asserções sobre
  `mesclagemDoGrupoDuplicidade` e `descreverEscalasFundidas`. Transpile antes com
  `npx tsc src/utils/mesclagemCadastro.ts --outDir scratchpad/_sim --module commonjs --target es2020`.
- `node scratchpad/val_sim_mesclagem_da_lista.js` — injeta **3 regressões** (aceitar CPF
  diferente, prometer mesclagem que não existe, esconder a escala fundida) e exige reprovação nas
  três, mais aprovação com o código intacto. ⚠️ Ele **confere que a substituição foi aplicada**
  antes de rodar: a 3ª injeção começou como um `replace` no-op contra a forma transpilada e teria
  "passado" (armadilha 48).
- `scratchpad/gen_fusao_escala_mesclagem.js` — gera a migration a partir da versão vigente, com
  invariantes: os 6 impedimentos antigos presentes, os 4 novos presentes, `$fn$` em pares, o GUC
  de imutabilidade da marcação preservado e a fusão **antes** do laço genérico.

## Arquivos

| arquivo | o quê |
|---|---|
| `supabase/migrations/20260906100000_*.sql` | `fn_impedimentos_mesclagem_servidor` + `fn_mesclar_servidores` |
| `src/utils/mesclagemCadastro.ts` | `mesclagemDoGrupoDuplicidade`, `descreverEscalasFundidas` |
| `src/components/setores/SeletorSetorArvore.tsx` | prop `mensagemVazia` |
| `.../pendencias/PendenciasCadastroClient.tsx` | selo, botão e motivo na lista de diagnóstico |
| `.../pendencias/CadastrosDuplicadosSection.tsx` | âncora, abertura por hash, relato da fusão |
| `.../pendencias/SolicitacoesTransferenciaSection.tsx` | setor só depois da unidade |
| `.../escalas/unidade/[unidadeId]/ScaleGrid.tsx` | mensagem de vazio própria |
