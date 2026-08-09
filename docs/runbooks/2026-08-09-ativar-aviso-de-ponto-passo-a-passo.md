# Aviso de ponto por WhatsApp — passo a passo para colocar no ar

**Data:** 09/08/2026
**Para quem:** quem administra o SisEscala no Coolify.
**Plano por trás disso:** [2026-08-09-comprovante-de-ponto-por-whatsapp.md](../planos/2026-08-09-comprovante-de-ponto-por-whatsapp.md)

Cinco passos. Nenhum deles envia mensagem a ninguém — o envio só começa no passo 5, e mesmo lá só
para quem tiver ativado por conta própria.

> **Nada quebra se você parar no meio.** Todas as chaves nascem desligadas. Um passo pela metade
> deixa o sistema exatamente como está hoje.

---

## Antes de começar: o que já está pronto

| item | situação |
|---|---|
| migration `20260809110000` (cadastro único) | ✅ aplicada |
| migration `20260809120000` (aviso de ponto) | ✅ aplicada |
| migration `20260809130000` (log do webhook) | ⬜ **falta aplicar** — passo 0 |
| código (portal, worker, webhook, tela da unidade) | ✅ pronto, aguardando deploy |

---

## Passo 0 — Aplicar a última migration

No SQL Editor do Supabase de produção, cole e execute o conteúdo de
[`supabase/migrations/20260809130000_whatsapp_inbound_log.sql`](../../supabase/migrations/20260809130000_whatsapp_inbound_log.sql).

Ela cria só uma tabela de log. Confira:

```sql
SELECT count(*) FROM logs_webhook_whatsapp;   -- deve retornar 0
```

---

## Passo 1 — Criar o `WHATSAPP_WEBHOOK_SECRET`

### O que é isso, em português

É uma **senha combinada** entre o SisEscala e a AstraCalls. Quando alguém responde no WhatsApp, a
AstraCalls avisa o SisEscala chamando um endereço na internet. Esse endereço é público — qualquer
um pode chamá-lo.

O problema: essa chamada é o que **confirma o opt-in** de um servidor. Sem senha, qualquer pessoa
poderia forjar "o fulano confirmou" e fazer o ponto do fulano ser enviado para um telefone
qualquer. A senha é o que prova que quem está chamando é mesmo a AstraCalls.

> Enquanto essa variável não existir, o endpoint responde **503** e recusa tudo. Isso é
> intencional: melhor não funcionar do que aceitar confirmação forjada.

### Como gerar

Qualquer texto longo e aleatório serve. Para gerar um bom, rode no terminal:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Copie o resultado. **Não reaproveite senha de outra coisa** e não coloque esse valor em documento
compartilhado.

### Onde colocar (Coolify)

1. Abra o Coolify e entre na aplicação **SisEscala**.
2. Menu lateral → **Environment Variables** (ou *Configuration → Environment Variables*).
3. Clique em **+ Add** e preencha:
   - **Name:** `WHATSAPP_WEBHOOK_SECRET`

     ⚠️ **Confira o nome caractere por caractere.** Já aconteceu de sair `HATSAPP_WEBHOOK_SECRET`
     (sem o `W`). O nome errado não dá erro em lugar nenhum: o Coolify aceita, o deploy passa, e o
     webhook simplesmente recusa **todas** as confirmações com HTTP 503 — o servidor que ativou no
     Portal fica esperando para sempre.
   - **Value:** o valor que você gerou
   - **Available at Runtime:** ✅ marcado · **Available at Buildtime:** ⬜ desmarcado
     (é segredo, não deve entrar no bundle)
   - **Is Literal?:** ⬜ desmarcado. Os valores gerados por `base64url` só têm letras, números,
     `-` e `_`. Se algum dia usar um valor com `$`, aí sim marque.
4. Aproveite e adicione também, se ainda não existir:
   - **Name:** `CRON_SECRET`
   - **Value:** outro valor gerado pelo mesmo comando

   ⚠️ Hoje o código usa `sis-escala-cron-token-2026` como padrão quando `CRON_SECRET` não existe.
   Esse valor está no código-fonte, ou seja, **não é segredo**. Definir a variável fecha isso.
5. **Save** e depois **Redeploy** a aplicação.

Guarde os dois valores no gerenciador de senhas da secretaria — você vai precisar deles no passo 3.

---

## Passo 2 — Fazer o deploy do código

