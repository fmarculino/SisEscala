# coletor-rep

App local do SisEscala. Roda numa máquina Windows dentro da unidade e faz duas coisas
independentes — uma máquina pode ter só uma, ou as duas:

1. **Sincroniza o relógio de ponto REP-C** (Control iD): busca o AFD incremental e envia para
   `/api/rep/v1/marcacoes`.
2. **Mantém a tela de presença do terminal local aberta** (`terminal abrir`): substitui o login
   de coordenador por email/senha no navegador da máquina do terminal por um token de
   dispositivo, restrito à unidade/setor cadastrados. Ver
   `docs/planos/2026-08-08-integracao-relogio-de-ponto-rep.md` para o motivo.

Dois binários, pacotes internos (`rep/`, `sisescala/`, `fila/`, `terminal/`, `config/`,
`ciclo/`) compartilhados entre os dois — nenhuma lógica duplicada:

- **`cmd/tray`** — o app de bandeja. É o que roda o dia a dia numa unidade: ícone verde/vermelho,
  ciclo de sync automático, autostart, auto-instalável. **É o que a maioria das pessoas deve
  baixar e usar** — pela tela **Marcações** do SisEscala, não compilando na mão.
- **`cmd/cli`** — ferramenta de linha de comando para diagnóstico/configuração manual (testar
  login no relógio, rodar um `sync` avulso, inspecionar o AFD cru). Útil para quem está
  configurando ou depurando uma unidade, não para rodar continuamente.

## Distribuição normal (o caminho esperado para a maioria das unidades)

1. No SisEscala, **Marcações → Terminais Locais** (ou **Dispositivos REP**) → editar o
   registro → **Gerar token** → **Baixar aplicativo**. O `.zip` baixado já vem com o
   `config.yaml` preenchido — ninguém copia token à mão.
2. Extrair o `.zip` inteiro (não só o `.exe` — ele precisa do `config.yaml` do lado) e executar
   `coletor-rep-tray.exe`.
