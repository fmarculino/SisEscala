# coletor-rep

App local do SisEscala. Roda numa máquina Windows dentro da unidade e faz duas coisas
independentes — uma máquina pode ter só uma, ou as duas:

1. **Sincroniza o relógio de ponto REP-C** (Control iD): busca o AFD incremental e envia para
   `/api/rep/v1/marcacoes`.
2. **Abre a tela de presença do terminal local** (`terminal abrir`): substitui o login de
   coordenador por email/senha no navegador da máquina do terminal por um token de
   dispositivo, restrito à unidade/setor cadastrados. Ver
   `docs/planos/2026-08-08-integracao-relogio-de-ponto-rep.md` e o plano de terminal local
   para o motivo.

## ⚠️ Estado desta versão

Este código foi escrito **sem acesso a um ambiente Go nem ao relógio físico** nesta sessão —
não foi compilado nem testado contra hardware real. Antes de instalar em produção:

1. Instale o Go (1.21+) e rode `go mod tidy` dentro de `tools/coletor-rep/` para baixar as
   dependências (`kardianos/service`, `golang.org/x/text`, `gopkg.in/yaml.v3`) e gerar o
   `go.sum`.
2. Rode `go build -o coletor-rep.exe .` e confira que compila sem erro.
3. **Confirme os nomes de campo da API do relógio contra o hardware real** antes de confiar no
   parsing, especialmente `get_system_information.fcgi` (usado só para a deriva de relógio no
   `heartbeat` — `rep/client.go` tenta `device_time`, `system_time` e `datetime`, nessa ordem,
   e se nenhum bater o heartbeat segue sem deriva, não quebra). `login.fcgi` e
   `get_afd.fcgi?mode=671` já foram validados contra produção em 08/08/2026 (ver o plano) —
   é o resto da API que é aproximação.
4. Use `curl.exe -sk` a partir do PowerShell para validar cada endpoint isoladamente antes de
   rodar `coletor-rep sync` de verdade — `Invoke-RestMethod` falha contra o TLS não-padrão do
   device (documentado no plano).

## Uso

```
coletor-rep sync                            sincroniza AFD do relógio REP configurado
coletor-rep heartbeat                       reporta versão e deriva de relógio ao SisEscala
coletor-rep diagnostico                     testa conexão com o REP e com o SisEscala
coletor-rep terminal abrir                  abre a tela de presença local no navegador
coletor-rep install|start|stop|uninstall    gerencia o serviço do Windows
coletor-rep run                             roda o ciclo contínuo em primeiro plano (usado pelo serviço)
```

Todos os comandos leem `config.yaml` ao lado do executável (ou o caminho passado em
`--config`). Copie `config.yaml.exemplo` para `config.yaml` e preencha.

## Provisionamento

1. Na tela **Marcações** do SisEscala (menu Operação), crie o dispositivo REP e/ou o terminal
   local, escolhendo unidade/setor e (para terminal local) o coordenador responsável.
2. Clique em "Gerar token" — o valor só aparece **uma vez**. Copie para o `config.yaml` da
   máquina.
3. Rode `coletor-rep diagnostico` para confirmar que o token autentica antes de instalar como
   serviço.
4. `coletor-rep install` seguido de `coletor-rep start` (como Administrador) registra o
   serviço do Windows, que roda o ciclo de sync+heartbeat a cada 5 minutos.
5. Para o terminal local, crie um atalho na área de trabalho (ou na inicialização do usuário
   do quiosque) apontando para `coletor-rep.exe terminal abrir`. Recomenda-se abrir o
   navegador em modo kiosk (`--kiosk` do Chrome/Edge) como camada extra — isso não é o que
   fecha o vazamento de sessão de coordenador (o cookie assinado do terminal é o que fecha),
   mas reduz a superfície de navegação indevida.

## Fila offline

Falha de rede ao enviar um lote de AFD grava o lote em
`%PROGRAMDATA%\SisEscala\fila\<lote_id>.jsonl` (append-only). O próximo `sync` reenvia tudo
que estiver lá antes de buscar AFD novo — reenviar é sempre seguro, porque `fn_ingerir_afd` é
idempotente por `(dispositivo_id, lote_id)`.

## Fora do escopo desta versão

- Exportar/aplicar por pendrive (`.sisrep`) — Fase 6 do plano.
- Push de cadastro SisEscala → relógio (biometria, matrícula) — Fase 7 do plano.
- Leitura prévia do `ultimo_nsr` antes de pedir o AFD (hoje `sync` sempre pede a partir do NSR
  1 e deixa a idempotência do servidor descartar o que já foi ingerido — funciona, mas
  reenvia o arquivo inteiro a cada ciclo; ver TODO em `main.go`).
