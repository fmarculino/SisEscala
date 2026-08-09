# Comprovante de ponto por WhatsApp — estudo de viabilidade e plano

**Data:** 09/08/2026
**Origem:** reclamação recorrente de servidores — o terminal `/presenca` não entrega nada ao servidor
depois da batida, enquanto o relógio REP-C imprime papel.
**Status:** estudo concluído, **decisões tomadas em 09/08/2026** (ver § 8), plano pronto para
implementação.

---

## 1. A reclamação é válida?

**Sim, e por um motivo mais forte do que o alegado.**

Hoje, quem bate no terminal recebe uma faixa colorida na tela que some em 3 segundos (6 s no caso
âmbar) e **nada mais**. Não há papel, não há mensagem, não há registro que a pessoa leve embora.
Quem bate no relógio Control iD sai com comprovante impresso na mão. A assimetria é real e é
percebida exatamente onde dói: o servidor não tem como provar, sozinho, que registrou.

Três fatos medidos em produção em 09/08/2026 sustentam isso:

| medida | valor | por que importa |
|---|---|---|
| marcações de origem `terminal` | 6.706 | é o canal majoritário — `rep` tem **2** |
| média de batidas/dia no terminal | 97,2 (pico 285) | volume real de eventos sem recibo |
| tentativas recusadas registradas em agosto/2026 | 432 | cada uma é alguém que saiu sem saber o que aconteceu |

O caso mais grave não é o da batida normal, é o da **batida âmbar**. Desde a v1.22.0 o terminal
aceita registro fora da janela e manda para revisão do coordenador — em produção já há 6 dessas.
A tela diz "seu coordenador vai revisar" e desaparece. O servidor fica com uma marcação real,
válida, pendente, e **zero evidência na mão** de que ela existe. Se a revisão não acontecer, ele
não tem como reclamar de algo que não sabe provar que registrou.

Ou seja: a reclamação chega como "não sai comprovante", mas o que ela está apontando é
**assimetria de prova entre o servidor e a administração**. Isso é legítimo.

---

## 2. Respaldo legal — e a inversão que ele impõe ao desenho

A Portaria MTP 671/2021 trata do comprovante em três artigos, e o resultado é o **oposto** do que a
intuição sugere.

### Art. 79 — conteúdo obrigatório do Comprovante de Registro de Ponto do Trabalhador

São nove campos, e nenhum é opcional:

| # | campo | SisEscala tem hoje? |
|---|---|---|
| I | cabeçalho com o título "Comprovante de Registro de Ponto do Trabalhador" | trivial |
| II | **Número Sequencial de Registro (NSR)** | ❌ `marcacoes_ponto.nsr` está preenchido em **2 de 7.179** linhas — só as do relógio |
| III | identificação do empregador: nome, CNPJ/CPF e CEI/CAEPF/CNO | ⚠️ `unidades.cnpj` em 16/16, **`razao_social` em 0/16** |
| IV | local da prestação do serviço / endereço do estabelecimento | ✅ `unidades.endereco` |
| V | identificação do trabalhador: nome e CPF | ⚠️ CPF nulo em boa parte da base (armadilha 10) |
| VI | data e horário do registro | ✅ `marcacoes_ponto.ocorrido_em` |
| VII | modelo e nº de fabricação (REP-C) **ou nº de registro no INPI (REP-P)** | ❌ o SisEscala não tem registro INPI |
| VIII | **código hash SHA-256 da marcação** — exclusivo do REP-P | ❌ não existe |
| IX | **assinatura eletrônica** | ❌ não existe |

### Art. 80 — como o REP-P entrega o comprovante

O arquivo deve ser **PDF assinado eletronicamente**. E o parágrafo único traz a regra que muda tudo:

> a emissão do comprovante no momento da marcação **não é obrigatória** se ao trabalhador for
> disponibilizado, por meio de sistema eletrônico, acesso ao comprovante após cada marcação,
> independentemente de solicitação e autorização prévias — devendo o empregador permitir a
> extração dos comprovantes das marcações realizadas, no mínimo, nas **últimas 48 horas**.

### Art. 88 — assinatura

As assinaturas eletrônicas geradas pelo REP-P devem usar **certificado ICP-Brasil**, e para PDF o
padrão é **PAdES**.

### O que isso significa na prática

**1. A lei não obriga a mandar nada no ato. Ela obriga a dar acesso.**
O canal exigido é *disponibilidade de acesso eletrônico*, não *push*. WhatsApp não é o que a
Portaria pede — o portal é.

