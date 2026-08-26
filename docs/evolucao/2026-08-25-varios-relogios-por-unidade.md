# Uma unidade, vários relógios (25/08/2026)

Ponto de partida: **há unidades com 4 relógios de ponto**, e pode haver mais. A pergunta era o que
precisava mudar — cadastro, coletor, biometria.

## O que já funcionava (e ninguém precisava mexer)

`dispositivos_rep.unidade_id` sempre foi FK simples, **sem unique** — a única unicidade é
`(fabricante, numero_serie)`. Cadastrar N relógios na mesma unidade nunca foi bloqueado, e desde
`20260813130000` cada um pode ainda ser restrito a setores (`dispositivos_rep_setores`, o "Setores
atendidos" do modal). A atribuição da batida também já não dependia disso: desde `20260818200000`
a identidade resolve direto por CPF ou PIS, então bater em qualquer relógio da unidade já virava
ponto.

## O que travava de verdade: o coletor era um-relógio-por-máquina por construção

| peça | como era | efeito com 4 relógios |
|---|---|---|
| `config.DispositivoRep` | ponteiro único (`dispositivo_rep:`) | 1 config = 1 relógio |
| mutex `Global\SisEscalaColetorRepTray` | uma instância por máquina | a 2ª instalação **não abre** |
| pasta de instalação | `%LOCALAPPDATA%\SisEscala\coletor-rep` fixa | instâncias se sobrescrevem |
| autostart | valor `SisEscalaColetorRep` fixo em `HKCU\...\Run` | idem |
| **fila offline** | diretório **plano**, `Pendentes()` devolvia tudo | 🚨 lote de um relógio reenviado com o **token de outro** |

O último não é estética. O client HTTP é montado **por dispositivo** (token no HMAC), a fila não
era: duas instâncias dividindo `%PROGRAMDATA%\SisEscala\fila` fariam o AFD de um equipamento entrar
em `dispositivos_rep` como sendo do outro — NSR de dois relógios misturados na mesma linha, cursor
embaralhado, e **nada reclamando em lugar nenhum**.

## A escolha: um coletor, N relógios (v0.9.0)

A alternativa era quatro instalações no mesmo PC (mutex por dispositivo, quatro ícones na bandeja,
quatro autostarts, quatro atualizações). Mais peças móveis para o mesmo resultado.

```yaml
dispositivos_rep:
  - nome: "REP-iDClass-HMI-01"
    id: "..."
    token: "..."
    endereco: "10.110.5.5"
  - nome: "REP-iDClass-HMI-02"
    ...
```

`dispositivo_rep:` (singular) **continua valendo** — todo config.yaml já instalado em campo usa
ela, e `Config.Dispositivos()` junta as duas formas.

### Quatro regras que não podem ser desfeitas

- **Cada relógio mantém id e token próprios.** Não existe "token da unidade": é o token que diz de
  qual equipamento veio cada linha do AFD. `id` repetido faz o coletor **recusar o config.yaml
  inteiro** — rodar meio certo aqui produz batida atribuída ao equipamento errado meses depois.
- **Relógio fora do ar não interrompe os outros.** `ciclo/todos.go` acumula os erros e segue; uma
  unidade não pode parar de registrar ponto em três equipamentos porque o quarto está desligado.
- **Fila por dispositivo** (`fila\<dispositivo_id>\`). Lote deixado na raiz por uma versão anterior
  é adotado **só quando há um único relógio configurado** — com dois, o arquivo não diz de quem é,
  e chutar autoria de marcação já coletada seria pior que o problema. Portão: `go test ./fila/`.
- **CLI com duas políticas.** Rotina (`sync`, `heartbeat`, `cadastros`, `higiene`,
  `higiene-remover`) roda em todos; o que fala com **um** equipamento (`afd-raw`, `afd-exportar`,
  `cadastros-exportar`, `cadastros-testar`, `remocao-testar`) **recusa** até escolher
  `--dispositivo <nome|ip|id>`. Gravar usuário de teste em quatro equipamentos de produção por um
  comando que a pessoa achava que era um só não pode acontecer por descuido.

### Instalação

No modal de um relógio de unidade com mais de um aparece **"Baixar pacote da unidade (N
relógios)"**: gera token novo para cada equipamento (`gerarTokensUnidadeRep`) e monta o `.zip` com
os N no mesmo `config.yaml`.

⚠️ Isso **invalida o token anterior** desses relógios — instalação antiga que estivesse coletando
um deles para de sincronizar (HTTP 401) até receber o pacote. É o efeito esperado de consolidar num
coletor só, e a tela avisa antes do clique. Falta **um** relógio na lista? A rota recusa o pacote
inteiro: um config.yaml com três dos quatro instala e roda sem erro nenhum, e o quarto simplesmente
não é coletado — o modo de falha silencioso que este módulo existe para não ter.

## v0.9.1 — duas armadilhas que só apareceram ao escrever o roteiro de instalação

Nenhuma das duas aparece em build, teste de tipo ou revisão de código: as duas só existem **na
máquina da unidade, na hora de instalar por cima do que já está lá**.

### 1. A mesclagem de `config.yaml` duplicaria o relógio e o app não abriria

`instalarConfig` preservava a seção `dispositivo_rep` sempre que o download novo não a trazia — a
regra certa quando só existia a forma singular. O pacote da unidade traz **`dispositivos_rep`
(lista)**, e a máquina que já coletava tem **`dispositivo_rep` (singular)** do mesmo relógio.
Resultado: o relógio 1 na lista com o token novo **e** no singular com o token que o download
acabou de invalidar → `id` repetido → `Carregar` recusa o arquivo → `mostrarErroFatal` e o app de
bandeja **não abre**.

O inverso também: baixar "Baixar aplicativo" de **um** relógio numa máquina que atende quatro
sobrescrevia a lista e apagava os outros três.

A regra vive agora em **`config.Mesclar`** (fora do `cmd/tray`, testável sem systray —
`go test ./config/`), com duas linhas que não podem sair:

- **nunca perder um relógio** — o que estava instalado e não veio no download continua;
- **quem repete, o novo ganha** — o download acabou de gerar o token; o de disco já está morto.

### 2. Instalador com o app aberto saía em silêncio

`garantirInstanciaUnica()` é a primeira linha do `main`, e o ramo "já existe" fazia `os.Exit(0)`
mudo. Isso é correto para o autostart disparando duas vezes — e péssimo para quem acabou de
extrair o `.zip` e dá duplo-clique: nada acontece na tela, a pessoa vai embora achando que
instalou, e a máquina continua com a instalação antiga e o **token já invalidado**.

Agora, quando quem roda está **fora** de `%LOCALAPPDATA%` (ou seja, é o instalador), aparece uma
caixa dizendo para sair pelo ícone da bandeja e executar de novo. Quem já está instalado continua
saindo em silêncio.

## Cobertura: o caso misto ficava ambíguo

A cobertura é calculada **por dispositivo**, e isso continua certo — para bater num relógio, a
pessoa precisa estar cadastrada **naquele** relógio, com biometria. Mas numa unidade com um relógio
geral + relógios setoriais, quem está no relógio do próprio setor e não no geral aparecia como
problema no geral, **exatamente como quem não está em relógio nenhum**. Duas situações com urgência
oposta, indistinguíveis na tela.

`20260825110000` acrescenta uma coluna em cada função, e **nenhum número existente muda de
significado**:

| função | coluna | o que diz |
|---|---|---|
| `fn_cobertura_ponto_dispositivo` | `coberto_em` | outros relógios ativos da unidade onde essa pessoa bate hoje |
| `fn_cobertura_ponto_resumo` | `cobertos_em_outro` | quantos dos `nao_conseguem_bater` batem em outro |

⚠️ **`cobertos_em_outro` nunca é descontado de `nao_conseguem_bater`.** Naquele equipamento a
pessoa continua sem conseguir bater; mudar o significado de um número que já está na tela seria
pior que somar um número novo ao lado dele.

⚠️ **Exige biometria para contar como cobertura.** Cadastro sem digital não registra ponto —
contar isso como coberto reintroduziria, por outro caminho, o "bate e não registra" que a aba de
Cobertura existe para denunciar.

## Biometria: dá para copiar

O relógio **devolve** os templates (`load_users.fcgi` já é chamado com `templates: true`; o coletor
só olhava o tamanho do array), e o CSV de "Enviar/Receber usuários" tem a coluna `digitais` em
base64, com "Receber usuários" confirmado **aditivo** em hardware real (CEI, 14/08/2026).

Procedimento por pendrive documentado em
[`docs/planos/2026-08-25-copia-de-biometria-entre-relogios.md`](../planos/2026-08-25-copia-de-biometria-entre-relogios.md),
com o teste de uma linha antes do arquivo inteiro e o aviso de duplicidade ao copiar entre um
relógio cadastrado por CPF e outro por PIS. A automação pela API fica planejada no mesmo documento
— exige janela de teste no equipamento, porque escrever template errado no cadastro de servidor
real tem como sintoma "a digital dele parou de funcionar", descoberto pelo servidor na frente do
relógio.

## Verificação feita

- `go build ./...` e `go vet ./...` limpos; `go test ./fila/` (portão novo do isolamento) passa.
- Binários recompilados: **tray subsystem 2 (GUI)**, **cli subsystem 3 (console)** — conferido pelo
  cabeçalho PE, como manda o CLAUDE.md.
- `ciclo.Versao` e `dist/VERSION` em **0.9.0**, os dois.
- `npm run build` ok, com `coletor-rep-tray.exe` e `VERSION` presentes em `.next/standalone`.
- `npx tsc --noEmit` e `npm run lint` sem erro novo.
- CLI exercitada com config de dois relógios fictícios: itera os dois no `diagnostico`, segue do
  primeiro para o segundo quando o primeiro falha no `sync`, recusa `afd-raw` sem `--dispositivo`
  listando os disponíveis, e **recusa o arquivo inteiro** com `id` repetido.

**Não verificado contra hardware real**: nenhuma máquina com dois relógios de verdade rodou este
binário ainda. A primeira instalação numa unidade de 4 é o portão que falta.
