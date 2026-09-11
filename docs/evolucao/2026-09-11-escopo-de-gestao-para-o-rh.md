# O RH não alcançava as duas telas que mais usa (11/09/2026)

**v2.56.0** · migrations `20260911100000`, `20260911110000`, `20260911120000`

## O pedido

> "Os RHs precisam ter acesso a todas as opções desta tela, sendo que RH Geral tem acesso a tudo e
> RH da Unidade tem acesso a suas respectivas unidades."
>
> "Da mesma forma os RHs precisam ter acesso total a essa página também; hoje eles não conseguem
> ver os cadastros duplicados e documentos com dígitos errados, servidor sem CPF e possíveis
> duplicados."

Duas telas: `/marcacoes` e `/servidores/pendencias`.

## O que estava no caminho

| tela | quem alcançava | o que faltava |
|---|---|---|
| `/marcacoes` | 4 abas (Terminais, Dispositivos REP, Higiene, Pendrive) presas em `['admin','super_admin']` | abrir para `rh` e `rh_unidade` |
| `/servidores/pendencias` | `rh` via tudo **menos** "Cadastros duplicados"; `rh_unidade` recebia `[]` **literal** | fazer o ramo escopado consultar de verdade |

🚨 **Mexer só na tela produziria um defeito pior que o atual.** As seis funções do banco por trás
daquelas abas têm allowlist de papel escrita à mão — `fn_gerar_token_dispositivo_rep`,
`fn_gerar_token_terminal_local`, `fn_definir_setores_dispositivo_rep`,
`fn_higiene_usuarios_dispositivo`, `fn_enfileirar_remocao_usuarios_dispositivo` e
`fn_registrar_substituicao_dispositivo`. Todas anteriores a `rh`/`rh_unidade` existirem
(armadilha 44). A aba apareceria e o botão morreria com *"Apenas administradores podem…"*.

ℹ️ **Um achado que reduziu o trabalho:** a RLS de `servidores` já escopa `rh_unidade` por
`profile_unidades` desde `20260818100000`. "Servidores sem CPF" e os contadores passaram a
funcionar **sem tocar no banco** — estavam vazios porque a página mandava `[]` de propósito, não
por falta de permissão.

## As três decisões, com o número na frente

### 1. Grupo de duplicidade que atravessa unidade aparece INTEIRO

Medido em produção em 10/09/2026:

| | grupos no escopo | com ficha de OUTRA unidade |
|---|---|---|
| HMI — possíveis duplicidades | 52 | **40 (77%)** |
| HMI — mescláveis (mesmo CPF) | 26 | **19 (73%)** |
| HMM — possíveis duplicidades | 120 | 43 (36%) |
| HMM — mescláveis | 46 | 18 (39%) |

Exigir o grupo inteiro dentro do escopo deixaria o RH do HMI com **12 de 52** — e os 63 grupos
cruzados da base continuariam sem dono na ponta. Mostrar só metade do grupo também não serve: a
duplicata **é** o mesmo CPF em dois lugares, e sem o outro lado não há como julgar se é a mesma
pessoa nem para quem escalar.

⚠️ **O filtro é no `HAVING`, sobre o GRUPO — nunca no `WHERE` da `base`.** Recortar os membros
destruiria o grupo: `count(*) > 1` deixaria de casar e a duplicata cruzada sumiria dos **dois**
lados, que é o oposto do que se quer.

### 2. RH da Unidade VÊ os mescláveis e NÃO mescla

**27 dos 62 grupos atravessam unidade** e **31 já têm ponto, escala ou folha**. Mesclar move esses
registros de uma ficha para a outra e inativa a que sai — num grupo cruzado, isso é mover ponto de
uma unidade que não é a dele. Ele identifica e escala; o RH Geral executa.

O botão vem **desabilitado com o motivo escrito ao lado** (armadilha 31): botão cinza e mudo ensina
a contornar a tela.

