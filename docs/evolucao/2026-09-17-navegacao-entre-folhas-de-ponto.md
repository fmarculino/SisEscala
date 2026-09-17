# Navegação entre folhas de ponto (17/09/2026)

**Issue:** [#4 — Paginação nas folhas de ponto](https://github.com/fmarculino/SisEscala/issues/4).
**Versão:** v2.69.0. **Sem migration.**

## O pedido

> "Criar um sistema de paginação nas folhas de ponto assim como foi feito na grade das escalas."

E, no detalhamento: voltar para a listagem **mantendo os filtros**, e um caminho da folha **de
volta para a grade** — o inverso do clique no nome do servidor, que já existia na grade.

## O trabalho que existia

Conferir uma competência era, a cada servidor: abrir a folha → voltar → reescolher unidade,
setor, mês → achar a pessoa seguinte → entrar. Numa unidade com 60 escalados, 60 vezes.

A grade já tinha resolvido isso em `NavegacaoEscalas` + `src/utils/escalasNavegacao.ts`. Aqui a
mesma forma foi repetida, com as diferenças que a folha impõe.

## A fonte única

**`src/utils/folhaNavegacao.ts`** — o filtro, a ORDEM e a leitura/escrita dos filtros na URL.

⚠️ **A sequência das setas tem que ser a MESMA lista que o usuário viu.** Se a barra derivasse a
sua, "próxima folha" pularia ou repetiria gente em relação à listagem de origem. Por isso:

| peça | onde |
|---|---|
| filtros na URL (`origem`) | `lerFiltrosFolha` / `escreverFiltrosFolha` |
| o que passa no filtro | `servidorVisivelNaFolha` — usado pela **tela** e pela **barra** |
| a ordem | `ordenarServidoresFolha` — usado pelas **duas actions** e pela tela |
| a sequência navegável | `sequenciaDeFolhas` |

🚨 **A ordem era `nome.localeCompare(nome)` PURA, e a base tem nomes idênticos.** Duplo vínculo é
a mesma pessoa em duas matrículas (armadilha 59: PAULINO, ELZENIR). Empate sem desempate deixa a
ordem indefinida — tolerável numa lista que se lê de uma vez, **inaceitável numa seta "próxima"**,
onde duas visitas percorreriam ordens diferentes. O desempate é matrícula → escala → servidor.

⚠️ **Linha sem folha gerada fica FORA da sequência**, de propósito. Ela aparece na lista (é onde
se clica em "Gerar"), mas não tem tela para onde navegar: incluí-la faria a seta parar num destino
inexistente e o contador "X de N" contaria gente que a navegação não alcança.

## A consulta é a mesma, o autoclose não

`getServidoresFolhaPonto` chama `autoCloseExpiredScalesAndTimesheets`, que varre as escalas e
folhas abertas da competência inteira. Rodá-lo a cada seta seria pagar o fechamento automático
para desenhar um contador.

O miolo virou `listarServidoresDaCompetencia` (interna), e duas actions a chamam:

| action | autoclose |
|---|---|
| `getServidoresFolhaPonto` (a lista) | **sim**, como sempre foi |
| `getSequenciaFolhasPonto` (a barra) | não |

⚠️ **O que não se podia fazer era dar à barra uma consulta própria** — aí a sequência divergiria
da lista, que é o defeito que a fonte única evita.

A busca global continua sendo `buscarServidoresFolhaPonto`: quando ela estava ativa na tela, é
ela que a barra consome. Trocar uma pela outra faria a seta percorrer um conjunto que o usuário
não viu.

## O caminho de volta

Os filtros viajam na query `origem` de cada folha aberta pela lista, e voltam por ela.

⚠️ **A URL vence o `sessionStorage`** (que já preservava os filtros entre visitas avulsas e
continua fazendo isso): quem clica em "Voltar à lista" está pedindo o estado **daquela**
navegação, e o `sessionStorage` pode ter sido sobrescrito por outra aba aberta na mesma tela.

⚠️ **A página volta junto.** Sem isso, quem estava na página 7 de uma unidade grande voltava para
a 1 e tinha que procurar de novo onde estava — exatamente o trabalho que a mudança existe para
tirar. Isso obrigou o efeito de reset de página a **pular a montagem**: ele roda depois dos
inicializadores de estado e jogaria de volta para a página 1 justamente quem acabou de voltar.

⚠️ **As setas usam `router.replace`, não `push`.** Com `push`, depois de percorrer dez folhas o
"voltar" do navegador desfaria a navegação uma a uma em vez de devolver a lista. O caminho de
volta é explícito, no botão da esquerda — esse usa `push`.

## De volta para a grade

Dois caminhos, ambos para `/escalas/unidade/{unidade}?setor={setor}&mes={mes}&ano={ano}`:
o botão **Ver na Escala** na barra, e o **nome do setor** no cabeçalho do documento (o inverso do
clique no nome do servidor na grade).

⚠️ **Sem `origem`.** Os filtros daqui são os da lista de FOLHAS, e a barra da grade leria a
querystring como se fossem os filtros de `/escalas`. Sem eles, a grade cai no filtro padrão para a
competência que está abrindo, que é o comportamento correto.

## A barra entra como SLOT, não por import

⚠️ O mesmo `FolhaPontoEditor` é renderizado pelo **Portal do Servidor**
(`ConsultarEscalaClient`), que autentica por PIN e por isso recebe as actions por prop em vez de
importar `folha-ponto/actions`. Importar `NavegacaoFolhas` dentro do editor arrastaria aquelas
actions para o grafo do portal. A page `[id]` monta a barra e a passa como `navegacao?: ReactNode`;
no portal a prop não vem e nada é renderizado.

Com a barra no ar, a seta solta do cabeçalho virou um segundo "voltar" sem rótulo, apontando para
a lista **sem** os filtros de origem — o defeito que esta mudança fecha. Ela só aparece quando não
há barra.

## Detalhes de processo

⚠️ **O gerador da listagem DETECTA o EOL em vez de assumi-lo.** A convenção do projeto é CRLF, mas
`folha-ponto/page.tsx` está em **LF**. Padrão montado com o EOL errado vira replace no-op
silencioso e o gerador "passaria" sem ter trocado nada (armadilhas 48 e 59).

⚠️ **O validador do portão precisou de fixtures que ISOLAM cada desempate.** A primeira versão
anulava o desempate por matrícula e o portão **passava**: o desempate seguinte (pela escala)
acertava por coincidência do fixture. Hoje matrícula e escala apontam para lados opostos, e cada
elo da cadeia é derrubado sozinho numa regressão própria.

## Portões

- `node scratchpad/sim_folha_navegacao.js` — **60 asserções**.
- `node scratchpad/val_sim_folha_navegacao.js` — **10 regressões injetadas, 10 reprovadas**.
- `node scratchpad/sim_manual.js` — 931 asserções (o manual entrou no mesmo commit).

Transpile antes com:

```bash
npx tsc src/utils/folhaNavegacao.ts --outDir scratchpad/_sim --module commonjs --target es2020
```

## Não foi feito

- **A grade não ganhou caminho para as apurações do período** (`/folha-ponto/apuracoes`) — fora do
  pedido.
- **O contador "X de N" não bate com a posição na lista da tela** quando há gente sem folha
  gerada: a lista mostra todos, a sequência só quem tem folha. É a decisão descrita acima; o
  rótulo "Próxima: NOME" orienta.
