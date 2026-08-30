# Fase 1 da auditoria de segurança: portal forjável, relay aberto e segredo servido a quem loga (30/08/2026)

O usuário rodou uma auditoria de segurança sobre o repositório e trouxe o relatório
(20 achados) preocupado com o resultado. Verifiquei os 20 um a um contra o código: **nenhum é
falso positivo na mecânica**. Uma varredura independente das Server Actions convergiu exatamente
no mesmo conjunto que o relatório aponta — não sobrou nenhuma que ele tivesse deixado passar
nessa classe.

O plano completo, a análise achado a achado e as decisões pendentes ficam em
`docs/security-audit/PLANO-DE-CORRECAO.md`.

> ⚠️ **Aquele diretório está no `.gitignore` (linha 78) e isso é deliberado.** O repositório é
> público (armadilha 18) e o plano descreve vulnerabilidades ainda abertas em produção. Este
> diário, que **é** versionado, descreve o que foi CORRIGIDO — não o que continua aberto.

Este documento cobre a **Fase 1**: os quatro itens exploráveis por quem não tem credencial
nenhuma, mais um achado que a auditoria não tinha.

---

## 1. O Portal do Servidor: a sessão era o UUID, e a aplicação entregava o UUID

`/consultar-escala` é isento de login (`src/utils/supabase/middleware.ts:115`) — é o portal onde
o servidor entra com matrícula + PIN. A "sessão" dele era isto:

```ts
cookieStore.set('portal_servidor_id', servidor.id, { httpOnly: true, ... })
```

O UUID do servidor, **em texto puro, sem assinatura**. `httpOnly` impede o JavaScript da página
de *ler* o cookie; não impede — e nunca impediu — que alguém *monte* a requisição com o cookie
que quiser (`curl -H 'Cookie: portal_servidor_id=<uuid>'`).

E o UUID necessário era entregue pela própria aplicação: `findServidorByMatricula` é Server
Action **sem autenticação nenhuma** e devolvia `{ id, nome }` a partir da matrícula — que é
numérica e curta. O bloqueio de 5 tentativas de PIN ficava decorativo: ninguém precisava do PIN.

### E 12 das 30 ações nem liam o cookie

Enumerando as 30 Server Actions de `src/app/consultar-escala/actions.ts`:

| classe | quantas |
|---|---|
| lia o cookie **e** comparava com o parâmetro | 6 |
| lia o cookie, mas só conferia presença | 6 |
| **parâmetro do cliente vencia o cookie** (`servidorId \|\| cookie`) | 1 |
| **não lia cookie nenhum**, com `createAdminClient()` (ignora RLS) | 11 |

`criarSolicitacaoPrevisao`, `cancelarSolicitacaoServidor`, `aceitarContraproposta` e
`rejeitarContraproposta` **escrevem**. Não era só leitura de dado pessoal: era agir em nome de
outro servidor — abrir e cancelar pedido de férias, aceitar contraproposta — sem nunca ter tido
a credencial dele.

### A correção: derivar, nunca comparar

**`src/utils/portalSession.ts`** espelha `terminalLocalSession.ts`, que já está em produção desde
11/08/2026: HMAC-SHA256, comparação em tempo constante, expiração dentro do payload.

⚠️ **A decisão que importa é derivar em vez de comparar.** Comparar
(`if (cookie !== param) return erro`) também fecharia o buraco — e seis ações já faziam isso, com
sucesso. Mas comparar exige que **cada ação nova lembre**, e 12 não lembraram. Derivar torna o
erro impossível de cometer: não existe mais um `servidorId` do cliente para confundir com o da
sessão.

| medida | antes | depois |
|---|---|---|
| ações que aceitam `servidorId` do cliente | 12 | **0** |
| ações que derivam da sessão assinada | 0 | 24 |
| sem leitura de sessão | 18 | 6, todas justificadas |

Ganho de graça: as ações de férias já filtravam `.eq('servidor_id', servidorId)`. Trocando a
**origem** do valor, a verificação de posse passou a valer sem escrever uma linha de checagem.
`getSolicitacaoHistorico` foi a única exceção — não filtrava por servidor nenhum — e ganhou a
conferência explícita.

Duas mudanças de contrato:

