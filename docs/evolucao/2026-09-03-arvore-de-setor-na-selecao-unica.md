# A caixa de setor virou árvore — e por que não deu para reusar a que já existia (03/09/2026)

Relato do usuário, olhando o `<select>` de "Setor de Destino" na avaliação de transferência
(`/servidores/pendencias`):

> nessa cx de setores precisa organizar ela em arvore assim como fizemos em outras.

## O reuso óbvio estava errado

`SeletorSetoresArvore` já existia desde 29/08/2026 (armadilha 29), com árvore, busca e
expandir/recolher. Mas ele marca **em cascata**: clicar num nó marca ele e todos os descendentes.

Isso é exatamente o que se quer no modal do Dispositivo REP — *"este relógio atende a
ALA - PSICOSSOCIAL inteira"* — e é o **oposto** do que se quer aqui: a lotação de um servidor é
**um** setor. Cascata nesta caixa transferiria a pessoa para um setor que ninguém escolheu.

Então são dois componentes com **a mesma árvore por baixo** e semânticas de clique diferentes:

| arquivo | papel |
|---|---|
| [`arvoreSetores.ts`](../../src/components/setores/arvoreSetores.ts) | montagem, filtro por texto, nós recolhíveis, trilha até um nó |
| [`SeletorSetoresArvore.tsx`](../../src/components/setores/SeletorSetoresArvore.tsx) | seleção múltipla **em cascata** (Dispositivo REP) |
| [`SeletorSetorArvore.tsx`](../../src/components/setores/SeletorSetorArvore.tsx) | seleção **única**, sem cascata (destino de transferência) |

Duas cópias da montagem divergiriam no primeiro ajuste de ordenação ou de tratamento de órfão, e o
sintoma seria a mesma unidade desenhando hierarquias diferentes em duas telas.

## Decisões que valem revisão

**O pai é selecionável.** Há servidor lotado no setor-pai, não só nas folhas — desabilitar nó com
filho tiraria da tela lotação que existe no cadastro.

**O caminho completo saiu de cada linha e foi para o resumo.** Na árvore a hierarquia já está no
recuo; repetir `SHL \ BLOCO A` em toda linha é ruído. Mas depois de recolher um ramo — ou de rolar
a lista — o pai sai da tela, e é aí que o caminho faz falta. Por isso o setor escolhido aparece
por extenso na barra de cima.

⚠️ Para isso `formatSectorPaths` passou a devolver **`nomeFolha`** junto com o caminho. Recortar o
caminho pelo separador para recuperar a folha seria frágil: um setor cujo nome contivesse a mesma
sequência sairia truncado.

**O ramo do setor já escolhido nasce aberto.** Sem isso, um setor três níveis abaixo de um pai
recolhido faria a tela abrir sem mostrar em lugar nenhum o valor que o formulário vai enviar.
A abertura roda só quando a seleção muda — não reabre o que a pessoa acabou de recolher à mão.

**Layout empilhado**, não lado a lado: a árvore é alta (busca + lista rolável) e ao lado do
`<select>` de unidade deixava metade da caixa vazia.

Preservadas as regras que já estavam ali: setor inativo não é oferecido, mas o destino que o
pedido já trazia continua selecionável (riscado, marcado como "inativo") — sumir da lista sem sair
da seleção é perda silenciosa.

## Portão

`node scratchpad/sim_arvore_setores.js` — 22 casos. **Validado injetando três regressões**, todas
já vistas de verdade em `formatSectorsHierarchy`:

| regressão injetada | reprova? |
|---|---|
| órfão deixa de virar raiz (some da tela) | ✅ |
| busca com `.some` em vez de `.map().some()` — irmão posterior que casa é perdido | ✅ |
| auto-referência (`parent_id = id`) aceita como pai | ✅ |

⚠️ A primeira injeção foi um `replace` **no-op** por diferença de indentação no JS compilado, e o
portão "passou" — um falso OK que teria validado nada. Refeita contra o texto real. **Ao injetar
regressão em código transpilado, confira que a substituição foi aplicada** (contar ocorrências e
abortar em zero), senão o teste do teste mente.

## O que ficou de fora

A mesma tela ainda tem **um** `<select>` plano de setor, em
[`ImportacaoRhSection.tsx:537`](../../src/app/(dashboard)/servidores/pendencias/ImportacaoRhSection.tsx#L537)
(promover pendência importada do RH). É outro fluxo e não foi pedido; com o componente pronto, a
troca é de poucas linhas.
