# Fase 3 da auditoria: fechar o `anon` e defesa em profundidade (30/08/2026)

Terceira e última leva da auditoria de 30/08/2026. Fases 1 e 2 em
[`2026-08-30-fase1-auditoria-de-seguranca.md`](2026-08-30-fase1-auditoria-de-seguranca.md) e
[`2026-08-30-fase2-xss-e-cabecalhos.md`](2026-08-30-fase2-xss-e-cabecalhos.md).

---

## 1. Item 13 — "321 funções abertas ao `anon`" era, em quase tudo, teórico. Menos numa.

O relatório apontava que a maioria das funções do schema continuava executável por `anon` — o
papel cuja chave vai no bundle do navegador. As migrations `20260827*` tinham fechado o núcleo de
presença; sobravam 321.

**Em vez de escrever um REVOKE em massa, medi o que cada uma realmente devolve.**

| função | resposta ao `anon` |
|---|---|
| `get_my_role()` | `null` |
| `fn_unidade_no_escopo()` | `false` |
| `fn_setores_no_escopo()` | array vazio |
| `fn_pendencias_biometria()` | array vazio |
| `fn_cpf_digito_valido()`, `fn_precedencia_origem()`, `fn_intervalo_minimo_legal()` | valor calculado, sem dado |

Isso **confirma a hipótese** que a `20260827050000` tinha registrado: função que confere escopo
sozinha recusa de verdade, porque `get_my_role()` é `NULL` para `anon`. Estar "aberta ao anon"
não é, por si só, vazamento.

### 🚨 Mas uma vazava de verdade, e vazava dado pessoal

```
POST /rest/v1/rpc/fn_tentativas_negadas_diagnostico  {}   com a chave ANON
  -> HTTP 200, 684 LINHAS
```

Devolvendo `servidor_id`, `servidor_nome`, `matricula`, `unidade_nome` e `setor_nome` de servidor
público, **sem login nenhum**. `fn_tentativas_negadas_resumo` idem, em forma agregada (586
tentativas, 240 servidores-dia).

`20260830120000` fecha **17 funções de tela** — as duas acima e as 15 outras que a aplicação
chama com a sessão do usuário. REVOKE de `PUBLIC`/`anon`, reafirmando `authenticated`.

### ⚠️ Quatro funções ficam intocadas, e mexer nelas derrubaria a aplicação

`get_my_role` · `fn_unidade_no_escopo` · `fn_unidade_alcancavel_por_setor` · `fn_setores_no_escopo`

Elas são chamadas **de dentro de policies de RLS** — `get_my_role` aparece em **38 migrations**. A
policy é avaliada com os privilégios de **quem consulta**: tirar `EXECUTE` de `authenticated` ali
faz **toda** consulta daquele papel falhar. Não é degradação, é a aplicação parando. E as quatro
já devolvem vazio/false para `anon`, medido.

A migration tem uma conferência específica que **aborta** se alguma delas perder `authenticated`.

### ⚠️ E as 252 do PostGIS também ficam

Elas dominam a contagem (252 de 321) e são geometria pura, sem acesso a dado. Além disso
pertencem à extensão: **não somos o dono**, e `REVOKE` de quem não é dono só emite `WARNING`
(armadilha 24) — a migration "aplicaria com sucesso" sem mudar nada. Fechar o schema do PostGIS,
se um dia for desejado, é outra decisão com outro método.

ℹ️ A migration resolve as funções **por nome, via `pg_proc`**, não por assinatura fixa no arquivo:
assinatura envelhece a cada parâmetro novo, e uma sobrecarga esquecida deixaria a porta aberta em
silêncio.

---

## 2. Item 20 — `applyAccessFilters` devolvia a query SEM filtro quando o perfil não carregava

```ts
if (!profile) return query    // ← devolvia tudo
```

Na maioria dos sítios era inofensivo: a query vinha de `createClient()` e a RLS restringia por
baixo. Mas em `justificativas/actions.ts:169-182` a função é aplicada sobre uma query de
`createAdminClient()` — `service_role`, com BYPASSRLS. Ali, perfil nulo significava **a tabela
inteira**.