O código novo já está no repositório. Assim que for enviado para a `main`, o webhook do GitHub
dispara o deploy automático no Coolify.

Depois que o deploy terminar, confira que as rotas responderam:

```bash
# a checagem que importa: confirma se o segredo chegou na aplicação
curl https://sisescala.maraba.pa.gov.br/api/avisos-ponto/webhook

# deve responder {"error":"Não autorizado"} — é o esperado, você não mandou o segredo
curl https://sisescala.maraba.pa.gov.br/api/avisos-ponto/despachar
```

A primeira resposta tem um campo `configurado`:

| resposta | significa | o que fazer |
|---|---|---|
| `{"ok":true,"configurado":true,…}` | o segredo chegou | pode seguir |
| `{"ok":true,"configurado":false,"aviso":"…"}` | a variável **não** chegou | confira o **nome** dela no Coolify (erro comum: faltar o `W` de `WHATSAPP`) e refaça o redeploy |

> O campo `configurado` existe justamente porque essa falha é silenciosa dos dois lados: com o
> nome errado, o Coolify aceita, o deploy passa e o webhook recusa tudo com 503 sem ninguém notar.
> Ele informa **se** o segredo existe — nunca qual é.

---

## Passo 3 — Agendar os dois crons

### O que é um cron, aqui

É só **alguém chamando um endereço de tempos em tempos**. O SisEscala não fica rodando sozinho em
segundo plano: ele age quando é chamado. São duas tarefas:

| tarefa | endereço | frequência | o que faz |
|---|---|---|---|
| enviar | `/api/avisos-ponto/despachar` | a cada **1 minuto** | pega até 20 mensagens da fila e envia |
| expirar | `fn_expirar_optin_aviso_ponto()` | **1× por dia** | quem pediu ativação e não respondeu em 48 h volta a desligado |

### Opção A — Scheduled Tasks do Coolify (recomendado)

1. Coolify → aplicação **SisEscala** → **Scheduled Tasks** → **+ Add**.
2. Primeira tarefa:
   - **Name:** `aviso-ponto-despachar`
   - **Frequency:** `* * * * *` (todo minuto)
   - **Command:**
     ```
     curl -s "https://sisescala.maraba.pa.gov.br/api/avisos-ponto/despachar?secret=SEU_CRON_SECRET"
     ```
3. **Save**.

Troque `SEU_CRON_SECRET` pelo valor que você definiu no passo 1.

### Opção B — serviço externo

