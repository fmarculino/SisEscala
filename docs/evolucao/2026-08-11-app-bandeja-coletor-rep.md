# App de bandeja para o coletor-rep + distribuição em escala municipal

**Data:** 11/08/2026

Continuação, no mesmo dia, do trabalho que fechou a Fase 4 em código e corrigiu o parser do
AFD (ver [`2026-08-11-terminal-local-e-fechamento-fase4-rep.md`](2026-08-11-terminal-local-e-fechamento-fase4-rep.md)).
Depois de validar o coletor contra hardware real, o usuário apontou que o jeito de
instalar/operar (copiar pasta, editar `config.yaml` na mão, `go run` para contornar o Smart App
Control) não escala para o que está sendo construído de verdade: atender a SMS de um município
inteiro, potencialmente dezenas a centenas de unidades de saúde, a maioria com pessoal
não-técnico operando a máquina.

## O pedido

Instalador baixado direto do SisEscala (autenticado, sem digitar token à mão), ícone na bandeja
do Windows como qualquer outro programa — verde/vermelho conforme o estado, notificação quando
cair — e cobertura de Windows 7 a 11.

## Decisões tomadas com o usuário

1. **Windows 7 não é bloqueante.** Maioria do parque é 10/11, e Go 1.21+ já não suporta Windows
   7 ([golang/go#57003](https://github.com/golang/go/issues/57003)). Construído para Windows
   10+; Windows 7 fica documentado como não suportado, não implementado.
2. **Sem Active Directory/GPO central** — cada unidade cuida da própria máquina. Elimina
   whitelisting central de aplicativo via política de grupo como saída para o aviso do Windows.
3. **Sem certificado de assinatura de código viável agora.** Combinado com o item 2, o
   instalador vai mostrar aviso do Windows em algum grau — não dá para eliminar isso nesta
   rodada, só desenhar em torno.
4. **Sem auto-atualização nesta versão.** Reinstalar baixando de novo resolve por enquanto.

## O que a pesquisa mudou no desenho

- **Smart App Control em modo "Ativado" não tem bypass nenhum**, nem para o usuário local —
  nem "Executar assim mesmo", nem PowerShell escapa (avalia `.exe`, `.msi` e `.ps1` igual). Só
  vem ligado por padrão em instalação limpa e recente do Windows 11, não no parque já em uso há
  anos. **Windows Defender SmartScreen** (o mecanismo mais comum, desde o Windows 8) *tem*
  clique-para-continuar — é o aviso que a maioria das máquinas vai mostrar.
- Um `.exe` normal esbarra no mesmo bloqueio que um `.msi` ou instalador via Inno
  Setup/WiX — o formato não muda nada. Por isso: **sem toolchain de instalador separada**. O
  próprio binário Go se auto-instala no primeiro uso.
- **Serviço do Windows não pode mostrar ícone de bandeja** (isolamento de Sessão 0 desde o
  Vista) — por isso o `kardianos/service` que a CLI usava foi removido, não adaptado. O app de
  bandeja é um processo comum, iniciado na sessão do usuário via autostart (`HKCU\...\Run`, sem
  precisar de administrador).
- `fyne.io/systray` (fork mantido de `getlantern/systray`, sem GTK) para o ícone/menu.
  `gen2brain/beeep` para a notificação de falha — `systray` não tem API de balloon/toast
  nenhuma; hand-rolar `Shell_NotifyIcon` sem poder testar interativamente era arriscado demais
  para este momento.

## O que foi construído

`tools/coletor-rep/` virou dois binários compartilhando os mesmos pacotes internos
(`rep/sisescala/fila/terminal/config`, mais um novo `ciclo/` extraído do que era `rodarSync`/
`rodarHeartbeat` do `main.go` antigo):

- **`cmd/cli`** — a CLI de diagnóstico manual que já existia (`sync`, `heartbeat`,
  `diagnostico`, `afd-raw`, `terminal abrir`), com `install/start/stop` removidos (o app de
  bandeja substitui o papel de "rodar continuamente").
- **`cmd/tray`** — novo. Ícone dinâmico (verde/vermelho/cinza — três `.ico` de 16×16 gerados por
  script, sem editor de imagem, com AND-mask zerado e alpha real), menu com Status/Sincronizar
  agora/Abrir tela de presença/Ver logs/Sair, ciclo interno por `time.Ticker` (sem Agendador de
  Tarefas), auto-instalação no primeiro uso (copia a si mesmo para
  `%LOCALAPPDATA%\SisEscala\coletor-rep\`, registra autostart, relança de lá), mutex nomeado
  para instância única, `MessageBoxW` via `golang.org/x/sys/windows` para erros fatais (um app
  de bandeja não tem console).

**Distribuição** — nova rota `POST /api/coletor-rep/download`
(`src/app/api/coletor-rep/download/route.ts`): recebe `tipo` (`terminal`|`dispositivo`), `id` e
o `token` que o admin **acabou de gerar** pela tela (não gera um token novo — evitaria
invalidar silenciosamente um terminal já instalado a cada novo download) e devolve um `.zip`
com o binário pré-compilado (`tools/coletor-rep/dist/coletor-rep-tray.exe`) + um `config.yaml`
já preenchido. Botão "Baixar aplicativo" nos dois modais de `/marcacoes`
(`TerminalLocalModal.tsx`, `DispositivoRepModal.tsx`), ao lado do "Gerar token" existente.

Dois detalhes de infraestrutura que valem registrar:

- **`.zip` sem dependência nova** (`src/utils/zip.ts`) — formato STORE (sem compressão) com
  CRC32 manual: o binário Go já vem comprimido pelo compilador, DEFLATE ganharia pouco, e
  implementar certo o framing de stream comprimido é mais arriscado de acertar sem testar
  contra um leitor de zip de verdade do que gravar os bytes crus.
- **`outputFileTracingIncludes`** em `next.config.js` — `tools/coletor-rep/dist/` fica fora de
  `src/` e do rastreamento automático do `output: 'standalone'`. Sem isso a rota funcionaria em
  `npm run dev` (lê o filesystem completo) e falharia silenciosamente no container do Coolify.
  Confirmado após o build: `.next/standalone/tools/coletor-rep/dist/coletor-rep-tray.exe`
  existe no output gerado.

## O que não foi possível testar nesta sessão

O Smart App Control desta máquina bloqueou até `go run` do `cmd/tray` (não só o `.exe`
compilado, que já era esperado) — sem determinismo aparente, já que `go run` do `cmd/cli`
funcionou antes na mesma máquina. Cada chamada de API externa (`fyne.io/systray`,
`gen2brain/beeep`, `golang.org/x/sys/windows`, `registry`) foi conferida contra a documentação
real via busca, não escrita de memória, e o código compila limpo (`go build`, `go vet` sem
avisos) — mas o comportamento em tempo de execução (ícone renderizando, notificação
disparando, auto-instalação de ponta a ponta) **precisa ser validado numa máquina sem esse
bloqueio**, ou desligando o Smart App Control nesta para teste.

## Pendências

| # | assunto |
|---|---|
| 1 | Validar `cmd/tray` de ponta a ponta numa máquina real (ícone, notificação, auto-instalação, autostart sobrevivendo a reboot) |
| 2 | Recompilar `dist/coletor-rep-tray.exe` sempre que `cmd/tray` ou os pacotes que ele importa mudarem — não há automação para isso ainda |
| 3 | Suporte a Windows 7, auto-atualização, instalador `.msi` — deliberadamente fora do escopo, ver README |