**2. Uma mensagem de texto no WhatsApp não é, e não pode ser chamada de, "Comprovante".**
Faltariam NSR, hash SHA-256, nº INPI e assinatura eletrônica — quatro dos nove campos do Art. 79.
Rotular um texto de WhatsApp como "Comprovante de Registro de Ponto" cria um documento que
**parece oficial e não é**. Em disputa, um comprovante inválido é pior que nenhum: desqualifica a
prova e sugere que o sistema tentou aparentar conformidade que não tem.

**3. O SisEscala hoje não pode emitir comprovante conforme por canal nenhum.**
Sem registro no INPI e sem certificado ICP-Brasil, o Art. 79 VII e IX são inatingíveis — por
WhatsApp, por PDF, por papel. Isso é um projeto próprio, não um detalhe desta feature.

### Nota sobre regime jurídico (reduz o risco, não a utilidade)

A Portaria 671 regulamenta o Art. 74 da **CLT**. Distribuição de vínculo em produção:

```
Concursada 91 · Contratada 65 · Comissionada 20 · Efetiva 6 · Estagiária 2   (184 ativos)
```

A maioria é estatutária e, a rigor, **fora do alcance da CLT e da Portaria**. Os 65 "Contratada"
(35% da base) são a fatia em que a aplicação é plausível a depender do regime do contrato temporário.
Isto é: aqui a Portaria 671 vale **por adoção** — o projeto já a elegeu como padrão de referência
(v1.22.0) — e não por imposição fiscalizável. Consequência: não há multa esperando, mas também não
há por que abrir mão do padrão que já se escolheu seguir. E o valor probatório (CLT Art. 74 §2º,
Súmula 338 do TST, e o princípio equivalente em processo administrativo) continua valendo para
qualquer regime.

---

## 3. Conclusão do estudo: implementar, mas como **aviso**, não como comprovante

A ideia é boa e resolve a dor real. O que precisa mudar é o **nome e o enquadramento**:

| camada | o que é | entrega | prazo |
|---|---|---|---|
| **A — Aviso de Registro de Ponto** | mensagem de WhatsApp, imediata, informativa | resolve a reclamação | esta proposta |
| **B — Comprovante Art. 79** | PDF no portal, 9 campos, extraível a qualquer tempo | atende o Art. 80 melhor que o WhatsApp | fase seguinte |
| **C — Conformidade plena** | registro INPI + certificado ICP-Brasil + assinatura PAdES | torna o comprovante oponível | projeto à parte |

A camada A **não substitui** a B nem a C, e o texto da mensagem tem que dizer isso com todas as
letras. O ganho da A é imediato e concreto: o servidor passa a ter, no próprio celular, com
carimbo de horário do WhatsApp, um registro de que bateu — e, no caso âmbar, de que a batida ficou
pendente de revisão.

O critério é o mesmo já firmado no CLAUDE.md para pré-assinalação: **o sistema informa o que
aconteceu; ele não fabrica o que não aconteceu.** Um aviso que reproduz o horário real gravado é
informação. Um "comprovante" sem NSR e sem assinatura seria aparência.

---

## 4. O que já existe (metade do pedido está pronta — e há um bug)

### ✅ A resolução unidade → global já está implementada

