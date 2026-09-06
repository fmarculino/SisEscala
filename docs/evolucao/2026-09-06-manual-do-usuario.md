# O manual do usuário em SUPORTE → Ajuda (06/09/2026)

**Versão 2.44.0.** Nenhuma migration — é tela e conteúdo. Nenhum dado do sistema é lido ou
escrito pelo manual.

## O pedido

> "lá no sisfilasus eu pedi pra vc fazer uma documentação, vc chamou de guia & manual, preciso de
> uma coisa semelhante aqui no sisescala, lembrando que estamos fazendo constantes atualizações
> aqui e essa documentação precisa entrar no radar de atualizações (...) o objetivo desse manual é
> orientar os usuarios de como usar o sistema e mostrar todas as ferramentas disponíveis e como
> usar cada uma delas, tem que ter uma linguagem bem acessível e um visual moderno e intuitivo"

Local confirmado pelo usuário na sequência: **menu SUPORTE → Ajuda**, que é onde o item já existia.

## O que havia antes

`/ajuda` existia com **5 seções curtas** (284 linhas de JSX): Visão Geral, Gestão de Escalas,
Presença e GPS, Sobreaviso, Configurações.

⚠️ E estava **desatualizada de um jeito que induzia ao erro**: a seção "Presença e GPS" descrevia
validação por geolocalização na marcação de ponto. Hoje o GPS é do **sobreaviso** (confere a
chegada ao local do chamado, desde 08/08/2026); a presença não usa GPS. Quem lesse aquilo
procuraria uma tela que não existe.

## O que existe agora

**8 capítulos, 45 seções, 208 blocos.**

| Capítulo | Cobre |
|---|---|
| Comece por aqui | o que é o sistema, os três lugares (retaguarda, terminal, Portal), o menu, os 7 perfis, o vocabulário, as 4 linhas da grade |
| O ciclo do mês | o fluxo em 4 etapas, o roteiro do primeiro mês, o fechamento |
| Escalas | grade, lançamento, Template e Gerador, as 4 travas, validação de presença, servidor externo, mover/dividir escala, sobreaviso, autorizações de carga |
| Ponto e Folha | formas de bater, as cores do terminal, "bati e não apareceu", folha, atraso × compensação, as 9 abas de Marcações, Cobertura de Ponto, justificativas |
| Pessoas e ausências | cadastro, pendências, mesclagem de duplicados, afastamentos, férias, transferência |
| Relatórios e gestão | painel, os 6 relatórios, auditoria, cadastros-base, área de Sistema |
| Para o servidor | Portal, PIN, o que orientar na implantação |
| Dúvidas frequentes | 12 perguntas reais + glossário de 14 termos |

## As decisões de construção

### O conteúdo é DADO, não JSX

`ajuda/conteudo/` é um conjunto de objetos tipados; `ajuda/Blocos.tsx` sabe desenhar cada tipo
(`p`, `titulo`, `passos`, `lista`, `tabela`, `aviso`, `cartoes`, `veja`, `caminho`).

Três coisas dependem disso, e as três quebram com markup solto:

1. **a busca** indexa o texto dos blocos sozinha. Com JSX, a alternativa seria uma lista de
   palavras-chave escrita à mão em cada seção — que envelhece na primeira edição que alguém fizer
   sem lembrar dela;
2. **o visual** é consistente por construção: um aviso tem uma aparência no manual inteiro, e não
   trinta variações copiadas;
3. **a manutenção** — que é o ponto do pedido — é editar um objeto, não caçar markup.

### A linguagem tem uma régua, e ela é verificada

O público é **o coordenador da unidade**. Nome de tabela, função ou migration não entram, nem em
nota de rodapé — e isso não é preferência de estilo: o portão varre o texto procurando `fn_`,
`escala_diaria`, `trigger`, `rpc`, `supabase` e afins, e **reprova**.

Duas outras regras que valem para quem for escrever aqui:

- **explique o porquê junto com o como.** Quem entende a razão da trava para de tentar contorná-la;
- **todo aviso de `cuidado` descreve uma consequência concreta.** Aviso genérico ensina o leitor a
  ignorar os avisos.

### O manual conta o que o sistema realmente faz

O conteúdo saiu de leitura das telas, não de suposição. Alguns exemplos do que entrou por isso:

