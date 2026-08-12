# Terminal local sem sessão de coordenador + fechamento em código da Fase 4 (REP)

**Data:** 11/08/2026 · **Versão:** v1.45.0

Registro da sessão que retomou o plano
[`docs/planos/2026-08-08-integracao-relogio-de-ponto-rep.md`](../planos/2026-08-08-integracao-relogio-de-ponto-rep.md)
na Fase 4 (parada em 08/08/2026, ver
[`docs/evolucao/2026-08-08-integracao-relogio-de-ponto-fases-0-a-4.md`](2026-08-08-integracao-relogio-de-ponto-fases-0-a-4.md))
e resolveu um segundo problema, relatado no meio da conversa e sem relação direta com o
relógio de ponto: o terminal `/presenca` deixava uma sessão Supabase Auth de coordenador
aberta na máquina do terminal por dias, e servidores com acesso físico à máquina estavam
usando isso para mexer na retaguarda.

Uma migration aplicada, todas as demais peças em código (frontend + rotas + coletor Go), zero
mudança de comportamento em `fn_confirmar_presenca`/`fn_confirmar_presenca_manual`.

---

## O que motivou o terminal local

O usuário relatou: o coordenador ativa `/presenca` com email/senha e vai embora — fluxo
correto e que precisa continuar assim, porque o objetivo é o servidor bater ponto sem
depender de alguém supervisionando o tempo todo. O problema é que ativar aquele terminal
significa logar de verdade no Supabase Auth **naquele navegador**. A sessão persiste (é o
comportamento desejado), então por dias o navegador do terminal tem credencial completa de
coordenador/admin. Servidor abre outra aba, navega para `/home` ou qualquer rota da
retaguarda, e está autenticado.

A pergunta original era sobre o app local que já estava sendo construído para o relógio de
ponto (`coletor-rep`): dava para ele também abrir essa tela, restrita à unidade/setor, sem
esse vazamento? A resposta implementada troca o mecanismo de ativação inteiro — nunca revoga a
persistência (que é o que o usuário queria manter).

### Decisões tomadas com o usuário (11/08/2026)

1. Matrícula fora da unidade/setor do terminal: **bloqueada**, nunca aceita ali.
2. No terminal ativado pelo app local, **não existe mais fallback de login por email/senha** —
   só o token do app local ativa. `/presenca` clássico continua existindo, sem alteração, para
   quem ainda não tem o app local.

---

## Modelo e fluxo

Migration `20260811180000_add_terminais_locais.sql` — tabela `terminais_locais` (`unidade_id`,
`setor_id` opcional, `responsavel_coordenador_id`, `token_hash`, `ativo`) e três funções, no
mesmo esquema sha256 que `dispositivos_rep`/`fn_autenticar_dispositivo_rep` já usava:

- `fn_gerar_token_terminal_local` — admin/super_admin, devolve o token em claro uma única vez.
- `fn_autenticar_terminal_local` — `service_role` apenas.
- `fn_registrar_ponto_terminal_local` — **novo wrapper**, não toca `fn_confirmar_presenca` nem
  `fn_registrar_ponto` (armadilha 1 do `CLAUDE.md`). Confere `ativo`, resolve
  `servidores.unidade_id/setor_id` pela matrícula (mesma fonte que `fn_registrar_ponto` já usa
  para o contexto da marcação) e recusa **antes** de checar o PIN quando fora de escopo — para
  uma matrícula de outro setor não aprender se o PIN estaria certo. Dentro do escopo, delega
  para `fn_registrar_ponto` e devolve o jsonb dela sem alterar.

Sessão sem `supabase.auth`: `src/utils/terminalLocalSession.ts` assina um payload
`{terminal_id, iat}` com HMAC-SHA256 (`crypto` do Node, sem dependência nova) e grava num
cookie httpOnly, `secure`, `sameSite=lax`, restrito a `/presenca-local`, com 180 dias de
validade. O token cru nunca é gravado em cookie — circula só na chamada de ativação.

- `POST /api/presenca-local/ativar` — recebe `{terminal_id, token}`, autentica via
  `fn_autenticar_terminal_local` e grava o cookie.
- `POST /api/presenca-local/registrar` — lê o cookie, confere HMAC e validade, chama
  `fn_registrar_ponto_terminal_local`.
