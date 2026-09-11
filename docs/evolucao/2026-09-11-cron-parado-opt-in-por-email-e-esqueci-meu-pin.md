# 11/09/2026 — O despachador parado há 12 dias, o opt-in por e-mail e o "Esqueci meu PIN"

Começou com uma pergunta de tela: *"na hora de ativar o aviso de ponto só dá pelo WhatsApp?"*.
A resposta era sim — mas ao medir para responder, apareceu que **nada estava sendo enviado havia
12 dias**, por WhatsApp nem por e-mail, e que isso não tinha relação nenhuma com a pergunta.

---

## 1. O despachador estava parado desde 30/08/2026, e a tela dizia "Success"

O usuário clicou em "Ativar aviso", a tela respondeu *"Enviamos uma mensagem para o seu
WhatsApp"* e nada chegou. A tela não mentia por conta própria: a RPC apenas **enfileira**, e
quem envia é `/api/avisos-ponto/despachar`, chamado por cron.

Medido em produção:

| evidência | valor |
|---|---|
| último item da fila realmente processado | **30/08/2026 03:00 UTC** — nada depois |
| o pedido daquele momento | `status: pendente`, **`tentativas: 0`**, `processado_em: null` |
| confirmações de opt-in paradas | **17**, a mais antiga de 31/08 |
| pessoas travadas em `pendente_confirmacao` | **15**, a maioria com o prazo de 48h já vencido |
| servidores com aviso ativo sem receber nada | **29** (27 por e-mail, 2 por WhatsApp) |

`tentativas: 0` é a prova de que nenhuma rodada chegou a *tocar* no item: não era falha de
envio, era ausência de execução. E nem a expiração rodava — quem expira o opt-in é o próprio
worker.

**A causa foi a mudança de 30/08/2026** (armadilha 40), que tirou o segredo da query string:

```
GET /api/avisos-ponto/despachar  → 401 "Use o cabeçalho Authorization: Bearer <segredo>"
```

401 e não 500 significa que `CRON_SECRET` **estava** no ambiente. O que ficou para trás foi o
**agendador**. As duas Scheduled Tasks do Coolify estavam lado a lado, e a comparação entre elas
é o diagnóstico inteiro:

| task | comando | resultado real |
|---|---|---|
| `envia-servidor-relogio` | `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron` | funcionava |
| `aviso-ponto-despachar` | `node -e "fetch('...?secret=<valor>')..."` | 401 há 12 dias |

🚨 **E o Coolify pintava "Success" nas duas.** `node -e "fetch(...).then(console.log)"` **sempre
sai com código 0**, mesmo recebendo 401 — o erro era impresso no log e ninguém lia. Foi isso que
deixou a parada invisível por 12 dias, não a parada em si.

A correção foi copiar o comando da task que funcionava:

```
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/avisos-ponto/despachar
```

⚠️ **O `-f` é a parte que impede a repetição.** Sem ele, o curl devolve 0 num HTTP 401 e o
painel volta a mostrar verde sobre uma rota recusando tudo. `$CRON_SECRET` em vez do valor
colado tira o segredo da tela e do log; `localhost:3000` evita o proxy.

**Lição transferível: rotina agendada precisa FALHAR quando a chamada falha.** Um agendador que
só verifica se o processo terminou está verificando a coisa errada — e o modo de falha é o pior
que existe, porque o painel afirma que está tudo bem.

ℹ️ Efeito colateral da descoberta: o `CRON_SECRET` estava em texto claro no campo *Command*,
visível no painel, em `ps` dentro do container e no log do Coolify. Rotação recomendada — as
duas tasks passam a usar `$CRON_SECRET` e se ajustam sozinhas.

---

## 2. O par canal/destino nascia quebrado, e mandava WhatsApp para e-mail

Com o worker religado, apareceu o defeito seguinte. `fn_solicitar_aviso_ponto` inseria na fila
**sem preencher `canal` e `destino`**. O canal caía no `DEFAULT` da coluna (`'whatsapp'`) e o
destino ficava nulo. No despacho, `fn_avisos_ponto_pendentes` resolve os dois com **COALESCE
independente**:

```sql
COALESCE(c.canal, k.canal)      -> 'whatsapp'   -- a coluna ja tinha valor
COALESCE(c.destino, k.destino)  -> o E-MAIL     -- k = fn_canal_aviso_ponto, pref = email
```

Resultado: **WhatsApp enviado para um endereço de e-mail**. Confirmado em duas linhas reais
(LENISE mat. 69366 e EMILLY mat. 69026), que esgotaram as 3 tentativas com *"Erro ao conectar na
API AstraCalls: Tempo limite"* — cada uma queimando o timeout da API que **também serve o
acionamento de sobreaviso**.

