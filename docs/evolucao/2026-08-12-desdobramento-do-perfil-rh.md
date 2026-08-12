# Desdobramento do perfil RH em RH Geral / RH da Unidade — 12/08/2026

## Contexto

O usuário criou o perfil "Recursos Humanos" (`role = 'rh'`, v1.44/`20260811130000`) pensando em
dois casos reais: um RH central que enxerga tudo, e RHs próprios de unidade que hoje respondem
para o RH central mas só deveriam enxergar a própria unidade. Ao testar limitando um usuário RH a
unidades específicas na tela de Usuários (desmarcando "Acesso Total"), o usuário viu que ele
continuava enxergando dados de outras unidades — pediu uma análise minuciosa das permissões e um
plano de ação antes de qualquer código.

## Diagnóstico

O perfil `rh` foi encaixado **parcialmente** no sistema de permissões quando foi criado:

1. **Excesso de acesso**: `applyAccessFilters` (`src/utils/permissions.ts:50`) tinha
   `role === 'rh'` num bypass incondicional, igual a `super_admin` — usado em 20 telas do
   dashboard. Desmarcar unidades na tela de Usuários não tinha efeito nenhum nelas, porque o
   código nunca olhava pra esse dado.
2. **Falta de acesso**: a RLS de `escala_mensal`/`escala_diaria`/`folha_ponto` (a versão vigente
   de cada uma, `20260618080000`) restringe por
   `get_my_role() = ANY(['admin','coordenador'])` — `rh` foi adicionado ao enum **depois** dessa
   migration e nenhuma migration posterior incluiu o papel. Um usuário `rh` tinha **zero** linhas
   dessas tabelas via RLS, não importa o que estivesse marcado no perfil — `/escalas`,
   `/folha-ponto` e `/relatorios/rh` (a tela batizada justamente pro RH) vinham vazias, mascarado
   como "nenhuma escala fechada" em vez de um erro visível.
3. **`servidores`/`unidades`/`setores` "funcionavam" por acidente**: a policy de leitura de
   `servidores` não checa papel (só `super_admin` explicitamente) — decide por
   `acesso_todas_unidades`/`acesso_todos_setores`/`profile_unidades`/`profile_setores`. Por isso
   o comportamento observado era inconsistente: dependia de qual tela/tabela, não de uma regra
   única.
4. **"Vincular unidade dá acesso a todos os setores dela" nem sempre era verdade**: o aviso na
   tela de Usuários promete isso, mas nas policies que checam `unidade_id IN profile_unidades`
   essa condição vinha **E**'d com `acesso_todos_setores = true` — só o branch alternativo
   `setor_id IN profile_setores` funcionava sem a flag. Vincular só a unidade, sem marcar os dois
   checkboxes, deixava a pessoa sem acesso de verdade em boa parte das tabelas.

Plano completo revisado e aprovado antes de qualquer código (fluxo `EnterPlanMode`/
`ExitPlanMode`) — arquivo de plano não persiste no repo, mas o desenho abaixo é o que foi
efetivamente implementado.

## O que foi construído

- **`rh` (mantém o valor do enum, sem migração de dado) → rótulo "RH Geral"**. Continua
  enxergando tudo — corrige o problema 2 (RLS) sem tirar nada de quem já é `rh` hoje.
- **novo valor de enum `rh_unidade` → rótulo "RH da Unidade"** (migration `20260812060000`, só o
  `ALTER TYPE` — Postgres não deixa usar um valor de enum recém-criado na mesma transação que o
  adiciona, mesmo padrão já usado em `20260811130000`). Escopado por `profile_unidades`, com
  acesso automático a **todos os setores** das unidades vinculadas.
- **`20260812070000`**: `escala_mensal`, `escala_diaria`, `folha_ponto` (as 4 policies) e
  `servidores_eventos` ganham branches para os dois papéis novos — corpo de cada policy copiado
  integralmente da versão vigente antes de ampliar (mesma disciplina do CLAUDE.md, armadilha 1,
  aplicada a policy em vez de função). `rh` ganha bypass incondicional (mesmo nível de
  `super_admin` nessas tabelas); `rh_unidade` ganha um branch próprio de
  `unidade_id IN profile_unidades` **sem** exigir `acesso_todos_setores = true` junto — decisão
  deliberada pra resolver o problema 4 de vez, sem depender de dois checkboxes lembrados na hora
  do cadastro.