3. Na primeira execução ele se copia sozinho para
   `%LOCALAPPDATA%\SisEscala\coletor-rep\`, registra autostart em
   `HKCU\...\CurrentVersion\Run` (sem precisar de administrador) e relança a si mesmo de lá — a
   pasta onde o `.zip` foi extraído pode ser apagada depois.
4. A partir daí, ícone na bandeja: verde = tudo certo, vermelho = falhando há algumas
   tentativas seguidas (com notificação). Menu com "Sincronizar agora", "Sincronizar cadastros
   agora" (Fase 7 — só quando `dispositivo_rep` está configurado, ver aviso abaixo), "Abrir tela
   de presença", "Ver logs", "Sair".

### "Sincronizar cadastros agora" — push de identidade para o relógio (Fase 7)

Envia matrícula/nome/CPF (nunca biometria — isso sempre exige alguém presencial no equipamento)
dos servidores enfileirados em **Marcações → Dispositivos REP → editar → Sincronizar cadastros**.
✅ Confirmada contra hardware real em 12/08/2026 (ver `rep/client.go`) — matrícula temporária
(`T26xxxxx`) tem o `T` removido antes de virar número no relógio, mesma convenção já usada
manualmente ali. Mesmo assim, continua fora do ciclo automático (só clique manual ou
`coletor-rep cadastros`) por prudência com escrita em equipamento de produção — antes de confiar
numa **unidade nova**, rode `coletor-rep-cli cadastros-testar` (abaixo) contra o relógio dela,
porque hardware/firmware diferentes podem responder diferente.

### Não dá para "testar IP/usuário/senha" pela tela do SisEscala

O relógio vive na rede interna da unidade (ex.: `10.x.x.x`); o servidor do SisEscala (Coolify,
numa VPS na internet) não alcança esse endereço — um botão de teste ali sempre falharia, com
qualquer credencial. O teste real só pode rodar numa máquina que esteja na mesma rede do
relógio, que é justamente onde o coletor roda. Duas ferramentas cobrem isso, ambas sem gravar
nada no equipamento:

- `coletor-rep-cli diagnostico` — login no relógio + comunicação com o SisEscala. É o mais
  rápido, use primeiro.
- `coletor-rep-cli cadastros-testar` — específico do push de identidade (Fase 7), grava um
  usuário de teste isolado.

`coletor-rep-cli.exe` **não** vem no `.zip` do "Baixar aplicativo" (esse é só o app de bandeja) —
baixe separadamente pelo link "coletor-rep-cli.exe" que aparece no aviso da tela de Dispositivo
REP (rota `GET /api/coletor-rep/download-cli`, admin/super_admin), e coloque o `.exe` na mesma
pasta onde o app de bandeja já está instalado (`%LOCALAPPDATA%\SisEscala\coletor-rep\`) — ele lê
o `config.yaml` que já está lá.

### Máquina que precisa das duas modalidades (relógio + terminal)

Baixe os dois `.zip` (um em Terminais Locais, outro em Dispositivos REP) e rode os dois
instaladores nela, em qualquer ordem — **não precisa editar `config.yaml` na mão**. Cada
download só vem com a seção que você pediu, mas o segundo instalador **mescla** com o
`config.yaml` que o primeiro já deixou instalado (`instalarConfig` em `cmd/tray/main.go`), em
vez de sobrescrever. No fim sobra um `config.yaml` só, com as duas seções.

### ⚠️ Aviso do Windows na primeira execução — é esperado

Sem certificado de assinatura de código (decisão consciente — ver
`docs/evolucao/2026-08-11-app-bandeja-coletor-rep.md`), o Windows vai avisar:

- **SmartScreen** (a maioria das máquinas): "Mais informações" → "Executar assim mesmo". Aviso
  normal para qualquer programa não assinado por uma editora grande, mesmo sendo legítimo.
- **Smart App Control** (só em instalação limpa/recente do Windows 11 — raro em máquina já em
  uso há anos): bloqueio **sem** opção de exceção por app. Único caminho: Configurações do
  Windows → Privacidade e segurança → Segurança do Windows → Controle de aplicativos e
  navegador → desligar o Smart App Control, executar o instalador, e então pode reativar (em
  builds recentes do Windows 11 isso já não exige reinstalar o Windows do zero — confira a
  versão do sistema se a opção de reativar não aparecer).

## Uso da CLI (`cmd/cli`) — diagnóstico manual

```
coletor-rep sync                sincroniza AFD do relógio REP configurado (uma vez)
coletor-rep heartbeat           reporta versão e deriva de relógio ao SisEscala (uma vez)
coletor-rep diagnostico         testa conexão com o REP e com o SisEscala
coletor-rep afd-raw             só imprime a resposta crua do relógio (diagnóstico, não grava nada)
coletor-rep cadastros           aplica a fila de push de identidade real no relógio (Fase 7) — GRAVA no equipamento
coletor-rep cadastros-testar    cria um usuário de teste no relógio e lista biometria (diagnóstico — GRAVA um registro de teste, ver aviso acima)
coletor-rep remocao-testar      cria um usuário de teste e o APAGA — descobre qual formato de `remove_users.fcgi` este relógio aceita, sem tocar em cadastro real
coletor-rep higiene             lê todos os usuários do relógio e reporta ao SisEscala (Fase 7b) — só leitura, seguro rodar sempre
coletor-rep higiene-remover     aplica no relógio quem foi selecionado na tela de higiene — GRAVA/APAGA no equipamento; num relógio novo, rode `remocao-testar` antes (ver abaixo)
coletor-rep terminal abrir      abre a tela de presença local no navegador (uma vez)
```

Lê `config.yaml` do diretório de trabalho atual (ou o caminho passado em `--config`) — copie
`config.yaml.exemplo` para `config.yaml` e preencha à mão para uso manual/depuração.

### `remove_users.fcgi`: formato descoberto em campo, não presumido

O corpo certo é **`{"users":[N]}`** — array de **números** com o `pis`, confirmado contra hardware
real em 13/08/2026 na LACEM. A aproximação por simetria com `load_users.fcgi`
(`{"users":[{"pis":N}]}`) tinha sido recusada no mesmo dia, nas 31 remoções da fila, com
`'users' em formato incorreto`.

A varredura fica: `rep.RemoverUsuario` não chuta um formato só — na primeira remoção de cada
execução ela tenta os candidatos de `formatosRemocao` (`rep/client.go`), o confirmado primeiro, e
**confirma por relistagem** qual deles realmente apagou o cadastro, guardando o vencedor para o
resto do lote. É o que faz um modelo/firmware diferente ser descoberto em vez de falhar.

Duas defesas que não podem sair daí:

- um `ok` do relógio **não** conta como remoção — se a relistagem mostrar o cadastro ainda lá, a
  fila do SisEscala é fechada como falha, não como aplicada;
- se um candidato apagar alguém que não era o alvo, a execução aborta na hora, sem tentar os
  outros pendentes.

Rode `coletor-rep remocao-testar` num relógio novo antes de `higiene-remover`: ele cria e apaga o
usuário descartável "SISESCALA TESTE - PODE APAGAR" e imprime o formato aceito.

## Desenvolvimento

```powershell
cd tools/coletor-rep
go mod tidy
go build -o cmd/cli/coletor-rep.exe ./cmd/cli                              # binário de dev, uso local
go build -o dist/coletor-rep-cli.exe ./cmd/cli                             # binário de release (GET /api/coletor-rep/download-cli)
go build -ldflags="-H=windowsgui" -o dist/coletor-rep-tray.exe ./cmd/tray  # binário de release, sem console
```

- `-ldflags="-H=windowsgui"` no build do `cmd/tray` suprime a janela de console que piscaria ao
  abrir — sem isso o app ainda funciona, só fica visualmente errado para um app de bandeja.
- `dist/coletor-rep-cli.exe` e `dist/coletor-rep-tray.exe` são os binários que
  `/api/coletor-rep/download-cli` e `/api/coletor-rep/download`
  (`src/app/api/coletor-rep/download{-cli,}/route.ts`) servem — **precisam ser recompilados e
  commitados manualmente a cada mudança em `cmd/cli`, `cmd/tray`, ou nos pacotes que eles
  importam**; o container de produção não tem toolchain Go para compilar em build-time.
  `next.config.js` inclui `tools/coletor-rep/dist/**` no output
  standalone via `outputFileTracingIncludes` — sem isso a rota funciona em `npm run dev` (lê o
  filesystem completo) mas falha em produção.
- Atalho de desenvolvimento no `cmd/tray`: se existir um `config.yaml` no diretório de trabalho
  atual, ele roda direto dali (pula a auto-instalação) — é o único jeito de testar via
  `go run ./cmd/tray` sem simular um download de verdade, e é como este projeto testa
  localmente.
- **Smart App Control pode bloquear até `go run`**, não só o `.exe` compilado — o binário
  temporário que o `go run` gera também é "não assinado" aos olhos do SAC, e o bloqueio não
  pareceu 100% determinístico nos testes desta sessão. Se acontecer, é preciso testar numa
  máquina sem SAC ativo, ou desligá-lo temporariamente nesta.

## Fila offline

Falha de rede ao enviar um lote de AFD grava o lote em
`%PROGRAMDATA%\SisEscala\fila\<lote_id>.jsonl` (append-only). O próximo `sync` reenvia tudo
que estiver lá antes de buscar AFD novo — reenviar é sempre seguro, porque `fn_ingerir_afd` é
idempotente por `(dispositivo_id, lote_id)`.

## Fora do escopo desta versão

- Windows 7/8 — o Go 1.21+ usado aqui exige Windows 10+. Se surgir necessidade real, o caminho
  é compilar essa unidade separadamente com Go 1.20 (última versão com suporte), sem misturar
  toolchain no build principal.
- Auto-atualização do app de bandeja — reinstalar baixando o `.zip` de novo resolve por ora.
- Instalador `.msi`/painel de controle — o auto-instalável cobre a necessidade por enquanto.
- Exportar/aplicar por pendrive (`.sisrep`) — Fase 6 do plano do relógio de ponto.
- Biometria em si (o template do dedo) — sempre presencial no equipamento, nunca por API.
  Push de identidade (matrícula/nome/CPF) já existe desde 12/08/2026, ver seção acima —
  não validado contra hardware real ainda.
- `get_system_information.fcgi` (deriva de relógio no heartbeat) continua aproximação — os
  nomes de campo não foram confirmados contra o hardware real.

## Coleta incremental (cursor de NSR) — v0.5.0, 17/08/2026

Até a v0.4.6 o `sync` pedia o AFD **sempre a partir do NSR 1** e confiava na idempotência de
`fn_ingerir_afd` para descartar o repetido. Funcionava, mas fazia o equipamento remontar o arquivo
inteiro a cada 5 minutos — e num relógio reaproveitado isso deixou de ser desperdício e passou a
ser **falha total**: o REP iDClass - SMS (10.110.0.20) ficou de 14/08 a 17/08/2026 com **zero**
sincronizações, todo ciclo morrendo em `context deadline exceeded ... while reading body` (o
equipamento leva mais de 30s para montar ~40 mil linhas) e recomeçando do zero 5 minutos depois.

Agora o coletor pergunta o cursor ao SisEscala antes de pedir o AFD:

```
GET /api/rep/v1/estado  ->  { "proximo_nsr": 36075, "ultimo_nsr": 36074 }
```

⚠️ **O cursor não é `ultimo_nsr + 1`, e essa diferença é o ponto todo.** Ele é
`fn_cursor_afd_dispositivo`: o fim do trecho **contíguo** de NSR já ingerido, mais 1. `ultimo_nsr`
é o *maior* NSR de cada lote, então se um NSR do meio nunca chegar (linha ilegível, lote perdido
da fila offline), um cursor ingênuo o deixaria para trás **para sempre** — batida descartada em
silêncio. Com trecho contíguo, qualquer lacuna puxa o cursor de volta para antes dela e o relógio
reenvia dali; reingerir é de graça. Ver a migration `20260817150000` para o raciocínio completo.

Toda falha de decisão cai para o NSR 1 (comportamento antigo, "baixar demais"). A assimetria é
deliberada: errar o cursor **para cima** é a única forma de perder marcação, porque o relógio
simplesmente não devolveria as linhas anteriores e nada no sistema reclamaria.

Quando o SisEscala está inacessível, o coletor usa o último cursor que o servidor informou,
cacheado em `cursor-<dispositivo_id>.json` no diretório da fila. Esse arquivo é **cache, nunca
fonte de verdade** — só guarda valor vindo do servidor, nunca é avançado localmente, e apagá-lo é
sempre seguro. Sem ele, um servidor fora do ar rebaixaria a coleta para "arquivo inteiro"
justamente no momento em que a fila offline precisa juntar dado.

### Dois timeouts, de propósito

| chamada | timeout | por quê |
|---|---|---|
| `login`, `get_system_information`, `load_users`, `add_users`, `remove_users` | 30s | respondem em menos de 1s num relógio saudável — timeout curto é o que faz equipamento fora do ar falhar rápido em vez de segurar o ciclo |
| `get_afd.fcgi` | 10 min (padrão) | o equipamento monta o arquivo antes de responder; a **primeira** coleta de um relógio já usado continua sendo o arquivo inteiro, e é ela que precisa de teto folgado para o dispositivo arrancar |

Ajustável por unidade sem recompilar, via `timeout_afd_segundos` no `config.yaml` (ausente ou 0
usa o padrão de 10 min — nunca "sem timeout", que prenderia o ciclo da bandeja num relógio
travado):

```yaml
dispositivo_rep:
  # ...
  timeout_afd_segundos: 900   # opcional; só para relógio muito lento
```

`afd-raw` e `afd-exportar` também usam esse teto — são justamente os comandos que se usaria num
relógio de alto volume.

## Desvio de relógio da máquina — v0.5.1, 17/08/2026

`HTTP 401: "Timestamp fora da janela permitida (anti-replay)"` no log **não é problema de token**.
A checagem de desvio roda antes da validação do token (token superado dá
`"Dispositivo ou token inválido"`), e afeta **todas** as rotas `/api/rep/v1/*`, não só o heartbeat —
`EnviarLote`, `pendencias` e `biometria` assinam com o mesmo HMAC. Numa máquina com hora errada, o
AFD baixa normalmente e **todos** os lotes vão para a fila offline: nada se perde, mas nada aparece
no SisEscala e a bandeja fica vermelha sem explicar por quê.

Desde a v0.5.1 o coletor **não depende mais do relógio local**: aprende o desvio pelo header `Date`
de qualquer resposta HTTP (ponto médio entre envio e chegada, à la NTP) e assina com
`hora local + desvio`. O próprio 401 de anti-replay já traz o `Date` correto, então a resposta que
recusa é a que ensina a hora certa; um retry único cobre a primeira requisição do processo, quando
o desvio ainda é zero.

**Não ajusta o relógio do Windows de propósito.** Isso exigiria `SeSystemtimePrivilege`, que usuário
comum não tem, e pedir elevação quebraria a decisão de o app instalar e rodar sem administrador.

**Não afrouxa o anti-replay.** Quem decide o que é "agora" continua sendo exclusivamente o servidor,
que segue recusando timestamp fora da janela dele. Alinhar-se ao relógio dele só permite que um
cliente honesto produza um timestamp que ele considere atual — replay de requisição capturada não
ganha nada com isso.

⚠️ **Compensar não é esconder.** Desvio de 1 min ou mais vira aviso explícito no log a cada vez que
aparece, porque a hora errada do Windows continua sendo problema real daquela máquina (aparece na
tela do terminal de presença, por exemplo). Corrija com `w32tm /resync /force` (como administrador)
e confirme o fuso com `tzutil /g` — deve dar `SA Eastern Standard Time`.
