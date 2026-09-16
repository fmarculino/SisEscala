# A tela perguntava "é vínculo adicional?" e não deixava responder

**16/09/2026** — Pendências de Cadastro · importação do RH · duplo vínculo

## O relato

Coordenadora do CAPS III abriu *Pendências de Cadastro → "Não achou seu servidor? Busque em toda
a base"*, procurou pela matrícula **53599**, achou **NEZILDA RIBEIRO DE SOUZA**, escolheu unidade
(CAPS III), setor (NUTRIÇÃO) e cargo (NUTRICIONISTA), digitou o CPF que a tela pedia como
obrigatório e clicou em **Confirmar cadastro**. Recebeu, em vermelho:

> CPF ja cadastrado como NEZILDA RIBEIRO DE SOUZA (matricula 68182).
> Confirme se e vinculo adicional da mesma pessoa.

Nas palavras de quem relatou: *"o sistema identifica a possibilidade do duplo vínculo, está tudo
certo, ele pergunta se realmente é um duplo vínculo, mas não deixa confirmar o cadastro"*.

O sistema estava certo no diagnóstico e **não oferecia lugar nenhum onde responder**.

## A causa

A busca cross-unidade existe porque a importação do RH nem sempre resolve a unidade:
`fn_buscar_pendencia_rh_por_termo` é `SECURITY DEFINER` e **ignora o escopo de propósito**.

A conferência de conflito, não. `buscarConflitoPendencia` (`servidores/actions.ts`) lia
`importacao_rh_pendentes` com o **cliente do usuário**, ou seja sob RLS, e a policy de coordenador
exige `unidade_id` no escopo:

```sql
OR unidade_id IN (SELECT pu.unidade_id FROM public.profile_unidades pu WHERE pu.profile_id = auth.uid())
```

`unidade_id` nulo não pertence a lista nenhuma. A leitura devolvia zero linhas, a action retornava
`{ error: 'Pendência não encontrada.' }` — e a tela **engolia o erro**:

```tsx
const encontrado = (res as any)?.conflito ?? null   // undefined ?? null → null
setConflito(encontrado)                              // "não há conflito"
```

Daí em diante os dois lados mentiam juntos:

- a linha dizia *"Obrigatório — a importação do RH não trouxe CPF para este vínculo"* quando a
  pendência **tem** `cpf_normalizado = 02535278138`;
- os dois rádios (*atualizar cadastro existente* / *é vínculo adicional de verdade*) só são
  renderizados quando `conflito?.tipo === 'cpf'`, então **nunca apareceram**;
- o botão caía em `handleConfirmarNovoCadastro`, que chama a RPC com
  `p_confirma_vinculo_adicional = false`. O banco recusou, corretamente.

## O que foi medido em produção

| fato | valor |
|---|---|
| pendências abertas | 860 |
| **sem unidade resolvida E com CPF** (invisíveis à RLS de quem não tem acesso total) | **564 (65,6%)** |
| dessas, marcadas `vinculo_adicional_de_cpf` | 9 |
| pendências abertas **sem** CPF | 0 |
| pendência 53599 | `cpf_normalizado` preenchido, `unidade_id` **nulo** |
| cadastro em conflito (68182) | Ativo, **HMI - Hospital Materno Infantil** |
| perfil que relatou | `coordenador`, escopo = **só CAPS III**, sem acesso total |

Não era um caso isolado: **dois terços da fila restante** cai nesse defeito para qualquer
coordenador ou RH da Unidade que use a busca cross-unidade — que é justamente a única forma de
achar essas linhas.

## O segundo beco sem saída, que só apareceu ao medir

Mesmo se os rádios aparecessem, *"atualizar cadastro existente"* seria **recusado pelo banco**: o
cadastro 68182 é do HMI, e `fn_atualizar_cadastro_via_pendencia_rh` exige escopo sobre a unidade do
alvo. A recusa está **certa** — completar ficha de outra unidade não é decisão de quem não responde
por ela.

Corrigir só a conferência trocaria um beco sem saída por outro: o rádio apareceria, ela marcaria, e
levaria *"Você não tem acesso a unidade deste cadastro"*. Por isso a detecção passou a devolver
`alvo_no_escopo`, e a tela desabilita a opção **com o motivo escrito ao lado** (armadilhas 31 e 44:
botão que convida ao impossível; instrução que o sistema não oferece).

O caminho certo para ela é **vínculo adicional** — cadastro novo no CAPS III, que
`fn_promover_pendencia_rh` autoriza pelo escopo de `p_unidade_id`, e que a própria importação já
havia classificado (`vinculo_adicional_de_cpf = true`).

## O terceiro defeito, sem caso vivo, achado no caminho

`fn_promover_pendencia_rh` grava
`v_cpf_final = COALESCE(v_pend.cpf_normalizado, <digitado na tela>)` — mas checava duplicidade só
contra `v_pend.cpf_normalizado`. Pendência **sem** CPF + CPF digitado que já pertence a outra ficha
criaria a duplicata **em silêncio, sem perguntar nada** — exatamente o modo de falha que esta tela
existe para impedir (armadilha 50). Foi fechado: a checagem passou a olhar o CPF **que vai ser
gravado**.

ℹ️ **É defesa em profundidade, não correção de caso vivo — e a medição diz mais que isso:**
`importacao_rh_pendentes.cpf_normalizado` é **`NOT NULL`**, e nenhuma das 858 pendências abertas
está vazia ou com menos de 11 dígitos. Então `p_cpf` é sempre ignorado hoje — **e o campo "CPF *"
com o texto *"a importação do RH não trouxe CPF para este vínculo"* nunca deveria aparecer.** Ele
só aparecia quando a conferência falhava calada. Corrigido o primeiro defeito, ele some sozinho.