### 3. RH da Unidade concede dispensa de ponto nas unidades dele

`autorizacoes_ponto_coletivo` tinha **0 linhas** em produção — ninguém nunca concedeu uma. A
decisão de 27/08/2026 (*"o ofício é endereçado ao RH central"*) foi ampliada pelo usuário.

🚨 **O Diretor (`admin`) continua de fora, e é por causa dele que a allowlist de papel existe nas
duas RPCs.** O predicado novo trata `admin` como irrestrito — é assim que ele se comporta no resto
de `/marcacoes`, onde sempre teve acesso —, então usar **só** o predicado daria a um Diretor de uma
unidade o poder de dispensar de bater ponto qualquer servidor da rede. **Papel decide QUEM; o
predicado decide ATÉ ONDE.** Os dois.

## A fonte única

`unidadeNoEscopo` em **`src/utils/escopoGestao.ts`** e **`fn_escopo_gestao_alcanca(unidade)`** no
banco, espelhos um do outro:

```
super_admin · admin · rh   irrestrito
rh_unidade                 profile_unidades ∪ unidades alcançadas por profile_setores
demais papéis              nenhuma unidade
```

⚠️ **O braço de `rh_unidade` NÃO chama `fn_unidade_no_escopo`.** Aquela função devolve `true` para
quem tem `acesso_todas_unidades`, e a flag é uma **caixa** na tela de usuários — um `rh_unidade`
com ela marcada passaria a gerir o parque inteiro no banco enquanto o TypeScript (que ignora a flag
para esse papel, mesma assimetria de `avaliacaoTransferencia.ts`) continuaria filtrando.
Divergência entre tela e banco é exatamente o que isto existe para não criar.

⚠️ **`rh` entra por PAPEL, não pela flag.** Os 8 perfis têm `acesso_todas_unidades = true` hoje e
`fn_unidade_no_escopo` já os deixa passar **por acidente de dado**; um RH Geral criado sem marcar a
caixa veria a tela vazia sem nenhuma mensagem.

⚠️ **`fn_unidades_de_gestao` é DERIVADA do predicado** (`WHERE fn_escopo_gestao_alcanca(u.id)`),
nunca reescrita. Duas implementações da mesma regra divergem na primeira mudança — e aqui a
divergência seria "a tela mostra X, o guard aceita Y". São 35 unidades: o custo é irrelevante.

## O que a tela não protege

⚠️ **Toda action de `/marcacoes` confere o escopo do REGISTRO, não só do formulário.** As listagens
usam `createAdminClient` (service_role, BYPASSRLS), então a policy "Leitura de dispositivos por
escopo" não roda — o filtro é na action. E editar confere os **dois** lados (a unidade em que o
equipamento está hoje **e** a que veio no payload): só o payload deixaria um RH da Unidade adotar
relógio de outra unidade; só o estado atual o deixaria empurrar o dele para fora do escopo. É a
mesma lição de `updateUser`.

⚠️ **`/api/coletor-rep/download` passou a conferir unidade por equipamento.** O `.zip` carrega o
**token e a senha** do relógio dentro do `config.yaml`, e o id vem do corpo do POST. Pacote com um
relógio fora do escopo é recusado **inteiro**, pelo mesmo motivo do "faltando UM" que já existia:
pacote incompleto instala, roda, e deixa o equipamento de fora sem coleta, sem erro nenhum.

⚠️ **A lista de responsáveis pelo terminal passou a ser filtrada**, e não é cosmético: responsável
com escopo de outra unidade faz `fn_registrar_ponto_terminal_local` recusar **toda** batida daquele
terminal, com a mensagem errada na cara do servidor (armadilha 56). Quem **já** é responsável nunca
some da lista, mesmo fora do escopo — sumir faria o `<select>` abrir vazio e o próximo "Salvar"
trocar o responsável sem ninguém pedir (armadilha 28).

