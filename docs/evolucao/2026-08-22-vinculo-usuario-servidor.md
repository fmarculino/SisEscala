# O vínculo usuário ↔ servidor não existia — 22/08/2026

## O relato

> "no cadastro do servidor, no campo e-mail, quando atualiza esse campo não está atualizando o
> campo do usuário que está vinculado — no cadastro do usuário é vinculado o servidor mas é
> bloqueado, então quando atualizar no cadastro do servidor deveria atualizar no usuário também."

O fluxo real de uso: cadastra-se o servidor primeiro; depois, para os poucos que terão acesso ao
sistema, cria-se o usuário em `/usuarios` escolhendo o servidor num dropdown, e a tela "puxa" nome
e e-mail dele. Daí a expectativa de que existisse um vínculo.

## O que se encontrou

**Não existia vínculo nenhum.** `profiles` não tem — nunca teve — coluna `servidor_id` nem `email`
(o e-mail do usuário mora só em `auth.users`). O que havia:

1. Um `<input type="hidden" name="servidor_id" value={selectedServidor} />` em
   `UserManagementClient.tsx`, presente há muito tempo. **`createUser` e `updateUser` nunca leram
   esse campo.** Escolher o servidor só autopreenchia nome e e-mail no formulário; nada era gravado.
2. A associação exibida na lista de usuários (cargo, lotação) era recalculada a cada render em
   `usuarios/page.tsx`, casando **por e-mail igual OU por nome igual**.
3. `updateServidor` gravava `servidores.email` e não tocava em `auth.users`. Nenhuma trigger no
   banco fazia isso — nenhuma migration mexe em `auth.users` além de FKs por `id`.

Ou seja: corrigido o e-mail na ficha do servidor, o login continuava com o antigo, o casamento por
e-mail quebrava, e sobrava só o casamento por nome. Como a tela de usuários bloqueia a edição do
e-mail de propósito, não havia caminho nenhum para consertar pela interface.

### O estrago não parava na tela de usuários

Três telas identificam o servidor logado por `servidores.email = auth.email`:

| tela | linha |
|---|---|
| `escalas/page.tsx` | 113 |
| `escalas/unidade/[unidadeId]/page.tsx` | 57 |
| `escalas/unidade/[unidadeId]/ScaleGrid.tsx` | 345 |

Um usuário de papel `comum`/`servidor` perdia acesso à própria escala assim que os dois e-mails
divergiam — sem mensagem que explicasse por quê.

## Medição em produção (22/08/2026)

63 usuários de autenticação, 63 profiles, 499 servidores. Zero e-mails e zero nomes duplicados
entre os servidores, o que tornou o backfill 1:1 seguro.

| situação | quantos |
|---|---|
| casam por e-mail — backfill automático | 59 |
| casam só por nome (e-mail divergente) | 2 |
| não casam com servidor nenhum | 2 |

Os quatro casos que não casaram por e-mail:

- **ALDENIR DA SILVA BARBOSA** — login `aldenirdasilvabarbosa6@gamil.com`, ficha
  `aldenirdasilvabarbosa6@gmail.com`. É o caso relatado: typo no cadastro, corrigido na ficha,
  login intocado. **Corrigido em produção nesta sessão**, com `email_confirm: true` e linha em
  `logs_sistema` (`USUARIO_EMAIL_LOGIN_ALTERADO`). A senha não mudou.
- **ILDIMAR NASCIMENTO ARAÚJO DOS SANTOS** — o usuário tem e-mail, a ficha do servidor está com
  `email = null`. Casa por nome; o backfill por nome o pega.
- **PAULA DHESSICA** — divergem nos dois campos (`...rabelo700@` × `...rabelo70@`, `OLIMPYO` ×
  `OLYMPIO`). Fica para vínculo manual pela tela, que agora mostra a sugestão.
- **`admin@admin.com`** — não é servidor. Fica sem vínculo, corretamente.

⚠️ **ALDENICE DE SOUSA DA SILVA** (mat. 44989), citada no relato, **não tem usuário nenhum** entre
os 63. Ela não acessa porque nunca teve acesso criado — não por e-mail errado. São dois problemas
diferentes com nomes parecidos, e vale conferir antes de agir.