Hoje aquele sítio está protegido por `exigirAcessoAoModulo` **antes** da chamada, então não era
explorável. Mas a proteção dependia de um guard **externo**, e o próximo sítio que combinar admin
client com este helper não teria esse guard por acaso. O default certo para uma função de
segurança é negar.

---

## 3. Item 15 — segredo de cron por query string, e comparação não constante

O fallback embutido de `CRON_SECRET` já tinha sido corrigido em 22/08/2026. Sobravam duas coisas,
agora com fonte única em **`src/utils/segredoCron.ts`**:

- **`?secret=` deixou de ser aceito** nas duas rotas de cron. Query string vaza para log de proxy,
  histórico de terminal e cabeçalho `Referer`. Um segredo que autoriza **fechar escalas e folhas**
  não pode viver na URL. Só `Authorization: Bearer`.
- **Comparação em tempo constante.** `!==` desiste no primeiro byte diferente. Contra segredo
  aleatório o ataque é impraticável pela rede, mas `timingSafeEqual` custa uma linha.

⚠️ **O webhook do WhatsApp foi tratado DIFERENTE, de propósito.** Ele usa outro segredo
(`WHATSAPP_WEBHOOK_SECRET`) e, ao contrário do cron, **quem o chama é um provedor externo**
(AstraCall). Exigir cabeçalho ali depende de o provedor permitir cabeçalho customizado — se não
permitir, a confirmação de aviso de ponto para de chegar e ninguém percebe. Ele ganhou só a
comparação em tempo constante. **Se for confirmado que o provedor envia cabeçalho, feche a query
string lá também.**

---

## 4. Item 12 — o link mágico de sobreaviso era montado com `origin` do cliente

```ts
const base = params.origin || process.env.NEXT_PUBLIC_SITE_URL || ''
```

`origin` vinha de `window.location.origin`, no navegador. O link montado com ele é o que o
servidor recebe **por WhatsApp** — e carrega o **token do chamado** na URL. Quem chamasse a action
com `origin` próprio fazia o SisEscala enviar, em nome da Secretaria, um link apontando para o
host dele, com o token junto.

A origem do link é propriedade da **instalação**, não da aba que clicou. `params.origin` continua
na assinatura para não quebrar o chamador, mas é ignorado.

⚠️ **E a ausência de `NEXT_PUBLIC_SITE_URL` deixou de cair para string vazia.** O `|| ''` produzia
um link relativo (`/sobreaviso/<token>`) dentro de uma mensagem de WhatsApp — inútil, e sem nada
no log dizendo por quê. Agora a action recusa com mensagem explícita. **Confirme a variável no
Coolify antes de subir isto**: não consegui verificá-la de fora (é inlinada no build).

---

## 5. Item 9 — chaves de produção em texto plano no disco

Nove scripts de `scratch/` tinham a `service_role` de **produção** literal. Passaram a ler de
`.env.production`/ambiente e a recusar rodar sem ela — o padrão da armadilha 18.

ℹ️ **Contexto que muda a urgência, e que o relatório não trazia:** `/scratch/` está no
`.gitignore` e `git log --all -S<chave>` não retorna nada. **Essas chaves nunca foram
commitadas.** Existe exatamente **1 JWT em todo o histórico dos 558 commits**, e é o de
homologação. Isto era higiene da máquina de desenvolvimento, não vazamento público — é por isso
que não há urgência de rotação (decisão do usuário em 30/08/2026: não rotacionar por ora).

---

## 6. Item 18 — decidido NÃO fazer, e o motivo importa

O relatório apontava `servidores_jornadas_temporarias` e `excecoes_escala_servidor` com
`FOR SELECT TO authenticated USING (true)`. **Não foram escopadas**, deliberadamente:

| motivo | detalhe |
|---|---|
| exposição real é mínima | 6 e 2 linhas em produção; só UUID, datas, horas e um `motivo` em texto. **Nenhum nome, nenhum CPF.** E são visíveis só a quem já está logado. |
| escopar **quebraria** correção documentada | a armadilha 26 registra que `fetchExcecoesEscala` **perdeu o filtro por unidade de propósito**: filtrar faria uma grade ignorar a autorização de horas concedida a partir de outro setor. O teto de carga é consolidado **entre** escalas por desenho. |

Fechar aqui seria o erro de "revogar demais" (a lição da `20260827050000`) por ganho nulo. Fica
registrado como **decisão**, não como pendência esquecida.

---

## 7. Item 10 — a fila do REP não conferia de quem era o `fila_id`

`/api/rep/v1/pendencias` e `/api/rep/v1/remocoes` autenticam o relógio por HMAC e **já tinham o
`dispositivoId` em mãos** — mas nunca o usavam. O `fila_id` vinha do corpo e era repassado cru
para a RPC, que também não conferia nada: ela lê o `dispositivo_id` **da linha da fila** e
trabalha com ele.

Um relógio legítimo (ou quem tivesse o token de um) confirmava item da fila de **outro**
equipamento. No caminho do cadastro isso cria `rep_vinculos_servidor` no dispositivo errado — e
vínculo errado é batida atribuída a quem não bateu, meses depois, sem nada no log.

`20260830130000` põe o guard **dentro** das duas RPCs.

### ⚠️ O parâmetro novo tem `DEFAULT NULL`, e isso é deliberado

Sem default, a assinatura muda e a ordem migration/deploy passa a quebrar **nos dois sentidos**.
E medi que essa janela custa caro:

> Quando a confirmação de cadastro falha, **o usuário já foi criado no relógio** —
> `ciclo.go:415` só registra um aviso. O item fica `pendente`, e no ciclo seguinte o coletor
> tenta criar de novo → o equipamento recusa por duplicidade (`PIS já cadastrado`) →
> `fn_confirmar_cadastro_rep` trata recusa como **definitiva** e o item vai para `falhou`,
> exigindo reenfileiramento manual.

Com `DEFAULT NULL` as duas ordens funcionam: chamador antigo segue sem checagem, chamador novo
passa o dispositivo e a divergência é recusada.

⚠️ **O preço é que a checagem só vale se quem chama PASSAR o parâmetro** — por isso existe
`scratchpad/sim_rep_fila_dono.js`, que reprova rota de `/api/rep/v1/` que consuma fila sem
repassar o dispositivo autenticado. **Validado com regressão injetada.** Sem esse portão, a
próxima rota esquece e o defeito volta na mesma forma silenciosa.

🚨 **E `GRANT` não é herdado**: assinatura diferente é objeto novo, e objeto novo nasce com
`EXECUTE` para PUBLIC (armadilha 24). Sem os `REVOKE`/`GRANT` no fim da migration, estas duas
funções — que escrevem vínculo de servidor e apagam cadastro de relógio — ficariam chamáveis por
`anon`. A verificação da migration aborta se isso acontecer.

ℹ️ As duas funções foram regeneradas por **cópia mecânica** (`scratchpad/gen_fila_dono.js`), que
aborta se o corpo divergir do original em qualquer coisa que não seja o guard.

---

## O que continua aberto

| item | o que falta |
|---|---|
| **11** | O pacote do coletor sempre gera `cert_fingerprint` vazio, então o pinning **nunca** está ativo e todo coletor roda com `InsecureSkipVerify`. Fechar isso exige ler o certificado do relógio — o que só uma máquina **na rede da unidade** consegue —, guardar a impressão em `dispositivos_rep` e o `.zip` passar a embuti-la. Provavelmente um comando novo na CLI (`coletor-rep-cli fingerprint`). |

⚠️ **O item 11 não é fechável desta cadeira.** Ele precisa de acesso ao equipamento para capturar
a impressão e para validar que o pinning não derruba a coleta — e o modo de falha de errar é o
coletor parar de falar com o relógio, numa unidade onde ninguém está olhando. Merece uma sessão
com hardware à mão.