⚠️ **O COALESCE campo a campo não foi "consertado", de propósito**: ele é a compatibilidade das
linhas antigas. O que mudou é que quem insere passa a gravar **os dois lados juntos** — par que
nasce completo não tem como se separar depois.

### O terceiro defeito: expirar deixava a linha órfã

`fn_expirar_optin_aviso_ponto` devolvia o servidor para `inativo` e **não tocava na fila**. A
linha continuava `pendente` e seria despachada depois — pedindo confirmação de um pedido que já
tinha sido cancelado por decurso de prazo. Eram 11 linhas nessa condição.

### Correção de dados, por lista fechada

`scratchpad/fix_fila_optin.mjs` (ensaio antes de escrever, id explícito, nunca critério amplo):

- **4 linhas ainda válidas** → `destino = telefone` (o número certo já estava na própria linha)
- **11 linhas órfãs** → encerradas com motivo legível

🚨 **O ensaio pegou algo que uma execução direta teria escondido:** duas dessas 11 (CAMILA
mat. 57343 e NIELLY mat. 67246) estavam com o aviso **já ativo** — tinham conseguido ativar por
outro caminho. O motivo delas não é "pedido expirado", é "confirmação desnecessária", e os dois
textos foram gravados separados. **Motivo único para casos diferentes é registro que mente.**

---

## 3. Ativar o aviso só era possível pelo WhatsApp (migration `20260911140000`)

O que motivou a conversa. O double opt-in exigia telefone válido e exclusivo, mandava *"responda
SIM"* e só aceitava confirmação pelo webhook do WhatsApp — **enquanto o canal padrão do aviso é
e-mail desde 30/08/2026**. Ou seja: 27 dos 29 ativos recebem por e-mail e **todos** foram
obrigados a passar pelo WhatsApp só para ligar, num número que a Meta já restringiu duas vezes.

A confirmação passa a sair pelo **canal preferido**:

| canal | confirmação |
|---|---|
| `whatsapp` | "responda SIM" — inalterado, e continua exigindo telefone **exclusivo** |
| `email` | link de uso único, válido pelo mesmo prazo do pedido |

⚠️ **O link não é prova mais fraca que o SIM.** Os dois provam posse do endereço pelo qual o
aviso será entregue, que é exatamente o que o double opt-in existe para provar. O SIM tem um
ganho a mais (transforma o número em interlocutor, sinal antibanimento do WhatsApp) — e por isso
ele **não foi substituído**, só deixou de ser o único caminho.

⚠️ **O WhatsApp continua exigindo `fn_telefone_aviso_ponto` (válido E exclusivo), e não basta o
`fn_canal_aviso_ponto`**, que só checa "não vazio". `fn_confirmar_aviso_ponto` casa a resposta
pelo sufixo do número e **recusa corretamente o caso ambíguo** — com telefone repetido em dois
cadastros, a pessoa ficaria esperando para sempre.

### De onde sai a URL do link

A mensagem é montada no Postgres, que não sabe (e não deve saber) o domínio da instalação. O SQL
grava o marcador `{{URL}}` e o despachador substitui pela origem de `src/utils/urlPublica.ts`.

⚠️ **Gravar a URL em `configuracoes_globais` foi descartado**: criaria uma segunda verdade, que
envelhece sozinha no dia em que o domínio mudar — e o sintoma seria um link morto dentro de um
e-mail já entregue. Sem origem resolvida, o item **falha com motivo explícito** em vez de sair
com link quebrado.

---

## 4. "Esqueci meu PIN" (migration `20260911150000`)

Quem esquece o PIN não entra no Portal — e é dentro do Portal que fica a única tela de troca. A
saída era ligar para o coordenador.

**Alcance medido:** 1.757 dos 2.647 ativos (66%) têm e-mail; só **3 e-mails são compartilhados**
por mais de uma pessoa. Os 281 que têm PIN e não têm e-mail continuam dependendo do coordenador,
e a tela diz isso.

### A decisão central: link, nunca PIN novo pronto

🚨 Gerar um PIN e mandá-lo por e-mail parece mais simples e é **perigoso**: bastaria digitar a
matrícula de um colega — que está impressa no crachá — para **derrubar o PIN dele**. E este PIN
não é só do Portal: é a credencial do **terminal de ponto** (armadilha 43). A pessoa descobriria
na frente do relógio, e recusa por PIN inválido é a única que ainda existe depois da v1.22.0 —
vira tentativa recusada, não marcação.