## O quarto, que a própria conferência pegou — em produção, sem gravar nada

A primeira tentativa de aplicar a migration **abortou**:

```
ERROR: P0001: ABORTADO: fn_conflito_pendencia_rh responde a quem nao tem papel.
```

O guard de papel foi copiado do padrão das funções vizinhas:

```sql
IF (SELECT get_my_role()) NOT IN ('super_admin', 'admin', 'coordenador', 'rh', 'rh_unidade') THEN
```

Medido publicando um JWT com `sub` inexistente: `get_my_role()` devolve **NULL**, e
`NULL NOT IN (lista)` resolve para **NULL**, não para TRUE — **o `IF` não dispara e o guard não
recusa**. Nas funções vizinhas o que segura é o `REVOKE` (anon não executa) mais a RLS; nesta não
serve, porque ela lê a tabela **por fora da RLS** por construção. O guard passou a recusar papel
nulo explicitamente: o default de uma função de segurança é **negar** (armadilha 40).

🚨 **Nada foi gravado em produção nessa tentativa** — conferido depois: `fn_conflito_pendencia_rh`
respondia 404 no PostgREST, ou seja a transação inteira voltou atrás. É para isso que a conferência
que **executa** existe.

## O que mudou

| peça | o quê |
|---|---|
| `fn_conflito_pendencia_rh` (`20260916100000`) | resolve o conflito inteiro em uma chamada `SECURITY DEFINER`: lê a pendência sem passar pela RLS, aplica a prioridade matrícula > CPF e devolve `alvo_no_escopo` |
| `fn_promover_pendencia_rh` | a checagem de duplicidade olha `v_cpf_final` (cópia mecânica por `scratchpad/gen_conflito_pendencia.js`) |
| `buscarConflitoPendencia` | passa a chamar a RPC, e aceita o CPF digitado quando a pendência não tem |
| `src/utils/pendenciaRh/conflitoCadastro.ts` | fonte única: o que a tela pode oferecer, e por que não pode |
| `ImportacaoRhSection.tsx` | erro de conferência vira bloqueio **com motivo**, nunca "sem conflito"; a recusa do banco por CPF reabre a escolha |

### Decisões que não devem ser desfeitas

⚠️ **A RLS de `importacao_rh_pendentes` não foi afrouxada.** Afrouxá-la abriria a fila inteira; o
que se quer é responder sobre **uma** linha que o usuário já achou pela busca. A RPC é bounded a um
id e devolve no máximo uma linha.

⚠️ **`falhou` não pode voltar a colapsar em `conflito: null`.** "Conferi e não há conflito" e "não
consegui conferir" levam a ações opostas. Confundir os dois É o defeito.

⚠️ **A função nova devolve UMA LINHA mesmo sem conflito** (com `tipo` nulo). Zero linhas seria
indistinguível de chamada que falhou — o mesmo problema, um nível abaixo.

⚠️ **`p_cpf` só é consultado quando a pendência não tem CPF próprio**, mesma ordem de
`fn_promover_pendencia_rh`. Perguntar por um CPF e gravar outro seria pior que não perguntar.

⚠️ **A recusa do banco vira pergunta na tela.** `recusaPorCpfJaCadastrado` reconhece as duas
redações em uso (a das migrations, sem acento, e a das actions de cadastro) e **não** reconhece a
de colisão de matrícula, que nunca é vínculo adicional. Cobre também a corrida: a ficha pode nascer
entre abrir a linha e confirmar.

## Portões

- `node scratchpad/sim_conflito_pendencia.js` — 46 asserções, incluindo o caso exato do print e uma
  varredura de 60 cenários que reprova qualquer bloqueio mudo ou caminho que o banco recusaria;
- `node scratchpad/val_sim_conflito_pendencia.js` — **7 regressões injetadas, 7 reprovadas**;
- a migration **executa** as duas funções na conferência (armadilha 42), com JWT sintético, porque
  migration roda como `service_role` e todo guard de papel bypassaria. Confere os dois sentidos: a
  pendência fora do escopo passa a ser lida, **e** a promoção continua recusando sem confirmação —
  numa chamada real, revertida por sentinela. Foi ela que pegou o quarto defeito.

**Validado em homologação com ensaio sintético revertido: 9 de 9 cenários**, com os corpos das duas
funções conferidos por `md5(prosrc)` contra o arquivo — validar texto diferente do que vai a
produção não valida nada. Os cenários: lê a pendência fora do escopo · tipo `cpf` apontando a ficha
certa · `alvo_no_escopo = false` para ficha de outra unidade · prioridade matrícula > CPF · sem
conflito devolve linha com `tipo` nulo · promoção recusa sem confirmação · **com** confirmação grava
o vínculo múltiplo · papel nulo recusado · super_admin vê `alvo_no_escopo = true`. Nada sintético
sobrou (conferido depois: 0 unidades, 0 servidores, 0 pendências `ZZ ENSAIO`, escopo do coordenador
intacto).

## A lição

**Erro de uma conferência nunca pode virar "conferi e está tudo bem".** O sintoma não foi a falha
em si: foi a tela seguir adiante afirmando o contrário do que o banco sabia, pedindo um dado que já
tinha, e terminando numa pergunta sem resposta possível.
