# Servidor externo para quem escala, autorização de carga para o RH, e o pedido que não existia

**31/08/2026** · migrations `20260831110000`, `20260831120000`, `20260831130000`

## De onde veio

O usuário abriu o modal "Adicionar Servidor Externo" logado como **RH da Unidade** e perguntou por
que ele não tem essa permissão, "assim como RH Geral" — e emendou: *"quando está como coordenador
aparece essa mensagem também, como ele vai pedir essa autorização? teria aí que dar a condição de
ser solicitada a permissão, né. No caso dos RH são eles quem autoriza, então se tiver no perfil
deles eles já deveriam poder incluir."*

Eram **duas travas diferentes** com a mesma causa, e a segunda era a mais cara.

## Trava 1 — o modal recusava o RH, e de dois jeitos diferentes

`get_external_servers_for_scale` (06/2026) e `fn_buscar_servidor_para_escala` (31/08/2026, um dia
antes) tinham allowlist **fixa** de papel: `super_admin`, `admin`, `coordenador`. Escrita antes de
`rh` (11/08), `ass_adm` (11/08) e `rh_unidade` (12/08) existirem, e nunca revisitada.

A RLS de `escala_mensal` **já autorizava os três** desde `20260818170000`: o banco deixaria gravar
a escala; o que faltava era poder escolher quem escalar.

⚠️ **O sintoma era diferente em cada caminho do modal, e o antigo é o pior:**

| caminho | o que o RH via |
|---|---|
| busca por nome | `Acesso negado: perfil sem permissão…` |
| Unidade → Setor | a tela **não trata** o erro do RPC — a lista de servidores voltava **vazia**, e quem procurava concluía que a pessoa não estava cadastrada |

Ou seja: o modo de falha silencioso que a busca por nome de 31/08 tinha acabado de resolver estava
vivo ao lado, pela porta do papel.

**A correção não é "allowlist com mais três papéis".** Allowlist de papel envelhece em silêncio —
foi ela que produziu este bug três vezes. `fn_pode_escalar_servidor_externo` é **denylist**: fica
de fora quem é do Portal do Servidor (`servidor`, `comum`), que nem enxerga a grade. Mesma escolha
(e mesmo motivo) de `fn_painel_sobreaviso_dia` em `20260812080000`.

Decisão do usuário, textual: *"adicionar os servidores externos na escala todos podem, desde que
estejam dentro dos limites e regras; agora se estiver fora das regras estabelecidas os RH têm que
autorizar."* — o que a migration implementa literalmente: a porta abre, o teto continua fechado.

⚠️ **O que isso abre, dito por extenso:** as duas funções são `SECURITY DEFINER` e atravessam a RLS
de `servidores` por definição (servidor externo está fora do escopo de quem escala). Então
`ass_adm` e `rh_unidade` passam a ler **nome + lotação** de servidor ativo de toda a rede. Não
expõe CPF, PIS, e-mail, telefone nem PIN — a projeção é a mesma de antes —, e a busca continua
bounded (3 caracteres, LIMIT 30).

⚠️ De quebra: `get_external_servers_for_scale` **nunca teve `REVOKE FROM PUBLIC`** e estava
executável por `anon` desde 06/2026 (armadilha 24). As `20260827*` e a `20260830120000` não a
alcançaram. Fechada aqui.

## Trava 2 — "Solicite a um Administrador" e não havia como solicitar

Ao estourar o teto mensal, quem não era admin recebia:

> Solicite a um Administrador a concessão de uma Autorização Extraordinária.

**Não existia tabela, tela, aviso nem registro.** O pedido acontecia por WhatsApp e a decisão não
ficava em lugar nenhum.

Medido em produção em 31/08/2026:

| papel | contas |
|---|---|
| coordenador | 73 |
| rh | 8 |
| rh_unidade | 7 |
| ass_adm | 8 |
| admin | 3 |
| super_admin | 2 |

**5 pessoas podiam conceder; 96 lançam escala.** E as duas únicas autorizações que existem na base
foram dadas pelo mesmo super_admin (sobreaviso da TI da SMS, 08 e 09/2026): o mecanismo funciona,
o gargalo era quem tinha a chave.

⚠️ **O custo não é o incômodo — é que instrução que o sistema não cumpre ensina a contornar o
sistema.** O teto vira algo que se resolve "falando com alguém", e a decisão sobre carga horária
de servidor público some.

### O que passou a existir

| peça | onde |
|---|---|
| quem **concede** | `fn_pode_autorizar_excecao_carga` (`20260831120000`) — super_admin, admin, `rh`, e `rh_unidade` **dentro do escopo dele** |
| policy de escrita de `excecoes_escala_servidor` | passa a **ler essa função** — fonte única com a tela |
| quem **pede** | `fn_pode_solicitar_excecao_carga` — espelha a policy de escrita de `escala_mensal`: quem lança a escala pede o teto dela |
| a fila | `solicitacoes_excecao_carga` (`20260831130000`), escrita **só** por RPC |
| decidir | `fn_avaliar_solicitacao_excecao_carga` — aprovar **grava a exceção na mesma transação** |
| tela | `/autorizacoes-escala`, item novo em OPERAÇÃO |
| fonte única no frontend | `src/utils/autorizacaoCarga.ts` (portão: `node scratchpad/sim_autorizacao_carga.js`, 69 casos) |