`sendWhatsAppMessageAction` ([communication.ts:110](../../src/app/actions/communication.ts#L110)) já
recebe `unidadeId` e faz exatamente o que foi pedido:

```ts
const unitKey = `unidade_comunicacao_${unidadeId}`
const unitRaw = dbConfigs[unitKey]
if (unitRaw && typeof unitRaw === 'object' && unitRaw.usar_global === false) {
  unidadeConfigs = unitRaw            // canal próprio da unidade
}
const configs = { ...dbConfigs, ...unidadeConfigs, ...overrideConfigs }   // global é o fallback
```

A tela também já existe:
[UnidadeCommunicationSettings.tsx](../../src/components/UnidadeCommunicationSettings.tsx), com modo
de herança, campos AstraCalls próprios e botão de teste por unidade. **Nada disso precisa ser
construído.**

Estado em produção: as 16 unidades já têm a chave `unidade_comunicacao_<id>` gravada, **todas com
`usar_global = true`**. Nenhuma tem canal próprio ainda — a infraestrutura está pronta e zerada.

### ❌ Bug encontrado: `unidades.configuracoes_comunicacao` não existe em produção

[unidades/actions.ts:172-191](<../../src/app/(dashboard)/unidades/actions.ts#L172-L191>) tenta gravar
a configuração em duas vias:

```ts
await supabase.from('unidades').update({ configuracoes_comunicacao: parsedConfig }).eq('id', id)
// ...
chave: `unidade_comunicacao_${id}`      // fallback em configuracoes_globais
```

Conferido por sonda: a coluna **não existe** no banco de produção —
`column unidades.configuracoes_comunicacao does not exist`. O erro é engolido por um `try/catch`
que só faz `console.warn`, então a tela sempre reportou sucesso. Na prática só o fallback em
`configuracoes_globais` funciona. É a armadilha 2 de novo (migrations não são o schema completo),
com o agravante de a falha ser silenciosa.

**Isso precisa ser resolvido antes ou junto** — senão o toggle novo nasce herdando o mesmo caminho
quebrado.

### ⚠️ Inconsistência menor

`sharePinWhatsApp`, nas duas telas de servidor
([novo/page.tsx:156](<../../src/app/(dashboard)/servidores/novo/page.tsx#L156>),
[EditServidorForm.tsx:105](<../../src/app/(dashboard)/servidores/[id]/EditServidorForm.tsx#L105>)),
chama `sendWhatsAppMessageAction` **sem `unidadeId`** — ou seja, o PIN sempre sai pelo canal global,
mesmo que a unidade tenha canal próprio. Corrigir junto, é uma linha em cada.

---

## 5. Riscos medidos, e como o desenho responde a cada um

### 5.1 Ban do número — o risco mais concreto

Volume real: **97 marcações/dia em média, pico de 285**, para até 180 destinatários distintos. Uma
sessão não-oficial (AstraCalls/Baileys) disparando nesse padrão é exatamente o perfil que o
WhatsApp classifica como *bulk messaging*.

O agravante: hoje **um único número** serve PIN, acionamento de sobreaviso e (na proposta) aviso de
ponto. Um ban derruba o **acionamento de sobreaviso** junto — e sobreaviso é o fluxo de urgência da
rede, com 13 acionamentos reais e 9 usando o link mágico.

**Resposta do desenho:** fila com throttle, piloto em uma única unidade, e recomendação formal de
número dedicado (idealmente WhatsApp Cloud API oficial, com template aprovado) antes de qualquer
expansão. O ligar/desligar por unidade é justamente o que permite crescer devagar.

### 5.2 O envio nunca pode atrapalhar a batida

O terminal chama `fn_registrar_ponto` direto do navegador. Colocar um `fetch` de WhatsApp no
caminho da confirmação significa que um timeout de 12 s da API do AstraCalls vira 12 s de tela
travada — e um servidor impaciente que bate de novo.

**Resposta:** o envio sai por **fila assíncrona no servidor**, nunca pelo cliente, nunca no caminho
crítico.

### 5.3 Terminal com bundle velho (armadilha conhecida)

Se o disparo dependesse de código no navegador, um terminal desatualizado deixaria de enviar e
**ninguém perceberia** — exatamente a falha silenciosa de 09/08/2026 que motivou a v1.27.0.

**Resposta:** o disparo é acionado por gatilho no banco sobre `marcacoes_ponto`. Independe
totalmente da versão do bundle do terminal.

### 5.4 Telefone errado = aviso de ponto para outra pessoa

Medido: **180 de 184 servidores ativos (97,8%) têm telefone utilizável**; 4 estão vazios, nenhum
malformado. Cobertura excelente. Mas há **1 número repetido entre dois cadastros**:

```
VIVIAN MARTINS MACEDO  matrícula T2600019  telefone 94984105178
VIVIAN MARTINS MACEDO  matrícula T2600014  telefone (94) 98410-5178
```

Mesma unidade, mesmo nome, mesmo telefone em formatos diferentes — é **duplicidade de cadastro**,
não duas pessoas. Mas o padrão é o que importa: telefone compartilhado entre dois `servidor_id`
faria o aviso da batida de um chegar como se fosse do outro.

**Resposta:** varredura de duplicidade antes de ligar, e a fila **recusa** enviar para número
associado a 2+ servidores, registrando o motivo em vez de arriscar.

### 5.5 LGPD

Horário de trabalho é dado pessoal, e o WhatsApp é operador terceiro fora do controle da SMS. A base
legal existe (execução de política pública / cumprimento de obrigação legal, LGPD Art. 7º II e III),
mas o tratamento por canal externo exige **transparência e escolha**.

**Resposta:** aviso explícito no terminal e no portal, e **opt-out por servidor**. A mensagem não
carrega CPF, matrícula, PIN nem link autenticado — só nome, data/hora, unidade e status.

### 5.6 Ruído

4 passos × 22 dias = até 88 mensagens/mês por servidor. Isso cansa e vira ignorado.

**Resposta:** a configuração por unidade define **quais eventos** geram aviso. Padrão sugerido:
apenas **entrada e saída do turno**, mais **sempre** o caso âmbar (fora do previsto) — que é o que
o servidor mais precisa saber.

---

## 6. Plano de implementação

### ✅ Fase 0 — Concluída em 09/08/2026

Documentada em [2026-08-09-cadastro-unico-de-servidor.md](2026-08-09-cadastro-unico-de-servidor.md).

| # | ação | resultado |
|---|---|---|
| 0.1 | fonte única da config de comunicação | `configuracoes_globais` — a gravação na coluna inexistente foi removida |
| 0.2 | erro do upsert visível na tela | feito; era `console.warn` |
| 0.3 | `unidadeId` no `sharePinWhatsApp` | feito nas duas telas |
| 0.4 | duplicidade de cadastro | migration `20260809110000` + índice único por CPF |

A resolução **unidade → global** que esta feature precisa é a que já existe e agora está confiável:
a unidade que tiver canal próprio o usa; as demais herdam o global.

### Fase 1 — Configuração por unidade

Migration com colunas **reais** em `unidades` (não JSON: o gatilho precisa ler isso em SQL):

```sql
ALTER TABLE public.unidades
  ADD COLUMN aviso_ponto_whatsapp        boolean NOT NULL DEFAULT false,
  ADD COLUMN aviso_ponto_eventos         text[]  NOT NULL DEFAULT ARRAY['entrada','saida','fora_janela'];
```

`DEFAULT false` fecha por padrão — mesma escolha já feita em `setores.sobreaviso_abrangencia`.
Nenhuma unidade passa a enviar por efeito colateral da migration.

UI: um bloco novo em `UnidadeCommunicationSettings` (ou seção própria no cadastro da unidade) com o
toggle e a seleção de eventos, **acima** do painel de canal próprio — porque a pergunta "envio
aviso?" vem antes de "por qual número?".

### Fase 1-B — Double opt-in (decidido em 09/08/2026)

Nada é enviado sem **duas** confirmações do servidor, em canais diferentes:

1. no **Portal**, autenticado por PIN, ele lê o termo e aceita → status `pendente_confirmacao`;
2. o sistema manda **uma** mensagem no WhatsApp pedindo que responda `SIM`;
3. a resposta chega por **webhook** e só então o status vira `ativo`.

Não é burocracia — resolve três problemas de uma vez:

| problema | como o double opt-in resolve |
|---|---|
| **banimento do número** | o sinal dominante de spam é **conversa de mão única**. A resposta transforma o número em interlocutor — inbound do destinatário é o sinal positivo mais forte que existe. E o número é o **mesmo do acionamento de sobreaviso**: um banimento derrubaria o fluxo de urgência da rede junto |
| **posse do número** | o PIN prova a *identidade*; não prova que o telefone **do cadastro** é daquela pessoa — pode estar desatualizado. A resposta prova posse do aparelho, e fecha o risco de aviso de ponto chegar a terceiro melhor que qualquer checagem de exclusividade |
| **LGPD** | consentimento confirmado no próprio canal do tratamento, com termo integral e resposta bruta guardados |

⚠️ **Pedido não respondido expira e NÃO é reenviado.** Silêncio é resposta: quem não respondeu não
quer, e insistir é exatamente o comportamento que gera bloqueio. Garantido em três camadas — a
função recusa se já houver pendente, o índice parcial
`idx_aviso_confirmacao_unica_por_servidor` barra o segundo INSERT, e a tela troca o botão por
"Cancelar pedido".

⚠️ **`PARAR` é honrado em qualquer estado**, inclusive de quem nunca ativou. Ignorar pedido de
parada é o caminho mais curto para denúncia — e denúncia é o que bane o número.

**Casamento telefone → servidor pelos últimos 8 dígitos.** O WhatsApp devolve o número brasileiro
ora com, ora sem o 9º dígito (o mesmo problema que `getWhatsAppPhoneVariants` já trata); comparar a
string inteira perderia metade das respostas. Se o sufixo casar com dois cadastros, a função
**recusa decidir** — confirmar o opt-in da pessoa errada colocaria o ponto de uma no celular da
outra. Medido em produção: **zero sufixos ambíguos**.

```sql
ALTER TABLE public.servidores
  ADD COLUMN aviso_ponto_status text NOT NULL DEFAULT 'inativo';  -- + pendente_confirmacao, ativo

-- Append-only. 'confirmou' guarda a resposta BRUTA do webhook: é ela que prova a posse do
-- número, então gravar só "confirmou = true" perderia justamente a evidência.
CREATE TABLE public.logs_preferencia_aviso_ponto (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  servidor_id    uuid NOT NULL REFERENCES public.servidores(id),
  acao           text NOT NULL CHECK (acao IN
                   ('solicitou','confirmou','desativou','expirou','parou_pelo_whatsapp')),
  termo_texto    text,       -- o texto EXATO que a pessoa leu, não uma referência
  termo_versao   text,
  resposta_bruta jsonb,
  origem         text NOT NULL DEFAULT 'portal',
  registrado_em  timestamptz NOT NULL DEFAULT now()
);
```

**O `termo_texto` é gravado por inteiro, não por referência.** Um termo que muda depois deixaria o
registro provando a ciência de um texto que a pessoa nunca leu — o mesmo raciocínio que faz
`escala_prevista_inicio` do log de tentativas ser histórico e não recalculado.

Os textos vivem em [`src/utils/avisoPonto.ts`](../../src/utils/avisoPonto.ts) — **fonte única**, e
isso é o ponto: o texto exibido na tela e o gravado em `termo_texto` têm de ser o mesmo literal. Se
divergissem, o registro provaria ciência de algo que o servidor nunca leu, que é justamente o valor
que o log existe para ter. A server action também **não aceita o termo vindo do cliente** — aceitar
permitiria gravar "ciência" de qualquer coisa.

RPCs, todas `SECURITY DEFINER` e **`service_role` apenas** (padrão de `fn_solicitar_ajuste_ponto`,
`20260808130000` — o portal autentica só por PIN e a action é chamável direto):

| função | papel |
|---|---|
| `fn_solicitar_aviso_ponto` | passo 1 — grava o aceite e enfileira o pedido. **Não ativa** |
| `fn_confirmar_aviso_ponto` | passo 2 — processa a resposta do webhook; honra `PARAR` sempre |
| `fn_desativar_aviso_ponto` | desliga pelo Portal e cancela o que estiver pendente na fila |
| `fn_expirar_optin_aviso_ponto` | devolve a `inativo` quem não respondeu no prazo (48 h) |

### Fase 2 — Fila de avisos

```sql
CREATE TABLE public.avisos_ponto_fila (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marcacao_id   uuid NOT NULL REFERENCES public.marcacoes_ponto(id),
  servidor_id   uuid NOT NULL REFERENCES public.servidores(id),
  unidade_id    uuid REFERENCES public.unidades(id),
  telefone      text NOT NULL,
  mensagem      text NOT NULL,
  status        text NOT NULL DEFAULT 'pendente',   -- pendente|enviado|falha|descartado
  tentativas    integer NOT NULL DEFAULT 0,
  motivo_falha  text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  processado_em timestamptz,
  UNIQUE (marcacao_id)                              -- idempotência: 1 aviso por marcação
);
```

Gatilho `AFTER INSERT ON marcacoes_ponto` que enfileira **somente** quando **todas** as condições
valem:

- `origem IN ('terminal','rep')` — nunca `ajuste_coordenador` nem `ajuste_servidor`;
- `sintetica = false` — **jamais** avisar sobre horário que o sistema derivou. Avisar "você bateu
  às 08:00" quando ninguém bateu é a vedação 2 pela porta da notificação;
- `ocorrido_em > now() - interval '10 minutes'` — protege contra backfill/sync histórico
  disparar 7.179 mensagens de uma vez;
- unidade com `aviso_ponto_whatsapp = true`;
- servidor sem `aviso_ponto_optout`, com telefone válido e **não compartilhado com outro servidor**
  (a duplicata da VIVIAN mostrou o risco; o índice único de `20260809110000` reduz, mas não elimina
  — dois servidores podem legitimamente dividir um telefone de família);
- evento dentro de `aviso_ponto_eventos`.

Todo o corpo sob `EXCEPTION WHEN OTHERS` virando `WARNING`, pela mesma razão do trigger de
`20260808070000`: **o aviso nunca pode impedir alguém de bater o ponto.**

> **Como o gatilho descobre o passo — sem inferir nada**
>
> `marcacoes_ponto` não tem coluna de passo, e adivinhá-lo reintroduziria exatamente a inferência
> que o modelo de marcações existe para eliminar. Mas não é preciso adivinhar: o trigger de sync
> (`20260808070000`) insere a marcação **como parte** do `UPDATE` em `escala_diaria`, então quando
> o gatilho do aviso dispara o valor **já está gravado**. Basta ler qual coluna bate:
>
> ```sql
> SELECT CASE NEW.ocorrido_em
>          WHEN ed.presenca_entrada           THEN 'entrada'
>          WHEN ed.presenca_saida_intervalo   THEN 'saida_intervalo'
>          WHEN ed.presenca_retorno_intervalo THEN 'retorno_intervalo'
>          WHEN ed.presenca_saida             THEN 'saida'
>        END
> ```
>
> É leitura do que o sistema acabou de escrever, não re-derivação. E o caminho âmbar
> (`fn_registrar_ponto`) **não escreve em `escala_diaria`** — não casa com nenhuma coluna, o passo
> sai `NULL`, e é assim que o gatilho identifica o evento `fora_janela`. Nenhuma função existente
> precisa ser alterada.
>
> **A mensagem, porém, não exibe o passo.** O passo pode mudar quando o coordenador revisa, e o
> aviso é imutável depois de enviado — dizer "entrada" numa batida que vira "retorno do intervalo"
> criaria contradição entre o que a pessoa tem no celular e o que está na folha. O comprovante do
> REP-C também não traz passo: o Art. 79 VI pede "data e horário do respectivo registro", nada
> mais. **O passo serve para filtrar; o horário é o que se informa.**

### Fase 3 — Worker de despacho

Rota `GET/POST /api/avisos-ponto/despachar`, protegida por `CRON_SECRET` no mesmo padrão de
[api/cron/route.ts](../../src/app/api/cron/route.ts). Chamada por cron do Coolify a cada 1 minuto.

- drena a fila em lotes (sugestão: 20 por execução → teto de ~1.200/dia, folgado sobre o pico de 285);
- `unidadeId` repassado a `sendWhatsAppMessageAction` → **a resolução unidade → global já pronta
  entra em ação sem uma linha nova**;
- até 3 tentativas com espaçamento, depois `falha` com `motivo_falha` preservado;
- `fallbackUrl` é **ignorado** aqui: não há humano na frente para clicar.

### Fase 4 — Texto da mensagem

```
📌 *Aviso de Registro de Ponto*

Olá, MARIA DA SILVA.
Seu ponto foi registrado em 09/08/2026 às 07:58.
Local: USF Laranjeiras

Situação: registrado dentro do horário previsto.

_Este é um aviso informativo, não é o Comprovante de Registro de_
_Ponto. O documento oficial fica disponível no Portal do Servidor._
SisEscala — Secretaria Municipal de Saúde de Marabá
```

Variante âmbar — a que mais importa:

```
Situação: *registrado fora do horário previsto.* A marcação está
válida e foi enviada para revisão do seu coordenador. Você não
precisa bater de novo.
```

O disclaimer de duas linhas **não é opcional** e é o que separa esta feature de uma falsa aparência
de conformidade (§ 2). O "você não precisa bater de novo" existe pelo mesmo motivo da regra de cor
âmbar no terminal: evitar que o servidor leia o aviso como recusa.

### Fase 5 — Piloto no **HMM**, no número atual (decidido em 09/08/2026)

Medição por unidade (produção, 09/08/2026) — **só 5 das 16 unidades usam o terminal**:

| unidade | servidores | c/ telefone | marca intervalo | msg/dia | pico |
|---|---|---|---|---|---|
| CTA | 1 | 1 | não | 1,9 | 2 |
| **HMM** ← piloto | **4** | **4** | não | **2,1** | **4** |
| USF ENFERMEIRA ZEZINHA | 54 | 53 | **sim** | 29,9 | 108 |
| SMS | 79 | 77 | não | 37,0 | 172 |
| LACEM | 42 | 42 | não | 56,9 | 138 |

**HMM**: 4 servidores, todos com telefone, pico de 4 msgs/dia. O CTA tem uma pessoa só — não
ensinaria nada sobre comportamento coletivo.

Uma semana. Conferir taxa de entrega, reclamação de ruído e — principalmente — **saúde da sessão
do WhatsApp**, já que o mesmo número serve o sobreaviso. Expandir depois, unidade a unidade, pelo
toggle.

### ⚠️ Piloto redefinido em 09/08/2026 — **SMS / TI**, e a habilitação passou a ser por SETOR

O usuário optou por começar pela **TI da SMS** (6 servidores, todos com telefone), depois a
**USF ENFERMEIRA ZEZINHA**, e então as demais. É o mesmo grupo do piloto do REP, com o coordenador
como participante — padrão já estabelecido neste projeto.

Isso expôs um defeito do desenho original: **o toggle era por unidade**. Ligar SMS habilitaria os
**78** servidores da secretaria quando a intenção são **6** — 13× o escopo. O double opt-in impede
que alguém receba sem pedir, mas tornaria a opção *visível* a 78 pessoas, e adesão fora do grupo
desmontaria a leitura do piloto.

Corrigido em `20260809150000`: `setores.aviso_ponto_whatsapp` com três estados —
`NULL` herda a unidade (padrão), `true`/`false` sobrepõem. Mesma forma da geolocalização por setor
(v1.7.0). A precedência vive em **um lugar só**, `fn_aviso_ponto_habilitado(unidade_id, setor_id)`;
reimplementá-la em cada chamador é como o módulo de marcações acabou com três regras de intervalo
divergentes.

Distribuição medida em produção (09/08/2026):

| unidade | setor | servidores | c/ telefone |
|---|---|---|---|
| SMS | **TECNOLOGIA DA INFORMAÇÃO** ← piloto | **6** | 6 |
| SMS | CAF · DMAC · ALMOXARIFADO · outros | 72 | 69 |
| ENF ZEZINHA | TEC ENFERMAGEM (maior) | 15 | 15 |
| ENF ZEZINHA | demais 9 setores | 39 | 38 |

**Ordem:** SMS/TI → USF ENFERMEIRA ZEZINHA → demais. A ZEZINHA em segundo continua sendo a escolha
certa para o *segundo* passo: é a **única** unidade com `permite_marca_intervalo = true`, ou seja,
a única onde existem 4 passos por dia — é ali que a configuração de eventos é exercitada de verdade.
Convém começar por um setor dela também, e não pela unidade inteira.

⚠️ **O gatilho do piloto é o toggle, não o deploy.** Como o default é `false`, aplicar a migration
não envia nada. Ligar o HMM é um ato deliberado da coordenação.

### Fase 6 (posterior, escopo próprio) — Comprovante do Art. 79 no portal

Tela no Portal do Servidor listando as marcações das últimas 48 h (mínimo legal; sugiro o mês
inteiro) com download em PDF. É **isto**, não o WhatsApp, que atende o Art. 80. Fica bloqueada em
conformidade plena por dois itens externos ao código — registro INPI e certificado ICP-Brasil — mas
o extrato em PDF, ainda que sem assinatura, já é um salto sobre o estado atual, desde que rotulado
com honestidade.

---

## 7. Ordem de custo

| fase | esforço | risco |
|---|---|---|
| 0 — correções | baixo | ✅ concluída |
| 1 — config por unidade | baixo | baixo (migration aditiva, default `false`) |
| 1-B — opt-out no portal + termo | baixo | baixo (tabela nova, RPC `service_role`) |
| 2 — fila + gatilho | médio | **médio** — gatilho em `marcacoes_ponto`, exige o `EXCEPTION` |
| 3 — worker | baixo | baixo (reusa `sendWhatsAppMessageAction` inteira) |
| 4 — texto | baixo | baixo |
| 5 — piloto HMM | — | **o risco real está aqui**: saúde da sessão WhatsApp |
| 6 — PDF no portal | alto | independente; escopo próprio |

Nenhuma linha de `fn_confirmar_presenca`, `fn_confirmar_presenca_manual` ou `fn_registrar_ponto` é
tocada — armadilha 1 respeitada por construção.

---

## 8. Decisões — tomadas em 09/08/2026

| # | decisão | escolha |
|---|---|---|
| 1 | fonte da config de comunicação | **`configuracoes_globais`**, coluna fantasma removida — ✅ feito |
| 2 | número do WhatsApp | **piloto no número atual**, uma unidade pequena, monitorando a sessão |
| 3 | eventos | **configurável por unidade**, padrão `entrada + saída + fora_janela` |
| 4 | consentimento | **double opt-in**: aceite do termo no Portal **+** resposta confirmando no próprio WhatsApp (§ Fase 1-B) |
| 5 | enquadramento | **aviso informativo**, nunca "Comprovante" — Fase 6 fica para depois |
| 6 | divulgação no terminal | **não anunciar por enquanto** — adiada, ver § abaixo |
| 7 | frequência | **escolhida pelo servidor**, 4 opções, padrão `resumo_diario` — ver § abaixo |

### Frequência escolhida pelo servidor (09/08/2026) — migration `20260809140000`

| opção | mensagens/mês | |
|---|---|---|
| Resumo semanal | ~4 | segunda-feira, semana anterior + link do Portal |
| **Resumo diário** | ~22 | **padrão** |
| Entrada e saída | ~44 | pula as batidas de intervalo |
| Todas as batidas | até 88 | confirmação imediata de cada registro |

**O resumo diário é padrão por ser melhor evidência, não só por incomodar menos.** Uma mensagem com
as quatro batidas do dia é uma peça só, achável depois; quatro fragmentos ao longo do dia ninguém
recupera.

⚠️ **Os resumos não saem do gatilho.** A ideia original era "resumo na última batida", mas no
instante da batida o sistema não sabe que ela é a última — e nos dias em que a saída **não** é
registrada (esquecimento, ou batida fora da janela que virou pendência) o resumo nunca sairia,
justamente no dia em que a pessoa mais precisa dele. Quem produz é
`fn_gerar_resumos_aviso_ponto()`, chamada pelo worker a cada minuto. O dia fecha de dois jeitos:
**todos** os turnos com saída registrada (entrega em ≤1 min, na prática "na última batida") ou o
dia virou — este segundo sai marcado como **incompleto**, com aviso de procurar o coordenador.

⚠️ **Agregado por (servidor, dia), não por linha de `escala_diaria`.** Um servidor pode ter duas
linhas no mesmo dia (Regular + Plantão). Percorrer linha a linha entregaria um resumo com só um dos
turnos, e o índice único engoliria o outro em silêncio — mensagem entregue, incompleta e sem rastro.

⚠️ **`fora_janela` avisa sempre, em qualquer modo**, e nunca entra em resumo.

❌ **Resumo mensal descartado:** é a folha de ponto, que já existe no Portal com muito mais detalhe
do que cabe numa mensagem. O resumo semanal leva o **link** do Portal no rodapé — o benefício de
*push* sem transcrever documento que já existe.

### Ainda em aberto

- **Formato do payload do webhook da AstraCalls.** `extrairMensagem()` em
  [`api/avisos-ponto/webhook/route.ts`](../../src/app/api/avisos-ponto/webhook/route.ts) foi escrito
  tolerante de propósito — tenta `from/sender/phone/remoteJid/chatId` e
  `text/body/message/content/conversation`, e trata JID (`5594…@s.whatsapp.net`). Todo payload não
  reconhecido é **registrado e respondido com 200** (um 4xx faria o provedor reentregar em laço).
  Assim que houver um payload real, o parser pode ser fechado no formato certo.
- **Duas variáveis de ambiente** a provisionar no Coolify:
  `WHATSAPP_WEBHOOK_SECRET` (obrigatória — sem ela o endpoint responde 503 em vez de aceitar
  confirmação forjada) e `CRON_SECRET`, se ainda não existir.
- **Cron do worker** — `/api/avisos-ponto/despachar` a cada 1 min, e
  `fn_expirar_optin_aviso_ponto()` uma vez por dia.
### 🔕 Divulgação no terminal — adiada deliberadamente (09/08/2026)

**Decisão: não anunciar nada por enquanto.** Fica registrado para retomada futura, se for o caso.

Com double opt-in, quem não souber que a opção existe nunca ativa. O lugar natural de divulgar
seria a tela do terminal logo após a batida — sobretudo no caso âmbar, que é onde a pessoa mais
sente falta de levar algo consigo. **Nada disso foi implementado**, e não deve ser sem decisão
nova.

A consequência a manter em mente ao ler os números do piloto: **adesão baixa não significa que a
feature não interessa.** Significa que ninguém foi avisado de que ela existe. Não é motivo para
descontinuar; é motivo para, aí sim, divulgar e medir de novo.

O que reabriria o assunto:
- a reclamação sobre falta de comprovante voltar a aparecer depois de a feature estar no ar;
- o piloto do HMM terminar sem sinal de degradação da sessão do WhatsApp, liberando volume;
- a Fase 6 (PDF do Art. 79 no Portal) entrar — aí o anúncio passa a ter o que oferecer de verdade,
  e o aviso deixa de ser a única coisa a divulgar.

Se for retomado, o menor caminho é a própria [`presenca/page.tsx`](../../src/app/presenca/page.tsx),
no bloco de status já existente — **sem** tocar em `fn_registrar_ponto` nem em nada do fluxo de
gravação.
- **Fase 6 (PDF do Art. 79 no portal)** — entra no roadmap agora ou depois da Fase 5 do módulo REP?
- **Número dedicado** — não foi descartado, foi **adiado**. O double opt-in reduz muito o risco,
  mas se o piloto do HMM mostrar qualquer degradação da sessão, ele vira pré-requisito da expansão
  para SMS e LACEM.

---

## Fontes

- [PORTARIA MTP nº 671, de 8 de novembro de 2021 — texto integral](https://www.normaslegais.com.br/legislacao/portaria-mtp-671-2021.htm)
- [Perguntas e Respostas — Portaria nº 671/2021 (Ministério do Trabalho e Emprego)](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/Perguntas%20e%20Respostas%20REP)
