# O cabecalho da grade travado no topo (16/09/2026)

Pedido dos coordenadores, vindo do habito de planilha: em setor com muita gente a grade fica
mais alta que a tela, e ao rolar para as ultimas linhas **o cabecalho com os dias sai junto** —
a pessoa perde a referencia de em qual dia esta lancando. Queriam o "congelar paineis" do Excel.

## O congelamento ja estava escrito, e nunca tinha grudado em lugar nenhum

`<thead className="sticky top-0 z-20 ...">` esta em `ScaleGrid.tsx` desde sempre, e o container
da tabela ja era `overflow-auto`. O que faltava era a **cadeia de alturas**:

| elemento | o que tem | efeito |
|---|---|---|
| `<main>` do layout do dashboard | `flex-1 overflow-y-auto` dentro de `h-screen` | **e ele que rola** |
| `<div className="p-8">` | sem altura | a cadeia morre aqui |
| pagina da escala | `h-full` | `100%` de um pai sem altura resolve para `auto` |
| card da grade | `h-full` | idem: cresce com a tabela inteira |
| container da tabela | `flex-1 overflow-auto` | o conteudo cabe, entao **nunca rola** |

`position: sticky` gruda no ancestral de rolagem mais proximo. Aqui esse ancestral era o
`overflow-auto` da grade — que nunca rolava —, e quem rolava era o `<main>`, por fora. O
cabecalho ficava parado dentro de um elemento parado e subia junto com a pagina.

🚨 **Ou seja: `sticky` declarado nao e `sticky` funcionando.** Ao escrever cabecalho fixo, a
pergunta nao e "tem `sticky top-0`?", e sim **"qual elemento esta rolando?"**. Nesta tela a
resposta estava tres niveis acima, em outro arquivo.

## Corrigir pelo layout do dashboard foi descartado

O caminho estrutural seria mover o scroll do `<main>` para um filho e deixar a cadeia de
`h-full` resolver. **Quebraria a tarja do `AvisoVersaoDesatualizada`**, que e `sticky top-0` e
depende de o `<main>` ser quem rola (armadilha 68) — e alcancaria as 23 telas do sistema de uma
vez. A correcao ficou dentro do `ScaleGrid`.

## O flag: a escolha e de quem opera

Decisao do usuario: *"temos gosto para todas as situacoes"*. Botao **Cabecalho fixo / Cabecalho
solto** na barra da grade, com a preferencia salva no `localStorage`
(`src/utils/escala/preferenciaGrade.ts`).

| decisao | por que |
|---|---|
| padrao **travado** | foi o que os usuarios pediram; quem preferir o antigo desliga em um clique |
| `localStorage`, nunca `configuracoes_globais` | e gosto pessoal, nao regra de negocio: nao muda numero nenhum da escala e nao pode valer para os colegas da mesma unidade |
| todo acesso em **try/catch** | janela anonima e site data bloqueado fazem `localStorage` **lancar** — preferencia de layout nao pode derrubar a grade |
| no modo solto, **nada** e aplicado | quem escolher o layout antigo tem a grade pixel a pixel como era |
| botao tambem para `comum`/`servidor` | a barra de acoes nao existe para esses papeis; sem uma faixa propria, quem so consulta ficaria sem como desligar |

⚠️ **O rodape de totais NAO foi travado** (decisao do usuario, mesma conversa): em monitor de
resolucao menor, travar as duas pontas espreme demais a area util.

## A altura e MEDIDA, nao chutada em `calc(100vh - Xrem)`

O que fica acima do card varia — titulo da pagina, tarja de escala inativa, tarja de somente
leitura, aviso de versao. Altura chutada **a mais** devolve a rolagem para a pagina, que e
exatamente o defeito que esta correcao fecha.

⚠️ A medida e a distancia ate o topo do **conteudo** da area que rola
(`rect.top - rect.top(area) + area.scrollTop`), nunca o `getBoundingClientRect().top` cru: este
ultimo muda conforme a rolagem, e a altura da grade passaria a depender de onde a pagina estava
quando alguem redimensionou a janela.

⚠️ **`min-h-0` no container da tabela nao e enfeite.** Em coluna flex o item nao encolhe abaixo
do proprio conteudo por padrao — sem ele o `maxHeight` do card nao produz rolagem nenhuma e o
cabecalho volta a nao grudar, com o codigo parecendo certo.

⚠️ **Piso de 320px.** Em monitor baixo a conta pode dar um valor em que nao cabe linha nenhuma;
ali vale mais deixar a **pagina** rolar um pouco do que espremer a grade a nada.

## Dois detalhes que so aparecem depois que o cabecalho passa a grudar

⚠️ **Os badges das celulas passariam POR CIMA do cabecalho.** Eles sao `z-30` e a `<td>` e
`relative` **sem** `z-index`, ou seja, nao cria contexto de empilhamento: competem com o
cabecalho (`z-20`) no contexto raiz e ganham. A saida foi `z-0` na `<td>` (confina os badges),
**nao** subir o cabecalho para `z-40`:

- a barra de ferramentas e `z-30` de proposito (o comentario dela explica), entao o menu
  "Ferramentas" abriria **por tras** do cabecalho;
- o balao dos indicadores de ponto sobe a celula do servidor para `hover:z-30` de proposito, e
  ficaria **cortado** pelo cabecalho.

⚠️ **A borda inferior do cabecalho some ao grudar.** A tabela e `border-collapse`, e nesse modo
a borda pertence a TABELA, nao a celula: ela nao acompanha o deslocamento do sticky no Chrome, e
o corpo apareceria colado no cabecalho. Resolvido com `box-shadow` inset nos `<th>`, aplicado so
no modo travado.

## Portao

`node scratchpad/sim_cabecalho_fixo.js` (26 assercoes) e
`node scratchpad/val_sim_cabecalho_fixo.js` (**7 regressoes injetadas, 7 reprovadas** — entre
elas o padrao voltando ao layout antigo, o piso sumindo e a escolha invertendo ao gravar).
Transpile antes com:

```
npx tsc src/utils/escala/preferenciaGrade.ts --outDir scratchpad/_sim --module commonjs --target es2020
```

⚠️ **Nao verificado em navegador nesta sessao**: `tsc`, `lint` e `build` passam, e o portao cobre
a preferencia e a conta da altura, mas o comportamento visual (o cabecalho realmente grudando, o
empilhamento dos badges e a borda) so se confirma abrindo uma grade com muitos servidores.