- **`findServidorByMatricula` não devolve mais o `id`.** Devolve só o nome. Quem entrega
  identidade antes do PIN entrega a chave da sessão junto.
- **`validatePin` recebe a matrícula**, não o `servidorId`. O identificador interno não transita
  mais pelo cliente.

Corrigido junto (achado 19): `sameSite: 'lax'`, que faltava — sem ele o navegador mandava o
cookie em requisição cross-site.

E um achado colateral: `sugerirJustificativaServidor` gravava `registrado_por_nome` com
`dados.servidorNome`, **texto livre vindo do navegador**. O autor do registro agora vem do banco.

⚠️ **`PORTAL_SESSION_SECRET` é a variável nova.** Se ela não existir, `portalSession.ts` cai para
`TERMINAL_LOCAL_SESSION_SECRET`, que já está no Coolify, **com separação de domínio no HMAC**
(`sisescala:portal-servidor:v1` entra na mensagem assinada, então um cookie de terminal local
jamais valida como sessão de portal, mesmo com a mesma chave). Isso é deliberado e é o oposto do
anti-padrão que a armadilha 18 proíbe: o proibido é `process.env.X || 'literal'`, um segredo
publicado no código de um repositório público. Aqui não há valor embutido — há uma segunda
variável de ambiente, para o deploy não derrubar o portal de ~500 servidores. Sem nenhuma das
duas, **lança**.

---

## 2. `communication.ts`: relay aberto, SSRF e exfiltração de credencial, tudo sem login

`sendWhatsAppMessageAction` e `sendEmailAction` eram Server Actions **sem autenticação nenhuma**,
e faziam:

```ts
const configs = { ...dbConfigs, ...unidadeConfigs, ...(overrideConfigs || {}) }
```

`overrideConfigs` vinha do cliente e **vencia** o config do banco. Consequências, todas sem login:

| ataque | como |
|---|---|
| **exfiltração da chave de API** | sobrescrever **só** `whatsapp_astracall_url` → a `X-API-Key` real vai no cabeçalho para o servidor do atacante |
| **exfiltração do SMTP** | sobrescrever **só** `email_smtp_host` → usuário e senha vão como AUTH para o host do atacante |
| **SSRF** | `fetch` para URL arbitrária a partir da VPS, alcançando a rede interna |
| **relay aberto** | `to`, `subject` e `html` arbitrários saindo do e-mail oficial da Secretaria |

E `tls: { rejectUnauthorized: false }` fechava o círculo: nem o TLS reclamava.

### A correção: separar o motor da porta

⚠️ **Não dava para simplesmente exigir sessão nas ações.** `/api/avisos-ponto/despachar` (o cron)
e `/api/avisos-ponto/webhook` chamam o envio **sem sessão de usuário**. Adicionar o guard direto
derrubaria o aviso de ponto.

O motor foi movido **verbatim, por script** (`scratchpad/gen_comunicacao.js`, que aborta se o
corpo divergir do original) para **`src/utils/comunicacao/enviar.ts`** — arquivo que **não** é
`'use server'` e por isso só alcança quem o importa. `communication.ts` ficou com envelopes finos:

| ação | guard | aceita `overrideConfigs` |
|---|---|---|
| `sendWhatsAppMessageAction` | `exigirSessao` | **não** |
| `sendEmailAction` | `exigirSessao` | **não** |
| `testWhatsAppConnectionAction` | `exigirAdminComunicacao` | sim |
| `testEmailConnectionAction` | `exigirAdminComunicacao` | sim |

Conferido antes: o único uso real de `overrideConfigs` é a tela de Configurações e o
`UnidadeCommunicationSettings`, **ambos admin**. Nenhuma tela quebrou.

⚠️ **Nunca reexportar `enviarWhatsAppInterno`/`enviarEmailInterno` de dentro de um arquivo
`'use server'`** — isso as transforma em Server Action de novo e reabre tudo acima.

O TLS foi ligado depois de conferir produção: o host é **`smtp.gmail.com`**, com certificado
público válido. A "flexibilidade para certificado autoassinado" do comentário não estava sendo
usada por ninguém. A escotilha continua, mas agora é decisão explícita
(`email_smtp_tls_inseguro`), nunca o padrão.

---

## 3. `configuracoes_globais` servia a senha do SMTP a qualquer conta logada