## O vazamento achado de passagem

🚨 **`fn_documentos_invalidos` estava aberta ao `anon`.**
`POST /rest/v1/rpc/fn_documentos_invalidos` com a chave pública devolvia **HTTP 200**. Hoje sai
`[]` porque a CHECK `chk_servidores_cpf_digito` impede gravar documento inválido — mas na primeira
linha ela entregaria **nome + CPF/PIS de servidor sem login nenhum**, o mesmo caso de
`fn_tentativas_negadas_diagnostico` em 30/08/2026.

Armadilha 24 pura: ela nasceu em 09/08/2026 com `GRANT ... TO authenticated` e **nunca** teve
`REVOKE ... FROM PUBLIC`, então as três migrations `20260827*` e a `20260830120000` passaram por
cima dela. Fechada aqui, e conferida por fora: agora devolve **401**.

## O que NÃO mudou, de propósito

- **Coordenador e Ass. Administrativo não ganharam nada.** E não perderam: a aba Autorizações
  continua listando para eles **sem recorte** — é por ela que o coordenador confere a vigência
  antes de declarar em massa. `filtrarPorUnidade` os zeraria; `ehEscopadoPorUnidade` existe para
  que o recorte novo alcance só quem o recorte novo descreve. Estreitá-los é decisão própria, com
  medição própria.
- **A recusa de quem tem servidor Ativo casando não saiu da higiene.** É o que impede de apagar do
  relógio quem está batendo ponto — e agora há mais gente com o botão na mão.
- **`fn_unidade_no_escopo` não foi tocada** (38 migrations dependem dela), nem as policies de RLS.

## Armadilhas que os portões pegaram durante o trabalho

1. **O gerador apontava para a migration errada.** `fn_mesclar_servidores` nasceu em
   `20260904130000`, mas a versão **vigente** é a `20260906100000` (a que funde escala do mesmo
   setor). O invariante "fusão de escala roda antes do laço genérico" abortou o script — que é
   exatamente para isso que ele existe.
2. **Recuo divergente entre os dois ramos de `page.tsx`**: 8 espaços no escopado, **6** no
   completo. O script abortou em vez de fazer no-op silencioso.
3. **Uma regressão que eu mesmo ia introduzir**: `filtrarPorUnidade` zeraria a aba Autorizações
   para o coordenador, que a vê hoje.
4. **O Diretor ia ganhar a dispensa de ponto de graça**, por herança do predicado.

## Conferência

**Homologação** — cenário sintético e ensaio revertido por `RAISE EXCEPTION` proposital:

| ensaio | resultado |
|---|---|
| predicado e funções reais, nos dois sentidos | **9 de 9** |
| autorização (concede na própria, recusado fora, lote misto nomeia quem ficou de fora, Diretor e coordenador barrados) | **6 de 6** |
| recorte do diagnóstico | **8 de 8** — RH Geral 2 grupos, RH da Unidade **1**, grupo cruzado com os **2 cadastros** |

**Produção** — aplicada pelo usuário em 11/09/2026, conferida por
`scratchpad/ver_escopo_rh_producao.mjs`, que **executa** as funções: **TUDO OK**. `anon` recebe 401
nas 7 funções conferidas (inclusive a que vazava), as contagens batem com a medição de 10/09
(**156 / 62 / 0**), **os 62 grupos vêm inteiros** com os 27 cruzados visíveis, o parque segue com
**32 relógios e 1 terminal** e **nenhum token foi rotacionado**.

**Portões:** `node scratchpad/sim_escopo_gestao.js` (80 asserções) e
`val_sim_escopo_gestao.js` (**7 regressões injetadas, 7 reprovadas**). Transpile antes com
`npx tsc src/utils/escopoGestao.ts --outDir scratchpad/_sim --module commonjs --target es2020`.
Estrutura das migrations: `node scratchpad/ver_migrations_20260911.js`.