## O que passou a existir

`profiles.servidor_id` (migration `20260822100000`), com índice único parcial: 1 servidor → no
máximo 1 usuário; servidor sem usuário é o caso normal. Backfill em duas passadas — e-mail exato,
depois nome exato — cada uma com dupla `row_number()` garantindo 1:1.

| peça | onde |
|---|---|
| grava o vínculo na criação e na **edição** do usuário | `usuarios/actions.ts` (`createUser`/`updateUser`) |
| recusa vincular servidor já ocupado (a action, não só a tela) | `validarServidorLivre` |
| lista de usuários usa o vínculo; heurística vira só **sugestão** | `usuarios/page.tsx` |
| dropdown esconde servidor já vinculado; edição mostra e permite corrigir | `UserManagementClient.tsx` |
| propaga o e-mail para `auth.users.email` do vinculado | `updateServidor` |

### Decisões que não devem ser desfeitas

- **Só `super_admin`/`rh` propagam o e-mail.** Trocar esse endereço troca a credencial de login, e
  quem edita ficha de servidor é coordenador — sem a restrição, um coordenador apontaria o login de
  um administrador para um endereço próprio e dispararia "esqueci minha senha". Reusa a mesma régua
  de `isSuperAdminEditor` que a transferência direta já usava.
- **Para quem não pode, a alteração é recusada por inteiro**, não gravada pela metade. Gravar em
  `servidores` e deixar o login para trás é exatamente o defeito original.
- **Esvaziar o e-mail de servidor com usuário é recusado** — não dá para apagar um login.
- **Conflito de e-mail é checado antes do UPDATE.** O Auth recusaria depois, deixando os dois lados
  divergentes de novo.
- **A propagação só roda depois do UPDATE em `servidores` passar.** A RLS pode filtrar a linha e
  devolver zero linhas gravadas; trocar o login antes disso mudaria a credencial de alguém sem que
  nada tivesse sido salvo.
- **Conta existente e ainda não vinculada é resgatada pelo e-mail ANTIGO**, e o vínculo é gravado
  na passagem — só quando o candidato é único e não pertence a outro servidor.
- **Escolher servidor na edição não sobrescreve o campo de e-mail.** Na criação o e-mail do
  servidor vira o login; na edição o login já existe, e trocá-lo é ato da ficha do servidor, nunca
  efeito colateral de um clique num dropdown.
- **O vínculo é resolvido mesmo para servidor inativado.** O dropdown filtra `status = 'Ativo'`;
  sem a consulta extra, a página devolveria `servidor_id: null` e o próximo "Salvar" desvincularia
  sozinho.

## Portão: aplicada em produção em 22/08/2026

A migration foi rodada no SQL Editor do Supabase de produção (self-hosted no Coolify — porta 5432
bloqueada por firewall e fora do MCP, então não há caminho automatizado a partir do repositório).
Conferência logo depois, e o resultado **bate exatamente com o previsto antes de aplicar**:

| | previsto | medido |
|---|---|---|
| usuários vinculados | 61 | **61** |
| sem vínculo | 2 | **2** — `admin@admin.com` e PAULA DHESSICA |
| servidores com mais de um usuário | 0 | **0** |

ALDENIR ficou vinculado ao servidor certo, com o mesmo e-mail nos dois lados. Ele casou pelo passo 1
(e-mail exato) porque o login já tinha sido corrigido nesta mesma sessão — não pelo passo 2.

**PAULA DHESSICA continua sem vínculo de propósito**: divergem o nome (`OLIMPYO` × `OLYMPIO`) e o
e-mail (`...rabelo700@` × `...rabelo70@`), então nenhum dos dois critérios do backfill a alcança —
e adivinhar qual dos dois lados está certo é decisão de quem conhece a pessoa, não da migration.
Resolve-se em `/usuarios`: a tela mostra a sugestão de correspondência e um clique grava o vínculo.
Feito isso, corrigir o e-mail na ficha dela passa a propagar para o login.

A migration é idempotente (`IF NOT EXISTS` na coluna e no índice; backfill só onde
`servidor_id IS NULL`) e traz a consulta de conferência comentada no fim.