A policy de leitura, desde `20260523000000`, era literalmente:

```sql
FOR SELECT TO authenticated USING (true)
```

Qualquer conta logada — incluindo `comum`, `servidor` e `ass_adm` — lia a tabela inteira pelo
PostgREST. E ela guarda `email_smtp_senha` e `whatsapp_astracall_key`. A policy de **escrita** já
era restrita a admin/super_admin desde a mesma migration: leitura e escrita tinham públicos
diferentes, e ninguém notou.

### ⚠️ A denylist por nome de chave NÃO resolve, e medir foi o que mostrou isso

O primeiro esboço era `chave NOT LIKE '%_key'`, `NOT LIKE '%senha%'` etc. Medido em produção:

| fato | consequência |
|---|---|
| das 59 chaves, **só 2** têm nome que denuncia segredo | a denylist pegaria essas duas… |
| …mas há **19 chaves `unidade_comunicacao_<uuid>`**, que são **blobs JSONB** com `email_smtp_senha` e `whatsapp_astracall_key` **aninhados dentro do valor** | 🚨 o nome delas não casa com padrão nenhum. **A denylist deixaria o segredo passar inteiro.** Duas dessas 19 têm chave de API preenchida hoje. |

`20260830100000` combina as duas formas, e as duas precisam ficar: o prefixo
`unidade_comunicacao_%` (que pega o blob), a lista explícita das chaves de hoje, e os padrões
genéricos (que pegam a chave futura que alguém batizar de `..._senha`). A regra tem fonte única
em **`fn_config_e_sensivel(text)`**, para que a conferência da migration teste exatamente o mesmo
critério que a policy aplica.

**Invariante escolhido: leitura e escrita passam a ter o mesmo público.** Não tira capacidade de
ninguém — `rh` e `rh_unidade` já **não** conseguiam gravar essas chaves. ⚠️ Efeito visível: em
`/unidades/[id]`, o painel de Comunicação passa a aparecer vazio para eles.

Simulado contra produção antes de entregar: **21 chaves fecham, 38 continuam abertas**, e as 6
conferências da migration passam.

Por que o envio não quebra: `getCommunicationConfigs` lê com `createAdminClient()`
(`service_role`, que tem BYPASSRLS).

---

## 4. `verify_pin` era chamável por `anon`, e o bloqueio de tentativas morava no TypeScript

**Este não estava no relatório da auditoria.** Confirmado ao vivo contra produção:

```
POST /rest/v1/rpc/verify_pin   com a chave ANON   →   HTTP 200
```

`verify_pin` foi criada em `20260523000000` e **nunca foi revogada de `PUBLIC`**. Pela
armadilha 24, `CREATE FUNCTION` já concede `EXECUTE` a PUBLIC — as três migrations `20260827*`
fecharam `fn_registrar_ponto`, `fn_confirmar_presenca` e companhia, mas passaram por cima desta.

E o bloqueio de 5 tentativas / 15 minutos vivia **inteiramente em `validatePin`**, no TypeScript.
A função SQL só faz `v_hash = crypt(p_pin, v_hash)` e devolve boolean, sem contar nada.

Somando: o PIN gerado pela tela de cadastro tem **4 dígitos**
(`Math.floor(1000 + Math.random() * 9000)`) — **9.000 possibilidades**. Quem tivesse o UUID de um
servidor percorria o espaço inteiro em segundos, direto no PostgREST, sem passar por controle
nenhum e sem deixar rastro em `pin_failed_attempts`.

`20260830110000` faz duas coisas:

**A) Revoga de PUBLIC/anon/authenticated.** Conferido antes: há **um único** chamador na
aplicação (`validatePin`, com `service_role`, que mantém o GRANT), e todos os chamadores em SQL
estão dentro de funções `SECURITY DEFINER`, que executam com os privilégios do dono e não
dependem do GRANT de quem chamou.

**B) Move o bloqueio para o banco** (`fn_validar_pin_portal`). Além de contornável, a lógica
antiga tinha **corrida** real: ler `pin_failed_attempts`, decidir e só então gravar deixa N
requisições simultâneas lerem 0 e passarem juntas — e força bruta é, por definição, concorrente.
Agora leitura, decisão e gravação acontecem na mesma transação, com `FOR UPDATE`.

