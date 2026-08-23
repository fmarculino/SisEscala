# O RH passou a cadastrar usuários — e a tela nunca foi a defesa — 22/08/2026

## O pedido

> "precisamos dar condição do perfil do RH cadastrar usuários. RH GERAL cadastra usuários para
> todas as unidades exceto usuários com perfil administrador geral; já o RH UNIDADE pode cadastrar
> usuários só das próprias unidades e lógico não pode cadastrar perfil de administrador geral.
> Consequentemente eles vão precisar ver o menu sistema/usuários mas vão ficar restritos — o RH
> unidade não pode visualizar os usuários de unidades que não as dele."

E, logo depois: **"diretores, coordenadores e ass. administrativos continuam sem acesso a cadastrar
usuários."**

## O que se encontrou antes de escrever qualquer linha

`/usuarios` era `super_admin` puro — um `if` no topo de `page.tsx`. Ao ler as server actions para
saber onde encaixar o escopo do RH, apareceu o problema de verdade:

🚨 **Nenhuma das cinco server actions conferia papel.** `createUser`, `updateUser`, `resetPassword`,
`deleteUser` e `toggleUserStatus` montavam um client com `SUPABASE_SERVICE_ROLE_KEY` e escreviam
direto, sem perguntar quem estava chamando. A única autorização do módulo inteiro era a página.

Server action do Next é um endpoint POST cujo id sai no bundle do cliente. Quem soubesse o id podia
chamar `createUser` e criar para si um **Administrador Geral** — sem passar por tela nenhuma.
Não é consequência desta mudança: já era assim. Abrir o menu para o RH sem fechar isso apenas
aumentaria o número de pessoas com sessão válida capazes de tentar.

