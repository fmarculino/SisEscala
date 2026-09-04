# O Diretor autorizava carga da rede inteira — e ninguém sabia disso (03/09/2026)

Relato do usuário, olhando a tela `/autorizacoes-escala` com 5 pedidos pendentes do HMI:

> acredito que hoje só quem consegue autorizar essas pendencias é o administrador geral e o RH
> geral correto? no entanto preciso que o diretor e o RH de unidade tambem possam autorizar essas
> pendencias

E, logo em seguida:

> esqueci de falar com uma condição, eles só podem autorizar as pendencias de suas proprias
> unidades

## A premissa estava errada pela metade — e as duas metades pediam coisas opostas

Antes de escrever qualquer linha, medi produção (`scratchpad/an_autorizacao_papeis.mjs`).

| papel | quantos | o que `fn_pode_autorizar_excecao_carga` respondia |
|---|---|---|
| `super_admin` | 2 | `true`, sem escopo |
| `rh` (RH Geral) | 8 | `true`, sem escopo |
| **`admin` (Diretor)** | **3** | **`true`, sem escopo** ⚠️ |
| `rh_unidade` | 7 | `true` **dentro das unidades dele** |
| `coordenador` · `ass_adm` | 91 | `false` — solicitam |

Ou seja: **os dois papéis que o usuário queria acrescentar já autorizavam.** O que faltava era o
contrário do que o pedido sugeria.

**RH da Unidade já exercia o poder.** Das 3 exceções concedidas em toda a base, 1 foi de ANA
CAROLINA DOS REIS DE SOUZA (`rh_unidade`, HMI). Isso vale como prova comportamental de que a
função aplicada em produção é a do repositório: só a versão de `20260831120000` concede a esse
papel, e a linha existe. Foi o que permitiu concluir sobre o corpo da função sem conseguir lê-lo
— a porta 5432 é bloqueada por firewall e não existe RPC de SQL cru no PostgREST.

**Diretor autorizava sem escopo nenhum**, no mesmo ramo de `super_admin`/`rh`. E o cadastro
mostra que isso nunca foi intencional: os 3 diretores têm `acesso_todas_unidades = false` e
**uma única unidade** em `profile_unidades` (2 na SMS, 1 no HMI). Mesmo assim, os dois da SMS
podiam decidir os 5 pedidos do HMI.

> ⚠️ **O pedido do usuário não era uma ampliação, era um FECHAMENTO.** Entregar "acrescente o
> Diretor" teria sido um no-op sobre um furo aberto. A condição que ele acrescentou depois é que
> era a mudança inteira.

## O que mudou

`20260903110000_escopo_de_unidade_para_diretor_autorizar_carga.sql` move `admin` do ramo sem
escopo para o mesmo ramo escopado que `rh_unidade` já ocupava.

| papel | antes | depois |
|---|---|---|
| Administrador Geral · RH Geral | tudo | tudo (inalterado) |
| **Diretor** | **tudo** | **só as próprias unidades** |
| RH da Unidade | só as próprias unidades | inalterado |
| Coordenador · Ass. Administrativo | só solicita | inalterado |

### Por que o escopo é o do RH da Unidade, e não a unidade do pedido

"Pendências das próprias unidades" tem duas leituras, e a diferença importa.

`fn_pode_autorizar_excecao_carga` recebe `(servidor, mês, ano)` e **não** recebe a unidade da
solicitação — e não deve receber. Ela é avaliada em dois caminhos:

1. `fn_avaliar_solicitacao_excecao_carga`, onde existe um pedido com `unidade_id`;
2. a **policy de escrita de `excecoes_escala_servidor`**, no caminho do escudo da grade, onde
   **não existe pedido nenhum**.

Escopar pela unidade do pedido daria duas regras diferentes para a mesma pergunta, e o caminho do
escudo ficaria sem defesa. Por isso reusei o critério que `rh_unidade` já obedece: **escala da
competência OU lotação**. O ramo de escala é o que preserva o Servidor Externo (v1.2.4 — lotado
noutro lugar, escalado aqui); o ramo de lotação cobre o mês cuja escala ainda não existe. Os 5
pedidos pendentes de hoje são todos do HMI sobre servidores escalados no HMI: passam pelo
primeiro ramo.

### Por que `super_admin` e `rh` continuam sem escopo

Não é esquecimento. A autorização é **UMA por (servidor, mês, ano)** e vale para a soma de todas
as escalas da pessoa (armadilha 26). Quando duas unidades disputam o mesmo número, precisa existir
alguém que enxergue a rede toda — senão a decisão trava, ou cada unidade sobrescreve a outra sem
ver. `fn_excecao_carga_detalhe` continua mostrando quem concedeu a vigente e de qual unidade,
antes de qualquer gravação por cima.

## Efeito operacional a avisar

⚠️ **PATRICIA e ANA AMÉLIA (diretoras da SMS) param de ver os 5 pedidos do HMI.** Se aparecer
*"sumiram os pedidos da tela de Autorizações"* vindo de um diretor, é isto, e é o comportamento
pedido. VAGNER (diretor do HMI) e as RH da Unidade do HMI continuam decidindo normalmente.

## Portões

A migration **confere o próprio resultado** e aborta se `admin` voltar ao ramo sem escopo. Como
SQL só resolve nome em execução (armadilha 1), a única conferência possível é sobre o texto de
`prosrc` — e ela foi **validada contra o corpo antigo**, que reprova. Asserção que nunca falha não
vale nada (armadilha 36).

Também no bloco: `anon` sem `EXECUTE`, `authenticated` **com** `EXECUTE` (sem ele, *toda* escrita
em `excecoes_escala_servidor` falharia — armadilha 39) e **exatamente uma** policy de escrita na
tabela (permissivas se somam com `OR`).

`node scratchpad/sim_autorizacao_carga.js` → 69/69. `tsc --noEmit`, `lint` e `build` limpos.

## O frontend não mudou de comportamento

`podeAutorizarCarga` em `src/utils/autorizacaoCarga.ts` continua devolvendo `true` para `admin` e
`rh_unidade`: ele diz **quem tem o direito**, nunca o alcance, que depende do servidor e do mês.
Só os comentários foram alinhados.

Em `/autorizacoes-escala` a divergência não produz botão inútil — cada linha traz `pode_avaliar`
já resolvido pela mesma função do banco, e a tela não reclassifica nada. É só na grade (o escudo)
que o `true` é um palpite otimista, porque ali não há uma consulta por servidor; quem estiver fora
do escopo recebe a recusa e o caminho do pedido.
