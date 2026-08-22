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

   🚨 **Isto deixou de ser opcional em 22/08/2026.** Havia um valor padrão embutido no código, e
   como o repositório é público ele **não era segredo nenhum** — qualquer pessoa disparava
   `/api/cron` (que fecha escalas e folhas) e o despacho de avisos. O fallback foi removido: sem
   `CRON_SECRET` no ambiente, as duas rotas respondem **500** e o cron não roda.
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

**É uma tarefa só.** O endereço `/api/avisos-ponto/despachar` faz as duas coisas: envia até 20
mensagens da fila **e** expira os pedidos de confirmação vencidos (quem pediu ativação e não
respondeu em 48 h volta a desligado).

> Havia aqui uma segunda tarefa em SQL usando `pg_cron`. **Este Supabase não tem essa extensão**
> — dá `ERROR: 3F000: schema "cron" does not exist`. A expiração foi movida para dentro do worker,
> que já roda a cada minuto. Não há nada a agendar no Supabase.

### Scheduled Task do Coolify

Coolify → aplicação **SisEscala** → **Scheduled Tasks** → **+ Add**:

| campo | valor |
|---|---|
| **Name** | `aviso-ponto-despachar` |
| **Frequency** | `* * * * *` (todo minuto) |
| **Timeout** | `300` |
| **Container name** | deixe **em branco** — o `php` que aparece é só exemplo do campo. Só preencha se a aplicação tiver mais de um container |
| **Command** | ver abaixo |

```
node -e "fetch('https://sisescala.maraba.pa.gov.br/api/avisos-ponto/despachar?secret=COLE_AQUI_O_CRON_SECRET').then(r=>r.text()).then(console.log)"
```

⚠️ **Troque `COLE_AQUI_O_CRON_SECRET` pelo valor real** que você criou no passo 1. Deixar o texto
de exemplo faz a chamada responder `401 Não autorizado` — e como o cron não reclama de 401, a fila
simplesmente nunca esvazia, sem nenhum erro aparecer em lugar nenhum.

**Por que `node` e não `curl`:** esta aplicação não tem Dockerfile próprio, então o Coolify monta o
container via Nixpacks, e **não há garantia de que `curl` esteja instalado ali**. Se não estiver, a
tarefa falha em silêncio. `node` está presente por definição — é uma aplicação Node — e a função
`fetch` é nativa a partir do Node 18.

### Como conferir que a tarefa está mesmo rodando

Não confie em ter salvo: **verifique**.

1. Na própria tela de Scheduled Tasks do Coolify, use **Run now** (ou aguarde 1 minuto) e abra os
   **logs da tarefa**. A saída esperada é um JSON:

   ```json
   {"success":true,"timestamp":"...","processados":0,"enviados":0,"falhas":0,"optinsExpirados":0}
   ```

2. O que cada resposta significa:

   | saída | significa | o que fazer |
   |---|---|---|
   | o JSON acima | **funcionando** — fila vazia é o esperado agora | seguir |
   | `{"error":"Não autorizado"}` | o segredo no comando está errado | conferir o `CRON_SECRET` |
   | `node: not found` / `curl: not found` | comando não existe no container | usar a outra variante |
   | log vazio ou tarefa não aparece | não executou | conferir Frequency e Container name |

### Alternativa, se o Scheduled Task não colaborar

