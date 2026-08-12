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
⚠️ **Diferente do resto deste app, essa função nunca foi validada contra hardware real** — ver
aviso extenso em `rep/client.go`. Antes de confiar nela numa unidade nova, rode
`coletor-rep-cli cadastros-testar` (abaixo) contra o relógio dessa unidade.

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
coletor-rep terminal abrir      abre a tela de presença local no navegador (uma vez)
```

Lê `config.yaml` do diretório de trabalho atual (ou o caminho passado em `--config`) — copie
`config.yaml.exemplo` para `config.yaml` e preencha à mão para uso manual/depuração.

## Desenvolvimento

```powershell
cd tools/coletor-rep
go mod tidy
go build -o cmd/cli/coletor-rep.exe ./cmd/cli
go build -ldflags="-H=windowsgui" -o dist/coletor-rep-tray.exe ./cmd/tray   # binário de release, sem console
```

- `-ldflags="-H=windowsgui"` no build do `cmd/tray` suprime a janela de console que piscaria ao
  abrir — sem isso o app ainda funciona, só fica visualmente errado para um app de bandeja.
- `dist/coletor-rep-tray.exe` é o binário que a rota `/api/coletor-rep/download`
  (`src/app/api/coletor-rep/download/route.ts`) empacota com o `config.yaml` de cada
  terminal/dispositivo — **precisa ser recompilado e commitado manualmente a cada mudança em
  `cmd/tray` ou nos pacotes que ele importa**; o container de produção não tem toolchain Go
  para compilar em build-time. `next.config.js` inclui `tools/coletor-rep/dist/**` no output
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
- Leitura prévia do `ultimo_nsr` antes de pedir o AFD (hoje `sync` sempre pede a partir do NSR
  1 e deixa a idempotência do servidor descartar o que já foi ingerido — funciona, mas
  reenvia o arquivo inteiro a cada ciclo; ver TODO em `ciclo/ciclo.go`).
- `get_system_information.fcgi` (deriva de relógio no heartbeat) continua aproximação — os
  nomes de campo não foram confirmados contra o hardware real.