## O que não pode ser desfeito

⚠️ **A policy antiga foi DERRUBADA, não ganhou uma irmã.** Policies permissivas se somam com `OR`
— duas policies de escrita na mesma tabela é a armadilha de `solicitacoes_transferencia_servidor`
(`20260828100000`) outra vez, onde a estrita existia e a permissiva ao lado dela é que decidia. A
migration **aborta** se encontrar mais de uma policy de escrita.

⚠️ **RH da Unidade precisa de escopo, e isso não é formalidade.** A autorização é UMA por
`(servidor, mês, ano)` e vale para a soma de **todas** as escalas da pessoa (armadilha 26). Quem
autoriza mexe num número que a outra unidade também usa. Por isso `fn_pode_autorizar_excecao_carga`
exige o servidor no escopo dele (por escala da competência **ou** por lotação) — e por isso
`fn_excecao_carga_detalhe` existe: o modal mostra **quem concedeu a vigente, de qual unidade e
quando**, antes de gravar por cima. Sobrescrever continua possível (às vezes é o certo: reduzir o
que se concedeu demais); o que não pode é sobrescrever **sem ver**.

⚠️ **Aprovar grava a exceção na mesma transação.** Duas etapas ("aprova aqui, concede ali")
produziriam pedido aprovado sem teto ampliado — a escala continuaria barrada com a tela dizendo
que estava autorizada. Pelo mesmo motivo, a RPC de avaliação confere `fn_pode_autorizar_excecao_carga`
antes de qualquer coisa: sem isso a aprovação passaria e a gravação morreria em erro de RLS.

⚠️ **A tabela não tem policy de INSERT/UPDATE/DELETE, de propósito.** A escrita é exclusivamente
pelas RPCs `SECURITY DEFINER`. Sem isso, qualquer autenticado marcaria o próprio pedido como
`aprovada` chamando o PostgREST direto (armadilha 12: tela filtrada não protege endpoint).

⚠️ **Um pendente por (servidor, mês, ano)** — índice único parcial. Dois pedidos abertos para o
mesmo mês produziriam duas decisões sobre o mesmo número. O segundo é recusado **nomeando quem já
pediu e quando**, em vez de virar fila silenciosa. E existe `fn_cancelar_solicitacao_excecao_carga`
para a trava não virar prisão.

⚠️ **`fn_solicitacoes_excecao_carga` resolve `pode_avaliar` no BANCO, linha a linha** — mesmo
desenho de `podeAvaliar` da avaliação de transferência. A tela não reclassifica nada: se decidisse
por conta própria, seria a segunda cópia da regra, e a divergência apareceria no primeiro papel
novo, exatamente como aconteceu aqui.

## Na grade

Os **quatro** caminhos que avisam sobre o teto — célula, Salvar Previsão, escudo da linha e
Aplicar Template — tinham a condição `role === 'super_admin' || role === 'admin'` escrita à mão,
cada um com seu texto. Trocados de uma vez por `scratchpad/gen_autorizacao_carga_grade.js`, que
**aborta** se qualquer das 11 substituições não bater na contagem: aplicar três de quatro deixaria
um caminho oferecendo "solicite a um Administrador" sem pedido nenhum por trás.

⚠️ **Pedido em aberto muda o que a tela oferece.** Sem isso, quem já pediu recebe de novo o convite
para pedir, e a RPC recusa com "já existe pedido pendente" — a tela mandaria fazer algo que ela
mesma nega. O escudo da linha fica **azul** (pedido em análise) em vez de vermelho (travado e
parado): sem distinguir os dois, quem já pediu vê o mesmo alerta do primeiro dia.

⚠️ **`isAdminRole` (linha ~4275) NÃO foi tocado** — ele é sobre validar presença e ignorar a trava
de previsão, não sobre carga. O gerador confere que ele continua existindo.

## O que ficou de fora, e por quê

- **Aviso ao RH quando chega pedido novo.** Hoje ele descobre abrindo a tela. Encaixaria no motor
  de `avisos_ponto_fila`, mas é decisão de canal (e-mail/WhatsApp) que não foi tomada.
- **Histórico de quem alterou a exceção fora do fluxo de pedido.** A concessão direta pelo modal
  continua sendo um `upsert` que sobrescreve; o que existe é autor + data visíveis antes de
  gravar. Os pedidos, esses sim, guardam a trilha inteira.
- **`fn_teto_carga_servidor` não foi alterada.** Acrescentar o nome do autor ali exigiria
  `DROP` + `CREATE` (42P13, `RETURNS TABLE`), e ela tem três consumidores vivos — um deles dentro
  de outra função SQL. Não vale arriscar o caminho do teto para exibir um nome:
  `fn_excecao_carga_detalhe` é função nova ao lado.