- `src/app/presenca-local/ativar/page.tsx` — lê `terminal_id`/`token` da URL (mesmo padrão de
  `src/app/sobreaviso/[token]/page.tsx`), ativa e troca a URL por `/presenca-local`.
- `src/app/presenca-local/page.tsx` — clone da tela pós-ativação de `/presenca`, sem
  formulário de login: sem cookie válido, mostra "terminal não ativado, reabra pelo
  aplicativo local" em vez de pedir email/senha.

Gestão em `/marcacoes` (novo módulo, ver abaixo), aba "Terminais Locais": CRUD +
"Gerar token", mesmo padrão de exibição única (caixa `font-mono` + copiar com feedback,
reaproveitado de `AssinaturaDigitalModal.tsx` — não havia precedente exato de "segredo exibido
uma vez" no projeto).

**Revogação:** `terminais_locais.ativo` é conferido a cada marcação — desativar na tela de
gestão derruba qualquer sessão de navegador já aberta, sem esperar o cookie expirar.

---

## Fechamento em código da Fase 4 (REP)

O que faltava, confirmado por exploração do repositório antes de começar (não existia
`tools/`, `src/app/api/rep/`, nem `src/app/(dashboard)/marcacoes/`):

- **Rotas `/api/rep/v1/marcacoes`, `/heartbeat`, `/pendencias`** — autenticação por token de
  dispositivo (não um segredo único compartilhado como `/api/cron`): `Authorization: Bearer`,
  `X-SisEscala-Dispositivo`, `X-SisEscala-Timestamp`, `X-SisEscala-Assinatura` (HMAC-SHA256
  do token sobre `timestamp + sha256(body)`, anti-replay de 5 min), extraído para
  `src/utils/repDeviceAuth.ts`. `/pendencias` devolve sempre `[]` — a fila de cadastro é Fase
  7, propositalmente fora do escopo.
- **Módulo `/marcacoes`** (`src/app/(dashboard)/marcacoes/`) — abas Terminais Locais,
  Dispositivos REP e Pendências. Pendências lista `fn_marcacoes_pendentes_revisao` (já
  existia, nunca tinha UI) e usa `fn_aceitar_marcacao_pendente` (idem) num modal que busca as
  escalas candidatas do servidor naquele dia antes de gravar o passo. Sincronizações e
  Importar (pendrive) ficaram de fora desta rodada — Fase 6.
- **Coletor em Go** (`tools/coletor-rep/`) — subcomandos `sync`, `heartbeat`, `diagnostico`,
  `terminal abrir`, `install/start/stop` via `kardianos/service`. **Não compilado nem testado
  nesta sessão** — sem Go instalado e sem acesso ao relógio físico. Ver os avisos no
  `README.md` do próprio diretório e a seção correspondente do `CLAUDE.md`.

---

## O que ficou pendente

| # | assunto | quando |
|---|---|---|
| 1 | Compilar (`go mod tidy` + `go build`) e testar o coletor contra o relógio real | antes de instalar em campo |
| 2 | Confirmar os nomes de campo de `get_system_information.fcgi` (só usado para a deriva de relógio no heartbeat) | idem |
| 3 | `sync` sempre pede o AFD a partir do NSR 1 em vez de ler `ultimo_nsr` antes — funciona pela idempotência de `fn_ingerir_afd`, mas reenvia o arquivo inteiro a cada ciclo | antes de relógio de alto volume |
| 4 | Abas Sincronizações e Importar (pendrive) do módulo `/marcacoes` | Fase 6 |
| 5 | Critério de saída da Fase 4 (coleta contínua por N dias) continua sem começar a contar | Fase 4 |
| 6 | Pendências que já bloqueavam a Fase 5 (103 marcações de intervalo, 3 regras de intervalo divergentes, `fn_blocos_previstos_dia` sem checagem de escopo) | inalteradas, ver `CLAUDE.md` |

## Verificação

`npx tsc --noEmit` e `npm run build` limpos (o build pegou um `useSearchParams` sem
`<Suspense>` em `/presenca-local/ativar`, corrigido antes do commit). Sem framework de testes
— verificação de `fn_registrar_ponto_terminal_local` e das rotas fica para depois do deploy,
com um terminal de teste provisionado pela própria tela de gestão.

---

## Continuação, mesmo dia: testado contra hardware real (v1.46.0, v1.47.0)

Com Go instalado na máquina do usuário (setor de TI), testou-se o coletor de ponta a ponta
contra o relógio real (10.110.2.89) e o terminal local em produção. Três bugs apareceram e
foram corrigidos na hora, cada um só descoberto porque havia hardware/ambiente real por trás —
nenhum apareceria em `tsc`/`build`.

### 1. Middleware redirecionava as rotas novas para `/login` (v1.46.0)

`/api/rep/v1/*` e `/api/presenca-local/*` são chamadas por máquina (token de dispositivo ou
cookie assinado), nunca com sessão Supabase Auth. O middleware só deixa passar sem sessão as
rotas listadas em `rotasApiPublicas` — as duas novas não tinham sido adicionadas. Sintoma
enganoso: toda chamada devolvia `405 Method Not Allowed` em vez de um redirect visível (o
middleware redireciona com 307, preservando o método; o cliente segue o redirect; `/login` é
página, só aceita GET; POST numa página GET-only é isto que gera 405). O comentário do próprio
arquivo já avisava desse padrão exato — já tinha acontecido com `/api/version`
(09/08/2026) — e caiu de novo. Corrigido acrescentando `/api/rep` e `/api/presenca-local` à
lista.

### 2. Windows Smart App Control bloqueia o `.exe` recém-compilado

Sem assinatura/reputação, o Smart App Control (ativo por padrão em instalação nova do Windows
11) recusa executar o binário. `go run .` contorna isso para desenvolvimento — o binário
temporário que o Go gera na hora passa. Desligar o Smart App Control de vez é irreversível sem
reinstalar o Windows, então não foi feito; ficou registrado como decisão para quando o terminal
for de fato instalado em produção (assinatura de código, ou aceitar rodar via `go run`/serviço
com outro mecanismo).

### 3. `cmd /c start` corta a URL de ativação no `&`

`terminal abrir` abria o navegador só com `?terminal_id=...`, sem `&token=...` — o `cmd.exe`
trata `&` como separador de comando. Trocado por `rundll32 url.dll,FileProtocolHandler`, que
não reinterpreta a URL. Confirmado funcionando: o terminal ativou e mostrou a tela de presença
sem pedir login nenhum.

### 4. O campo de data/hora do AFD não é o do exemplo do plano (v1.47.0)

Achado mais sério: `sync` trouxe 17.448 registros do histórico completo do relógio (ele ainda
pede sempre a partir do NSR 1) e **zero marcações**. Investigando com um subcomando novo,
`afd-raw` (só busca e imprime os bytes crus, não grava nada), ficou claro que o campo de
data/hora real tem 12 dígitos (`DDMMYYYYHHMM`), não os 24 caracteres ISO 8601
(`2023-11-08T08:46:00-0300`) do exemplo ilustrativo do plano — o exemplo era uma reformatação
para leitura humana na documentação, não os bytes reais. Confirmado cruzando NSR, identificador
e CRC: é literalmente o mesmo evento do exemplo do plano, só sem os separadores.

**Sem dado corrompido** — `linha_bruta` sempre esteve certa; o bug era só na extração das
colunas derivadas, e por isso é recuperável via `parse_versao` sem tocar no artefato legal.
Migration `20260811190000` corrige `fn_parse_linha_afd` e roda `fn_reparse_afd_dispositivo`
para todo dispositivo existente. Resultado em produção: 21 marcações resolvidas para servidor
(as batidas reais do piloto — Lucia, Daiane, Victor confirmados na amostra, com horários batendo
com o esperado) e mais de mil órfãs (o histórico de 2023 do relógio, configuração/teste do
equipamento com identificador fake — comportamento correto, não sujeira).

Detalhe técnico: `to_timestamp(v_dt_txt, 'DDMMYYYYHH24MI')::timestamp AT TIME ZONE
'America/Sao_Paulo'` substitui o cast direto — o mesmo padrão que `fn_confirmar_presenca` usa
na direção inversa. Ver armadilha 11 do `CLAUDE.md`.

### Pendências atualizadas

Item 1 e 2 da tabela original resolvidos (compilado, testado, `login`/`heartbeat`/`sync`
funcionando). Item 2 (`get_system_information.fcgi`) continua em aberto — não testado ainda.