- **`src/utils/permissions.ts`**: `UserProfile.role` ganha `'rh_unidade'`. `applyAccessFilters`
  não precisou de lógica nova pro papel novo — ele já cai no fluxo genérico de
  `permitted_unidades`/`permitted_setores`, que funciona certo desde que
  `acesso_todos_setores` esteja `true` (ver próximo item). `hasSectorAccess`/`hasUnitAccess` já
  tinham `role === 'rh'` no bypass desde que o papel foi criado — não precisaram de mudança.
- **`src/app/(dashboard)/usuarios/actions.ts`**: `createUser`/`updateUser` forçam
  `acesso_todos_setores = true` no servidor quando `role === 'rh_unidade'`, **mesmo que o
  formulário não mande isso** — a action é chamável direto, não dá pra confiar só no client.
- **`UserManagementClient.tsx`**: novo item no seletor de papel; ao escolher RH da Unidade, o
  checkbox "Acesso Total" de Setores é marcado e travado automaticamente, com nota explicando o
  porquê (o `<select>` de papel virou controlado — antes era `defaultValue`/`key`, sem estado —
  pra poder reagir à escolha).
- **`sidebar.tsx`**: `isRh` passa a cobrir os dois papéis (mesma visibilidade de menu de hoje,
  tudo exceto SISTEMA — a diferença entre os dois é só no dado que cada tela mostra).
- **Páginas do dashboard com checagem de papel escrita à mão** (fora de `applyAccessFilters`):
  - `escalas/page.tsx` — botão "Gerar Nova Escala" passa a aparecer pros dois papéis.
  - `escalas/nova/page.tsx` — os `if (!prof.acesso_todas_unidades && !isSuperAdmin)` que decidem
    a lista de unidades/setores do formulário ganharam `&& !isRhGeral` (RH Geral enxerga tudo por
    definição do papel, não por uma flag no perfil — o bypass dele vive no código, não no dado).
  - `relatorios/*`, `auditoria/page.tsx`, `folha-ponto/page.tsx`: conferidos e **não precisaram
    de mudança** — só excluem `role === 'coordenador'` explicitamente, nunca `'rh'`, então os dois
    papéis novos já passavam por esses gates; a correção de `applyAccessFilters`/RLS já resolve o
    dado que essas telas mostram.
  - `FolhaPontoEditor.tsx` (editar marcação Real, reabrir folha Revisada) e o "reabrir folha" em
    `folha-ponto/actions.ts`: **deliberadamente não tocados** — são restrições de governança
    específicas (super_admin/admin apenas, v1.4.0/v1.4.1), mais estreitas que "editar folha de
    ponto" em geral e fora do escopo desta correção.

## Decisão registrada: os dois papéis têm capacidade de admin/coordenador (não só leitura)

Assumido que RH Geral e RH da Unidade podem **criar, editar e fechar** escala e folha de ponto —
não só consultar relatório. O comentário original de `20260811130000` já dizia "mesmos dados de
gestão/cadastros/relatórios", e RH tipicamente fecha folha de ponto na prática. Se a intenção real
for RH só consultar, as policies de `20260812070000` precisam trocar de `FOR ALL` pra
`FOR SELECT` nesses dois papéis — não implementado, fica registrado aqui como decisão a revisar
se for o caso.

## Verificação

- `npx tsc --noEmit` / `npm run build`.
- Migration aplicada pelo usuário primeiro em homologação, depois produção.
- Pendente validar em produção: criar um usuário de teste `rh_unidade` vinculado a uma única
  unidade e confirmar que `/servidores`, `/escalas`, `/folha-ponto`, `/relatorios/rh` mostram só
  essa unidade, com todos os setores dela; confirmar que um `rh` (Geral) já existente passa a ver
  escala e folha de ponto (que antes vinham vazias pra esse papel).