É a **armadilha 12** do `CLAUDE.md` outra vez ("quando uma tela filtra as opções, a RPC ainda
precisa recusar as inválidas"), agora do lado do Next em vez do lado do Postgres.

## As decisões (usuário, 22/08/2026)

**1. Que papéis o RH da Unidade pode atribuir?** Escolhido: **só os escopados por unidade** —
Ass. Administrativo, Coordenador e RH da Unidade.

Não é conservadorismo, é o fecho da escalada. `rh` (RH Geral) tem bypass total em
`applyAccessFilters` — enxerga a secretaria inteira. `admin` (Diretor) carrega gestão ampla. Criar
uma conta dessas **com senha que ele mesmo define** contornaria o próprio escopo em um clique:
bastaria sair e entrar com o acesso recém-criado. Pelo mesmo motivo o RH da Unidade não concede
`acesso_todas_unidades`.

**2. Que ações além de criar e editar?** Escolhido: **redefinir senha** e **ativar/inativar**, ambas
dentro do escopo. **Excluir ficou só com o Administrador Geral** — apaga do Auth e do banco, é
irreversível e (diferente de inativar) não deixa log. Para tirar alguém do ar, inativar resolve e é
reversível.

## O modelo

Fonte única em **`src/utils/gestaoUsuarios.ts`**, aplicada nos três lugares que precisam concordar:
página (o que a lista mostra), client (o que o `<select>` oferece) e actions (o que o servidor
aceita de fato). Só o terceiro é defesa; os outros dois são conveniência.

| gestor | vê / administra | pode atribuir |
|---|---|---|
| `super_admin` (Administrador Geral) | todos | todos |
| `rh` (RH Geral) | todos, **menos** `super_admin` | todos menos `super_admin` |
| `rh_unidade` (RH da Unidade) | só conta cujo escopo **cabe inteiro** dentro das unidades dele | `ass_adm`, `coordenador`, `rh_unidade` |

`admin`, `coordenador` e `ass_adm` continuam sem acesso à tela.

### Uma regra só para gravar

`validarPayload` não tem lista de exceções: ele chama `alcancaUsuario` **sobre o resultado** da
gravação. Ou seja — **o gestor não pode deixar no ar uma conta que ele mesmo não enxergaria.**

Isso resolve papel atribuído, "Acesso Total" e unidades/setores escolhidos de uma vez. Três listas
separadas divergiriam na primeira manutenção; esta não tem como.

### Alcance é sobre o estado ATUAL, conferido antes do payload

Em `updateUser` a ordem importa e está registrada no código: primeiro `alcancaUsuario` sobre o que
a conta **é hoje**, depois `validarPayload` sobre o que ela **vai virar**. Invertendo, um RH da
Unidade "puxaria" para dentro do escopo dele uma conta de outra unidade só mandando as unidades
certas no formulário — a checagem final passaria, porque o resultado seria legítimo.

### Conta vinculada só por setor conta como sendo da unidade

É o caso do coordenador cujo acesso vem inteiramente de `profile_setores`, sem a unidade-pai
vinculada (o mesmo que motivou `fn_unidade_alcancavel_por_setor`, 12/08/2026). Exigir
`permitted_unidades` não-vazio esconderia essas pessoas do RH da Unidade delas.

O mapa setor→unidade vem dos setores que a tela/action já carregou — e ela carrega só os das
unidades do gestor. **Setor desconhecido é tratado como fora do escopo**: a dúvida fecha, não abre.

## Dois defeitos pré-existentes corrigidos junto

### 1. `profiles` não podia ser lido pela sessão do RH

A policy `"Users can view own profile"` libera a tabela inteira só para `super_admin`. Com a sessão
do RH, a consulta da página devolveria **uma linha só** — a dele. A listagem passou a usar o client
admin, e **quem restringe a lista é o filtro de escopo em JS**, não a RLS. Nenhuma policy foi
alterada: esta tela nunca dependeu de RLS para nada (as actions já eram `service_role`).

### 2. `listUsers()` devolve no máximo 50 contas, em silêncio

O `perPage` padrão do supabase-js é 50 — o mesmo tipo de corte da armadilha 8 (PostgREST em 1000
linhas), com o mesmo modo de falha: resultado errado com cara de certo. Com **63 contas** em
produção, **13 pessoas nunca apareceram** em `/usuarios`. E havia consequência fora da tela: a
checagem de e-mail duplicado de `updateServidor` (escrita no mesmo dia, para o vínculo
usuário↔servidor) varria essa lista truncada e deixaria passar um conflito que o Auth recusaria
logo em seguida — deixando os dois lados divergentes, exatamente o defeito que ela existe para
evitar.

Fonte única: `listarTodosUsuariosAuth` (`src/utils/authAdmin.ts`), que pagina. Os três pontos de
chamada passaram a usá-la. **Nunca chamar `listUsers()` cru.**

## O que mudou na tela

- Menu: **"Usuários" liberado dentro do grupo SISTEMA** para os dois papéis de RH. Configurações,
  Backup e Segurança continuam exclusivos do Administrador Geral (`itensSistemaParaRh`).
- O `<select>` de Nível de Acesso deixou de ser uma lista fixa no JSX e passa a ser montado a partir
  de `PAPEIS_ATRIBUIVEIS` — era ele que mostrava "Administrador Geral" no filtro para qualquer um.
- Para o RH da Unidade, a caixa **"Acesso Total"** de unidades **some**, e os dropdowns de unidade,
  setor e servidor trazem só o que é dele.
- O botão de **excluir** só aparece para quem pode excluir; **ativar/inativar** deixou de ser
  exclusivo do Administrador Geral.

## Verificação

Não há framework de teste no projeto. O portão é `scratchpad/sim_gestao_usuarios.js` — **34 casos**
de alcance, payload e exclusão, incluindo os que só existem por causa de decisões acima: coordenador
vinculado só por setor, conta que pega duas unidades, conta órfã sem perfil, RH da Unidade sem
nenhuma unidade vinculada, e cada tentativa de escalada recusada.

```
npx tsc src/utils/gestaoUsuarios.ts --outDir scratchpad/_sim --module commonjs --target es2020
node scratchpad/sim_gestao_usuarios.js
```

`npx tsc --noEmit` e `npm run build` passam. **Nenhuma migration foi necessária** — a mudança é
inteiramente da camada de aplicação.

## O que ficou de fora

- **Não se mexeu em nenhuma policy de RLS.** A tela de usuários nunca dependeu delas; mexer ali
  afetaria outras telas sem necessidade.
- `validarServidorLivre` continua devolvendo o nome do usuário que já ocupa um servidor. Para um RH
  da Unidade isso pode revelar um nome de outra unidade — o dropdown dele só oferece servidores das
  unidades dele, então o caminho é estreito, e a alternativa (mensagem genérica) tornaria o erro
  impossível de resolver sozinho. Registrado, não corrigido.