- **as cores do terminal** — âmbar é "registrado, vai para revisão", e a maior parte das pessoas
  entende como falha e bate de novo. Ganhou seção própria;
- **"bati o ponto e não apareceu"** — um roteiro de 5 passos na ordem de probabilidade, começando
  pela Cobertura de Ponto, que é o caso dominante e é silencioso dos dois lados;
- **atraso × compensação** — por que o sistema pergunta em vez de decidir, e por que "pendente"
  não altera valor nenhum;
- **a folha é uma fotografia** — corrigir a escala não corrige a folha; é preciso Sincronizar;
- **o teto de horas é da pessoa, não do setor** — a grade pode recusar por causa de horas lançadas
  por outra pessoa, em outro setor.

⚠️ Uma descrição vaga foi corrigida na revisão: a aba **Autorizações do RH** tinha entrado como
"autorizações relacionadas ao ponto". Lendo a tela, ela é bem mais específica — o RH libera, por
servidor e período (até 12 meses, com número de ofício), quais passos o coordenador pode declarar
em massa. E a batida de saída **nunca** é dispensada. Virou linha de tabela e aviso próprios.

## A tela

- sumário lateral com capítulos recolhíveis e a seção atual destacada;
- **busca** sobre todo o texto, sem acento e sem caixa, com atalho `/`;
- etiquetas de perfil em cada seção (azul para gestão, verde para servidor, neutro para "todos");
- navegação **anterior / próxima**, porque o manual tem ordem e ela ajuda quem está aprendendo;
- blocos `caminho` mostram onde a ferramenta fica no menu, com botão que abre a tela;
- a área de leitura rola sozinha ao trocar de seção — senão quem clica numa seção longa e depois
  em outra começa a ler no meio do texto novo;
- a versão do sistema aparece no cabeçalho, tirada do `package.json`: quem lê sabe de qual versão
  o manual fala.

## Como ele entra no radar de atualizações

Registrado no **`CLAUDE.md`**, seção "O manual do usuário — atualizar JUNTO, no mesmo commit".

🚨 **Manual desatualizado é pior que manual nenhum**: ele ensina o caminho errado com a autoridade
de documentação oficial, e quem o segue conclui que o sistema está quebrado — e abre chamado sobre
um defeito que não existe. A `/ajuda` anterior já era prova disso, com o GPS na presença.

A defesa que não depende de ninguém lembrar é a **checagem de cobertura** do portão: ele exige que
as **23 telas do menu** sejam citadas em algum lugar do texto. Tela nova que ninguém documentou
reprova o portão — some do radar justamente quem não está escrito.

## Portões

```bash
npx tsc "src/app/(dashboard)/ajuda/tipos.ts" "src/app/(dashboard)/ajuda/conteudo/index.ts" \
  --outDir scratchpad/_sim_manual --module commonjs --target es2020 --skipLibCheck
node scratchpad/sim_manual.js       # 610 asserções
node scratchpad/val_sim_manual.js   # injeta 5 defeitos e exige reprovação nos 5
```

`sim_manual.js` confere: ids de capítulo e seção únicos, todo bloco com tipo conhecido, link
`veja` apontando para seção que existe, tabela com linhas do tamanho do cabeçalho, `**` e crase
balanceados, a busca achando os 12 termos que o manual promete, ausência de jargão técnico e a
cobertura das 23 telas.

`val_sim_manual.js` injeta, no conteúdo transpilado: link quebrado, tabela com célula faltando,
jargão técnico no texto, negrito não fechado e dois ids iguais. Os 5 reprovam, e o manual intacto
passa. ⚠️ Ele **confere que cada injeção foi aplicada** antes de rodar — substituição no-op faria
o validador mentir.

## Arquivos

| arquivo | o quê |
|---|---|
| `ajuda/tipos.ts` | tipos de bloco, índice de busca, normalização sem acento |
| `ajuda/Blocos.tsx` | um renderizador por tipo de bloco, e a marcação leve (`**negrito**`, `` `código` ``) |
| `ajuda/conteudo/` | o manual: 8 arquivos de capítulo + índice |
| `ajuda/ManualClient.tsx` | sumário, busca, leitura, navegação |
| `ajuda/page.tsx` | página fina, só passa a versão |
| `scratchpad/sim_manual.js` · `val_sim_manual.js` | os portões |