[cron-job.org](https://cron-job.org) chama a mesma URL de fora, a cada 1 minuto, e mostra o retorno
de cada execução — o que também resolve o problema de visibilidade. A desvantagem é depender de um
terceiro estar no ar.

---

## Passo 4 — Descobrir o formato do payload

### O que é "payload"

É o **conteúdo da mensagem que a AstraCalls manda para o SisEscala** quando alguém responde no
WhatsApp. Cada provedor manda num formato diferente — um chama o telefone de `from`, outro de
`sender`, outro de `remoteJid`. O SisEscala precisa saber onde olhar.

O código já tenta os formatos mais comuns. Este passo é só para **confirmar** que acertou — e, se
não acertou, me mandar o formato real.

### Como fazer

### ⚠️ Antes de tudo: a caixa por onde o aviso sai é a caixa que recebe a resposta

Este foi o erro que derrubou o primeiro teste, e ele se repete a cada unidade nova.

O SisEscala **envia** pela API do AstraCalls, usando um SID de sessão. A **resposta** do servidor
cai na caixa do Chatwoot ligada a **essa mesma sessão**. Se a regra de automação escutar outra
caixa, ela nunca dispara — e a confirmação nunca chega, sem erro em lugar nenhum.

Some-se que a sessão global corresponde a uma caixa de **atendimento ao público**. Deixar o aviso
ali mistura o tráfego do SisEscala com mensagem de paciente.

**Como acertar:**

1. No Chatwoot, abra a caixa que você quer usar → aba **Conexão** → anote o nome da sessão
   (ex.: `inbox5_acc6`).
2. No AstraCalls, clique nessa sessão e copie o **ID** (ex.: `a08e3c4b2cb2d551f742cb68318c655d`).
   Se preferir, dá para listar tudo de uma vez:

   ```bash
   curl -s -H "X-API-Key: <a chave do Astra>" https://astracall.atb.app.br/api/sessions
   ```

3. SisEscala → *Configurações* → **Sessão dedicada ao Aviso de Ponto** → cole o ID → Salvar.
4. A regra de automação (abaixo) tem que apontar para **essa mesma caixa**.

> Trocar a sessão troca o **número** que fala com o servidor. Quem já tinha um pedido pendente
> precisa **cancelar e reativar** no Portal — responder na conversa antiga cai na caixa errada.

1. **Configure o webhook.** O painel do AstraChat é baseado em Chatwoot, então isso é feito por
   **regra de automação** (*Configurações → Automação → Adicionar regra*):

   | campo | valor | por quê |
   |---|---|---|
   | **Nome** | `Aceite sisescala` | — |
   | **Evento** | **`Mensagem Criada`** | ⚠️ **não** use `Conversa Criada`. O servidor responde numa conversa que **já existe** (o sistema mandou a mensagem antes), então ela não é criada de novo — a regra nunca dispararia |
   | **Condições** | nenhuma, ou *tipo da mensagem = recebida* | uma condição em branco invalida a regra ou não casa com nada |
   | **Ação** | *Enviar evento de Webhook* → a URL abaixo | — |

   ```
   https://sisescala.maraba.pa.gov.br/api/avisos-ponto/webhook?secret=SEU_WEBHOOK_SECRET
   ```

   Se o painel permitir cabeçalhos em vez de query string, pode usar
   `X-Webhook-Secret: SEU_WEBHOOK_SECRET` — o código aceita os dois.

   Ações extras como *Adicionar Etiqueta* e *Resolver Conversa* são inofensivas; pode manter.

   > **Não é preciso correlacionar a mensagem.** O sistema identifica de quem é a resposta **pelo
   > número de telefone**: o aceite no Portal já deixou o cadastro daquele servidor em
   > `pendente_confirmacao` com prazo de 48 h. Não há token nem link a casar.
   >
   > Link mágico foi descartado de propósito (é o que o *sobreaviso* usa): clicar num link não
   > gera mensagem de entrada no WhatsApp, e é a **resposta** que transforma a conversa de mão
   > única em diálogo — de onde vem toda a proteção contra banimento.

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

**Ligue por SETOR, não por unidade.** Desde a v1.30.0 o setor sobrepõe a unidade
(`fn_aviso_ponto_habilitado`): ligar a unidade SMS habilitaria os **78** servidores da secretaria
quando a intenção é a TI, que tem **6**.

1. **Ligue o setor.** SisEscala → *Setores* → **TECNOLOGIA DA INFORMAÇÃO** (unidade SMS) → campo
   *Aviso de ponto por WhatsApp* → **Habilitar neste setor** → *Salvar*.

   A unidade SMS permanece como está. Os eventos continuam vindo da unidade — deixe no padrão:
   **Entrada**, **Saída** e **Fora do horário previsto**.

2. **Avise os 6 servidores da TI** que a opção existe e precisa ser ativada por eles no
   Portal do Servidor, aba **💬 Avisos**.

   Confira quem ficou habilitado antes de avisar (esperado: 6):

   ```sql
   SELECT count(*) FROM servidores s
    WHERE public.fn_aviso_ponto_habilitado(s.unidade_id, s.setor_id);
   ```

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
- [ ] Passo 3 — cron de 1 minuto para `/api/avisos-ponto/despachar` (tarefa única; a expiração já
      vai junto) e **conferir o log da tarefa**
- [ ] Passo 4 — apontar o webhook na AstraCalls e capturar um payload de teste
- [ ] Passo 5 — ligar o HMM e avisar os 4 servidores