Com link, o pedido de um terceiro **não muda nada**: o PIN atual continua valendo até que alguém
com acesso à caixa clique e escolha outro. O custo de um pedido indevido cai de "colega sem bater
ponto" para "um e-mail ignorado".

### Três regras que não podem ser desfeitas

| regra | por quê |
|---|---|
| **o bloqueio de 5 tentativas NÃO se aplica a este caminho** | quem esqueceu o PIN quase sempre já errou 5 vezes e **está** bloqueado — é exatamente essa pessoa que precisa do link. Amarrar a saída ao bloqueio a prenderia no estado em que ela pede ajuda |
| **pedir o link não incrementa `pin_failed_attempts`** | se incrementasse, qualquer pessoa bloquearia o login de um colega repetindo o pedido — a função de socorro viraria negação de serviço |
| **redefinir zera o bloqueio** | quem provou posse do e-mail não pode continuar travado por tentativas antigas; seria resolver pela metade |

⚠️ **A regra do PIN novo é validada ANTES de queimar o token.** Validar depois gastaria o link
por um erro de digitação, e a pessoa teria de pedir outro e-mail para corrigir seis dígitos.

⚠️ **Quem nunca teve PIN também passa**, de propósito: a prova exigida é a mesma (posse do
e-mail que o coordenador cadastrou), e barrar esse caso manteria uma segunda fila no coordenador
sem ganho de segurança nenhum.

### Resposta neutra na tela

🚨 A tela responde **sempre a mesma frase** — ache ou não ache alguém, tenha ou não tenha e-mail,
tenha ou não estourado o teto de 3 pedidos por hora. Variar o texto transformaria a tela de login
num **verificador de matrículas válidas**. Até a falha de envio fica só no log do servidor: dizer
"não conseguimos enviar para você" confirmaria que a matrícula existe e tem e-mail.

---

## 5. `tokens_portal` — fonte única dos dois fluxos

As frentes 3 e 4 precisavam do mesmo mecanismo: token de uso único, com prazo, que invalida o
anterior. Duas implementações divergiriam justamente no detalhe que importa.

- o token **cru nunca é gravado** — só o sha256, no mesmo esquema de `dispositivos_rep` e
  `terminais_locais`
- **um token ativo por (servidor, finalidade)**: pedido novo aposenta o anterior. Sem isso, dois
  links válidos ao mesmo tempo fazem o mais antigo continuar servindo depois de a pessoa ter
  pedido outro — que é justamente o que ela faz quando desconfia do primeiro
- a tabela tem RLS ligada e **nenhuma policy**: só as funções `SECURITY DEFINER` a alcançam

🚨 **O token não é consumido ao ABRIR a página, e isso não é preciosismo.** Filtro de e-mail
corporativo e antivírus **abrem os links da mensagem** para checá-los antes de entregá-la. Com
consumo no GET, um robô queimaria o link e a pessoa encontraria "este link já foi usado" sem
nunca ter clicado. Por isso as duas páginas só consomem no **POST**: a de confirmação tem um
botão, e a de PIN é um formulário.

---

## Conferência em produção

`scratchpad/ver_migrations_20260911_pin.mjs` **executa** as funções (armadilha 42) e sai com
código 1 se qualquer asserção falhar — **12 de 12**:

- `tokens_portal` existe; `avisos_ponto_fila.telefone` deixou de ser obrigatório
- as quatro funções novas executam de verdade (não só existem)
- PIN repetido é recusado **antes** de o token ser olhado
- `anon` recebe 401 nas **seis** funções do fluxo
- nenhuma linha pendente manda WhatsApp para endereço de e-mail

As duas migrations trazem verificação própria, com cenário sintético revertido por
`RAISE EXCEPTION 'ENSAIO_OK'` — inclusive a prova de que **a regra do PIN novo não vazou para o
caminho de login**, que derrubaria os 826 PINs de 4 dígitos legados do Portal e do terminal no
mesmo instante.

## O que ficou de fora

- **Os 890 servidores sem e-mail** continuam dependendo do coordenador. O caminho é cadastro,
  não código.
- **`fn_confirmar_aviso_ponto` (webhook do WhatsApp) não foi tocada** — o ramo SIM e o ramo PARAR
  continuam exatamente como estavam.
- **Os resumos das semanas de 31/08 e 07/09 não voltam.** `fn_gerar_resumos_aviso_ponto` olha a
  semana anterior e 3 dias para o diário; o que passou disso não é regerado, e forçar seria
  entregar de uma vez doze dias de mensagens.