⚠️ Duas premissas foram **medidas** antes de resolver o login por matrícula: **1385 servidores
ativos, 1385 matrículas distintas, zero duplicadas** (se houvesse repetição, o `SELECT INTO`
pegaria uma linha arbitrária e abriria a sessão da pessoa errada — o código antigo usava
`.single()`, que **errava** nesse caso), e 795 têm PIN cadastrado.

⚠️ `crypt` é chamado **sem qualificar**, resolvido pelo `SET search_path = public, extensions`,
exatamente como `verify_pin` faz desde 23/05/2026. Escrever `extensions.crypt` seria uma aposta
no schema onde o pgcrypto está instalado; herdar a resolução que já funciona não é aposta.

ℹ️ **Decisão do usuário (30/08/2026): os PINs de 4 dígitos já emitidos não serão trocados** —
serão substituídos naturalmente com o tempo. É por causa dessa decisão que fechar o caminho de
força bruta importa **mais**, não menos.

---

## 5. Achado 7 — `getDadosPlantoesSobreavisosServidor`

Usava `createAdminClient()` e recebia `servidorId` do cliente **sem conferir sessão, papel nem
escopo**: bastava chamar com o id de qualquer servidor da rede para receber plantões,
sobreavisos, cargo, vínculo, unidade e setor dele. Ganhou `getUserProfile` + `hasSectorAccess`,
no padrão que o resto de `folha-ponto/actions.ts` já usava.

---

## Portões (não há framework de teste no projeto)

| script | o que trava |
|---|---|
| `scratchpad/sim_portal_sessao.js` | reprova ação do portal que aceite `servidorId`, use `createAdminClient` sem sessão, leia o cookie cru ou grave cookie sem assinar. **Testado com regressão injetada: reprova e sai 1.** |
| `scratchpad/sim_portal_cookie.mjs` | 12 casos de forja: UUID cru, payload trocado, segredo errado, **contexto trocado**, expirado, lixo |
| `scratchpad/sim_bloqueio_pin.mjs` | **352 estados**, lógica antiga (TS) × nova (plpgsql): **0 divergências**, mais 7 propriedades |
| `gen_comunicacao.js` · `gen_portal_sessao.js` · `gen_portal_identidade.js` · `gen_portal_client.py` · `gen_validate_pin.py` | geradores mecânicos, abortam na divergência de contagem |

⚠️ **Um portão que nunca falha não vale nada.** O do portal foi testado injetando uma regressão
de propósito (uma ação voltando a aceitar `servidorId`): reprova e sai com código 1.

⚠️ **Ao reauditar, o script precisa conhecer os guards novos.** A varredura antiga procurava a
string `portal_servidor_id`; como ela deixou de existir, passou a acusar **29** ações sem
checagem — todas falso-positivo. Ensinando-lhe `servidorDaSessao`/`exigirSessao`/
`exigirAdminComunicacao`, cai para **4**, todas justificadas. Se um resultado vier muito **pior**
que o original depois de uma correção, suspeite do detector antes de suspeitar do código.

---

## Armadilhas de execução que apareceram no caminho

⚠️ **`CREATE POLICY` nova não substitui a antiga.** Policies permissivas se **somam com OR** — se
a `"Permitir leitura de configurações para todos"` (`USING (true)`) sobrevivesse ao lado da nova,
a correção seria inteiramente inútil, sem nenhum sintoma. É a armadilha 24 em forma de RLS, a
mesma que `20260828100000` já tinha encontrado em `solicitacoes_transferencia`. A migration
**aborta** se encontrar a antiga viva.

⚠️ **Os arquivos do portal não têm a mesma quebra de linha**: `actions.ts` é LF e os dois
componentes cliente são CRLF. Script de substituição que case com `\n` fixo devolve **zero**
ocorrência num deles e aborta sem explicar o motivo real.

⚠️ **Ordem de aplicação: migrations ANTES do deploy do código.** O código atual continua
funcionando com as migrations aplicadas (`validatePin` ainda chama `verify_pin` com
`service_role`). Na ordem inversa, o `validatePin` novo chamaria `fn_validar_pin_portal` antes
dela existir e **o login do portal cai para todos**. Como o push na `main` dispara o deploy pelo
webhook do Coolify, o push é o passo que precisa vir por último.