Se preferir, [cron-job.org](https://cron-job.org) faz o mesmo: cadastre a URL acima com intervalo
de 1 minuto. Funciona igual, mas depende de um terceiro estar no ar.

### A tarefa diária de expiração

Essa é SQL, não URL. No Supabase, se a extensão `pg_cron` estiver habilitada:

```sql
SELECT cron.schedule(
  'expirar-optin-aviso-ponto',
  '0 3 * * *',                                  -- todo dia às 03:00
  $$ SELECT public.fn_expirar_optin_aviso_ponto(); $$
);
```

Se `pg_cron` não estiver disponível, **não é urgente**: rode o `SELECT` abaixo manualmente uma vez
por semana. Enquanto ninguém rodar, o único efeito é um pedido antigo continuar aparecendo como
"aguardando resposta" no Portal — nada é enviado indevidamente.

```sql
SELECT public.fn_expirar_optin_aviso_ponto();
```

---

## Passo 4 — Descobrir o formato do payload

### O que é "payload"

É o **conteúdo da mensagem que a AstraCalls manda para o SisEscala** quando alguém responde no
WhatsApp. Cada provedor manda num formato diferente — um chama o telefone de `from`, outro de
`sender`, outro de `remoteJid`. O SisEscala precisa saber onde olhar.

O código já tenta os formatos mais comuns. Este passo é só para **confirmar** que acertou — e, se
não acertou, me mandar o formato real.

### Como fazer

1. **Configure o webhook na AstraCalls.** No painel do AstraCalls, procure por *Webhook*,
   *Callback* ou *Eventos de mensagem recebida* e aponte para:

   ```
   https://sisescala.maraba.pa.gov.br/api/avisos-ponto/webhook?secret=SEU_WEBHOOK_SECRET
   ```

   Se o painel permitir cabeçalhos em vez de query string, pode usar
   `X-Webhook-Secret: SEU_WEBHOOK_SECRET` — o código aceita os dois.

2. **Mande uma mensagem de teste.** Do seu celular, mande qualquer coisa (ex.: `teste`) para o
   número que o sistema usa.

3. **Leia o que chegou.** No SQL Editor do Supabase:

   ```sql
   SELECT recebido_em, reconhecido, telefone, texto, jsonb_pretty(payload)
     FROM logs_webhook_whatsapp
    ORDER BY recebido_em DESC
    LIMIT 1;
   ```

### Como interpretar o resultado

| o que apareceu | o que significa | o que fazer |
|---|---|---|
| nenhuma linha | a AstraCalls não chamou, ou o segredo está errado | reveja a URL do webhook e o segredo |
| `reconhecido = true`, telefone e texto preenchidos | **funcionou** | pode ir para o passo 5 |
| `reconhecido = false` | chegou, mas o parser não achou telefone/texto naquele formato | me mande o conteúdo da coluna `payload` que eu ajusto |

---

## Passo 5 — Piloto no HMM

Só agora alguma mensagem pode sair.

1. **Ligue a unidade.** SisEscala → *Unidades* → **HMM - Hospital Municipal de Marabá** → seção
   *Aviso de ponto por WhatsApp* → marque **Habilitar o envio nesta unidade** → *Salvar*.

   Deixe os eventos no padrão: **Entrada**, **Saída** e **Fora do horário previsto**.

2. **Avise os 4 servidores do HMM** que a opção existe e que precisa ser ativada por eles no
   Portal do Servidor, aba **💬 Avisos**.

   > Lembre-se: nada é enviado a quem não ativar. Se ninguém ativar, nada acontece — e isso não é
   > defeito.

3. **Acompanhe por uma semana:**

   ```sql
   -- quem está em cada estado
   SELECT aviso_ponto_status, count(*) FROM servidores GROUP BY 1;

   -- o que a fila fez
   SELECT tipo, status, evento, count(*) FROM avisos_ponto_fila GROUP BY 1,2,3;

   -- falhas, com o motivo
   SELECT telefone, motivo_falha, criado_em FROM avisos_ponto_fila
    WHERE status = 'falha' ORDER BY criado_em DESC;

   -- histórico de consentimento
   SELECT acao, count(*) FROM logs_preferencia_aviso_ponto GROUP BY 1;
   ```

4. **O que observar de verdade:** se a sessão do WhatsApp continua saudável. É o **mesmo número**
   do acionamento de sobreaviso — se ele for banido, o sobreaviso cai junto. Qualquer sinal de
   degradação, desligue a unidade (mesmo checkbox) e avalie número dedicado antes de expandir.

**Ordem de expansão depois:** HMM → CTA → USF ENFERMEIRA ZEZINHA → SMS → LACEM.
A ZEZINHA em terceiro de propósito: é a única unidade com marcação de intervalo, onde os 4 passos
por dia existem.

---

## Como desligar tudo, se precisar

Em ordem de reversibilidade, do mais simples ao mais amplo:

```sql
-- 1. desliga uma unidade (ou use o checkbox na tela)
UPDATE unidades SET aviso_ponto_whatsapp = false WHERE nome LIKE 'HMM%';

-- 2. desliga TODAS as unidades — para o envio imediatamente
UPDATE unidades SET aviso_ponto_whatsapp = false;

-- 3. limpa o que ainda não saiu da fila
UPDATE avisos_ponto_fila SET status = 'falha', motivo_falha = 'cancelado manualmente'
 WHERE status = 'pendente';
```

Nada disso apaga consentimento nem histórico. Religar é marcar o checkbox de novo.

---

## Resumo do que você precisa providenciar

- [ ] Passo 0 — aplicar `20260809130000_whatsapp_inbound_log.sql`
- [ ] Passo 1 — `WHATSAPP_WEBHOOK_SECRET` e `CRON_SECRET` no Coolify, + redeploy
- [ ] Passo 2 — deploy do código e conferência das duas rotas
- [ ] Passo 3 — cron de 1 minuto para `/api/avisos-ponto/despachar`
- [ ] Passo 3b — agendamento diário de `fn_expirar_optin_aviso_ponto()` *(pode esperar)*
- [ ] Passo 4 — apontar o webhook na AstraCalls e capturar um payload de teste
- [ ] Passo 5 — ligar o HMM e avisar os 4 servidores
