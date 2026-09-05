# SisEscala — guia para agentes

Sistema de gestão de escalas e ponto digital da **Secretaria Municipal de Saúde de Marabá (DMAC)**.
**Está em produção com dados reais de servidores públicos.** Erros aqui viram folha de ponto errada
e problema jurídico. Prefira investigar demais a supor de menos.

Ver também [`.agents/AGENTS.md`](.agents/AGENTS.md) — regras que **complementam** este arquivo.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind 4 · Supabase (Postgres + RLS + Auth)
Verificações automáticas via GitHub Actions CI (`.github/workflows/ci.yml`): `npx tsc --noEmit`, `npm run lint`, `npm run build` e validação de compilação dos binários Go do coletor REP.

**Deploy: Coolify na VPS, não Vercel.** App em `sisescala.maraba.pa.gov.br`, mesmo host do
Supabase de produção. Webhook do GitHub dispara o deploy automático a cada push na `main`.
Uma nota anterior aqui dizia "Vercel" — os headers de produção não têm nenhuma assinatura da
Vercel, e isso já levou a afirmar que um push tinha deployado sem ter como verificar.

```
src/app/(dashboard)/     telas internas (escalas, folha-ponto, relatórios, cadastros)
src/app/consultar-escala portal do servidor (login por matrícula + PIN)
src/app/presenca         terminal de ponto
supabase/migrations/     60+ migrations SQL
docs/                    planos, evolução por versão, diagnósticos
```

## Onde mora a complexidade

**Não é no frontend.** A lógica crítica está em funções PL/pgSQL grandes:

| função | papel |
|---|---|
| `fn_confirmar_presenca` | ~1.030 linhas. Decide, a cada batida no terminal, **qual** dos 4 passos está sendo registrado (entrada → saída intervalo → retorno intervalo → saída), com janela de tolerância, blocos contíguos e turnos que cruzam a meia-noite. |
| `fn_confirmar_presenca_manual` | Validação manual pelo coordenador. Grava horários **sintéticos** derivados da jornada. |
| `fn_confirmar_presenca_manual_bulk` | Apenas um laço que **delega** para `fn_confirmar_presenca_manual`. Corrigir a função manual corrige a validação em massa junto. |
| `fn_jornada_tem_intervalo` | Fonte única da regra de intervalo intrajornada (CLT Art. 71). |

`ScaleGrid.tsx` (~5.000 linhas) é a grade de escala — o maior arquivo do frontend.

## Módulo de marcações (integração com relógio de ponto) — em construção

Iniciado em 08/08/2026. Plano em [`docs/planos/2026-08-08-integracao-relogio-de-ponto-rep.md`](docs/planos/2026-08-08-integracao-relogio-de-ponto-rep.md),
faseado de 0 a 9. **Fases 0–3 aplicadas em produção.** A 4 ganhou o resto do código em
11/08/2026 (rotas `/api/rep/v1/*`, módulo `/marcacoes`, coletor em Go) — ver
[`docs/evolucao/2026-08-11-terminal-local-e-fechamento-fase4-rep.md`](docs/evolucao/2026-08-11-terminal-local-e-fechamento-fase4-rep.md).
**Ainda não é "fechada"**: o coletor não foi compilado nem testado contra o relógio real nesta
rodada (sem Go instalado nem acesso ao device na sessão que o escreveu), e o critério de saída
da Fase 4 (coleta contínua por N dias, ver seção "Piloto" abaixo) continua sem começar a contar.

✅ **Estado medido em produção em 19/08/2026 — o parágrafo acima é histórico.** A Fase 4 está
**materialmente cumprida**: **6 relógios** ativos (Reg/TI/TFD, SMS, LACEM, CEI, ENF-ZEZINHA,
Almox-Pat-CAF), 414.301 registros AFD, 1.514 sincronizações e **zero falhas** nas últimas 1.000
(todas `concluida`). A rampa é recente: 2 batidas/dia em 07/08 → **441 batidas de 169 servidores em
6 relógios em 19/08**.

⚠️ **E a Fase 4 deixou de ser "sem afetar a folha".** Desde `20260818080000`, `fn_ingerir_afd`
chama `fn_reconciliar_marcacoes_dia` para todo servidor com vínculo — a batida do relógio **já
escreve em `escala_diaria`**, em qualquer unidade. Eram 408 linhas de 08/2026 com entrada de origem
`rep` em 19/08/2026.

A infraestrutura da **Fase 5** foi criada em 19–20/08/2026 e está **inerte** (toda unidade em
`fonte_ponto_oficial = 'terminal'`):

| migration | o que dá |
|---|---|
| `20260820000000` | a coluna `unidades.fonte_ponto_oficial` — **a chave de corte nunca tinha sido criada**, só existia em comentários da `20260808060000` |
| `20260820010000` | criar vínculo aciona o reparse e reconcilia **só os pares que ganharam dono** |
| `20260820020000` | em unidade `rep`, a escrita direta é **neutralizada** (não abortada) e a marcação dispara a reconciliação, aplicando a precedência |

⚠️ **O motivo da `20260820020000`, medido:** dos 580 pares (servidor, dia) com batida REP em
08/2026, **41 ficaram gravados com entrada de origem `terminal` e 8 com `ajuste_coordenador`** — em
49 dias o REP perdeu para quem está **abaixo** dele em `fn_precedencia_origem`, porque
`fn_confirmar_presenca` escreve `escala_diaria` direto, sem passar pela precedência.

O relógio é um **REP-C certificado** (Control iD iDClass, AFD assinado, memória inviolável) e o
SisEscala passa a ser o **PTRP** da Portaria 671/2021: pode complementar e tratar, **nunca**
alterar o dado original, e deve manter histórico.

### O modelo separa três coisas que hoje estão fundidas numa coluna só

| camada | tabela | mutabilidade |
|---|---|---|
| evidência bruta | `rep_afd_registros` | `linha_bruta` imutável, com cadeia de hash |
| o fato | `marcacoes_ponto` | **INSERT-only** — trigger bloqueia UPDATE/DELETE |
| o juízo do coordenador | `marcacoes_tratamentos` | append-only |
| projeção (cache) | `escala_diaria.presenca_*` | reconstruível por `fn_reconciliar_marcacoes_dia` |

Origem em `marcacao_origem`; a prioridade vem de `fn_precedencia_origem` (rep 1 → terminal 2 →
ajuste_coordenador 3 → ajuste_servidor 4) e é aplicada **em um único lugar**, a reconciliação.
Não replicar no frontend.

### Regras que não podem ser quebradas

- **Nunca fabricar horário.** Passo sem marcação vira pendência, não timestamp sintético. É o
  oposto de `fn_salvar_saida_bloco`, que inventa até 5 timestamps por batida.
- **Nunca descartar batida.** Órfã, excedente, duplicada e fora de escala continuam registradas.
- **Marcação perdedora por precedência continua visível** (`substituida_por_precedencia`).
- `fn_projecao_marcacoes_dia` é a **fonte única** compartilhada por reconciliar e conferir. Se
  cada uma derivar por conta própria, o portão de conferência deixa de validar o que será aplicado.

### A alocação roda por dia, e um dia não sabe do outro (19/08/2026)

⚠️ **`fn_alocar_marcacoes_dia` é chamada por (servidor, dia) e grava só o seu dia.** Nada
sobrescreve nada entre dias vizinhos, então **a mesma batida podia ficar gravada como saída de
ontem E entrada de hoje** — foi assim que a batida das 21:20 do dia 18 virou a entrada do dia 19
e empurrou a batida real das 08:23 para "saída para o intervalo" (caso real, coordenador da TI).
Diário completo em
[`docs/evolucao/2026-08-19-batida-de-um-dia-virando-passo-de-outro.md`](docs/evolucao/2026-08-19-batida-de-um-dia-virando-passo-de-outro.md).

Duas defesas em `20260819180000`, que **não podem ser removidas sem repor equivalente**:

| defesa | o que faz |
|---|---|
| **piso de meia-noite** | um passo nunca casa com batida anterior à meia-noite do dia civil em que o **bloco** começa. Blocos que cruzam a meia-noite não são afetados: o piso é o do *início* do bloco |
| **regra do dono** | a batida é do dia cujo passo previsto está mais perto dela; os passos dos blocos dos dias vizinhos viram *sombras* que só desqualificam candidatas. O desempate por timestamp do slot faz os dois dias decidirem o oposto — exatamente um fica com ela, **independente da ordem de reconciliação** |

⚠️ **O teto de distância sozinho nunca resolve isso.** 720 min é metade do período da escala, então
toda batida das 20:00–24:00 da véspera alcança o slot de entrada das 08:00. Baixar o teto até
fechar essa brecha desliga a flag `ignora_janela_presenca` (medido em `20260819120000`).

⚠️ **O DP prefere quantidade a qualidade** — o custo de não casar (`v_tol_ontem * 2`) é sempre
maior que o pior casamento aceito (`<= v_tol_ontem`), então casar mal sempre compensa. Mexer nesse
custo foi **simulado e descartado** em 19/08/2026: corrige 2 duplicações a mais e quebra três dias
saudáveis, entre eles uma entrada real a 3 min do previsto que passava a ser recusada.

Ainda aberto, medido e sem correção: um bloco que cruza a meia-noite é alocado ao processar o dia
dele **e** o dia seguinte, com conjuntos de slots concorrentes diferentes — o resultado gravado
depende de qual dia foi reconciliado por último. (Batida de transição entre blocos encostados
aparecendo em dois passos é o caso vizinho e é **desejado**; ver armadilha 6.)

### Antes de mexer

`fn_blocos_previstos_dia` (`20260808040000`) é **cópia mecânica** do trecho de montagem de blocos
de `fn_confirmar_presenca`. Não editar à mão — regerar pelo script (`scratchpad/gen_blocos.js`),
que aborta se a contagem de ocorrências divergir.

`fn_conferir_reconciliacao` é o substituto do framework de testes: roda a projeção sobre meses
reais e devolve toda divergência. O portão da Fase 2 está registrado em
[`docs/evolucao/2026-08-08-portao-fase2-reconciliacao-de-marcacoes.md`](docs/evolucao/2026-08-08-portao-fase2-reconciliacao-de-marcacoes.md).

### Piloto da Fase 4 (definido em 08/08/2026)

6 servidores do setor de **Informática da SMS**, marcando **no relógio e no terminal** por um mês
— um par de controle por evento. O coordenador é participante e supervisiona.

**O mês só começa quando a coleta estiver contínua.** Em 08/08/2026 havia 1 dispositivo, 26
registros AFD e **2 marcações de origem `rep`** — a data de início não é a data em que a fase foi
marcada.

Duas lacunas conhecidas, registradas no plano:
- ⚠️ ~~A SMS tem `permite_marca_intervalo = false` → o piloto exercita só o fluxo de 2 batidas.
  **A Fase 5 tem que começar por unidade sem marcação de intervalo**~~ — **desatualizado, e a
  premissa caiu (19/08/2026).** Medido em produção: as **4 unidades com relógio marcam intervalo**
  (CEI, LACEM e SMS `flexivel`; ENF-ZEZINHA `rigido`). Não existe mais unidade candidata pelo
  critério original. O critério novo é **cobertura de ponto**, e o CEI é o único com 100%
  (17/17) — ver [`docs/planos/2026-08-20-virada-do-cei-fase5.md`](docs/planos/2026-08-20-virada-do-cei-fase5.md).
  Consequência prática: o fluxo de 4 batidas, que o plano dizia nunca ter sido exercitado, **já
  roda em produção**.
- Nenhum turno do grupo cruza a meia-noite → o cursor de "ontem" fica sem teste. Escalar um
  `Plantão N` no mês resolve.

### Coletor Go (`tools/coletor-rep/`) — dois binários, mesmo pacote interno

`rep/ sisescala/ fila/ terminal/ config/ ciclo/` são compartilhados por dois `cmd/`:

| binário | papel |
|---|---|
| `cmd/cli` | diagnóstico manual: `sync`, `heartbeat`, `diagnostico`, `afd-raw` (busca e imprime o AFD cru, não grava nada), `afd-exportar` (grava `.sisrep` para pendrive, ver abaixo), `terminal abrir`. Não roda continuamente. |
| `cmd/tray` | o que roda o dia a dia numa unidade: ícone de bandeja (verde/vermelho conforme o ciclo) **mais uma linha por relógio com bolinha verde/vermelha e `— online` / `— SEM RESPOSTA`** desde a v0.11.0 — o ícone da bandeja é um só para a máquina, então ele **agrega**, e o agregado escondia exatamente o caso comum de três equipamentos respondendo e um mudo (para isso `HeartbeatComEstado` separa "o relógio não respondeu" de "o SisEscala não respondeu", que antes viravam um erro só). ⚠️ **A bolinha é `MenuItem.SetIcon` (os mesmos `.ico` 16×16 da bandeja), nunca emoji no título**: essas linhas são `Disable()` e o Windows esmaece o item desabilitado inteiro — o `🟢` saía cinza, indistinguível do `🔴` (medido em campo na v0.11.0). O ícone é desenhado como `hbmpItem`, separado do texto, e mantém a cor. A cor nunca vai sozinha: o veredito está no próprio título, para quem não distingue as duas cores, autostart via `HKCU\...\Run` (sem precisar de administrador — `kardianos/service`, que a CLI usava antes, foi **removido**, não adaptado: serviço do Windows roda na Sessão 0, isolada da área de trabalho desde o Vista, e por isso **nunca** pode mostrar ícone de bandeja nem abrir navegador na sessão do usuário), auto-instalação no primeiro uso (copia a si mesmo para `%LOCALAPPDATA%\SisEscala\coletor-rep\` e relança de lá). |

#### Uma unidade pode ter VÁRIOS relógios, e o coletor era um-por-máquina por construção (25/08/2026)

Há unidades com **4 equipamentos**. O **cadastro** sempre aceitou isso (`dispositivos_rep.unidade_id`
é FK simples, sem unique; `dispositivos_rep_setores` divide por setor desde `20260813130000`), e a
atribuição da batida também (identidade por CPF/PIS, armadilha 13). **O coletor é que travava**:
config singular, mutex nomeado único, pasta de instalação fixa e — o pior — **fila offline plana**.

⚠️ **A fila plana era erro silencioso, não desorganização.** O client HTTP é montado por dispositivo
(o token vai no HMAC); a fila não era. Duas instâncias dividindo `%PROGRAMDATA%\SisEscala\fila`
fariam o lote de um relógio ser reenviado com o **token do outro** — o AFD de um equipamento
entrando em `dispositivos_rep` como sendo do outro, NSR misturado, **sem erro em lugar nenhum**.
Desde a v0.9.0 a fila é `fila\<dispositivo_id>\`. Portão: `go test ./fila/`.

Desde a **v0.9.0** o `config.yaml` aceita a chave plural `dispositivos_rep:` (lista); a singular
`dispositivo_rep:` **continua valendo** — todo config instalado em campo usa ela, e
`Config.Dispositivos()` junta as duas. Diário em
[`docs/evolucao/2026-08-25-varios-relogios-por-unidade.md`](docs/evolucao/2026-08-25-varios-relogios-por-unidade.md).

| regra | por quê |
|---|---|
| cada relógio tem **id e token próprios** — não existe "token da unidade" | é o token que diz de qual equipamento veio cada linha do AFD |
| `id` repetido faz o coletor **recusar o config.yaml inteiro** | rodar meio certo aqui vira batida atribuída ao equipamento errado meses depois |
| relógio fora do ar **não interrompe os outros** (`ciclo/todos.go` acumula erros) | a unidade não pode parar de registrar ponto em três porque o quarto está desligado |
| lote legado solto na raiz da fila só é adotado com **um único** relógio configurado | com dois, o arquivo não diz de quem é — chutar autoria de marcação já coletada é pior |
| CLI: rotina roda em todos; comando de **um** equipamento exige `--dispositivo` | escrever usuário de teste em 4 equipamentos de produção por descuido não pode acontecer |

Instalação: **"Baixar pacote da unidade"** no modal do dispositivo gera token novo para cada
relógio **marcado** e monta o `.zip` com eles. A rota recusa o pacote se **um** relógio da lista não
for encontrado: um config com três dos quatro roda sem erro e o quarto some da coleta.

🚨 **Isso INVALIDA o token anterior de cada relógio marcado, e derrubou produção em 26/08/2026.**
Até essa data a tela era tudo-ou-nada (rotacionava **todos** os ativos da unidade). A SMS tem
**4 relógios**, e baixar o pacote rotacionou os 4 às 15:32 — **SMS e Reg/TI/TFD ficaram 2h49 sem
sincronizar**, porque só CAF-01/02 receberam o arquivo. Por isso a seleção por relógio existe:
**marque só os que AQUELA máquina vai coletar.** Equipamentos divididos entre computadores = um
pacote por computador.

⚠️ **`config.Mesclar` preserva a ENTRADA, não a CREDENCIAL.** A regra "nunca perder um relógio"
funcionou como projetada e manteve SMS e Reg/TI/TFD no `config.yaml` — com tokens já mortos. O
sintoma é o coletor rodando normalmente, o relógio no menu, e **401 silencioso** na sincronização
daqueles dois. Ao diagnosticar "parou de sincronizar depois que baixei o pacote", compare
`dispositivos_rep.updated_at` (quando o token girou) com `ultimo_contato_em`: se batem, é isto.
Nada se perde — o AFD fica no equipamento até o coletor voltar.

⚠️ A action `gerarTokensUnidadeRep` **confere a seleção contra a unidade** em vez de aceitar a
lista como veio (armadilha 12 — tela filtrada não protege server action, que é POST chamável
direto). Omitir a lista mantém o comportamento antigo, que é o certo para o caso dominante: uma
máquina que enxerga a unidade inteira.

⚠️ **A mesclagem de `config.yaml` é `config.Mesclar`, e as duas regras dela não podem sair**
(v0.9.1): **nunca perder um relógio** (o que estava instalado e não veio no download continua —
senão baixar o pacote de um relógio numa máquina que atende quatro apaga os outros três) e **quem
repete, o novo ganha** (o de disco é o token que o download acabou de invalidar). A versão anterior
preservava o `dispositivo_rep` singular sempre que o novo não o trazia — instalar o pacote da
unidade por cima produzia o mesmo relógio nas duas chaves, `id` repetido, e o app **nem abria**.
Portão: `go test ./config/`.

⚠️ **Instalador com o app aberto saía em silêncio** (`garantirInstanciaUnica` é a primeira linha do
`main`; `ERROR_ALREADY_EXISTS` → `os.Exit(0)` mudo). Quem dava duplo-clique no `.exe` recém-extraído
não via nada e ia embora achando que instalou, com o token já invalidado. Desde a v0.9.1 o silêncio
vale só para quem roda **de dentro** de `%LOCALAPPDATA%`; o instalador mostra caixa pedindo "Sair"
pela bandeja primeiro.

⚠️ **A Cobertura da Escala é por dispositivo, e isso está certo** (para bater num relógio é preciso
estar cadastrado *naquele*, com biometria) — mas na unidade com relógio geral + setoriais a mesma
pessoa vira uma linha por relógio. `20260825110000` acrescenta `coberto_em`
(`fn_cobertura_ponto_dispositivo`) e `cobertos_em_outro` (`fn_cobertura_ponto_resumo`) para separar
"não bate em lugar nenhum" de "usa outra entrada da unidade". **`cobertos_em_outro` nunca é
descontado de `nao_conseguem_bater`**, e só conta quem tem **biometria** no outro relógio — cadastro
sem digital não registra ponto.

✅ **Biometria PODE ser copiada entre relógios**, e desde a v0.10.0 (25/08/2026) isso é
**automático — mas travado**. O procedimento manual por pendrive e o desenho completo estão em
[`docs/planos/2026-08-25-copia-de-biometria-entre-relogios.md`](docs/planos/2026-08-25-copia-de-biometria-entre-relogios.md).

A **detecção sempre foi automática** e ninguém tinha percebido: o ciclo já lê o cadastro de cada
relógio e reporta quem tem biometria, então o SisEscala já sabia que fulano tem digital no relógio
A e não no B. O que faltava era o **transporte** — `fn_biometria_faltante_dispositivo`
(`20260825130000`) diz quem falta e onde buscar, e `ciclo.SincronizarBiometria` copia.

| regra | por quê |
|---|---|
| **o template nunca vai ao servidor** — a cópia é relógio → relógio, dentro da unidade | LGPD; e o servidor não tem rota de rede até lá de qualquer forma |
| **a cópia não cria usuário** — só alcança quem já está no destino sem digital | quem não está é a fila de identidade (`rep_cadastros_fila`); é isso que torna impossível duplicar cadastro |
| depois de escrever, **só o alvo pode ter ganhado biometria E o cadastro não pode ter crescido** | a 2ª conferência pega o formato que "funciona" criando usuário novo — passaria pela 1ª e seria pior que falhar |
| falha de **transporte** não queima a pendência; **recusa** do equipamento fica 24h fora da fila | mesma distinção de `transitorio` nos cadastros |

✅ **CONFIRMADA em campo em 26/08/2026 e JÁ NO CICLO AUTOMÁTICO** (piloto Almox-Pat-CAF-01 → 02;
diário em [`docs/evolucao/2026-08-26-sincronia-de-biometria-entre-relogios.md`](docs/evolucao/2026-08-26-sincronia-de-biometria-entre-relogios.md)).
O parágrafo que existia aqui dizia o contrário — está superado.

⚠️ **O que travava não era o formato do template, era o COMANDO: `add_users.fcgi` é CRIAÇÃO, não
atualização.** Nas 45 cópias que falharam ele respondeu `PIS já cadastrado: <n>` — recusa de
**duplicidade**, nunca de formato. Contra quem já está no relógio (que é *sempre* o caso desta
operação, que por regra nunca cria usuário) ele não tem como funcionar, com corpo nenhum.

| comando | neste firmware |
|---|---|
| `add_templates` · `set_templates` · `update_templates` · … | **não existem** (`Invalid command`) |
| **`update_users.fcgi`** | **é o certo** — `{"users":[{"pis":N,"name":"...","registration":N,"templates":[...]}]}` |
| `add_users.fcgi` **com** `templates` | grava a digital **junto na criação** — relógio novo recebe cadastro e digital numa operação só |

Sondar comando com **corpo vazio** distingue "não existe" de "campo errado" sem escrever nada — é
o jeito barato de descobrir isso num modelo novo. `coletor-rep-cli biometria-testar --de <relógio>
--para <relógio>` continua sendo o portão para hardware diferente, contra o descartável
"SISESCALA TESTE - PODE APAGAR" (com um dedo cadastrado **nele**, nunca o template de um servidor
real).

⚠️ **Não acrescente candidato que mande `templates` sem `name`/`registration`.** Se um firmware
tratar `update_users` como substituição do objeto inteiro, o cadastro perde nome e matrícula — e a
conferência por relistagem **não pega**: ela olha biometria e tamanho do cadastro, não os campos de
quem ficou.

⚠️ **`fn_biometria_faltante_dispositivo` ignora quem falhou nas últimas 24h.** Ao investigar "diz
zero pendentes com N pessoas faltando digital", confira `rep_biometria_copias` antes de suspeitar
da consulta — é proteção contra repetir o mesmo erro a cada 5 min, não bug.

⚠️ Copiar de um relógio cadastrado por **CPF** para um por **PIS** duplica o cadastro de quem já
estava lá (armadilha 10): rode a Higiene no destino depois.

**Distribuição normal não é compilar na mão** — `/marcacoes` (Terminais Locais / Dispositivos
REP) tem botão "Baixar aplicativo" que gera o token e devolve um `.zip` já configurado
(`POST /api/coletor-rep/download`, empacota `tools/coletor-rep/dist/coletor-rep-tray.exe`
pré-compilado + `config.yaml` preenchido). `dist/coletor-rep-tray.exe` **precisa ser
recompilado e commitado manualmente** a cada mudança em `cmd/tray` ou no que ele importa — o
container do Coolify não tem toolchain Go. `next.config.js` usa `outputFileTracingIncludes`
para incluir esse binário no `output: 'standalone'` (ele fica fora de `src/`, fora do
rastreamento automático) — confirme com
`find .next/standalone -iname coletor-rep-tray.exe` depois de qualquer `npm run build` que
mexa nisso.

**Desde 12/08/2026, todo release do coletor também exige bump de `dist/VERSION`** — arquivo
texto puro com o número (`0.3.0`, sem prefixo `v`), lido por `GET /api/coletor-rep/tray-version`
(pública, sem sessão — mesmo espírito de `/api/version`) para o próprio app de bandeja comparar
com `ciclo.Versao` (`tools/coletor-rep/ciclo/ciclo.go`) e avisar sozinho que existe atualização.
Esquecer de subir um dos dois deixa o app achando que já está atualizado (ou, pior, oferecendo
"atualização" para a mesma versão). Ordem: bump `ciclo.Versao` → escrever `dist/VERSION` com o
mesmo número → **`.\gerar-versioninfo.ps1`** → recompilar os dois `.exe` → `npm run build` →
conferir `find .next/standalone -iname VERSION -path "*coletor-rep*"` → commitar juntos.

⚠️ **O passo do `gerar-versioninfo.ps1` entrou em 30/08/2026 e vem ANTES do build** — o `.syso`
só entra no `.exe` no build seguinte. Ele regenera os recursos `VS_VERSION_INFO` dos dois
binários a partir de `ciclo.Versao` (fonte única; a versão **não** é escrita nos
`versioninfo.json`) e **aborta** se `dist/VERSION` divergir. `.\gerar-versioninfo.ps1 -Conferir`
checa sem escrever.

**Por que existe:** binário Go não gera recurso de versão, e `.exe` sem nome de empresa, produto
nem versão é um dos sinais que motores heurísticos usam — e o coletor já tem vários outros por
construção (copia a si mesmo, grava autostart em `HKCU\Run`, roda sem janela, se auto-atualiza
baixando executável). Medido no VirusTotal na v0.13.0: **4 de 71**, todos heurística, e o único
que importa é o **Microsoft** (`Trojan:Win32/Wacatac.B!ml` — `!ml` é veredito de machine
learning, não assinatura), porque é o Defender que apaga o arquivo nas máquinas.

⚠️ **Metadado NÃO substitui assinatura digital.** Enquanto não houver certificado de code
signing, cada release é um binário novo, com hash novo, sujeito a ser reavaliado do zero — e a
liberação de falso positivo da Microsoft é **por hash**. Assinar é o que quebra o ciclo.

⚠️ **O manifesto é só declarativo, e tem que continuar assim.** `activeCodePage=UTF-8` e
`dpiAware` foram deliberadamente deixados de fora: eles **mudam comportamento** (tratamento de
texto nas APIs ANSI, desenho do menu de bandeja), não dão ganho contra antivírus, e num app que
se auto-atualiza sozinho para máquinas que ninguém alcança fisicamente não valia a carona. Se um
dia houver motivo real, que entrem num release próprio e testado em campo.

⚠️ **`cmd/tray` precisa compilar com `-ldflags="-H=windowsgui"` (documentado no `README.md` do
coletor, ignorado uma vez em 14/08/2026 ao recompilar rápido pra testar `cadastros-exportar`).**
Sem essa flag o binário sai no subsystem console (3) em vez de GUI (2) — não é só cosmético
("janela pisca e some"): fechar essa janela de console mata o processo inteiro, porque não há
console separado do processo, e derruba o app de bandeja em produção. `cmd/cli` é o oposto —
**não** leva essa flag, porque é feito pra imprimir no terminal. Conferir depois de compilar:

```powershell
$b = [System.IO.File]::ReadAllBytes("dist\coletor-rep-tray.exe")
$off = [BitConverter]::ToInt32($b, 0x3C) + 4 + 20
[BitConverter]::ToUInt16($b, $off + 68)   # 2 = GUI (certo) | 3 = console (esqueceu a flag)
```

⚠️ **Update do app de bandeja ERA "avisa e espera clique". Desde a v0.12.0 (26/08/2026) é
automático — com o interruptor no SERVIDOR.** A regra antiga era decisão explícita do usuário,
tomada quando o parque tinha 1–2 relógios e havia alguém por perto. **A premissa caiu**: medido em
26/08/2026 com 15 relógios, **11 estavam desatualizados** (9 em v0.8.0, 1 em v0.7.0, 1 em v0.10.0)
e **todos com contato recente** (0,1h–7,1h) — o gargalo nunca foi rede nem máquina desligada, era
o clique que ninguém dava. Agrava: **v0.9.0** foi quem trocou a fila plana pela fila por
dispositivo, então os 9 em v0.8.0 rodavam com o bug silencioso de lote reenviado com o token do
outro relógio. Diário em
[`docs/evolucao/2026-08-26-auto-atualizacao-do-coletor.md`](docs/evolucao/2026-08-26-auto-atualizacao-do-coletor.md).

🚨 **Não troque "espera clique" por "aplica sempre".** Um release ruim alcançaria o parque inteiro
em até 24h, nas máquinas que são justamente as que ninguém alcança fisicamente. Defasagem é chato;
parque derrubado é uma viagem a cada unidade. Três defesas, e nenhuma pode sair:

| defesa | onde | por quê |
|---|---|---|
| **política no servidor** | `coletor_auto_update` e `coletor_auto_update_atraso_max_minutos` em `configuracoes_globais`, devolvidas por `GET /api/coletor-rep/tray-version` (`20260826230000`) | é o **único** kill switch que funciona num parque remoto: trocar a chave para a propagação no próximo ciclo, sem deploy e sem tocar em máquina. Chave ausente = ligado; **falha ao ler = desligado** |
| **atraso sorteado** (até 240 min, no cliente) | `cmd/tray/main.go` | com 15 relógios, uma falha aparece nas primeiras antes de alcançar as demais |
| **rollback** | `aplicarAtualizacao` | se o processo novo não assumir o mutex em 3s (Smart App Control bloqueando `.exe` recém-escrito), o executável **anterior é restaurado**. Sem isso o autostart do próximo boot lança o binário bloqueado e a unidade sai do ar **em silêncio** |

Continua valendo: sha256 conferido antes de instalar, checagem no máximo **1x/dia**, e a aplicação
roda **no fim de `executarCiclo`, na mesma goroutine** — nunca com um lote em voo. Campo
`auto_update` ausente na resposta (servidor anterior à v0.12.0) desserializa como `false` em Go, e
o coletor volta a só avisar. ⚠️ **Reverter uma versão já aplicada exige publicar um `dist/`
anterior com `VERSION` maior** — `compararVersoes` só aceita subir. É por isso que o atraso
sorteado importa.

**Import/export de AFD por pendrive (Fase 6, 12/08/2026)** — para unidades onde o relógio não
tem rede até o servidor (ex.: LACEN). `coletor-rep-cli afd-exportar <arquivo>.sisrep` roda numa
máquina que enxerga o equipamento, lê um estado local (`estado-pendrive.json`, ao lado do
`config.yaml` — **nunca** no banco, porque essa máquina por definição não tem caminho até lá) para
pedir só o que ainda não foi exportado, e grava um cabeçalho ASCII + os bytes crus do AFD
(ISO-8859-1, sem decodificar — mesma preservação de `linha_bruta`). O arquivo é levado
fisicamente até uma máquina com acesso ao SisEscala e importado pela aba "Importar por Pendrive"
em `/marcacoes` (`importarPendriveAfd` em `marcacoes/actions.ts`, que chama a mesma
`fn_ingerir_afd` do sync online com `p_canal: 'pendrive'`). Nenhuma migration nova foi necessária
— a RPC já aceitava esse canal desde a Fase 0-3. **`fn_ingerir_afd` só é `GRANT`ada a
`service_role`**: a action usa `createAdminClient()` só para essa chamada, não `createClient()`
(que teria `auth.getUser()` funcionando mas falharia com permissão negada na RPC).

- ⚠️ **Pendência (13/08/2026): fluxo de pendrive nunca foi testado ponta a ponta contra hardware
  real** — nem a coleta (`afd-exportar`) nem o envio de cadastros por esse canal (a fila de
  cadastro/Fase 7 hoje só roda pelo coletor online, via `/api/rep/v1/pendencias`; não existe
  ainda um caminho "enfileirar cadastro → aplicar por pendrive" simétrico ao de coleta). Falta
  também decidir **como higienizar** (apagar cadastro de) um relógio que só recebe pendrive: a
  Fase 7b (`remove_users.fcgi`, confirmada em 13/08/2026 na LACEM) só foi validada no caminho
  online, onde o coletor aplica a remoção na hora — um dispositivo pendrive-only não tem coletor
  rodando continuamente pra aplicar nada, então `rep_remocoes_fila` precisaria de um jeito de sair
  do banco e chegar ao equipamento fisicamente, como o AFD já faz na direção inversa.

  ✅ **Formato confirmado em 14/08/2026** (REP-iDClass-CEI, ciclo real de exportar pelo menu do
  equipamento → reimportar sem erro): "Enviar/Receber usuários" usa **texto CSV `;` com
  cabeçalho**, não nada proprietário:

  ```
  cpf;nome;administrador;matricula;rfid;codigo;senha;barras;digitais
  76107426272;Luciede de Jesus Alves;0;58534;0;0;;;<base64 do template, quando tem>
  ```

  `cpf` sai **sem zero à esquerda** (device trata como número) — é o oposto de `identificador_afd`
  do AFD, que é sempre 12 dígitos com zero de preenchimento (armadilha 10). `digitais` pode vir
  vazio (confirmado: 19 de 67 usuários do teste não tinham biometria). `empregador` é o mesmo
  formato CSV, uma linha só, campos `cpforcnpj;cei;endereco;cpfcnpj;razao;cpfresp` — cadastro de
  empresa/CEI, sem equivalente hoje no schema do SisEscala, fora de escopo por ora.
  `usuarios.dat`/`digitais.dat` (binários, o segundo com assinatura `ICRS21`) são cache interno e
  container proprietário de biometria — não usados, biometria continua só presencial.

  **Implementado:** `coletor-rep-cli cadastros-exportar <arquivo>` gera esse CSV a partir de
  `rep_cadastros_fila` (mesma fonte do comando `cadastros` online), replicando a exata mesma
  conversão cpf/matrícula que `CriarUsuario` (`rep/client.go`) já fazia para o caminho online — sem
  regra nova para o mesmo dado. Só gera o arquivo: não toca no relógio nem confirma nada no
  SisEscala (a aplicação de verdade acontece fisicamente, depois, via "Receber usuários"). Fechar o
  loop depois de aplicar é rodar `coletor-rep higiene` (quando o relógio tiver rede) e vincular por
  CPF em `/marcacoes` (`fn_vincular_cadastros_por_cpf`, já existente) — não criei confirmação nova,
  reusei a que já resolve o caso dominante de "Cobertura de ponto".

  ✅ **Confirmado em 14/08/2026, hardware real (REP-iDClass-CEI)**: `cadastros-exportar` gerou o
  CSV, aplicado via "Receber usuários" no equipamento com um usuário de **teste novo**
  ("SISESCALA TESTE - PODE APAGAR", matrícula 900000) somado aos 67 reais já existentes — o
  teste entrou junto, os 67 continuaram intactos. Confirma duas coisas: o formato do
  `cadastros-exportar` é aceito de volta pelo device, e "Receber usuários" é **aditivo**, não
  substitui a lista inteira (testado apensando ao `usuarios` real exportado antes, exatamente
  por essa dúvida — testar com um CSV de 1 linha só teria arriscado apagar os 67 reais se fosse
  substituição). Usuário de teste removido pela interface do equipamento depois, mesma convenção
  de `cadastros-testar`/`remocao-testar`.

  ⚠️ **Ainda não testado**: importar de volta em `/marcacoes` → "Importar por Pendrive" um AFD
  cru exportado pelo próprio menu do relógio ("Enviar marcações") — o código já trata esse caso
  (`parseArquivoSisrep` em `marcacoes/actions.ts` aceita `.sisrep` OU AFD sem cabeçalho), só
  falta alguém passar um arquivo de verdade por ali. "Marcações (legado)" ao lado de "Enviar
  marcações" continua sem explicação — pode ser um segundo formato de AFD que nunca foi
  examinado.

- ⚠️ **Atalho de dev do `cmd/tray` não pode detectar `go run` pela presença de `config.yaml`
  no diretório de trabalho.** Era exatamente esse teste que fazia todo usuário real nunca se
  auto-instalar de verdade: o Explorer do Windows abre um `.exe` com CWD = pasta do próprio
  executável, que é onde o `.zip` baixado sempre deixa o `config.yaml`, ao lado do `.exe`. Todo
  duplo-clique caía no atalho "modo dev", rodava direto da pasta extraída e nunca copiava para
  `%LOCALAPPDATA%`, nunca registrava autostart, nunca passava pela mesclagem de config.yaml —
  "reinstalar" rodando o mesmo `.exe` de novo era sempre um no-op sobre o mesmo arquivo estático
  da extração original (inclusive um token já superado por um "Gerar token" mais recente na
  tela). Corrigido em 12/08/2026 (`rodandoViaGoRun()`, v1.49.1) detectando pelo caminho do
  binário (`go-build` no path — padrão do toolchain Go em qualquer SO) em vez de por arquivo
  vizinho. Esse teste nunca foi exercitado numa instalação real antes disso — só via `go run`
  na máquina de quem escreveu o código, onde o CWD por acaso também tinha um `config.yaml` de
  teste, mascarando o problema.
- `login.fcgi` e `get_afd.fcgi?mode=671` **validados contra o relógio real** (10.110.2.89).
- 🚨 **O handshake TLS do equipamento custa ~1,1s de CPU DELE, e ele serializa os handshakes**
  (medido em 05/09/2026 na USF José Manoel, `192.168.0.200`). Escalando a concorrência: 1,4 → 2,7
  → 4,2 → 5,4 → 8,3 → 9,2 → **16,3s**, e a **8ª conexão simultânea falha em 21s sem conectar**. As
  duas mensagens de erro do coletor são o mesmo fenômeno em dois estágios — `Client.Timeout
  exceeded while awaiting headers` é entrar na fila e não ser atendido em 30s;
  `connectex: o componente conectado não respondeu` é a fila cheia descartando o SYN. **Não é
  rede**: TCP conecta em 41ms (60/60) e a porta 80 responde em 14ms (301 → força HTTPS).
  ⚠️ **A interface web do relógio aberta num navegador triplica o custo** (4,2s errático × 1,1s
  estável) — **não deixe aberta**, e é fácil de esquecer durante uma instalação.
  ⚠️ **Mas ela não é a causa raiz.** Um monitor de outra máquina, com **uma** requisição a cada
  29s, viu o equipamento ficar surdo na 443 por **4 minutos** com o navegador já fechado. Para
  separar "reinicia" de "só o servidor web trava" **não é preciso credencial**: durante o
  episódio, ping respondendo = firmware (chamado na Control iD); ping caindo junto = fonte/hardware.
  ℹ️ Reusar a conexão é ~50× mais barato (0,02s contra 1,1s), e o coletor hoje cria **três**
  `rep.Client` por ciclo (`Sync`, `Heartbeat`, `SincronizarCadastros`), cada um com `Transport`
  próprio, login próprio e nenhum `CloseIdleConnections`. Reduzir isso está pendente.
- **Windows Smart App Control bloqueia o `.exe` recém-compilado** (sem assinatura/reputação) —
  e em 11/08/2026 bloqueou também `go run` do `cmd/tray`, sem determinismo aparente (`go run`
  do `cmd/cli` tinha funcionado antes, na mesma máquina). Sem opção de exceção por app quando
  ativo ("Ativado", não avaliação) — o único caminho é desligar nas Configurações do Windows.
  Uma nota anterior aqui dizia que isso era **irreversível sem reinstalar o Windows** — builds
  mais recentes do Windows 11 já trouxeram a opção de reativar sem reinstalar; confira a versão
  antes de assumir uma coisa ou outra. Confirmado em 14/08/2026 na máquina de dev (build 26200,
  Windows 11 Pro): `HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy` →
  `VerifiedAndReputablePolicyState = 1` (Ativado, não avaliação) — bate com o comportamento
  descrito acima. Não dá para alternar por registro/PowerShell (o Windows valida a troca por um
  serviço protegido); só pela UI (Segurança do Windows → Controle de aplicativos e navegador →
  Configurações do Smart App Control → Desativar), e o próprio diálogo de confirmação mostra se
  dá para reativar sem reinstalar — não presuma, leia o texto que aparece na hora.
- ✅ **Relógio do equipamento: `get_system_date_time.fcgi` / `set_system_date_time.fcgi`,
  confirmados contra hardware real em 26/08/2026.** Corpo: `{"day","month","year","hour","minute",
  "second"}` — campos soltos, sem fuso, então quem lê decide o fuso (local, porque equipamento e
  máquina estão na mesma sala).

  🚨 **`get_system_information.fcgi` NÃO devolve hora nenhuma, e por isso `deriva_segundos` estava
  `NULL` nos 15 relógios do parque — a deriva nunca foi medida uma vez sequer.** A antiga
  `extrairRelogioDevice` procurava `device_time`/`system_time`/`datetime` ali, campos que não
  existem; a resposta real traz `user_count`/`template_count`/`uptime`/`cuts`/`last_nsr`. O
  servidor sempre soube gravar a deriva (`/api/rep/v1/heartbeat`) — só nunca recebia o dado.

  ⚠️ **Os nomes foram achados na interface web do próprio equipamento**, depois de 22 chutes
  (`set_time`, `set_clock`, `set_rtc`, `adjust_time`, `sync_time`, `set_ntp`…) darem todos
  `Invalid command`. `curl -sk https://<ip>/ | grep -o '[a-z_]*\.fcgi'` lista o que a página usa —
  mais barato que adivinhar, e revelou também `import_users_csv.fcgi`, `template_extract.fcgi` e
  `template_merge.fcgi`, ainda não explorados.

  ✅ **Ajustar a hora é operação AUDITADA, e é isso que a torna aceitável:** o próprio REP grava no
  AFD um registro **tipo 4** com o de → para (`010120010008` → `260820261658`). Não há como um
  ajuste passar despercebido em fiscalização. É o oposto de mexer em marcação, que continua
  impossível por construção.

  ⚠️ **A hora enviada NUNCA pode ser `time.Now()` puro.** Relógio de Windows torto em máquina de
  unidade não é hipótese — foi a causa dos 401 de anti-replay da SMS em 17/08/2026. `ciclo.horaConfiavel()`
  usa `time.Now() + sisescala.DesvioServidor()`, o desvio já aprendido do header `Date`. Propagar o
  erro da máquina para o equipamento transformaria problema de UM computador em ponto errado de
  servidor, com registro assinado.

  O ciclo ajusta sozinho acima de **90s** (`derivaParaAjustar`) e confere por releitura. O limiar é
  folgado de propósito: cada ajuste é uma linha no artefato legal, e deriva menor que isso não muda
  passo de jornada nenhum. `coletor-rep-cli diagnostico` mostra a hora de cada relógio e marca
  `<<< FORA DE HORA`.

  ⚠️ **Medido em 26/08/2026, no piloto:** CAF-01 com **+1min37s** e CAF-02 marcando
  **01/01/2001 00:08** — RTC perdido, provável bateria. E não estava assim horas antes (os
  cadastros das 15:20 saíram carimbados corretamente), então o relógio perdeu a hora sozinho. Com
  `ponto_valido_desde` = 26/08/2026, batidas carimbadas em 2001 seriam **orfanadas em silêncio**
  (armadilha 20): a folha não corrompe, mas o ponto da pessoa some. **Ao ligar um relógio novo,
  confira a hora antes de liberar a biometria.**
- ✅ **`sync` passou a ser incremental em 17/08/2026 (v0.5.0).** Antes pedia o AFD sempre a
  partir do NSR 1 e confiava na idempotência de `fn_ingerir_afd`. Isso não era só desperdício:
  no **REP iDClass - SMS** (10.110.0.20) era falha **total** — de 14/08 a 17/08/2026 o
  dispositivo ficou com `rep_sincronizacoes = 0` e `rep_afd_registros = 0`, todo ciclo morrendo
  em `context deadline exceeded ... while reading body` (30s de timeout contra um equipamento
  que leva mais que isso para montar ~40 mil linhas) e recomeçando do zero 5 min depois. O
  relógio comunicava o tempo todo — `login.fcgi` e `get_system_information.fcgi` respondiam na
  mesma rodada. **Sync que nunca completa uma vez não deixa rastro nenhum no banco**: ao
  diagnosticar "instalado e não comunica", confira `rep_sincronizacoes` antes de suspeitar de
  rede ou credencial.
  O cursor vem de `GET /api/rep/v1/estado` → `fn_cursor_afd_dispositivo` (migration
  `20260817150000`, **corrigida pela `20260817160000` no mesmo dia**), e **não é `ultimo_nsr + 1`**:
  é o fim do trecho **contíguo** de NSR a partir do **menor NSR do dispositivo**, mais 1.
  ⚠️ A primeira versão ancorava no **NSR 1** (`se não existe NSR 1, peça tudo`), embutindo a
  suposição de que todo AFD começa em 1 — tirada dos 3 dispositivos que tinham dado real na hora.
  Ela travaria devolvendo 1 para sempre em qualquer relógio cujo piso seja maior, e travava também
  durante recuperação grande: **a fila offline reenvia lote em ordem de nome de arquivo**
  (`os.ReadDir` sobre `lote_id`, que é hash), **não de NSR**, então o "menor NSR" de um dispositivo
  em recuperação vai *descendo* e o AFD fica cheio de buracos transitórios (medido na SMS: piso
  aparente 3001 → 501 → 1 em minutos). Cursor baixo durante recuperação é correto e passa; não
  confunda com cursor travado.
  `ultimo_nsr` é o maior NSR de cada lote, então um NSR do meio que nunca chegue ficaria para
  trás **para sempre** com cursor ingênuo — batida descartada em silêncio, e o autoconserto que
  existia (repedir o arquivo inteiro todo ciclo) tinha acabado de ser removido. Lacuna puxa o
  cursor para trás; reingerir é de graça. Toda falha de decisão cai para o NSR 1: errar o cursor
  **para cima** é a única forma de perder marcação, então a assimetria é deliberada.
  `get_afd.fcgi` ganhou timeout próprio (10 min, `timeout_afd_segundos` no `config.yaml`);
  as demais chamadas continuam em 30s de propósito, para relógio fora do ar falhar rápido.
- ✅ **Desvio de relógio da máquina deixou de derrubar o coletor em 17/08/2026 (v0.5.1).**
  `HTTP 401: "Timestamp fora da janela permitida (anti-replay)"` **nunca foi problema de token** —
  a checagem de desvio (`repDeviceAuth.ts`, 5 min) roda **antes** da validação do token, e token
  superado dá `"Dispositivo ou token inválido"`. Não afetava só o heartbeat: `EnviarLote`,
  `pendencias` e `biometria` usam o mesmo HMAC, então **nada** daquela unidade chegava ao
  SisEscala. Medido na máquina do RH da SMS: o AFD baixava certo e os ~80 lotes iam **integralmente
  para a fila offline**, com a tela vazia e nenhuma pista do motivo para quem olhava de fora.
  A correção **não** é o coletor ajustar o relógio do Windows — isso exige `SeSystemtimePrivilege`,
  que usuário comum não tem, e o app roda deliberadamente **sem administrador** (autostart em
  `HKCU`). A correção é ele parar de depender do relógio local: `sisescala/client.go` aprende o
  desvio pelo header `Date` de qualquer resposta HTTP (ponto médio envio/chegada, à la NTP) e assina
  com `hora local + desvio`. Confirmado em produção: o próprio 401 de anti-replay **já traz o
  `Date` correto**, então a resposta que recusa é a que ensina a hora. Um retry único, só quando o
  corpo contém `anti-replay`, cobre o arranque (desvio ainda zero na 1ª requisição do processo).
  **Isso não afrouxa o anti-replay**: quem decide o que é "agora" continua sendo só o servidor, e
  alinhar-se ao relógio dele apenas permite que um cliente honesto produza timestamp que ele
  considere atual — replay de requisição capturada não ganha nada. Desvio ≥ 1 min vira **aviso
  explícito no log**, porque a hora errada do Windows continua sendo problema real daquela máquina
  (aparece na tela do terminal de presença, por exemplo): o coletor deixa de ser vítima dela, não a
  conserta. Conferir com `tzutil /g` (deve dar `SA Eastern Standard Time`).
- ⚠️ **Ciclo longo = menu da bandeja sem resposta.** `executarCiclo` e todos os `case` de clique do
  menu rodam na **mesma goroutine** (`cmd/tray/main.go`), então enquanto um ciclo está em andamento
  nenhum item do menu responde. Foi assim que um bug de fila virou "o app não detecta atualização"
  em 17/08/2026: `fila.Gravar` usava `O_APPEND` num arquivo nomeado pelo `lote_id` (que é hash
  determinístico do conteúdo) e `fila.Pendentes` lê **cada linha como um lote**, então cada ciclo
  recusado reempilhava o mesmo lote — ~80 lotes viraram ~1.000 reenvios por ciclo em ~12 ciclos.
  Corrigido na v0.5.2 (`Gravar` substitui em vez de acrescentar, e o reenvio desiste após 3 falhas
  seguidas). **Ao investigar "a bandeja não responde", meça a duração do ciclo antes de suspeitar
  do systray** — e lembre que `GetAFD` agora pode legitimamente levar minutos.
- No Windows, abrir URL com `cmd /c start` **corta tudo depois de um `&`** (separador de
  comando do `cmd.exe`) — quebrava a URL de ativação do terminal local, que tem
  `?terminal_id=...&token=...`. `terminal/terminal.go` usa
  `rundll32 url.dll,FileProtocolHandler` em vez disso.
- Windows 7 **não é suportado** — Go 1.21+ exige Windows 10+. Decisão consciente (maioria do
  parque é 10/11); se precisar de verdade, compilar essa unidade à parte com Go 1.20.

Confirme cada ponto com `curl.exe -sk` a partir do PowerShell antes de instalar em campo —
`Invoke-RestMethod` falha contra o TLS não-padrão do device (já registrado acima). Detalhes da
sessão que fez essa reestruturação:
[`docs/evolucao/2026-08-11-app-bandeja-coletor-rep.md`](docs/evolucao/2026-08-11-app-bandeja-coletor-rep.md).

### Pendências que bloqueiam a Fase 5

1. ~~103 marcações de intervalo em unidades com `permite_marca_intervalo = false`~~ **Resolvido
   em 12/08/2026.** O número estava desatualizado — reconferido antes de decidir, a contagem real
   em produção era **7**, não 103, todas na LACEM, agosto/2026 (padrão clássico de horário
   sintético: campos de intervalo em `:00:00` exato, entrada/saída com segundos reais de
   terminal). Usuário decidiu limpar antes de ligar a reconciliação (migration `20260812140000`,
   `UPDATE` por **id explícito**, nunca por critério amplo — só os dois campos de intervalo, nunca
   entrada/saída). Confira `fn_unidade_no_escopo`/`fn_unidade_alcancavel_por_setor` antes de
   assumir que uma contagem antiga deste arquivo ainda vale — sempre reconfira contra produção.
2. As três regras de intervalo divergentes (armadilha 9) só convergem na Fase 8.
3. ~~`fn_blocos_previstos_dia` sem checagem de escopo~~ **Resolvido em 12/08/2026**, migration
   `20260812130000` (gerada por `scratchpad/gen_escopo_blocos.js`, mesmo padrão de cópia mecânica
   da armadilha 1). Guard único em `fn_blocos_previstos_dia`: `auth.uid() IS NULL` bypassa
   (service_role — hoje o único caminho real de `fn_alocar_marcacoes_dia` →
   `fn_projecao_marcacoes_dia` → `fn_conferir_reconciliacao`, sem nenhum caller de aplicação
   ainda); caso contrário exige `EXISTS` de `escala_mensal` do servidor naquele mês/ano com
   `fn_unidade_no_escopo(unidade_id) OR fn_unidade_alcancavel_por_setor(unidade_id)`. **Checa por
   escala, não por lotação do servidor** — de propósito, para não quebrar "Servidor Externo"
   (v1.2.4): quem gerencia a escala que recebeu o externo continua vendo, mesmo fora da lotação
   dele. `fn_blocos_previstos_mes`/`fn_alocar_marcacoes_dia`/`fn_projecao_marcacoes_dia`/
   `fn_conferir_reconciliacao` **não foram tocadas** — herdam a proteção por serem envelopes
   LATERAL desta função, exatamente como a pendência original previa.
   ⚠️ **`fn_unidade_no_escopo` em si só verifica `profile_unidades`, nunca `profile_setores`** —
   um coordenador cujo acesso vem inteiramente de setor vinculado (sem a unidade-pai vinculada
   também, ex.: o piloto da TI) passa `p_unidade_id IS NULL` mas falha em qualquer chamada real,
   mesmo tendo acesso legítimo pelo próprio setor. Descoberto e contornado em 12/08/2026
   (`fn_unidade_alcancavel_por_setor`, migration `20260812050000`), usado desde então também no
   guard de `fn_blocos_previstos_dia` acima — `fn_unidade_no_escopo` em si **continua não
   corrigida**. Antes de usar `fn_unidade_no_escopo` sozinha em código novo, some
   `OR fn_unidade_alcancavel_por_setor(...)` ou confirme que quem vai chamar sempre tem
   `profile_unidades` preenchido.

✅ **Não é mais pendência:** a policy `WITH CHECK (true)` de `logs_tentativas_presenca` foi
fechada por `20260807130000`. O plano do REP ainda a listava como aberta.

❌ **Descartado (usuário, 08/08/2026):** marcar no relógio com matrícula + PIN. O relógio é
equipamento não supervisionado, e PIN ali reintroduz o "bater ponto pelo colega" — agora
respaldado por AFD assinado, o que torna o registro falso *mais* difícil de contestar. Some-se
que `servidores.pin_acesso` é bcrypt e não é recuperável para envio ao device.

### Fase 7 (parte identidade) — push de cadastro SisEscala → relógio (12/08/2026)

Motivada por instalação em mais de uma unidade: sem `rep_vinculos_servidor` populado por
dispositivo, um segundo relógio gera marcação que ninguém consegue atribuir — e essa tabela não
tinha tela nenhuma até aqui (só existia via `fn_vinculos_sugeridos_afd` + SQL direto).

**Biometria continua impossível de empurrar por API** — o template vem do sensor com a pessoa
presente no equipamento, sempre vai exigir alguém ir até o relógio pelo menos uma vez por
servidor (confirmado no plano original, Fase 7). O que ficou automatizado é só a
**identidade** (matrícula/nome/CPF) chegar pronta no relógio antes disso.

⚠️ **"Pelo menos uma vez por servidor" — não uma vez por relógio (25/08/2026).** A frase acima
vale para *criar* biometria; **copiar** a que já existe de um relógio para outro é possível e o
formato está confirmado (`digitais` em base64 no CSV de "Enviar/Receber usuários"; templates
devolvidos por `load_users.fcgi`). Numa unidade com 4 equipamentos isso é a diferença entre uma
digital por pessoa e quatro — ver
[`docs/planos/2026-08-25-copia-de-biometria-entre-relogios.md`](docs/planos/2026-08-25-copia-de-biometria-entre-relogios.md).
Escrever template **pela API** continua não testado.

| peça | onde |
|---|---|
| fila de push | `rep_cadastros_fila` (migration `20260812000000`) |
| enfileirar (admin, por dispositivo) | `fn_enfileirar_cadastros_rep` — pula quem já tem vínculo vigente e quem não tem CPF preenchido |
| o coletor pergunta o que está pendente | `GET /api/rep/v1/pendencias` (antes um stub que sempre devolvia `[]`) |
| o coletor confirma sucesso/falha | `POST /api/rep/v1/pendencias` → `fn_confirmar_cadastro_rep`, que cria/renova `rep_vinculos_servidor` com `tem_biometria = false` |
| fecha o loop quando alguém cadastra o dedo | `POST /api/rep/v1/biometria` → `fn_atualizar_biometria_vinculos` — só liga `tem_biometria`, nunca desliga sozinha |
| tela de gestão | botão "Sincronizar cadastros" no modal de Dispositivo REP (`/marcacoes`) |
| tela de acompanhamento | aba "Biometria Pendente" em `/marcacoes` (`fn_pendencias_biometria`, por escopo) |

`identificador_afd` é gerado como `lpad(cpf_digits, 12, '0')` — a mesma convenção de 12 dígitos
da armadilha 10, na direção inversa (`right(ident, 11)` recupera o CPF; aqui é o CPF que vira o
identificador).

✅ **`rep.CriarUsuario`/`rep.ListarUsuariosComBiometria` (`tools/coletor-rep/rep/client.go`) —
CONFIRMADAS contra hardware real em 12/08/2026**, depois de cinco rodadas de teste
(`coletor-rep-cli cadastros-testar` contra 10.110.2.89):

1. API genérica "objects" (`create_objects.fcgi`/`load_objects.fcgi`) — HTTP 400 "Invalid
   command". Pertence à Linha de Acesso da Control iD (iDAccess/iDFlex/iDBlock), não à linha
   REP/iDClass deste device.
2. `add_users.fcgi`/`load_users.fcgi` — comando certo, mas CPF de teste `"000000000000"`
   reprovado no dígito verificador e `limit: 1000` acima do máximo (100).
3. Corrigidos CPF de teste e paginação — `load_users.fcgi` devolveu **6 usuários reais do
   piloto com sucesso**. Revelou que este device **não tem campo `"id"`** — só
   `pis`/`registration`/`code`/`rfid`/`templates`, **todos como número JSON**, não string.
4. `registration`/`cpf` viram número; `device_user_id` (não existe de verdade neste hardware)
   substituído por `identificador_afd` como identidade de referência em toda a cadeia
   (`ListarUsuariosComBiometria`, `fn_atualizar_biometria_vinculos` — migration `20260812010000`,
   `bigint[]` → `text[]`).
5. Matrícula temporária (`T26xxxxx`) tem o `T` removido antes de virar número — **confirmado
   pelo usuário** (não achado em busca no repositório) como a convenção já em uso manual para os
   servidores temporários já cadastrados neste mesmo relógio.

**Resultado final**: `CriarUsuario` criou um usuário de teste real no relógio; `ListarUsuariosComBiometria`
achou os 5 servidores reais do piloto com biometria cadastrada, CPFs batendo. Apague o usuário
"SISESCALA TESTE - PODE APAGAR" (matrícula 900000) pela interface do próprio relógio depois de
cada rodada de `cadastros-testar`.

Mesmo confirmado, por isso continua:

- ⚠️ **Desatualizado.** A nota aqui dizia que o push de cadastro ficava **fora** do ciclo
  automático e que o ticker de 5 min só rodava `Sync`/`Heartbeat`. **Não é verdade desde a
  v0.6.0**: `executarCiclo` (`cmd/tray/main.go`) roda `SincronizarCadastrosTodos` e
  `HigienizarRemocoesTodos` com teto por ciclo, e desde a **v0.11.0** roda também
  `SincronizarBiometriaTodos`. O que autoriza os três é o mesmo: **a fila é o gatilho** — sem
  ninguém enfileirado, a chamada devolve lista vazia e nada é escrito no equipamento. Falha em
  qualquer um deles **não** derruba o status para vermelho; sincronizar o AFD é a função
  essencial. O clique manual no menu e os subcomandos da CLI continuam existindo, passando
  `limite = 0` (sem teto).
- `coletor-rep cadastros-testar` (subcomando) cria **um** usuário de teste bem marcado
  ("SISESCALA TESTE - PODE APAGAR") direto no relógio e lista quem tem biometria, sem tocar na
  fila real do SisEscala — o `afd-raw` desta função, útil para validar um relógio novo antes de
  confiar no botão "Sincronizar cadastros" da tela.

⚠️ **Não existe (nem pode existir) botão "Testar conexão" na tela do SisEscala.** O relógio fica
na rede interna da unidade (`10.x.x.x`); o servidor do SisEscala roda na VPS do Coolify, sem
nenhum caminho até essa rede. Um teste server-side falharia sempre, com qualquer credencial —
por isso o teste (`diagnostico`, `cadastros-testar`) só existe na CLI, que precisa rodar numa
máquina física dentro da rede da unidade. `GET /api/coletor-rep/download-cli` (12/08/2026,
admin/super_admin) baixa `coletor-rep-cli.exe` avulso — não vem no `.zip` do app de bandeja, que
é só para uso contínuo — para colocar ao lado do `config.yaml` já instalado nessa máquina.

### Fase 7b — higiene de cadastros do dispositivo (12/08/2026)

Motivada pela primeira instalação real fora do piloto da TI (LACEN): o relógio é **reaproveitado
de outro sistema**, e chega com cadastros de gente que pode não fazer mais parte do quadro.
Confirmado ao vivo no log de sync da LACEN: o histórico de marcação antigo (~34.500 registros
tipo 3) deu `marcacoes == orfas` em **todo** lote, porque `rep_vinculos_servidor` estava vazio
até a primeira identidade (Fase 7) ser empurrada — ou seja, dado órfão de relógio reaproveitado
já é inofensivo por construção (nunca escreve em `escala_diaria` sem vínculo), o problema real
era só o **cadastro de usuário** desatualizado no equipamento.

⚠️ **Não existe "zerar o relógio" e não deveria existir.** A memória do AFD é desenhada para ser
inviolável (é o que dá ao REP-C valor como prova legal, Portaria 671/2021) — um botão de reset no
SisEscala minaria essa garantia, e não há confirmação de que a API do equipamento sequer exponha
uma operação dessas. O histórico órfão já é inofensivo; a higiene mexe só em **cadastro de
usuário**, que é dado gerenciável pela mesma família de API já validada na Fase 7
(`add_users`/`load_users`/`remove_users.fcgi`).

| peça | onde |
|---|---|
| snapshot do que existe no relógio agora | `rep_usuarios_dispositivo` — substituído por inteiro a cada relato, nunca reconciliado incrementalmente |
| fila de remoção | `rep_remocoes_fila` — só populada por ação explícita na tela |
| enfileirar (admin/super_admin) | `fn_enfileirar_remocao_usuarios_dispositivo` — recusa quem tem `rep_vinculos_servidor` vigente para um servidor Ativo, não confia só na UI |
| coletor reporta o snapshot | `POST /api/rep/v1/usuarios-dispositivo` ← `coletor-rep higiene` (só leitura, `load_users.fcgi`) |
| coletor aplica remoções | `GET`/`POST /api/rep/v1/remocoes` ← `coletor-rep higiene-remover` |
| tela | aba "Higiene do Relógio" em `/marcacoes` (admin/super_admin) |

✅ **`rep.RemoverUsuario` (`remove_users.fcgi`) CONFIRMADA contra hardware real em 13/08/2026**
(LACEM) — mas só depois de ser **reprovada** no mesmo dia. O corpo `{"users": [{"pis": ...}]}`
(aproximação por simetria com `load_users.fcgi`, nunca confirmada) foi recusado nas **31**
remoções da primeira rodada de campo com `'users' em formato incorreto`. O device nomeia o campo
**`users`**, não um campo de dentro do objeto (compare com `'cpf' em formato incorreto`, da Fase
7, onde o inválido era o valor de um campo interno) — era o **tipo dos elementos**: array de
números, não de objetos. O formato certo é **`{"users": [pis]}`**, validado removendo o usuário de
teste e conferindo por relistagem que só ele saiu.

A varredura de candidatos **fica**, com o formato confirmado em primeiro lugar: `RemoverUsuario`
não chuta um formato só, e a primeira remoção de cada execução percorre `formatosRemocao`
(`rep/client.go`) **confirmando por relistagem** qual realmente apagou o cadastro — é o que faz um
modelo/firmware diferente ser descoberto em vez de falhar em cima de cadastro de servidor. O
vencedor fica em cache para o resto do lote. Duas defesas que não podem sair daí:

- **`ok` do relógio não é remoção.** Se a relistagem mostrar o cadastro ainda lá, a fila do
  SisEscala é fechada como **falha**. Marcar como aplicada deixaria a tela dizendo que o relógio
  está limpo quando não está.
- **Se um candidato apagar quem não era o alvo, a execução aborta na hora** (diferença de
  conjunto antes/depois, não só "o alvo sumiu") — nenhum outro pendente é tentado.

`coletor-rep remocao-testar` (13/08/2026) é o `cadastros-testar` da remoção: cria e apaga o
descartável "SISESCALA TESTE - PODE APAGAR", imprime o formato aceito e **não toca na fila real**.
Rodar num relógio novo antes de `higiene-remover`. Por tudo isso `coletor-rep higiene` (só
leitura) tem botão na bandeja, mas `higiene-remover` fica **só na CLI** — mesma prudência já
aplicada a `cadastros`/`cadastros-testar`.

`rep.ListarUsuarios` é só um refactor de `ListarUsuariosComBiometria` para devolver a lista
inteira, não filtrada — reaproveita a mesma paginação já confirmada, então herda a confiança dela
(`ListarUsuariosComBiometria` virou um filtro em cima de `ListarUsuarios`).

✅ **Resolvido em 17/08/2026 (v0.5.0).** A nota anterior aqui registrava, com dado real do log da
LACEN (12/08/2026), que `sync` reprocessava as ~36 mil linhas do AFD inteiro a cada ciclo de 5
minutos — sem corromper nada (o atalho de idempotência por lote de `fn_ingerir_afd` devolvia o
resultado já calculado, `reenvio: true`, sem reprocessar; só o log do coletor não distinguia isso
de reprocessamento de verdade). Virou prioridade quando o mesmo comportamento **impediu** o REP
iDClass - SMS de sincronizar uma única vez — ver a seção do cursor de NSR acima.

### SMS (17/08/2026) — ~250 mil marcações órfãs desde 2021, e o risco que elas criam

O REP da SMS (10.110.0.20) é reaproveitado e chegou com **268.556 registros de AFD**, o mais antigo
de **abril/2021** — sete vezes o volume da LACEM. Ingeridos por inteiro (regra "nunca descartar
batida"), gerando **~250 mil `marcacoes_ponto` todas órfãs**, porque `rep_vinculos_servidor` está
vazio para esse dispositivo. Órfã é inerte: sem `servidor_id` nada projeta em `escala_diaria`.

⚠️ **É aqui que a armadilha 10 do `p_vigente_de` fica cara.** Ao criar os vínculos, um
`p_vigente_de` antigo demais transformaria **cinco anos de ponto de outro sistema** em ponto do
SisEscala — não na hora (criar vínculo não reprocessa nada), mas no primeiro
`fn_reparse_afd_dispositivo`, que re-resolve autoria pelo vínculo *vigente na data da batida*. Use
o default (`dispositivos_rep.created_at` = 14/08/2026) e **nunca** a data da primeira batida do AFD.
A LACEM tinha ~34.500 marcações nessa situação; aqui é 7x isso.

🚨 **A instalação da SMS NÃO está concluída, e o motivo é o identificador ser PIS** (ver armadilha
10, que foi reescrita por causa deste caso). Estado medido em 17/08/2026, agosto/2026, 126 escalados:

| situação real (casando por PIS) | quantos | a tela "Cobertura da Escala" diz |
|---|---|---|
| já no relógio, **com biometria** — só falta o vínculo | **27** | `fora_do_relogio` ❌ |
| já no relógio, sem biometria | 1 | `fora_do_relogio` ❌ |
| realmente fora do relógio | 83 | `fora_do_relogio` ✅ |
| sem PIS no cadastro do SisEscala | 15 | `sem_cpf` (1) ❌ |

Ou seja: **27 pessoas batem ponto naquele relógio todo dia e a batida morre órfã**, e a tela afirma
que elas não estão cadastradas. Nada disso se resolve clicando em "Sincronizar cadastros": o push
falhou nos 327 (`'pis' em formato incorreto`) e, se tivesse passado, teria gravado vínculo por CPF
que jamais casaria com as linhas do AFD deste equipamento.

O que falta é **código**, não operação: vinculação por PIS, `fn_cobertura_ponto_dispositivo`
reconhecendo PIS, `fn_enfileirar_cadastros_rep` gravando o identificador do tipo certo, e
`rep.CriarUsuario` mandando o campo que este modelo aceita (varredura de formatos como a de
`remove_users.fcgi`, validada em campo com `cadastros-testar`). Provavelmente precisa de uma coluna
em `dispositivos_rep` dizendo o tipo de identificador — hoje CPF e PIS convivem em produção sem nada
no schema distinguindo.

✅ **RESOLVIDO em 17–18/08/2026 — o quadro acima é histórico.** O código saiu em
`20260817170000` (resolução de identidade por CPF **ou** PIS), `20260817180000` (identificador do
tipo certo na fila) e `20260818200000`. Reconferido em produção em 19/08/2026, agosto/2026: os
**6 relógios** têm `sem_vinculo = 0`, `fora_do_relogio = 0` e `batidas_perdidas = 0`. Na SMS são 58
escalados, 33 `ok` e 24 `sem_biometria` — o gargalo deixou de ser identificador e passou a ser
**biometria presencial** (93 servidores no parque todo). **Não decida nada com base na tabela
acima; reconfira contra produção.**

⚠️ **E a solução mudou uma premissa do modelo:** `fn_servidor_por_identificador_afd` resolve a
identidade **direto em `servidores`**, por CPF ou PIS, **sem exigir `rep_vinculos_servidor`**. Ver
a armadilha 13.

ℹ️ Observação registrada, ainda **não tratada**: a cadeia de hash de `rep_afd_registros` é montada
na **ordem de chegada** (`v_hash_ant` vem do maior NSR já presente), e a fila offline reenvia em
ordem de hash de `lote_id`. Numa recuperação grande a cadeia deixa de acompanhar a ordem de NSR.
Não afeta o artefato legal — `linha_bruta` é gravada exatamente como veio do equipamento — mas a
cadeia não serve como prova de sequência contínua nesses trechos.

### Implantação do LACEM (13/08/2026) — primeira unidade fora do piloto

Diário de campo completo em
[`docs/evolucao/2026-08-13-implantacao-lacem-diario.md`](docs/evolucao/2026-08-13-implantacao-lacem-diario.md):
higiene do relógio (31 cadastros de outro sistema removidos), `remove_users.fcgi` confirmado, e a
descoberta que virou tela — 38 dos 39 escalados não tinham ponto sendo registrado.

**O cadastro do equipamento ficou limpo; os consertos da unidade ainda não foram aplicados**
(criar os 27 vínculos → enfileirar os 10 → biometria da última). As 8 batidas já perdidas
continuam órfãs por decisão consciente: recuperá-las mexe em ponto passado, e o histórico do
sistema anterior está no mesmo AFD.

### Cobertura de ponto — estar cadastrado no relógio não é estar no ponto (13/08/2026)

Medido em produção na LACEM, agosto/2026, **39 servidores escalados**: **27** "bate e não
registra", 10 fora do relógio, 1 sem biometria, **1 pronto para bater** — contagem reproduzida
exatamente pela tela depois de aplicada, o que fecha o portão da migration. Ver
[`docs/evolucao/2026-08-13-cobertura-de-ponto.md`](docs/evolucao/2026-08-13-cobertura-de-ponto.md).

⚠️ **O caso dominante é silencioso dos dois lados.** A pessoa está cadastrada no equipamento, com
biometria, encosta o dedo, o relógio aceita e grava no AFD — e a batida morre como órfã porque não
existe `rep_vinculos_servidor` vigente. **Nenhuma das duas pontas reclama.** Ao diagnosticar
"o ponto de fulano não aparece", confira o vínculo antes de suspeitar do equipamento ou do parser.

Nenhuma tela respondia isso antes: "Biometria Pendente" só lista quem **já tem vínculo**, e
"Higiene do Relógio" olha a direção inversa (quem está no relógio e não no SisEscala). A ponta que
faltava — escala → relógio — virou a aba **Cobertura da Escala** (`fn_cobertura_ponto_dispositivo`
classifica; `fn_cobertura_ponto_resumo` é envelope LATERAL dela; a tela não reclassifica nada).

✅ **A aba virou "Cobertura de Ponto" em 05/09/2026 (`20260905100000`) e o universo agora é
`lotados ∪ escalados`.** Listar só escalados escondia o caso dominante: medido no parque,
**1.257 pessoas cadastradas no relógio SEM BIOMETRIA** (348 no HMM-01, 57 no CAPS III, ~82 em cada
relógio do HMI) — gente que não consegue bater e não aparecia em tela nenhuma. O caso que motivou
foi a USF José Manoel: 4 lotados, os 4 no relógio com biometria, a aba mostrava 1. **Os dois
números estavam certos; a tela respondia outra pergunta.** Diário em
[`docs/evolucao/2026-09-05-cobertura-de-ponto-inclui-lotados.md`](docs/evolucao/2026-09-05-cobertura-de-ponto-inclui-lotados.md).

⚠️ **União, nunca substituição** — trocar escala por lotação quebraria o "Servidor Externo"
(v1.2.4). Conferido em produção: **22 externos preservados**. E `escalados` no resumo **continua
contando só quem tem escala**; o denominador novo é `total_pessoas`, somado ao lado. `dias_com_escala = 0`
identifica quem entrou por lotação, sem coluna nova.

⚠️ **O número de escalados varia de 640 a 1.785 conforme o mês** (implantação em andamento: o HMI
tinha 6 escalados em 08/2026 e 390 em 09/2026); a união fica **estável em ~3,4 mil**. É isso que faz
a aba parar de depender de a escala ter sido lançada — reconfira contra produção antes de decidir
com base nestes números.

🚨 **O enfileiramento ao relógio era 100% MANUAL até 05/09/2026** — `fn_enfileirar_cadastros_rep`
(lotação) e `fn_enfileirar_cadastros_por_escala` (escala) só rodavam no clique de "Sincronizar
cadastros"; **não havia trigger nem cron**, então servidor novo com lotação definida nunca chegava
ao equipamento sozinho. Hoje o cron diário roda **as duas** por dispositivo ativo
(`src/utils/rep/enfileirarCadastrosParque.ts`). Só popula `rep_cadastros_fila` — quem grava no
relógio continua sendo o coletor, com teto de 20 por ciclo. ⚠️ Roda com **`service_role`**: as duas
RPCs só aplicam os guards quando `auth.uid() IS NOT NULL`, então com `createClient()` a rotina veria
zero.

⚠️ **`CREATE OR REPLACE FUNCTION` não altera a lista de colunas de um `RETURNS TABLE`.** Reaplicar
uma migration depois de acrescentar uma coluna de saída morre com `42P13: cannot change return
type of existing function` — aconteceu em 13/08/2026 com `fn_cobertura_ponto_dispositivo`. Quem
devolve `TABLE(...)` precisa de `DROP FUNCTION IF EXISTS` **antes** do `CREATE`, com a assinatura
exata e os dependentes derrubados primeiro; sem `CASCADE`, para um dependente de verdade dar erro
em vez de sumir em silêncio. Isso não vale só para esta migration: é a diferença entre
"idempotente" e "reaplicável depois de mudar a assinatura".

⚠️ **`fn_enfileirar_cadastros_rep` (o botão "Sincronizar cadastros") escolhe por LOTAÇÃO, não por
escala.** Quem está escalado na unidade mas lotado em outro lugar **nunca** entra por ali, e o
botão devolve "0 enfileirados" sem dizer que aquela pessoa ficou de fora — clicar de novo não muda
nada, para sempre. Foi o caso de duas servidoras da LACEM que batiam ponto no terminal todo dia
sem nunca terem chegado ao relógio. Por isso `fn_enfileirar_cadastros_por_escala` (13/08/2026)
existe em paralelo, enfileirando por **escala** (mesma escolha do guard de
`fn_blocos_previstos_dia`, para não quebrar servidor externo). A tela distingue as três causas de
continuar fora do relógio por `fila_status`/`fila_erro`/`lotacao_compativel` — mandar todas para o
mesmo botão seria conselho errado em uma delas.

⚠️ **`fn_vincular_cadastros_por_cpf` conserta o caso dominante sem tocar no equipamento**, mas
`p_vigente_de` decide **quais batidas passam a ter dono**: a resolução é *vigente na data da
batida*. Um valor antigo demais faz o histórico do sistema anterior (a LACEM chegou com ~34.500
marcações) virar ponto do SisEscala no primeiro `fn_reparse_afd_dispositivo`. Default é
`dispositivos_rep.created_at`, nunca a primeira batida do AFD. E ela **não reprocessa nada** —
criar vínculo e recuperar histórico são decisões separadas porque a segunda mexe em ponto passado.

## Terminal local sem sessão de coordenador (11/08/2026)

O terminal `/presenca` ativa com `supabase.auth.signInWithPassword()` **rodando no navegador da
máquina do terminal**. O fluxo real sempre foi "coordenador ativa e vai embora" — e isso tinha
que continuar exatamente assim — então aquele navegador ficava com uma sessão Supabase Auth
completa de coordenador/admin por dias a fio. Servidor com acesso físico à máquina abria outra
aba e navegava para a retaguarda autenticado como aquele coordenador. Era a causa relatada de
alterações indevidas no sistema — sem relação com o relógio de ponto, mas surgiu no meio do
trabalho da Fase 4 porque o mesmo app local (`coletor-rep`) que fala com o REP passou também a
poder abrir essa tela.

**A correção não revoga a persistência da sessão** (quebraria o fluxo desejado) — troca o
mecanismo inteiro: o navegador do terminal **nunca mais chama `supabase.auth`**. Nova tabela
`terminais_locais` (`20260811180000`), token por dispositivo no mesmo esquema sha256 de
`dispositivos_rep`/`fn_autenticar_dispositivo_rep`. `fn_registrar_ponto_terminal_local` confere
escopo — a matrícula tem que pertencer à `unidade_id`/`setor_id` do terminal, checado contra
`servidores.unidade_id/setor_id` (a mesma fonte que `fn_registrar_ponto` já usa para gravar o
contexto da marcação) — e **recusa antes de checar o PIN**, para uma matrícula de outro setor
não aprender se o PIN estaria certo. Só então delega para `fn_registrar_ponto`, sem tocar nela
(armadilha 1).

| peça | onde |
|---|---|
| sessão assinada por HMAC — nunca o token cru vira cookie | `src/utils/terminalLocalSession.ts` |
| ativação (token → cookie httpOnly) | `POST /api/presenca-local/ativar` |
| marcação (lê o cookie; nunca uma sessão Supabase) | `POST /api/presenca-local/registrar` |
| tela sem formulário de login | `src/app/presenca-local/page.tsx` |
| gestão (criar terminal, gerar token, ver responsável) | `/marcacoes`, aba "Terminais Locais" |
| abrir a tela pelo app local | `coletor-rep terminal abrir` (`tools/coletor-rep/terminal/`) |

⚠️ **`/presenca` clássico não foi alterado** — continua existindo, com o login de coordenador
de hoje, para as unidades que ainda não têm o app local instalado. A migração é unidade a
unidade, nunca um corte único.

⚠️ **Cookie de sessão dura 180 dias.** Revogação real é `terminais_locais.ativo`, conferido a
cada marcação por `fn_registrar_ponto_terminal_local` — desativar o terminal na tela de gestão
derruba qualquer sessão de navegador já aberta, já na marcação seguinte, sem esperar o cookie
expirar.

⚠️ **`TERMINAL_LOCAL_SESSION_SECRET` é obrigatória em runtime** (Coolify, além de `.env.local`
para quem rodar localmente). Sem ela, `/api/presenca-local/ativar` falha com 500 explícito —
nunca cai para um segredo fixo no código, que é exatamente o padrão que o `CRON_SECRET` com
fallback hardcoded já provou ser ruim (ver rota `/api/cron`).

⚠️ **Path do cookie tem que cobrir `/presenca-local` E `/api/presenca-local`.** São prefixos
irmãos, não pai/filho — `path: '/presenca-local'` (o valor original, corrigido em 11/08/2026)
deixava o cookie de fora de toda chamada a `/api/presenca-local/registrar`. Sintoma: ativação
funcionava, a tela abria, e **toda** tentativa de bater o ponto caía em "Terminal não ativado" —
só apareceu ao testar contra hardware/rede reais, não em nenhuma revisão de código. Use
`path: '/'` para qualquer cookie compartilhado entre uma página e uma rota de API que não
compartilhem o mesmo primeiro segmento de URL.

⚠️ **Escopo é pela lotação do servidor (`servidores.unidade_id/setor_id`), não pela escala do
dia.** Um servidor temporariamente escalado em outra unidade fica bloqueado no terminal local
dessa unidade até a lotação dele ser atualizada. Decisão deliberada por simplicidade — trocar a
fonte da checagem é ajuste pequeno se isso virar problema prático frequente.

## Conformidade da marcação de ponto (v1.22.0) — não regredir

A Portaria 671/2021 veda, em **qualquer** registrador — e o **REP-P é o registrador via
programa**, ou seja, o terminal `/presenca` se enquadra:

1. **restrições de horário à marcação**;
2. **marcação automática usando horários predeterminados ou contratuais**;
3. exigência de autorização prévia para sobrejornada;
4. qualquer dispositivo que permita alterar o dado registrado pelo empregado.

O sistema incorria na 1 e na 2. Três regras saíram disso e **nenhuma pode ser desfeita sem
decisão jurídica**:

| regra | onde vive | o que quebra se voltar atrás |
|---|---|---|
| Batida **nunca** é recusada por horário. Só matrícula/PIN inválidos recusam. | `fn_registrar_ponto` (`20260808100000`) | volta a vedação 1: o horário real se perde e o controle vira imprestável como prova (Súmula 338 do TST) |
| Entrada e saída do turno **nunca** são geradas pelo sistema | `src/utils/folha/preAssinalacao.ts`, aplicado nas 4 cópias da geração de folha | volta a vedação 2 |
| Validação manual grava o horário **informado**, não o derivado da jornada | `fn_registrar_presenca_informada` (`20260808110000`) | volta a vedação 2 pela porta do coordenador — era 24–29% das entradas/saídas |

**O que continua permitido:** pré-assinalação do intervalo (CLT Art. 74 §2º), e **somente** onde
a unidade não exige marcação de intervalo — ali o servidor não tem como registrar o repouso.
Horário **fixo**, sem o offset aleatório antigo, origem `pre_assinalado`.

O critério que separa um caso do outro: **o sistema só preenche onde o servidor não tem como
registrar.** Onde ele tem meio, preencher é fabricar.

⚠️ **O terminal fica aberto por dias e não recarrega sozinho** — um deploy o deixa com o bundle
velho, chamando a RPC anterior. Aconteceu em 09/08/2026: um terminal continuou fora da v1.22.0
depois dela ir ao ar, o servidor via "recusado" e batia de novo, e nada virava marcação pendente.
A falha é **silenciosa dos dois lados**. Desde a v1.27.0 a página confere `/api/version` a cada
5 min e recarrega **só quando ociosa** (sem matrícula/PIN digitados). `NEXT_PUBLIC_APP_VERSION`
vem de `package.json` via `next.config.js` e é o **mesmo literal** no cliente e no servidor —
valor recalculado em runtime poria o terminal em laço de recarga. Ao diagnosticar batida que
"sumiu", **confira a versão do bundle daquele dispositivo antes de suspeitar do banco**.

⚠️ **Cor importa.** No terminal, âmbar = registrado fora do previsto (vai para revisão);
vermelho = nada foi registrado. Pintar de vermelho o que foi aceito ensina o servidor a não
insistir, produzindo na prática o efeito que a lei quer evitar.

**Validação em massa** (v1.22.1): `fn_atestar_jornada_bulk` envolve
`fn_confirmar_presenca_manual_bulk` e **pula os dias que têm batida pendente de revisão**,
devolvendo a lista ao chamador. É a regra de `fn_precedencia_origem` trazida para o fluxo do
coordenador: onde existe horário real disponível, ele ganha do declarado. A exclusão é por par
(escala, dia), não por servidor nem por período.

**Portal do servidor** (v1.23.0): a folha deixou de ser editável ali. A célula vazia (desde que
o fictício de entrada/saída foi removido) virava uma edição livre na folha oficial, sem revisão
e sem marcação — o mesmo problema da vedação 2, só que pela porta do servidor em vez da do
sistema. Agora ele **solicita** (`fn_solicitar_ajuste_ponto`), o pedido vira marcação
`ajuste_servidor` (precedência 4, a mais baixa) pendente de revisão, e só o coordenador grava em
`escala_diaria`. Bloqueio em duas camadas: `FolhaPontoEditor` desabilita os inputs quando
`isPortal`, e `salvarFolhaPontoServidor` recusa no servidor qualquer alteração de horário —
importa porque o portal autentica só por PIN e a action é chamável direto.

ℹ️ Uma nota anterior aqui chamava a validação em massa de "exposição residual à vedação 2".
**Era impreciso.** Conferido em produção em 08/08/2026: ela grava com origem
`ajuste_coordenador` e `sintetica = true`, e a folha a pinta como `manual` — o sistema não a
apresenta como batida. Coordenador declarando, com justificativa e rótulo próprio, é tratamento
autorizado pelo Art. 82, parágrafo único. A vedação 2 é o *sistema* marcar sozinho.

`fn_confirmar_presenca` e `fn_confirmar_presenca_manual` **não foram alteradas** por nada disso —
todo o comportamento novo entra por funções que as envolvem (armadilha 1).

### A folha é um snapshot, e preservar demais congela a correção (19/08/2026)

⚠️ **`folha_ponto.registros` é jsonb, não uma view de `escala_diaria`.** Corrigir a escala **não**
corrige a folha: quem leva o horário de uma para a outra são as **quatro** cópias da geração
(`executeGerarFolhaPonto`, `sincronizarFolhaPonto`, `gerarFolhaPontoServidor`,
`sincronizarFolhaPontoServidor`). Em 19/08/2026 todas preservavam **tudo** que já estivesse
preenchido (`shouldPreserve = true`, ou `!scaleChangedForDay`, que dá no mesmo quando a escala não
mudou) — então o horário corrigido no banco nunca mais chegava à folha, e clicar "Sincronizar"
reafirmava o valor errado. O comentário acima da linha dizia "preserve manual edits"; o código
preservava também o valor derivado.

Fonte única desde então: **`src/utils/folha/preservacao.ts`**.

| origem do campo | ao regerar/sincronizar |
|---|---|
| `manual` · `ajuste_coordenador` · `ajuste_servidor` | **preserva** — alguém decidiu aquilo |
| `real` · `pre_assinalado` · nulo | **regera** a partir de `escala_diaria` |

⚠️ **Preservar `real` parece conservador e é o oposto.** `real` é justamente o que a
`escala_diaria` manda; congelá-lo impede a folha de receber a correção de uma batida mal alocada.
A proteção da batida real vive noutro lugar e continua: `salvarFolhaPonto` recusa que quem não é
`super_admin` **altere** um horário de origem `real`.

⚠️ **Ao mexer em qualquer regra da geração de folha, mexa nas quatro cópias pelo mesmo critério** —
duas ficam em `folha-ponto/actions.ts` e duas em `consultar-escala/actions.ts`. Elas já divergiram
entre si antes (foi o que criou `sequenciaDia.ts`). Use um script que conte as ocorrências e aborte
na divergência (`scratchpad/aplica_preservacao.js` é o modelo).

⚠️ **O RECÁLCULO de totais tem outras quatro cópias, e elas não são as mesmas quatro.** As da
geração são `executeGerarFolhaPonto` · `sincronizarFolhaPonto` · `gerarFolhaPontoServidor` ·
`sincronizarFolhaPontoServidor`. As do recálculo de `total_horas_normais` são
`salvarFolhaPonto` · `autoCorrigirFolhaPonto` · `salvarFolhaPontoServidor` ·
**`autoCorrigirTodasFolhasPonto`** — esta última roda sobre **todas as folhas de uma vez** e é a
mais fácil de esquecer (foi o que quase aconteceu em 19/08/2026). Ao mexer em carga horária,
confira as oito, e lembre que as duas listas se sobrepõem só em nome.

### A jornada do mês não tem vigência, e trocá-la reescreve o mês inteiro (19/08/2026)

⚠️ **`escala_mensal.jornada_id` é UMA jornada por (servidor, mês).** Trocá-la no dia 12 **não**
muda "dali pra frente": reescreve a premissa dos dias 1 a 11 também, porque
`fn_blocos_previstos_dia`, `fn_confirmar_presenca` e a geração da folha leem essa coluna para
**todo** dia do mês. Batida real não se perde (`marcacoes_ponto` é INSERT-only), mas o **julgamento**
dela muda: hora extra e falta dos dias passados são recalculadas contra um horário que não valia
neles. Diário em
[`docs/evolucao/2026-08-19-mudanca-de-jornada-no-meio-da-escala.md`](docs/evolucao/2026-08-19-mudanca-de-jornada-no-meio-da-escala.md).

**A peça datada é `servidores_jornadas_temporarias`**, resolvida por
`obter_jornada_servidor_data(servidor, data, jornada_do_mês)` — chamada **de dentro** de
`fn_confirmar_presenca` e `fn_blocos_previstos_dia`, então terminal, REP, reconciliação e folha já
a respeitam por data. É o caminho da redução judicial e do acordo; a troca da coluna é o caminho do
**engano**, e desde `20260819230000` exige justificativa e vira linha em
`escala_mensal_jornada_historico`.

⚠️ **Vigência que acaba no fim do mês precisa sobreviver à virada.** O Gerador Inteligente herda a
jornada do mês anterior; até 19/08/2026 herdava `escala_mensal.jornada_id` e **desfazia
silenciosamente** a vigência. Hoje consulta a vigência do **último dia** do mês anterior — critério
escolhido para que vigência curta no meio do mês (um curso de 5 dias) corretamente **não** seja
herdada.

⚠️ **Não bloqueie a troca "porque já existe batida".** Foi a primeira ideia e está errada: proíbe a
redução judicial (que vai acontecer) e não resolve o engano (que sem histórico é indistinguível da
correção). Medido em produção em 19/08/2026, competência 08/2026: **zero** quebras de horário
praticado no meio do mês em 134 escalas mensuráveis, e **zero** jornadas desalinhadas do praticado
em 145. O risco é estrutural; a ocorrência era nenhuma.

⚠️ **`updated_at` de `escala_mensal` NÃO mede troca de jornada.** O `handleSave` da grade faz upsert
de todas as linhas a cada "Salvar Previsão", então o carimbo sobe sempre (75% das escalas com
batida, medido). Para medir troca, use a quebra no horário **praticado** — ou, agora, o histórico.

### Seleção da batida real na validação manual (v1.26.0)

Plano em [`docs/planos/2026-08-09-selecao-de-batida-real-na-validacao-manual.md`](docs/planos/2026-08-09-selecao-de-batida-real-na-validacao-manual.md),
migration `20260809100000`.

Onde o terminal já registrou o horário, o coordenador **seleciona** a batida em vez de digitar.
`fn_validar_presenca_manual` é a entrada única do modal e reparte:

| o coordenador… | função | origem gravada |
|---|---|---|
| seleciona marcação pendente | `fn_aceitar_marcacao_pendente` (já existia, nunca era chamada) | `terminal` |
| seleciona tentativa recusada | `fn_aceitar_tentativa_recusada` → materializa/reusa marcação → delega à de cima | `terminal` |
| digita o horário | `fn_registrar_presenca_informada` | `ajuste_coordenador` |

**Digitar não pode ser removido** — é o caso de quem chegou às 06:00, esqueceu de bater e só bateu
às 06:50. Selecionar é usar o fato; digitar é o coordenador declarar (Art. 82, parágrafo único).
Os dois na mesma validação, em passos diferentes, é normal.

⚠️ **Nunca mande o horário; mande o id.** Copiar `HH:MM` para o campo (o que o botão
`usar em <passo>` fazia) perde os segundos, a origem e o `presenca_*_marcacao_id` — a batida real
vira declaração do coordenador. Pior: se a RPC aceitasse horário como texto, qualquer chamada
poderia rotular horário inventado como batida real.

⚠️ **Elegibilidade é regra de banco.** `fn_tentativa_recusada_elegivel` é a fonte única (extraída
de `fn_batidas_reais_recusadas`, que agora a chama). Sem ela, uma tentativa de `PIN inválido` —
378 das 911 de produção — viraria horário de folha a partir de erro de digitação, possivelmente
de outra pessoa. Tentativa inelegível continua **visível** no modal, só não é selecionável.

⚠️ **A mesma batida física aparece em duas tabelas.** Desde `20260808100000`, batida fora da
janela gera tentativa em `logs_tentativas_presenca` **e** marcação pendente em `marcacoes_ponto`.
A grade dedup por timestamp (5 s) e a função reusa a marcação existente — `marcacoes_ponto` é
INSERT-only, uma cópia a mais não sai mais de lá.

**O previsto do modal vem de `fn_blocos_previstos_mes`** (via `blocoDaCelula`), não do log. Os dois
convivem e significam coisas diferentes: `escala_prevista_inicio` do log é **histórico**, gravado
no instante da recusa, e **não se recalcula** — é ele que denuncia recusa por bug. Rotulado como
`previsão vigente na época`.

## Acionamento de sobreaviso com destino (08/08/2026)

Plano em [`docs/planos/2026-08-08-acionamento-de-sobreaviso-com-destino.md`](docs/planos/2026-08-08-acionamento-de-sobreaviso-com-destino.md).
**As 5 migrations `202608081[5-9]0000` estão aplicadas em homologação e em produção**, conferidas
por sonda (backfill, índice único, FK composta, gatilho e CHECK). A única defesa não verificada
por fora é a policy — precisa de JWT de coordenador.

O sobreaviso era tratado como se pertencesse à unidade da escala. Quem está de sobreaviso atende
a rede inteira, e o `cheguei no local` conferia o GPS contra a **origem**. Medido nas 8 chegadas
com GPS que existem: todas conferidas contra o setor da TI, e em dois casos o destino real estava
a **3,3 km** e **4,0 km** dali — o servidor ia até a própria sala para o botão aceitar, e só então
se deslocava.

| o que mudou | onde |
|---|---|
| janela do Sobreaviso ganha **fonte única** no banco | `fn_janela_sobreaviso_dia` |
| chegada confere o **destino** (setor → unidade → origem) | `register_sobreaviso_arrival` |
| acionamento vira RPC; INSERT direto do cliente **deixa de existir** | `fn_acionar_sobreaviso` |
| painel do dashboard passa a ser **global** | `fn_painel_sobreaviso_dia` |
| quem pode acionar | `setores.sobreaviso_abrangencia` (`geral` × `unidade`) |

**Ver é global; acionar é por abrangência.** Default `'unidade'` — fecha por padrão. Só a TI da
SMS entra marcada como `geral` na migration; CAF e Transporte ficam para a tela.

⚠️ **"Ver é global" depende de um guard de papel que precisa ser lembrado a cada papel novo.**
`fn_painel_sobreaviso_dia`/`fn_pode_acionar_sobreaviso` (08/08/2026) nasceram com uma allowlist
fixa de papel (`super_admin`/`admin`/`coordenador`) — `rh` (11/08) e `rh_unidade` (12/08) ficaram
de fora até `20260812080000` corrigir. `fn_painel_sobreaviso_dia` virou denylist (só barra
`servidor`/`comum`, os papéis do Portal) para não repetir — mas `fn_pode_acionar_sobreaviso`
continua allowlist de propósito (acionar é uma decisão de autoridade, não só visibilidade), então
um papel novo com poder de agir precisa ser adicionado ali manualmente.

⚠️ **`fn_blocos_previstos_dia` não serve para Sobreaviso** — exclui a categoria por construção
(armadilha 6), e os 5 códigos de sobreaviso têm `horario_inicio = NULL` de propósito. Por isso a
janela precisou de função própria. Não tente ancorar código de Sobreaviso no dicionário.

⚠️ **Efeito colateral a avisar antes de ligar:** `sobreaviso_tempo_chegada_minutos` (90 min) hoje
cronometra o deslocamento até a unidade de origem. Passando a cronometrar até o local do chamado,
chamados que hoje "chegam" no prazo podem estourar. É o comportamento correto, não é silencioso.

## Armadilhas conhecidas

### 1. `CREATE OR REPLACE` já apagou lógica crítica seis vezes

As funções de presença são recriadas inteiras a cada migration. **Seis regressões reais** já
aconteceram por omitir ou trocar um trecho ao recopiar — e **cinco delas saíram da mesma
migration, `20260804080000`**:

- 04/08/2026 — perda do alinhamento dinâmico de hora extra (documentado em `.agents/AGENTS.md`).
- `20260804080000` — perda do guard de intervalo, corrigido em `20260806000000`.

As quatro seguintes também são da `20260804080000`, e só apareceram em 07/08/2026, quando um
coordenador tentou validar uma presença:

| o que se perdeu | sintoma | correção |
|---|---|---|
| cast `p_categoria::public.escala_categoria` | `operator does not exist: escala_categoria = text` | `20260807060000` |
| colunas `justificativa_manual` / `confirmacao_manual`, que passaram a ser **escritas sem nunca terem sido criadas** | `column "justificativa_manual" does not exist` | `20260807070000` |
| `COALESCE(campo, sintético)` e as flags `presenca_*_manual` | validação manual **sobrescreveria batida real** e o intervalo manual apareceria como batida de terminal | `20260807080000` |
| o **segundo passo** de cada escopo de meio período | "1º Período" e "2º Período" pintavam 1 segmento em vez de 2 | `20260807100000` |

Nenhum dado foi corrompido só porque as duas primeiras abortavam a função **antes** de qualquer
`UPDATE` — a validação manual ficou inteiramente inoperante de 04/08 a 07/08/2026. Cuidado com a
ordem ao corrigir cadeias assim: destravar o erro visível sem corrigir o que estava atrás dele
teria liberado a escrita destrutiva.

**Uma função quebrada esconde as outras regressões dela.** As três últimas só ficaram visíveis
depois que as anteriores foram corrigidas, uma de cada vez. Ao consertar uma função que estava
inoperante, não presuma que o primeiro erro resolvido é o único: **compare o corpo inteiro com a
última versão que comprovadamente funcionava**, não só o trecho que estourou.

Escopos de validação manual e quantos passos cada um grava — a grade espelha isso:

| escopo | passos |
|---|---|
| Dia Completo | entrada + saída intervalo + retorno intervalo + saída |
| 1º Período | entrada + saída para o intervalo |
| 2º Período | retorno do intervalo + saída final |

Os passos de intervalo em todos eles são condicionados a `v_tem_intervalo`.

Nada disso quebra build ou deploy: **plpgsql resolve nomes de coluna e operadores só em tempo de
execução do statement**, e `CREATE OR REPLACE FUNCTION` aceita a função feliz da vida.

⚠️ **Mas VARIÁVEL desconhecida o Postgres pega no `CREATE`** — e a diferença importa na hora de
decidir quanto conferir. `check_function_bodies` (ligado por padrão) valida a *sintaxe* e as
*variáveis* do corpo plpgsql; não valida nome de coluna, de função nem operador. Então:

| erro | quando aparece |
|---|---|
| `v_x` não declarada | **no `CREATE`**, `42601 "v_x" is not a known variable` — a função antiga fica intacta |
| coluna inexistente, função inexistente, operador errado | só quando o statement **executa** |

Aconteceu em 23/08/2026 com a `20260823130000`: `fn_confirmar_presenca` tem **dois blocos DECLARE
com escopo próprio** (o cursor de ontem e o de hoje), e uma variável nova foi declarada só no de
hoje enquanto o gerador a usava nos dois. O `CREATE` foi recusado e nada mudou em produção — mas
uma chamada a função inexistente, no mesmo commit, teria passado e só estourado no terminal, com o
servidor na frente. **Ao acrescentar variável a essas funções, confira que os dois cursores a
declaram.**
`npx tsc --noEmit` e `npm run build` não detectam nenhum desses cinco casos — mudança em função
de presença exige executar o caminho real.

**Antes de alterar `fn_confirmar_presenca*`:**

1. Descubra qual migration define a versão **vigente** — não é necessariamente a que o nome sugere.
   `grep -rln "FUNCTION public.fn_confirmar_presenca" supabase/migrations/ | sort | tail -1`
2. Gere a nova migration **copiando o arquivo vigente** e aplicando substituições pontuais por script,
   depois confira com `diff`. Não redigite o corpo à mão. Faça o script **abortar** se a contagem
   de ocorrências não for a esperada — foi isso que pegou uma indentação divergente em `20260807080000`.
3. Confirme que os guards existentes continuam presentes no resultado.

⚠️ **No script gerador, o segundo argumento de `String.replace` tem que ser uma função.** Com
string, o JS interpreta os padrões de cifrão: `$$` vira `$` — quebrando o dollar-quoting do
plpgsql — e `$'` (que existe dentro de `~ '^[0-9]+$'`) é substituído pelo **resto do arquivo**.
Isso produziu um `syntax error at or near "$"` em `20260809000000` e enfiou o bloco de `GRANT` no
meio de uma função. `gen_dobra.js` ganhou conferência estrutural do arquivo inteiro por causa
disso: delimitadores `$$` em pares, `CREATE OR REPLACE` na contagem certa, `GRANT` uma vez só.

4. Confira que **toda coluna escrita existe de fato** — a função não avisa. Compare a lista de
   colunas do `UPDATE` com o que o banco realmente tem (ver armadilha 3).

### 2. As migrations não são o schema completo

Tabelas base (`escala_diaria`, `escala_mensal`, `jornadas`, `dicionario_turnos`, `servidores`,
`unidades`, `setores`) foram criadas **fora do versionamento** e só existem no banco.
`src/types/database.ts` também está incompleto — não contém `escala_diaria` nem `jornadas`.

**Não confie nos arquivos para saber a forma das tabelas. Consulte o banco.**

### 3. Dois bancos diferentes

| ambiente | URL | acesso |
|---|---|---|
| homologação | `.env.local` → `mtgfmxsbsyknotvwzdcr.supabase.co` | REST |
| **produção** | `.env.production` → `supabase-sisescala.coolify.vps.atb.app.br` | REST (porta 5432 bloqueada por firewall) |

Os schemas **divergem**. Sempre confirme em qual banco você está antes de concluir qualquer
coisa sobre os dados.

⚠️ Uma nota anterior aqui dizia que `justificativa_manual` / `confirmacao_manual` faltavam
*só em homologação*, sugerindo que produção as tinha. **Era falso.** Em 07/08/2026 se confirmou
que as colunas não existiam em nenhum dos dois — nenhuma migration jamais as criou, e a função
as escrevia desde `20260804080000` (criadas em `20260807070000`). Coluna ausente em homologação
não é evidência de divergência: **verifique nos dois**, e não presuma que produção é o superset.

Só há `DATABASE_URL` em produção, e a porta Postgres não é acessível de fora — na prática,
consultas são feitas via PostgREST com a service role key. **Peça autorização antes de tocar
em produção, mesmo para leitura.**

### 4. Horário previsto: cadeia de precedência de 4 níveis

⚠️ **Esta regra mudou em 08/08/2026.** Antes o horário era inferido só por regex sobre o nome da
jornada, e isso impediu três servidoras de bater ponto no mesmo dia. Ver
[`docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md`](docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md).

Não existe coluna `start_hour`. O horário é resolvido nesta ordem, e o primeiro não-nulo vence:

| nível | fonte | quando |
|---|---|---|
| 1 | `escala_diaria.hora_inicio_prevista` | o coordenador informou ao escalar. **Não vale para `Regular`** (constraint `chk_hora_prevista_nao_regular`) |
| **2-A** | **`end_hour` do Regular do dia** | **o Regular cruza a meia-noite e o plantão é diurno** (`slots[1] IN ('M','T')`) — ver abaixo |
| 2 | `dicionario_turnos.horario_inicio` | o código determina a hora. **Só quando NÃO há turno `Regular` no dia** |
| **2-B** | **a mesma âncora, quando ela NÃO colide com o Regular** | **depois dos ramos de emenda da cascata, antes do fallback pelo nome da jornada** — ver abaixo |
| 3 | regex sobre `jornadas.nome` | categoria `Regular` |
| 4 | cascata legada (`LIKE 'M%'`, `slots[1]`, alinhamento ao Regular) | último recurso, **nunca removida** |

**Nível 2-B — a âncora que não colide** (`20260903100000`, aplicada em 03/09/2026; plano em
[`docs/planos/2026-09-03-plantao-noturno-previsao-e-virada-de-dia.md`](docs/planos/2026-09-03-plantao-noturno-previsao-e-virada-de-dia.md)).
⚠️ **O último ramo da cascata legada resolve o início do PLANTÃO pelo início da JORNADA REGULAR**
(`substring(j.nome from '^([0-9]+)')`). Para plantão **noturno** em jornada **diurna** nenhum ramo
de emenda casa, e esse fallback não emenda nada: **empilha o plantão em cima do expediente.** Caso
real (CHARLENE, mat. 69250, 02/09/2026): Regular `M` `07H ÀS 13H` + Plantão `N` viravam **um bloco
07:00–19:00**, fundido (armadilha 6) e sem o passo de intervalo do plantão de 12h (armadilha 9).
O DP então casava a batida real das 13:00 com o slot das 07:00 (**360 min**) e a das 18:45 com o
das 13:00 — o expediente de 6h saía com **11h55** na folha, sem tentativa recusada, sem pendência,
sem alerta.

Medido em 03/09/2026 sobre 2.216 escalas ativas: **156 plantões previstos sobrepostos ao Regular**,
54 com ponto, 5 unidades. O 2-B fechou **60** (todos `N`); os 96 restantes são Classe B (o código
não dá a hora — só o nível 1 resolve) ou escala que não cabe no dia (`MT` 12h + Regular 12h).

⚠️ **Este ramo NÃO pode subir na cascata.** Acima dos ramos de emenda, um `N` em jornada
`07H ÀS 17H` passaria a esperar até 19:00 em vez de emendar às 17:00 — o comportamento medido em
49 dias reais em 08/08/2026, que criou a condição do nível 2. E **a condição do nível 2 continua no
lugar**: o 2-B passa por baixo dela com a checagem explícita de não-colisão
(`fn_ancora_plantao_livre_do_regular`), que é o próprio critério que ela dizia proteger.

⚠️ **A grade e o banco divergiam em silêncio nesses dias.** `getShiftStartHour` sempre resolveu `N`
pela âncora fixa (19:00), sem olhar a jornada — então compliance e PDF viam o certo enquanto o
terminal, a reconciliação e a folha usavam 07:00. Depois do 2-B as duas fontes convergem no caso
dominante. **Nenhuma tela mostrava o horário que o banco estava usando**, e é por isso que o erro
só aparecia depois, como hora extra estranha.

**Nível 2-A — o espelho da jornada noturna** (`20260809000000`, plano em
[`docs/planos/2026-08-09-plantao-diurno-em-jornada-noturna.md`](docs/planos/2026-08-09-plantao-diurno-em-jornada-noturna.md)).
A cascata inteira assume que **plantão é sequência do expediente**. Com jornada `18H ÀS 06H` isso
se inverte: o plantão diurno vem **antes** do Regular. O nível 4 dava 18:00 ao `MT` e o sobrepunha
inteiro ao turno da noite — o servidor não conseguia registrar a entrada das 06:00, e a batida das
18:00 virava a *entrada* do dia, apagando 12h trabalhadas. A âncora correta é o **fim** da jornada:
a manhã de quem faz noite começa quando a noite dela terminaria. Fica **acima** do nível 2 porque a
âncora fixa do dicionário (`MT = 07:00`) não conhece a jornada do servidor.

```sql
substring(j.nome from '^([0-9]+)')                    -- "08H ÀS 12H" → 8
substring(j.nome from '(?:ÀS|AS|as|às)\s*([0-9]+)')   -- "08H ÀS 12H" → 12
```

**Renomear uma jornada ainda quebra o cálculo de presença** para `Regular` — o nível 3 continua
sendo regex sobre o nome.

**Por que o nível 2 só vale sem `Regular` no dia:** havendo turno Regular, o plantão é sequência
do expediente e o alinhamento da cascata está correto. Forçar a âncora ali sobreporia o plantão
ao Regular — medido em 49 dias reais de produção. **Não remover essa condição.**

**27 dos 64 códigos estão ancorados.** As famílias: `M T N MT` · `M?N` começa 19:00 (a noite
emenda na manhã seguinte) · `T?N` = `19h − (duração − 12)`, a tarde vem antes · `MT?` e `MTN`
começam 07:00 · intermediário (`I M4I IT4`) = 11:00–15:00. Os outros 21 são **Classe B** de
propósito: o código dá duração e período, não a hora — usam o nível 1. Só `MT4N` ficou sem
definição.

**Não ancore um código de Sobreaviso** — as migrations abortam se tentar (armadilha 6).

#### O frontend duplica isso, e a duplicação é parcialmente resolvida

- `getShiftForecastTime` **lê do banco** via `fn_blocos_previstos_mes` — um `LATERAL` sobre
  `fn_blocos_previstos_dia`, a mesma que o terminal usa. Por construção não diverge.
- `getShiftStartHour` / `getShiftEndHour` (`ScaleGrid.tsx`) **ainda existem** e servem o motor de
  compliance, o PDF e a sugestão de encadeamento. **Elas espelham as 27 âncoras à mão.** Ao
  ancorar um código novo, atualize as duas — as famílias `M?N`, `T?N` e intermediário têm testes
  de prefixo que precisam vir **antes** dos genéricos, senão `T2N` cai em 13:00 contra a âncora
  de 17:00.

#### Ao alterar as funções de presença

`scratchpad/gen_ancora.js` e `gen_hora_dia.js` fazem a cópia mecânica das **três** funções de uma
vez (`fn_confirmar_presenca`, `fn_confirmar_presenca_manual`, `fn_blocos_previstos_dia`),
conferem os invariantes antes e depois e **abortam** em qualquer divergência. Substituem o
`gen_blocos.js` que se perdeu. Use-os como modelo — não redigite corpo de função.

### 5. Horário sintético vs. batida real

Timestamps redondos (`:00:00`) são gerados por validação manual. Batidas reais de terminal têm
segundos e microssegundos. Ao auditar dados de ponto, **essa distinção decide se um registro pode
ser movido ou precisa ser refeito** — mover um horário sintético para outro campo fabrica um
registro de ponto falso.

⚠️ **A heurística não vale para o relógio de ponto.** O AFD registra com precisão de **minuto**
(`2026-08-07T22:20:00-0300`), então toda batida de REP tem segundos zerados sem ser sintética.
Por isso `fn_ingerir_afd` passa `sintetica = false` explicitamente para origem `rep`, e
`marcacoes_ponto.sintetica` é campo gravado, não derivado na leitura. Nunca reintroduzir a
inferência por segundos em cima de marcação de relógio.

⚠️ **E ela falha na direção contrária em dado anterior a 08/08/2026: segundos reais NÃO provam
batida real.** A validação em massa antiga gravava o **instante da validação** nos campos de
presença — com segundos e microssegundos, indistinguível de terminal pela heurística. Medido em
19/08/2026: HUGO MARCELO OSORIO tem os dias 1 a 17 de junho/2026 **todos** com entrada *e* saída em
`18/06 20:3x`; LUCIA LAYANE, idem. Competências **Fechadas**, comportamento corrigido pela v1.22.0.
Para separar fato de artefato use `escala_diaria.presenca_*_origem` (`rep`/`terminal` = real) — mas
essa coluna só existe desde `20260808020000`, então **junho e julho/2026 não são auditáveis por
horário**, por nenhum dos dois caminhos. Não tire conclusão sobre horário praticado nesses meses.

### 6. Fusão de blocos: Sobreaviso nunca funde

`fn_confirmar_presenca` agrupa os turnos do dia em **blocos contínuos**: se um turno começa
antes ou no instante em que o anterior termina (`v_s2_inicio <= v_s1_fim`), viram um bloco só,
e a janela de **saída** passa a ser o fim do último turno.

Isso é **correto e desejado** para `Regular` + `Extra` + `Plantão` — ex.: 08h–18h + 2h extra +
Plantão N 12h formam um bloco único, com saída esperada no fim do plantão.

⚠️ **Um bloco carrega UM intervalo só** — `v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min)`.
Então fundir dois turnos que **cada um** tem intervalo próprio apaga o da segunda jornada. Foi por
isso que o plantão diurno em dia de jornada noturna ganhou guard de **não-fusão**
(`20260809000000`, 12 sítios, mesma forma dos guards de Sobreaviso): `MT` 06:00–18:00 + `N`
18:00–06:00 são duas jornadas de 12h com 1h de intervalo cada, não uma de 24h com uma pausa.
Ao decidir se dois turnos fundem, **cheque `permite_marca_intervalo` da unidade** — em unidade que
não marca intervalo a fusão é inofensiva, em unidade que marca ela é perda de dado.
Quando dois blocos ficam encostados, a **batida de transição** fecha um e abre o outro com o
horário real: nada de timestamp fabricado na fronteira.

⚠️ **Dentro de um bloco fundido isso só passou a valer em 19/08/2026** (`20260819200000`, diário em
[`docs/evolucao/2026-08-19-batida-de-transicao-entre-turnos.md`](docs/evolucao/2026-08-19-batida-de-transicao-entre-turnos.md)).
Antes, o bloco tinha no máximo os 4 passos do conjunto e **quem batia na fronteira perdia a batida**:
medido na SMS (MAISA, 18/08/2026, Regular M 07:00–13:00 + Plantão T 13:00–19:00), as batidas das
13:07 e 13:10 viraram `fora_da_janela`, e a linha do plantão ficava com o horário do expediente
(07:04 → 19:09) porque a projeção grava o mesmo par em todas as linhas do bloco.

Como funciona agora: `fn_blocos_previstos_dia` expõe `turnos_inicio[]`/`turnos_fim[]` (o previsto de
cada turno fundido, na ordem de `escala_diaria_ids`), e cada fronteira interna ganha **dois slots
opcionais** — a saída do turno que fecha e a entrada do turno que abre — gravados na **linha** de
cada turno, não no bloco. Três coisas não podem ser desfeitas:

- **Slot opcional sem batida não vira pendência.** A maioria dos dias em bloco contínuo não tem
  batida na fronteira, e isso é normal, não falta.
- **Os slots precisam ser reordenados por instante previsto** depois de montados. O DP é um
  alinhamento monotônico; os slots de fronteira nascem no fim do array (13:00 depois da saída das
  19:00) e sem reordenar o alinhamento fica impossível — a batida de transição seria recusada do
  mesmo jeito, e o sintoma seria idêntico ao bug original.
- **A alocação de fronteira vence a do bloco** na mesma linha e passo (`'fronteira'` no jsonb da
  alocação, desempate em `fn_projecao_marcacoes_dia`). É o que faz a linha do plantão mostrar
  13:10 em vez de 07:04.

⚠️ **SEM batida na fronteira, o par do bloco continua indo para TODAS as linhas — e isso é dupla
contagem** (medido em 23/08/2026; plano em
[`docs/planos/2026-08-23-turno-regular-emendado-com-plantao.md`](docs/planos/2026-08-23-turno-regular-emendado-com-plantao.md)).
Regular `08:00–14:00` + Plantão `T 14:00–20:00`, duas batidas só (08:03 e 18:02): as duas linhas
ficam `08:03 → 18:02`, a folha cobra **4h de extra** contra a jornada que acaba às 14:00, e o anexo
já paga aquelas horas como plantão. **6h de jornada + 4h de extra + 6h de plantão para 10h
trabalhadas.** Em 08/2026: **27 dias, 75h12** — AGNA (mat. 205), ANDRESA (54594), DORILENE (53612)
e outros 4. `turnosDaFolha` (`origemMarcacao.ts`) exclui a linha do Plantão e **não basta**, porque
quem carrega a saída errada é a própria linha Regular.

⚠️ **Três coisas que só se descobrem medindo, e que mudam o conselho operacional:**

| fato | consequência |
|---|---|
| `rep_janela_duplicidade_segundos = 60` descarta a 2ª batida em menos de 1 min | a regra folclórica de "sair, esperar 5 minutos e bater de novo" é margem de uma regra de **1 minuto**. Duas batidas às `14:00:00` (AGNA, dia 4) = a segunda some |
| **`fn_confirmar_presenca` NÃO tem os slots de fronteira** — `20260819200000` só mexeu em `fn_blocos_previstos_dia`, `fn_alocar_marcacoes_dia` e `fn_projecao_marcacoes_dia` | no terminal a batida de transição é **recusada** (vira marcação pendente, que a reconciliação aproveita). Mandar o servidor bater na transição hoje é mandar ele levar recusa — e ele desiste (AGNA, dias 5, 6 e 7: nenhuma saída) |
| `fn_salvar_saida_bloco` **FABRICA** os horários de transição a partir da escala (o comentário dela diz isso) | é por isso que ANDRESA tem `Regular 08:01 → 12:00` sem nunca ter batido às 12:00 — e a folha exibe origem **`real`**. 533 marcações `sintetica` de origem `terminal` em 08/2026, 244 já gravadas como presença. Parte é backfill de `20260808030000`, parte é fabricação viva. **Auditoria própria pendente** |

**Sobreaviso não entra nessa conta.** Não é trabalho presencial, não marca presença e tem ciclo
próprio em `logs_sobreaviso`. Agrava o fato de que o `start_hour` do Sobreaviso é alinhado ao fim
do turno Regular (o 3º elemento do `COALESCE` de `start_hour` **não filtra por categoria**), então
um Sobreaviso N12 encosta exatamente no fim da jornada e fundia com ela.

Sintoma quando quebra: servidor não consegue bater a saída, e `logs_tentativas_presenca` mostra
`escala_prevista_fim` com o horário do sobreaviso em vez do fim do turno.

**Sobreaviso não marca presença, ponto.** Ciclo próprio em `logs_sobreaviso`: acionamento →
aceite (magic link por WhatsApp/e-mail/SMS) → chegada (GPS ou validação manual). Nada disso
entra na folha de ponto, que lê só `Regular` e `Extra`.

⚠️ **`logs_sobreaviso` não é uma tabela de acionamentos.** Uma nota anterior aqui dizia
"522 acionamentos de produção, 514 Manual e 8 GPS". **É enganoso** — medido em 08/08/2026:

| linhas | o que é |
|---|---|
| 325 | artefato de validação manual de presença |
| 183 | artefato do terminal (`O próprio usuário confirmou…`) |
| 1 | artefato de validação manual na grade |
| **13** | **acionamento real — um coordenador digitou um motivo** |

`fn_confirmar_presenca` e `fn_confirmar_presenca_manual` também escrevem aqui, e os artefatos
entram com status `Chegou`. Dos 13 reais, **9 usaram o link mágico e 8 registraram chegada com
GPS** — o fluxo é usado; o número inflado é que escondia isso. **Ao contar acionamento, filtre
os artefatos** (`acionado_por IS NOT NULL` ou motivo que não case com os prefixos acima). Contar
tudo já produziu um relatório afirmando o oposto da realidade.

Três camadas de defesa, todas devem ser preservadas:

| camada | onde | migration |
|---|---|---|
| guards `<> 'Sobreaviso'` nas 8 fusões de bloco | `fn_confirmar_presenca` | `20260807000000` |
| `Sobreaviso` fora da lista de categorias dos blocos + função manual não escreve em `escala_diaria` | ambas as funções | `20260807020000` |
| `CHECK chk_sobreaviso_sem_presenca` | tabela `escala_diaria` | `20260807030000` |

A constraint é a única que sobrevive a um `CREATE OR REPLACE` descuidado — é ela que torna a
regra realmente definitiva.

⚠️ As checagens de **acesso** do coordenador (as que não têm `ORDER BY start_hour`) continuam
aceitando `Sobreaviso` de propósito: sem isso, quem tem só sobreaviso no dia perderia acesso
ao terminal.

### 7. Batidas recusadas ficam registradas

`logs_tentativas_presenca` guarda toda tentativa negada, com `data_hora_tentativa`,
`mensagem_erro` e `escala_prevista_inicio`/`fim`. É a **fonte de verdade** para recuperar
horários reais quando uma batida legítima foi recusada por bug — muito melhor que presumir
horário a partir da jornada. Ver `20260807010000` como exemplo, e `fn_reconciliar_presencas_negadas`.

⚠️ **A maioria das linhas não prova que alguém estava presente.** Auditoria de 07/08/2026
(911 tentativas, 361 em agosto):

| tentativas | o que é | serve como horário de ponto? |
|---|---|---|
| 378 | `Matrícula ou PIN inválidos` | **não** — identidade não confirmada, pode ser outra pessoa |
| 75 | `servidor_id` nulo | **não** — idem |
| 90 | `Nenhum plantão` / `Sem escala` | **não** — não havia escala no dia |
| 175 | janela de presença / erro interno | **sim** — pessoa identificada, recusada por bug |

Gravar um horário de "PIN inválido" na folha registra o ponto a partir de um erro de digitação.
O filtro canônico está em `fn_batidas_reais_recusadas` (`20260807090000`): exige `servidor_id`
preenchido **e** mensagem de janela/erro interno.

Também não há campo indicando **qual passo** a tentativa era. O casamento é por proximidade ao
horário previsto, guloso e sem reuso. Considerar só entrada e saída erra: muitas tentativas caem
por volta das 12h em jornadas 08:00–18:00 (almoço) e ficavam a 250–295 min do passo escolhido.
Incluindo os 4 passos, a distância cai para p50 = 51 min. Tolerância adotada: **90 min**
(aproveita 89%; o resto cai no horário previsto, que é o comportamento seguro).

### 8b. FK nova quebra todo embed implícito daquela tabela

`logs_sobreaviso` sempre teve `unidade_id`. Ao ganhar `destino_unidade_id` (`20260808160000`),
passou a ter **duas** FKs para `unidades` — e todo `select` que embutia `unidades(...)` **sem
dizer qual** virou `HTTP 300 / PGRST201` de uma vez. Aconteceu em três lugares em produção,
incluindo a tela de **Auditoria**, que ficou sem dado nenhum.

```
unidades(nome)                                    ❌ ambíguo
unidades!logs_sobreaviso_unidade_id_fkey(nome)    ✅ origem
unidades!destino_unidade_id(nome)                 ✅ destino (dica por coluna serve em FK simples)
```

`profiles` sofreu o mesmo com `acionado_por` ao lado de `validado_por`.

⚠️ **FK composta não aceita dica por coluna.** `(destino_setor_id, destino_unidade_id) →
setores(id, unidade_id)` só embute pelo **nome da constraint**:
`setores!fk_logs_sobreaviso_destino_setor(...)`. Com a dica de coluna dá `PGRST200`.

**Nada disso quebra `tsc` nem `npm run build`** — a string do `select` é opaca para o
TypeScript, exatamente como o corpo de uma função plpgsql (armadilha 1). Depois de adicionar
qualquer FK, varra os `select` que embutem a tabela alvo e **execute cada um** contra o banco:

```js
// para cada tabela: se der PGRST201, todo embed sem dica daquela tabela está quebrado
await fetch(`${U}/rest/v1/logs_sobreaviso?select=id,${tabela}(*)&limit=1`, { headers: H })
```

### 8. PostgREST corta em 1000 linhas

Consultas via REST retornam no máximo 1000 registros, **silenciosamente** — `limit=2000` não
adianta. `escala_diaria` tem ~3.500 linhas só em 08/2026. Sem paginação por header `Range`,
auditorias dão resultado errado e parecem corretas. Já causou dois diagnósticos falsos.

```js
for (let from = 0; ; from += 1000) {
  const r = await fetch(url, { headers: { ...H, Range: `${from}-${from + 999}` } })
  const page = await r.json(); out.push(...page)
  if (page.length < 1000) break
}
```

### 9. Regra de intervalo intrajornada (CLT Art. 71)

Intervalo só para trabalho contínuo **acima de 6h**. Fonte única:

```sql
public.fn_jornada_tem_intervalo(p_duracao_minutos, p_intervalo_minutos)
  -- duração > 360 min E intervalo_minutos > 0
```

⚠️ **Os dois argumentos vêm de fontes diferentes, e por um ano só um deles conhecia o plantão**
(corrigido em 22/08/2026 por `20260822100000` + `20260822110000`; diário em
[`docs/evolucao/2026-08-22-intervalo-do-plantao.md`](docs/evolucao/2026-08-22-intervalo-do-plantao.md)).
A **duração** já vinha do turno (`horas_computadas`) para Plantão/Extra; o **intervalo** vinha
sempre de `jornadas.intervalo_minutos`, a jornada Regular do servidor. Como **toda jornada ≤ 6h
tem `intervalo_minutos = 0`** — correto para o expediente dela —, esse zero **anulava o guard
inteiro** em qualquer plantão daquela pessoa, de qualquer duração.

Caso real, mesmo sábado, mesmo turno `MT` de 12h: AGNES (jornada 10h) ganhou bloco 08:00–20:00
com intervalo 12:00–14:00; INGRID (jornada 6h) ganhou 07:00–19:00 **sem intervalo nenhum**.
E o prejuízo já tinha acontecido com batida assinada do relógio: a batida REP das **14:41** da
INGRID e a das **13:00** da GISELE foram gravadas como **saída** de plantões que iam até 19:00 —
não havia passo de intervalo para elas caírem, e **nenhuma tentativa recusada foi gerada**.

A resolução agora tem fonte única, e o cadastro do plantão mora no lugar certo:

| camada | onde | papel |
|---|---|---|
| expediente | `jornadas.intervalo_minutos` | intervalo do turno **Regular** |
| plantão | **`dicionario_turnos.intervalo_minutos`** (nullable) | intervalo do **turno**. `NULL` = não regulamentado |
| piso | **`fn_intervalo_minimo_legal(duracao)`** | > 360 min → 60; senão 0 |
| resolução | **`fn_intervalo_previsto_minutos(cat, dur, jornada, turno)`** | `GREATEST(cadastro, piso)` |

⚠️ **Só a coluna nova não bastaria** — dependeria de alguém cadastrar os 53 códigos de plantão, e
um código esquecido volta a ser o bug, em silêncio. O piso derivado da duração é o que torna a
regra impossível de esquecer. Por isso todos os códigos ficam `NULL` de propósito: preencher só
serve para **elevar** acima do piso (o caput admite até 2h), nunca para rebaixar.

⚠️ **A faixa de 15 min do Art. 71 §1º (acima de 4h e até 6h) NÃO é implementada** — decisão do
usuário em 22/08/2026: *jornada de até 6h registra só entrada e saída*. Não reintroduzir sem
decisão nova; a fronteira de `fn_intervalo_minimo_legal` e a de `fn_jornada_tem_intervalo`
precisam continuar sendo **a mesma** (360 min), senão o terminal aceita uma janela que a
reconciliação não prevê.

**Base legal**, para quem for reabrir a decisão: a Lei 17.331/2008 (RJU de Marabá), Art. 17 §2º,
manda **regulamento próprio** disciplinar o regime de turno ou plantão — e esse regulamento não
existe. Enquanto não existir, vale subsidiariamente o Art. 71 caput da CLT, cuja âncora é
*"trabalho contínuo, cuja duração exceda"* — a duração do que foi trabalhado, não o contrato de
quem trabalhou. É daí que sai a decisão de o intervalo do plantão ser propriedade do turno.

**Espelho no frontend:** `src/utils/intervaloIntrajornada.ts` (`celulaTemPassosDeIntervalo`), usado
pelos dois sítios de `ScaleGrid.tsx`. Ao mexer no SQL, mexa nele.

Medido em produção em 22/08/2026, simulando a regra nova sobre as **10.152 linhas** de
`escala_diaria`: **106 plantões ganham** o passo de intervalo, **zero perdem**, `Regular` e `Extra`
ficam **inteiramente inalterados**, e 68 plantões de quem tem jornada de 10h passam de 120 para
60 min de intervalo previsto — os dois riscos disso foram medidos e estão vazios
(`servidores.intervalo_flexivel = true` em **0 de 500**, então `fn_ajuste_intervalo_flexivel` está
inerte e nada antecipa a saída esperada; e o maior intervalo realmente praticado nesses 68 foi de
**94 min**).

**Modo do intervalo** — três níveis, do mais geral ao mais específico:

1. `unidades.tipo_intervalo` = `flexivel` | `rigido`
2. `servidores.intervalo_inicio/fim_personalizado` — exceção de **horário** dentro do modo rígido
3. `servidores.intervalo_flexivel` (bool) — libera horário livre **mesmo em unidade rígida**

Com `intervalo_flexivel = true`, os campos personalizados deixam de ser horário obrigatório e
passam a definir só a **duração prevista**. A saída vira dinâmica:

```
saída_esperada = fim previsto + (intervalo real − intervalo previsto)
```

Excedente adia, déficit antecipa (mantém a carga líquida). Sem nenhuma marcação de intervalo,
a saída fica no horário previsto. Implementado em `20260807050000` via
`fn_ajuste_intervalo_flexivel`; os passos 2 e 3 do terminal ganham ramos próprios para o modo
flexível. **Preserve-os ao recriar a função.**

Vale para **todas** as categorias, inclusive Plantão. No cadastro atual, toda jornada ≤ 6h tem
`intervalo_minutos = 0`. A duração vem de `horas_totais` (Regular) ou `horas_computadas` do turno
(Plantão/Extra). `ScaleGrid.tsx` espelha essa regra para escolher entre 2 e 4 segmentos — se alterar
uma ponta, altere a outra.

⚠️ **`jornadas.intervalo_inicio_padrao`/`intervalo_fim_padrao` são HORA ABSOLUTA (12:00), e até
19/08/2026 valiam para qualquer turno** — inclusive um Plantão `19:00 → 07:00`, cuja janela de
intervalo nascia *antes da própria entrada*. Medido: 9 dos 3.626 blocos de agosto/2026, todos
plantão noturno; ICARO HENRIQUE, 18/08, ficou gravado com `entrada 19:03 | intervalo 13:02/13:37 |
saída 06:55`. `20260819220000` fecha isso em duas etapas — soma um dia quando a hora absoluta
pertence ao dia seguinte; senão cai para o relativo (`início + 4h`) preservando a **duração** do
padrão. Diário em
[`docs/evolucao/2026-08-19-intervalo-previsto-dentro-do-turno.md`](docs/evolucao/2026-08-19-intervalo-previsto-dentro-do-turno.md).

⚠️ **O trecho do intervalo existe em TRÊS sítios** — dois em `fn_confirmar_presenca` (cursor de
hoje e cursor de ontem) e um em `fn_blocos_previstos_dia`. Corrigir só um lado faz o terminal
aceitar uma janela e a reconciliação prever outra. Use um gerador com contagem
(`scratchpad/gen_intervalo_dentro_do_turno.js` é o modelo).

⚠️ **E existe um QUARTO sítio, que não vive na mesma migration: `fn_confirmar_presenca_manual`.**
A versão vigente dela é mais antiga que a das outras três (`20260809000000` contra
`20260819220000`), então quem regenerar só o arquivo "mais recente" a deixa para trás — foi o que
quase aconteceu em 22/08/2026. Corrigir só o lado do terminal deixa a **validação manual do
coordenador** ainda gravando 2 passos num plantão de 12h. `scratchpad/gen_intervalo_plantao.js` é
o modelo de gerador que lê **duas fontes** e confere invariantes contra cada uma.

### 10. O identificador do AFD é CPF com **um** zero à esquerda — ⚠️ **só em alguns relógios**

🚨 **LEIA ISTO ANTES DO RESTO DESTA ARMADILHA (17/08/2026).** "O identificador é CPF" **não é
propriedade do AFD, é propriedade de como cada equipamento foi cadastrado.** O relógio da **SMS**
(10.110.0.20) identifica por **PIS/NIS**, não por CPF — medido pelos dígitos verificadores dos 323
usuários dele: **292 validam como PIS, só 13 como CPF** (2 como ambos, 16 como nenhum). Os relógios
da TI, LACEM e CEI são CPF porque foram cadastrados assim; este veio de outro sistema que usou PIS.

Consequências medidas em produção, todas silenciosas:

| o que assume CPF | efeito no relógio da SMS |
|---|---|
| `rep.CriarUsuario` (manda campo `cpf`) | **327 cadastros falharam**: `add_users.fcgi recusou: 'pis' em formato incorreto` |
| `fn_vincular_cadastros_por_cpf` | casa **0** dos 323 |
| `fn_cobertura_ponto_dispositivo` | diz `fora_do_relogio` para **27 pessoas que estão no relógio com biometria** e batem ponto todo dia |
| `fn_enfileirar_cadastros_rep` (grava `lpad(cpf,12,'0')`) | criaria vínculo com identificador que **nunca** casa com as linhas do AFD deste device — 265.922 marcações ficariam órfãs para sempre, sem erro nenhum |

A falha do `add_users.fcgi` foi **sorte**: se tivesse passado, teria criado 327 vínculos inúteis e o
problema só apareceria como "o ponto de ninguém aparece", meses depois.

✅ **Existe ponte, e ela mudou desde que este arquivo dizia o contrário:** `servidores.pis_pasep`
está preenchido em **309 de 347** servidores (a nota abaixo, de 08/08/2026, dizia "vazio em 100% dos
registros" — **desatualizado**, os dados entraram depois). Casando por PIS, 48 dos 323 usuários do
relógio viram servidor, e 28 dos 126 escalados. Casar por **matrícula** é ponte ruim aqui: só 35 de
323 (89 têm matrícula `0` no device).

**Ao ligar um relógio novo, descubra o tipo de identificador ANTES de empurrar cadastro** — rode a
higiene (só leitura) e valide os dígitos verificadores do `identificador_afd`. Não existe hoje coluna
dizendo se o dispositivo é CPF ou PIS; enquanto não existir, os dois conviverão em produção sem nada
no schema registrando qual é qual.



O registro tipo 3 do AFD (a marcação) carrega apenas `NSR + data/hora + identificador(12) + CRC`.
**A matrícula não aparece em nenhuma marcação** — só no tipo 5 (cadastro) e no `load_users.fcgi`.
Por isso `rep_vinculos_servidor` é a única ponte, e precisa ser populada **antes** de qualquer
`remove_users.fcgi`: apagado o usuário do relógio, os NSRs antigos ficam órfãos para sempre.

⚠️ **"única ponte" deixou de ser verdade em 17–18/08/2026.** `fn_servidor_por_identificador_afd`
tenta o vínculo primeiro, mas **cai para busca direta em `servidores` por CPF ou PIS** quando não
acha. O vínculo continua tendo prioridade e continua sendo o que você deve popular antes de
remover cadastro — mas **não é mais o que decide se a batida ganha dono**. Ver armadilha 13.

⚠️ **E `p_vigente_de` nunca protegeu a queda para CPF/PIS.** Quem impede o histórico de um relógio
reaproveitado de virar ponto daqui é `dispositivos_rep.ponto_valido_desde` (22/08/2026) — ver
armadilha 20. Antes dela, 9.626 marcações de 2019–2025 de sete relógios já tinham ganhado dono.

O identificador é o CPF preenchido a 12 posições. A inversa é `right(ident, 11)`, **nunca**
`ltrim(ident, '0')`:

```
053638930459 → ltrim → 53638930459  (11)  CPF 53638930459  ✅
008943857128 → ltrim →  8943857128  (10)  CPF 08943857128  ❌ perdeu um dígito
```

**37% dos servidores com CPF preenchido começam com zero** (47 de 127, medido em 08/08/2026),
então o erro atinge um terço da base de forma aparentemente aleatória — e o sintoma é órfã
fantasma no módulo de pendências, que leva alguém a vincular a pessoa errada na mão. Corrigido
em `20260808090000`.

Agrava: quem usa relógio tende a ter `cpf` nulo no SisEscala. Auditor fiscal casa por PIS/NIS.
⚠️ A frase que existia aqui — "`pis_pasep` está vazio em 100% dos registros" — era verdade em
08/08/2026 e **não é mais**: em 17/08/2026 são **309 de 347** preenchidos. Foi exatamente isso que
tornou viável a ponte por PIS descrita no topo desta armadilha. **Reconfira contagem deste arquivo
contra produção antes de decidir com base nela.**

⚠️ **Pendência (13/08/2026, sem solução escolhida): identificador por CPF quebra para vínculo
duplo.** `servidores.vinculo_multiplo_confirmado` (`20260810140000`) permite duas matrículas pra
mesma pessoa/mesmo CPF — 110 CPFs assim na base — mas `uq_vinculo_vigente` só aceita **um**
vínculo vigente por `(dispositivo_id, identificador_afd)`. Se as duas matrículas precisam bater
no mesmo relógio, hoje só uma pode ter vínculo — o relógio identifica pela digital cadastrada,
não sabe distinguir "qual matrícula" a pessoa está representando. É limitação de hardware/
protocolo AFD, não só de schema. Direções possíveis e o que falta decidir em
[`docs/planos/2026-08-13-vinculo-duplo-e-identificacao-no-rele.md`](docs/planos/2026-08-13-vinculo-duplo-e-identificacao-no-rele.md).

### 11. O campo de data/hora do AFD tem 12 dígitos, não 24 (não é ISO 8601)

`fn_parse_linha_afd` (`20260808080000`) nasceu assumindo que o campo de data/hora de uma
marcação (tipo 3) era `2023-11-08T08:46:00-0300` — 24 caracteres, igual ao exemplo ilustrativo
do próprio plano. **O exemplo era uma reformatação para leitura humana na documentação, não os
bytes reais.** O campo de verdade é `DDMMYYYYHHMM`, 12 dígitos, sem hífen, dois-pontos, `T` ou
offset — confirmado em 11/08/2026 buscando o AFD de verdade do relógio (10.110.2.89) pelo
`coletor-rep`.

**Sintoma:** o cast direto `v_dt_txt::timestamptz` falhava (capturado pelo `EXCEPTION` que já
existia) para **toda** linha tipo 3, `ocorrido_em` ficava `NULL`, e `fn_ingerir_afd` nunca
criava marcação nenhuma — mesmo com a linha certa gravada no banco. Uma sincronização de teste
trouxe 17.448 registros do histórico completo do equipamento (o coletor ainda pede sempre a
partir do NSR 1, ver acima) e **zero marcações**.

**Por que isso não corrompeu nada:** `rep_afd_registros.linha_bruta` é o artefato legal, gravado
exatamente como veio do equipamento — estava certo o tempo todo. O bug era só na extração das
colunas *derivadas*, e `parse_versao` existe exatamente para isto: permitir reprocessar sem
jamais tocar em `linha_bruta`. O modo de falha era "não extrai nada", nunca "extrai errado".

**Correção em `20260811190000`:** desloca os offsets em 12 posições (identificador tipo 3:
35→23; tipo 5: 36→24) e troca o cast direto por
`to_timestamp(v_dt_txt, 'DDMMYYYYHH24MI')::timestamp AT TIME ZONE 'America/Sao_Paulo'` — o
mesmo padrão que `fn_confirmar_presenca` usa na direção inversa para `v_now_local`. A migration
também roda `fn_reparse_afd_dispositivo` para todo `dispositivos_rep` existente, recuperando
retroativamente as marcações que deveriam ter sido criadas desde o início.

⚠️ **Se outro relógio/modelo entrar no ar, confira o formato antes de confiar no parser** — use
`coletor-rep afd-raw` (diagnóstico puro, não grava nada) para ver os bytes crus antes de rodar
`sync` de verdade. Um exemplo ilustrativo em markdown não é evidência do formato real; só o
byte cru é.

### 12. O processo Node roda em UTC — `new Date(iso).getDate()` mente

✅ **Desde 23/08/2026 (v2.10.0) a EXIBIÇÃO tem fonte única: `src/utils/horario.ts`.** Toda
formatação de data/hora passa por ela e **sempre** fixa o fuso — nunca herda o do navegador nem
o do processo. O fuso vem de **`configuracoes_globais.timezone`** (a chave sempre existiu; só o
SQL a respeitava), publicado pelo layout raiz em `window.__SISESCALA_TZ__` e editável em
Configurações → Regras.

⚠️ **`toLocaleTimeString`/`toLocaleDateString`/`toLocaleString` sem `timeZone` usam o fuso da
MÁQUINA de quem abriu a tela.** Num sistema de ponto isso significa a mesma batida com horários
diferentes por computador. Caso real: AGNA (mat. 205), 10/08/2026, batida
`2026-08-10T11:03:40+00:00` = **08:03:40** em Marabá — a folha mostrava `08:03` e o tooltip da
grade `11:03`. Medido: **96** formatações sem fuso contra 56 com; 125 reescritas por
`scratchpad/gen_fuso_unico.js`. **Ao escrever código novo, use `formatarHora`/`formatarData`/
`formatarDataHora` — nunca `toLocale*` direto.**

⚠️ **Data pura (`'2026-08-10'`) NÃO é timestamp e não pode ser convertida.**
`new Date('2026-08-10')` é meia-noite UTC; convertido para `America/Sao_Paulo` vira **09/08**. Era
por isso que o projeto colava `+ 'T00:00:00'` em toda data de calendário. `formatarData` detecta
a forma `YYYY-MM-DD` e formata **sem conversão nenhuma** — então passe a data pura, não o
`T00:00:00`. Manter o sufixo *e* fixar o fuso traz o erro de volta pelo outro lado (a string sem
offset é lida no fuso do processo, UTC na VPS, e vira 09/08 21:00).

⚠️ **`new Date(new Date().toLocaleString('en-US', { timeZone }))` NÃO é exibição — é cálculo,**
e continua sendo o padrão para obter a hora local. O resultado alimenta `getDate()/getMonth()`.
Trocá-lo por uma função de formatação quebra a lógica de negócio, não só a tela; o ensaio do
gerador pegou exatamente essa troca indevida antes de aplicar. Para derivar a data de domínio de
um instante, use `dataISOLocal()`.


Não há `Dockerfile` nem `TZ` em lugar nenhum do repo, e o container do Coolify sobe em UTC.
Confirmado empiricamente desde a **v1.2.8** (folha mostrando `10:59` onde o real era `07:59` —
exatamente UTC−3).

Consequência: **toda data de domínio derivada de um timestamp com `.getDate()`/`.getMonth()`/
`.getFullYear()` no servidor sai errada por 3 horas.** Uma batida às 22:00 de 11/08 é dia 12 para
o Node. O padrão correto, já usado em `folha-ponto/actions.ts` e `consultar-escala/actions.ts`, é
converter explicitamente pelo `configuracoes_globais.timezone`:

```ts
const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }))
// ou, para extrair só a data de um ISO:
new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit' })
```

`new Date(ano, mes, 0).getDate()` (contar dias do mês) e `setDate(getDate() + 1)` (aritmética)
são imunes — não confunda os dois casos.

⚠️ **Definir `TZ=America/Sao_Paulo` no container foi considerado e descartado** em 12/08/2026:
mudaria em silêncio ~40 derivações de data num sistema de ponto em produção, sem teste que cubra
a diferença. Se alguém reabrir essa decisão, o custo é a verificação, não a mudança.

**O que tornou isso perigoso não foi o offset, foi a RPC confiar no input.**
`fn_aceitar_marcacao_pendente` recebia `(p_marcacao_id, p_escala_diaria_id)` e não conferia
relação nenhuma entre os dois — nem servidor, nem dia. Ela até lia `m.servidor_id` para
`v_servidor` e **descartava sem usar**. Fechado em `20260812160000` com quatro guards antes de
qualquer escrita (servidor · data em `[D−1, D]` · não-Sobreaviso · competência aberta), gerado
por `scratchpad/gen_guard_aceitar.js`. Auditoria de produção na mesma data: **zero** tratamentos
com dia ou servidor divergente — nenhum dado foi corrompido.

Lição transferível: **quando uma tela filtra as opções, a RPC ainda precisa recusar as
inválidas.** Tela corrigida não protege quem chama a RPC direto — e todas elas são `GRANT`adas
a `authenticated`.

### 13. Estar cadastrado num relógio basta para a batida virar ponto (19/08/2026)

⚠️ **Desde 17–18/08/2026, `rep_vinculos_servidor` deixou de ser obrigatório para a batida ganhar
dono.** `fn_servidor_por_identificador_afd` (`20260818200000`) tenta o vínculo, e **cai para busca
direta em `servidores` por CPF ou PIS**. Isso resolveu a SMS, mas criou um caso novo:

**Quem administra o parque precisa estar cadastrado em TODOS os equipamentos** — para configurá-los
e para cadastrar os outros administradores — **e passa a ter cada teste de biometria convertido em
ponto.** Caso real medido: o administrador testou o relógio do CEI em 15/08/2026 (11:24, 12:12,
12:41) e a batida das 11:24 virou a **entrada do Plantão dele na folha**. Ele **não tinha vínculo no
CEI** — a resolução por CPF bastou. O problema multiplica a cada administrador novo.

A defesa é `rep_excecoes_ponto` (`20260820030000`): pares (servidor, dispositivo) em que a batida
**não** é atribuída, consultada por `fn_ponto_excecao` **nos três caminhos** de resolução (vínculo,
CPF, PIS) — cobrir só um deixa o furo aberto para quem tem vínculo. A batida continua gravada em
`rep_afd_registros` e `marcacoes_ponto`; ela apenas não ganha dono, então não projeta na folha.

⚠️ **O seed da `20260820030000` NÃO alcança relógio novo, e o comentário dele diz que sim.** Ele é
um `SELECT` sobre `dispositivos_rep` — "todos menos o relógio onde a pessoa realmente bate" — e não
uma lista de UUID, mas **`INSERT` roda uma vez**: pegou os equipamentos que existiam em 20/08/2026 e
nenhum dos oito criados depois. Numa unidade que ganha o segundo, o terceiro e o quarto relógio,
**cada equipamento novo volta a converter em ponto o teste de quem o está instalando**, em silêncio.

⚠️ **E a primeira correção (`20260825120000`) tinha critério INSATISFAZÍVEL.** Ela herdava a exceção
de quem fosse exceção em **todos os demais** equipamentos — só que quem administra o parque tem, de
propósito, **um relógio sem exceção**: aquele onde o ponto dele é real. Medido no mesmo dia: exceção
em 5 de 14 relógios, cadastro com biometria em 8 e exceção em nenhum desses 8, backfill inserindo
**zero** linhas e um gatilho que nunca dispararia. **Quem administra o parque é um fato
administrativo, não algo a inferir da forma das exceções já gravadas.**

Fonte única desde `20260825140000`: a tabela **`rep_administradores_parque`** (`servidor_id` +
`dispositivo_ponto_id` + motivo). `trg_herdar_excecoes_ponto_dispositivo_novo` cria exceção para
todo administrador a cada `INSERT` em `dispositivos_rep`, **menos** no `dispositivo_ponto_id` dele —
criar exceção ali faria o ponto real da pessoa parar de contar, o erro na direção contrária e o
único caro dos dois (`NULL` = não bate em relógio nenhum). ✅ Aplicada e conferida em produção em
25/08/2026: **13 exceções para os 13 relógios que não são o dele**, e nenhuma no dele.

⚠️ **A exceção age na ATRIBUIÇÃO e não alcança ponto já gravado** (armadilha 20) — a porta é
`marcacoes_tratamentos` com `tipo = 'desconsiderar'`. Conferido em 25/08/2026: das 6 batidas do
administrador em relógio com exceção, a de 17/08 (ENF-ZEZINHA) já estava desconsiderada e **duas
continuam na folha**: 15/08 11:24 (entrada do Plantão, CEI) e 24/08 07:33 (entrada do Regular,
USF-JBB). Diário em
[`docs/evolucao/2026-08-25-administrador-do-parque-e-a-excecao-que-nunca-disparava.md`](docs/evolucao/2026-08-25-administrador-do-parque-e-a-excecao-que-nunca-disparava.md).

⚠️ **Duas alternativas foram consideradas e descartadas**: encerrar o vínculo não resolve (no CEI
não havia vínculo nenhum), e restringir a resolução à unidade do dispositivo quebraria
**"Servidor Externo"** (v1.2.4), que é escalado numa unidade e lotado em outra.

### 14. Nem todo caminho que escreve na grade passa por `handleCellChange` (20/08/2026)

⚠️ **`ScaleGrid.tsx` tem três caminhos que escrevem em `gridData`, e só um deles valida.**
Digitar na célula passa por `handleCellChange` (validação local **+** RPC `fn_check_shift_conflicts`);
**Aplicar Template** e **Gerador Inteligente** escrevem direto no estado. Foi assim que um `MT`
apareceu no meio de umas férias: a célula recusava, o template não.

O dado nunca chegou ao banco — o trigger `fn_prevent_shift_during_event` (`BEFORE INSERT OR
UPDATE ON escala_diaria`, desde `20260601130000`) recusa cada linha, e a medição de 20/08/2026
achou **zero** linhas gravadas dentro de afastamento em 2.340 linhas de escala com 131
afastamentos. **Mas a recusa só chegava no "Salvar Previsão", e o upsert é em lote**: uma linha
inválida aborta o mês inteiro de todos os servidores da grade, com a mensagem crua do Postgres.
Ao acrescentar um caminho novo de escrita na grade, valide **antes** de salvar.

A regra de afastamento tem **fonte única no frontend**: `src/utils/afastamentos.ts`
(`encontrarAfastamentoBloqueante`), espelhando o SQL. Estava copiada em quatro telas, cada uma
com uma divergência própria. Três eixos, e os três precisam bater com o banco:

| eixo | regra |
|---|---|
| por **horas** (`periodo_tipo = 'horas'` ou `hora_inicio`) | **não bloqueia nada** — é a declaração de comparecimento (`20260817210000`); o servidor trabalha o resto do dia |
| por **slot** (`slots = ['M']`) | bloqueia só os turnos cujos slots cruzam o período; integral bloqueia qualquer turno |
| **categoria** | `Regular` e `Sobreaviso` sempre; `Plantão`/`Extra` conforme `permitir_plantao_extra_durante_eventos` (`false` em produção) |

⚠️ **`Sobreaviso` nunca foi coberto pelo nome daquela configuração** e ficava liberado junto com
plantão/extra quando ela era ligada — fechado em `20260820120000`, na mesma migration que faz
`fn_clean_conflicting_shifts` limpar `Sobreaviso` além de `Regular`. Diário em
[`docs/evolucao/2026-08-20-afastamento-e-aplicar-template.md`](docs/evolucao/2026-08-20-afastamento-e-aplicar-template.md).

⚠️ **Bloquear o dia inteiro em afastamento parcial foi considerado e descartado** (usuário,
20/08/2026): mataria a declaração de comparecimento por horas, que existe justamente para o
servidor continuar escalado no resto do dia.

### 15. A célula com ponto ficava congelada, e a dobra de plantão não tinha onde ser dita (21/08/2026)

⚠️ **`fn_check_shift_conflicts` conflitava a célula com ela mesma.** A busca do passo 3 varria
todas as linhas do servidor naquele dia **sem excluir a linha que estava sendo editada** — medido
chamando a RPC contra uma linha real de Plantão `MT`: digitar `MT` (o **mesmo** código já gravado)
devolvia "Conflito com o turno MT no setor ...", e `MT4`/`MTN` idem; só `N` passava, por não
compartilhar slot. Quem não tem ponto no dia contorna sem perceber (apaga a célula, salva, digita
de novo); **com ponto, apagar é barrado pelo "Direito Adquirido"** e o dia ficava impossível de
corrigir. `20260821100000` acrescenta `p_escala_mensal_id` e exclui `(escala_mensal, categoria,
dia)` — a chave exata de uma célula. NULL preserva o comportamento antigo; a detecção real
(mesmo servidor em **duas** escalas no mesmo dia com slots sobrepostos) continua intacta.

⚠️ **Dobra de plantão não precisa de duas linhas — o dicionário já tem o código combinado.**
`TN` (18h, slots `[T,N]`, âncora 13:00) é T 13–19 emendado no N 19–07; a família `T?N` termina
sempre às 07:00 e a `M?N` começa às 19:00. A grade guarda **um turno por (servidor, categoria,
dia)**, então dois plantões só coexistem em escalas diferentes — o que já funciona, porque
`fn_confirmar_presenca` monta bloco por servidor/dia **sem filtrar unidade** e funde os dois.

⚠️ **Trocar o turno de um dia com ponto exige justificativa, e a regra é do banco**
(`20260821110000`). `trg_registrar_troca_turno` recusa o UPDATE quando a linha tem ponto e nenhuma
justificativa foi publicada no GUC `sisescala.justificativa_turno`; `fn_alterar_turno_escala_diaria`
é o único caminho que publica. Mesmo padrão de `20260819230000` (troca de jornada): trigger como
rede de segurança, RPC para carregar o texto. O motivo vira linha em
`escala_diaria_turno_historico` (append-only, com `de → para`, autor e `tinha_ponto`) **e é
acrescentado** — nunca substitui — à justificativa daquele dia em `justificativas_eventos`, que é
o que o relatório de plantão imprime (decisão do usuário, 21/08/2026: as duas coisas são verdade).
Por isso o relatório precisa de `whitespace-pre-line`.

⚠️ **Dia SEM ponto continua livre** — é planejamento. E nenhum caminho em massa é afetado:
`generateTemplate` recebe `skipDays` e nunca gera turno para dia protegido por presença, e o
Gerador Inteligente pula `hasPresenceForDay`. O `handleSave` reenvia a mesma linha e o
`IS NOT DISTINCT FROM` sai na hora — mas uma **aba desatualizada** mandaria o turno antigo e
derrubaria o lote inteiro no trigger, então `handleSave` compara com o que buscou do banco antes
do upsert e recusa com mensagem específica.

### 16. Plantão vale as UNIDADES que contém, não a faixa da duração (21/08/2026)

⚠️ **`PL12`/`PL6`/`PL4` são unidades de pagamento, não faixas.** Não existe `PL24` nem `PL18`
porque nenhum plantão é pago assim: `MTN` (24h) é **2×PL12** e `TN` (18h) é **PL6 + PL12** —
regra do RH, confirmada pelo usuário. `calculateTotals` classificava o código **inteiro** por
faixa (`>=12 → PL12`) e multiplicava pela **faixa**: **44 dos 53 códigos** de plantão contavam
errado, e nos dois sentidos — `MTN` valia 12h em vez de 24, `TN` 12h em vez de 18, e `N1` (1h)
valia 4h. Todos os relatórios (RH, consolidado, plantão/sobreaviso) já somavam
`horas_computadas` direto, então a grade **discordava deles** na mesma competência.

Fonte única: **`src/utils/plantaoUnidades.ts`** (`decomporPlantao`). Quebra o código na estrutura
real de períodos (`TN`→[6,12], `MTN`→[12,12], `MT4`→[6,4], `M{n}N`→[n,12], `MT{n}`→[6,n]) e
converte cada pedaço em unidades, da maior para a menor. **O resto não vira unidade** — PL6
arredondado para cima é pagar plantão que não houve —, mas entra no TOTAL, que passa a ser a soma
exata. Não replicar essa regra na tela.

⚠️ **Medido em produção em 21/08/2026** (autorizado pelo usuário; 636 lançamentos de Plantão,
06–08/2026): só **10 códigos em uso** — `MT`(355) `T`(90) `T4`(81) `M`(66) `N6`(15) `N`(11)
`N4`(11) `MTN`(3) `TN`(3) `M7`(1). Sete não mudam nada. Os **7 lançamentos** que mudam (3 `MTN`,
3 `TN`, 1 `M7`, +55h) estão **todos em 08/2026** — 06 e 07, fechadas, exibem exatamente o mesmo
número de antes. **Nada é recalculado nem migrado**: o totalizador é derivado na renderização, e
o PDF (`ScalePrintView`) nem recebe essas colunas.

⚠️ Se `N8`/`N9` entrarem em uso, a quebra deles merece decisão do RH — 9h dá "PL6 + 3h soltas"
por esta regra, e "2×PL4 + 1h" desperdiçaria menos. Com um caso real (`M7`), não vale inventar.
### 17. O usuário do sistema e o cadastro de servidor não tinham vínculo nenhum (22/08/2026)

⚠️ **Até aqui a associação era recalculada a cada render, casando por e-mail OU por nome iguais**
(`usuarios/page.tsx`). A tela de usuários tinha um `<input type="hidden" name="servidor_id">` desde
sempre, e **nenhuma action jamais o leu** — escolher o servidor no formulário só autopreenchia nome
e e-mail; nada era gravado.

Consequência medida em produção: corrigir o e-mail na ficha do servidor **não** alcançava
`auth.users`. O login continuava com o valor antigo (a tela de usuários bloqueia editá-lo ali de
propósito), o casamento por e-mail quebrava e sobrava só o casamento por nome. Caso real: ALDENIR
DA SILVA BARBOSA logava com `...@gamil.com` (typo) enquanto a ficha já dizia `...@gmail.com`.

⚠️ **O estrago não parava na tela de usuários.** Três telas identificam o servidor logado por
`servidores.email = auth.email` — [`escalas/page.tsx`](src/app/(dashboard)/escalas/page.tsx),
[`escalas/unidade/[unidadeId]/page.tsx`](src/app/(dashboard)/escalas/unidade/[unidadeId]/page.tsx) e
[`ScaleGrid.tsx`](src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx) — então um usuário
de papel `comum`/`servidor` perdia acesso à própria escala assim que os dois e-mails divergiam.

✅ **Aplicada em produção em 22/08/2026**: 61 dos 63 usuários vinculados, **zero** servidores com
mais de um usuário. Ficaram de fora `admin@admin.com` (não é servidor) e PAULA DHESSICA — nome e
e-mail divergentes nos dois lados, então nenhum critério do backfill a alcança; resolve-se pela
sugestão que a tela de usuários passou a mostrar.

**Fonte única desde `20260822100000`: `profiles.servidor_id`** (índice único parcial —
1 servidor → no máximo 1 usuário; a maioria dos servidores não tem usuário, 499 para 63 em
22/08/2026). O casamento heurístico sobrevive **apenas como sugestão de exibição** para conta ainda
não vinculada, nunca como vínculo.

| regra | onde |
|---|---|
| e-mail do servidor propaga para `auth.users.email` do usuário vinculado | `updateServidor` |
| **só `super_admin`/`rh` propagam** — a alteração é RECUSADA para os demais | mesma régua de `isSuperAdminEditor` da transferência direta |
| conta que existe mas não foi vinculada é resgatada pelo **e-mail antigo**, e o vínculo é gravado | `updateServidor` |
| vincular/desvincular na criação **e** na edição do usuário | `createUser` / `updateUser` |

⚠️ **Trocar esse e-mail troca a CREDENCIAL DE LOGIN** — daí a restrição de papel. Sem ela, um
coordenador apontaria o login de um administrador para um endereço próprio e dispararia "esqueci
minha senha". Para quem não pode, a alteração é **recusada por inteiro** em vez de gravada pela
metade: deixar os dois lados divergentes é exatamente o defeito que a correção fecha.

⚠️ **O dropdown de servidores filtra por `status = 'Ativo'`, mas o vínculo tem que ser resolvido
mesmo para servidor inativado** — senão a página devolve `servidor_id: null` e o próximo "Salvar"
do formulário de edição **desvincula sozinho**. `usuarios/page.tsx` busca os vinculados que faltam
numa consulta à parte por isso.

Diário em [`docs/evolucao/2026-08-22-vinculo-usuario-servidor.md`](docs/evolucao/2026-08-22-vinculo-usuario-servidor.md).

### 18. O repositório é PÚBLICO — nenhum segredo pode encostar no código (22/08/2026)

🚨 `github.com/fmarculino/SisEscala` é **público** (com fork). Isso é uma escolha, não um
descuido — mas significa que **tudo** que entra num commit é publicado para sempre: o GitHub
preserva objetos de commits antigos, e um fork guarda o histórico inteiro. **Apagar do git não
desfaz um vazamento.** A única correção real é **rotacionar o segredo**.

Dois casos reais, achados na mesma varredura:

| o que | onde | gravidade |
|---|---|---|
| `service_role` JWT de **homologação**, literal | `scripts/corrigir_folhas_banco.mjs`, desde 19/08/2026 (`0f525c9`) | alta — ignora RLS por completo, válida até 2036. Detectada pelo GitGuardian em 21/08 |
| fallback `CRON_SECRET` embutido | `/api/cron` e `/api/avisos-ponto/despachar` | alta — `/api/cron` **fecha escalas e folhas**, e o valor estava no código público |

✅ **Chaves de PRODUÇÃO nunca entraram no histórico** — conferido varrendo todos os commits
(`git log --all -p`): existe **um único** JWT em toda a história do repositório, e é o de
homologação. `.env.local`/`.env.production` estão no `.gitignore` e nunca foram rastreados.

⚠️ **`process.env.X || 'valor-padrão'` num repositório público não é conveniência, é um segredo
publicado.** O padrão correto já existia no projeto e é o de `TERMINAL_LOCAL_SESSION_SECRET`:
**falhar explicitamente** quando a variável não está no ambiente. As duas rotas de cron passaram a
seguir esse padrão em 22/08/2026 — sem `CRON_SECRET` no Coolify elas devolvem **500** e o cron não
roda, o que é o modo de falha desejado.

⚠️ **Ao documentar um vazamento, não repita o valor vazado no comentário nem no runbook** — foi o
que quase aconteceu ao escrever esta seção. Descreva o que era, nunca qual era.

**Ao escrever script avulso em `scripts/`**, leia a chave de `.env.local` ou do ambiente e recuse
rodar sem ela. Nunca cole o valor, nem "só para testar": o commit é que publica, e ninguém lembra
de tirar depois.

### 19. Sair do relógio não tirava o vínculo — e a tela dizia que a pessoa estava lá (22/08/2026)

⚠️ **`rep_vinculos_servidor` nunca era reconciliado com o snapshot do equipamento.** A única
limpeza de vínculo vivia em `fn_confirmar_remocao_usuario_dispositivo`, que só alcança quem saiu
**pela fila de remoção**. Quem é apagado na telinha do relógio — ou nunca chegou nele — some do
equipamento e continua vinculado aqui, para sempre. Os dois lados são silenciosos:

| onde | o que acontecia |
|---|---|
| `fn_cobertura_ponto_dispositivo` | classifica por vínculo quando não acha a pessoa no snapshot → a aba **Cobertura da Escala** mostrava `ok` + "com biometria" com `identificador_afd` **nulo** |
| `fn_enfileirar_cadastros_rep` | pula quem tem vínculo vigente → "Sincronizar cadastros" **nunca** reenviaria essa pessoa |

Medido em 22/08/2026 — vínculo vigente cujo identificador não está no snapshot do próprio
dispositivo: **HMM-01 53** (relógio reaproveitado, 1.211 cadastros do sistema anterior, higiene de
1.157 + limpeza manual do resto), **ENF-ZEZINHA 7**, **SMS 2**, os outros 10 relógios **0**.

Fonte única desde `20260822200000`: **o snapshot é a verdade sobre quem está no equipamento.**
`fn_registrar_snapshot_usuarios_dispositivo` encerra (`vigente_ate`) o vínculo ausente da leitura e
devolve `vinculos_encerrados`. **Duas guardas que não podem sair:** lista **vazia** nunca reconcilia
(payload vazio é indistinguível de leitura que falhou — a rota cai para `[]`), e vínculo criado há
**menos de 15 min** é poupado (corrida entre ler o relógio, paginado de 100 em 100, e publicar o
snapshot).

⚠️ **A outra metade é obrigatória:** `fn_enfileirar_cadastros_rep` passou a pular também quem
**está no snapshot**, não só quem tem vínculo. Sem isso, encerrar vínculo órfão faria reenviar
cadastro de quem está no relógio **sob outro identificador** — 6 dos 7 casos do ENF-ZEZINHA —
duplicando cadastro no equipamento.

⚠️ **Encerrar vínculo não mexe em ponto passado** (a autoria é resolvida pelo vínculo vigente *na
data da batida*) e é reversível: reenviar o cadastro abre um vínculo novo, e
`fn_confirmar_cadastro_rep` já fecha o anterior antes de inserir. Nenhum dos 62 identificadores
tinha batida dentro da vigência.

ℹ️ Descartado por falta de caso real: sincronizar `tem_biometria` do vínculo com o snapshot.
Divergência medida nos 13 dispositivos: **0**. `fn_atualizar_biometria_vinculos` continua só
ligando, nunca desligando.

ℹ️ O achado que esta seção registrava como "sem correção" — a resolução de identidade não ter
vigência — virou a **armadilha 20**, logo abaixo.

### 20. Relógio reaproveitado traz o ponto de outro sistema, e ele entrava por CPF/PIS (22/08/2026)

⚠️ **A resolução de identidade não tinha vigência.** `fn_servidor_por_identificador_afd` cai para
CPF e depois PIS (`20260818200000`, o que resolveu a SMS) **sem olhar a data da batida** —
`p_vigente_de` só protege o caminho do **vínculo**, e a armadilha 10 fala dele como se fosse a
única porta. Então o AFD inteiro de um equipamento reaproveitado virava ponto atribuído **já na
ingestão**, sem erro nenhum:

| relógio | marcações com dono anteriores ao cadastro | mais antiga |
|---|---|---|
| HMM-01 | 3.714 | 2021 |
| USF-LARANJEIRAS | 2.362 | **2019** |
| HMI-01 | 1.366 | 2021 |
| USF-HIROSHI | 1.222 | 2023 |
| USF-DAA · USF-PC · USF-JPA | 964 | 2021–2024 |

**9.626 no total**, todas anteriores a 07/2026 — exatamente os sete relógios instalados em três
dias. Não é resíduo de uma instalação infeliz: era o comportamento padrão de toda instalação nova.
**Nada projetou em folha, e isso é sorte de calendário**: a escala mais antiga do SisEscala é de
07/2026. O próximo relógio pode chegar com batida do mês passado.

Fonte única desde `20260822210000`: **`dispositivos_rep.ponto_valido_desde`** (date), o dia em que
o SisEscala assumiu o ponto daquele relógio. A resolução recebe o instante da batida e devolve
`NULL` abaixo do corte — **antes** das três portas, porque nem vínculo explícito deve fazer o
SisEscala assumir ponto de outro sistema. Relógio novo nasce protegido (`DEFAULT` = hoje no fuso
configurado); a data é editável na tela do dispositivo, para a unidade que já registrava ponto
pelo terminal antes de ganhar o REP.

⚠️ **O corte age na ATRIBUIÇÃO, nunca na ingestão — e isso é o que o torna reversível.** A batida
continua em `rep_afd_registros` e continua virando `marcacoes_ponto`, só que **órfã**. Data errada
se conserta mudando a data e rodando `fn_reparse_afd_dispositivo`, que só mexe em órfã. Se a
ingestão deixasse de criar a marcação não haveria o que reprocessar. O preço é volume — o HMM-01
sozinho tem 69.619 marcações, quase todas órfãs; é o mesmo preço que a SMS já paga com ~250 mil.

⚠️ **`p_ocorrido_em` não tem `DEFAULT`, e a assinatura de 2 argumentos foi DERRUBADA.** Com
`DEFAULT`, as duas assinaturas conviveriam e qualquer chamada de 2 args passaria a pular o corte
**em silêncio**. Os callers são quatro e estão todos na mesma migration: `fn_ingerir_afd`,
`fn_reparse_afd_dispositivo`, `fn_registrar_snapshot_usuarios_dispositivo` (passa **NULL** — o
snapshot é cadastro, não batida, e quem está no relógio hoje continua reconhecido) e a própria
função.

⚠️ **`fn_reparse_afd_dispositivo(uuid)` — sobrecarga de 1 argumento — foi derrubada junto.** Ela
nasceu em `20260811190000` e nunca saiu quando a de 2 argumentos apareceu: as duas estavam vivas em
produção, e chamar a RPC só com `p_dispositivo_id` já devolvia `PGRST203` ("could not choose the
best candidate"). Depois do corte ela seria pior que ambígua — o corpo dela chamava a assinatura de
2 args da resolução, então explodiria em runtime.

⚠️ **O que ficou para trás continua atribuído.** `marcacoes_ponto` é INSERT-only e o único `UPDATE`
que o trigger libera é órfã → com dono (`20260818001000`) — **não existe caminho para tirar o
dono**, e não deve existir. A porta é `marcacoes_tratamentos` com `tipo = 'desconsiderar'`, que a
alocação já honra (o último `desconsiderar`/`restaurar` vence). Não foi feito: as 9.626 são inertes
e 9.626 tratamentos comprariam aparência de limpeza, não segurança.

ℹ️ **`fn_data_local()`** nasceu aqui só porque `DEFAULT` de coluna não aceita subconsulta e o fuso
mora em `configuracoes_globais`. `CURRENT_DATE` não serve: o banco roda em UTC, então nas últimas 3
horas de todo dia ele já é amanhã (armadilha 12) — e um corte um dia adiantado orfanaria as batidas
do próprio dia da instalação. As funções que já resolvem o fuso inline **não** foram convertidas.

**Ao instalar um relógio novo**, confira o corte com a consulta 3 da conferência de
`20260822210000` (quanto histórico alheio o equipamento trouxe e quanto dele ficou com dono).

### 21. Um dia pode ter MAIS DE UM afastamento, e todo mundo lia só o primeiro (24/08/2026)

⚠️ **`servidores_eventos` nunca proibiu dois eventos no mesmo (servidor, dia) — e não deve.** Uma
declaração de comparecimento pela manhã e outra à tarde são dois fatos, com horários e documentos
próprios. Mas a leitura era `afastamentos?.find(...)`, que devolve **o primeiro**, e isso estava
repetido nas quatro cópias da geração de folha **mais** a grade de escala.

Caso real medido (KETHURY CHAVES, 14/08/2026, USF ENFERMEIRA ZEZINHA): duas Declarações de
Comparecimento, uma `M` e outra `T`. A tela de Afastamentos mostrava as duas; a folha imprimia
`AFASTAMENTO PARCIAL: DECLARAÇÃO DE COMPARECIMENTO (M) | FOLGA`, e o anexo de ocorrências do verso
repetia o mesmo texto — **ele deriva de `folha_ponto.registros`, não consulta `servidores_eventos`**.
O lançamento nunca se perdeu; a leitura é que perdia. Silencioso dos dois lados.

✅ **Extensão medida em produção em 24/08/2026: 1 par (servidor, dia) em toda a base** —
expandindo as 164 linhas de `servidores_eventos` dia a dia, o caso relatado é o único, e a única
folha atingida estava em **Rascunho**. Nenhuma competência Fechada. Reconfira antes de decidir com
base neste número.

Fonte única desde então: **`src/utils/folha/afastamentosDia.ts`** — `afastamentosDoDia()` e
`descreverAfastamentos()`. Ela também recolheu `getAfastamentoNome`/`getAfastamentoObservacao`/
`isShiftOverlappingAfastamento`, que estavam **duplicados** entre `folha-ponto/actions.ts` e
`consultar-escala/actions.ts`. Diário em
[`docs/evolucao/2026-08-24-dois-afastamentos-no-mesmo-dia.md`](docs/evolucao/2026-08-24-dois-afastamentos-no-mesmo-dia.md).

⚠️ **A ordem precisa ser determinística, e não é a ordem de chegada.** As quatro consultas a
`servidores_eventos` não têm `ORDER BY` — sem desempate próprio, regerar a mesma folha duas vezes
podia trocar a ordem do texto num documento que o servidor assina. Integral primeiro, depois pela
hora de início, e o desempate final é pela própria descrição.

⚠️ **Só a EXIBIÇÃO virou plural; bloqueio continua binário.** `encontrarAfastamentoBloqueante`
sobrevive como envelope de `encontrarAfastamentosBloqueantes(...)[0]` e continua servindo os quatro
sítios da grade que só precisam saber *se* bloqueia (digitação na célula, aviso da linha, Aplicar
Template, Gerador Inteligente — armadilha 14). A célula, que não tem largura para dois rótulos,
mostra `VIS+1`; o tooltip lista todos.

⚠️ **Não funda descrições iguais.** Dois eventos do mesmo tipo saem como `... (M) + ... (T)`, e não
como `... (M, T)`: em documento comprobatório, um rótulo para dois lançamentos esconde que houve
dois.

⚠️ **Nada disso alcança folha já gerada.** `folha_ponto.registros` é snapshot (ver "A folha é um
snapshot"); a competência antiga só muda ao clicar em **Sincronizar**. Não houve migration — o
conserto é de leitura, e nenhum horário, hora normal ou falta se move.

### 22. Relatar o que foi CALCULADO em vez do que MUDOU (25/08/2026)

⚠️ **O Gerador Inteligente anunciava "111 turnos preenchidos" com ZERO células alteradas.** O
contador media a saída do motor; os dois `return` do merge (dia com ponto batido, dia de
afastamento) descartavam célula sem contabilizar nada. Caso real: TI da SMS, 08/2026 — 81 das
111 caíram por já ter ponto, e as 30 restantes já estavam lançadas com o mesmo turno. O usuário
procurou a escala e não achou. Diário em
[`docs/evolucao/2026-08-25-gerador-inteligente-quatro-linhas.md`](docs/evolucao/2026-08-25-gerador-inteligente-quatro-linhas.md).

**A regra vale além do gerador: nunca relate o que foi calculado; relate o que mudou, e por que
o resto não.** Toda tela que filtra depois de calcular tem esse buraco.

⚠️ **E o contador não pode viver dentro do updater do `setState`.** O React chama o updater na
fase de render, não na linha em que ele está escrito — a variável ainda vale zero quando a
mensagem a lê, e em modo estrito o updater roda duas vezes e dobra a conta. Faça a mesclagem
síncrona e mande só o resultado pronto.

⚠️ **Mais histórico deu MENOS acerto, e isso é contraintuitivo o bastante para estar aqui.**
Backtest de ponta a ponta (prever 08/2026, 96 setores, contando os 11 com competência anterior):

| histórico | Regular | Plantão | Extra |
|---|---|---|---|
| **1 mês** | **76,1% / 94,1%** | **50,6% / 75,8%** | **39,8% / 66,2%** |
| 3 meses | 68,7% / 93,4% | 45,0% / 73,6% | 36,7% / 69,1% |

O denominador da confiança cresce com cada mês somado, então quem foi consistente no mês passado
e diferente dois meses atrás cai **abaixo do limiar** e some da sugestão. Somar competências com
peso **igual** é pior ainda (84,6% → 81,4% de precisão) — o quadro muda, e o mês antigo vota
contra o recente. Daí os pesos 5/2/1 de `fn_estatistica_escala_setor` e o padrão de **1 mês**.
Só existem 3 competências na base; **refaça o backtest antes de mexer nesses números.**

⚠️ **Precisão vale mais que cobertura num sistema de ponto**, e é o que define os limiares por
categoria (`LIMIAR_CONFIANCA`: Regular 0,50 · Plantão 0,75 · Extra e Sobreaviso 1,00). Célula que
falta o coordenador preenche — é o trabalho normal dele. Célula sugerida a mais em Plantão ou
Extra é hora paga que ninguém decidiu, e ele precisa *caçar* para apagar. Sem limiar, o Extra
media 57,5% de precisão: **43% da hora extra que ele agendaria nunca aconteceu.** Por isso Extra
e Sobreaviso entram **desmarcados** na tela.

⚠️ **A estatística mora no banco (`fn_estatistica_escala_setor`, `20260825100000`) e não pode
voltar para o cliente.** Não é só desempenho: o maior setor tem 692 linhas de `escala_diaria` num
mês, três meses dão 2.076, e o PostgREST corta em 1000 **em silêncio** (armadilha 8) — a
estatística sairia errada sem erro nenhum na tela.

⚠️ **Mês extra gerado é gravado; o mês da grade não.** A competência aberta continua rascunho
local até "Salvar Previsão"; as seguintes não têm grade para segurá-las e vão ao banco como
**Rascunho**. Quatro travas em `persistirMesesGerados` que não podem sair: competência encerrada
é pulada, `escala_mensal` fora de Rascunho é pulada, **célula existente nunca é sobrescrita** (é
o que torna seguro rodar duas vezes) e dia de afastamento é removido antes — sem isso o trigger
`fn_prevent_shift_during_event` derruba o lote inteiro (armadilha 14).

⚠️ **Cada mês extra é previsto a partir do último mês REAL, nunca do mês anterior gerado.**
Encadear previsão sobre previsão multiplica o erro (~85% → 72% → 61% em três meses) e congela um
engano dentro dos meses seguintes. A exceção é o ciclo de passo fixo, que é determinístico e
precisa mesmo atravessar a virada.

### 23. O mesmo servidor em DOIS setores no mesmo horário, e a batida contando duas vezes (26/08/2026)

⚠️ **`fn_check_shift_conflicts` existe desde sempre, detecta o caso certo e tinha UM ÚNICO
chamador em todo o repositório:** `handleCellChange` — ou seja, só a digitação célula a célula.
**Aplicar Template**, **Gerador Inteligente** e **Salvar Previsão** nunca a consultaram, e **não
existia trigger nenhum no banco**. É a armadilha 14 um eixo adiante: lá o furo do template era
afastamento (fechado); aqui era sobreposição, e sem rede de segurança no banco.

Medido na base inteira (5 competências, 21.031 linhas de `escala_diaria`): **24 pares**
(servidor, dia) com a mesma pessoa em dois setores com slots sobrepostos, **a mesma marcação
projetada nas duas linhas** e **duas folhas contando o mesmo tempo** — CLEONEIDE (61399): 19 dias,
210h + 190h em 08/2026. Diário em
[`docs/evolucao/2026-08-26-sobreposicao-de-escala-entre-setores.md`](docs/evolucao/2026-08-26-sobreposicao-de-escala-entre-setores.md).

⚠️ **A grade JÁ SABIA.** `fn_get_monthly_occupancy` carrega a ocupação externa do mês inteiro no
`mount`, e `externalOccupancy` era usado **só para pintar a célula e montar tooltip**. O dado que
bloquearia já estava em memória — servia para avisar, nunca para recusar.

Defesas desde `20260826220000`, fonte única no frontend em **`src/utils/conflitoEscala.ts`**:

| camada | o que faz |
|---|---|
| `trg_escala_diaria_sem_sobreposicao_setor` | recusa no banco. É a única que sobrevive a chamada direta da RPC e a caminho de escrita novo |
| `conflitoEscala.ts` nos 3 caminhos de escrita | célula, Aplicar Template, Gerador Inteligente |
| barreira do `handleSave` | **relê a ocupação do banco** — aba desatualizada é o caso que a checagem local não cobre |

⚠️ **O critério é slot SOBREPOSTO, nunca "mesmo dia".** Dobra em outro setor é legítima e medida:
9 pares adjacentes (ERIKA, 09/2026, `Regular MT` + `Plantão N` em setores diferentes). Proibir
por dia quebraria o que o dicionário de turnos existe para suportar (armadilha 15).

⚠️ **O guard de `UPDATE` do trigger não é otimização, é corretude.** `handleSave` faz upsert da
linha INTEIRA (presença incluída) a cada "Salvar Previsão", e 20+ migrations têm funções que dão
`UPDATE` em `escala_diaria` só para gravar presença. Sem o `IS DISTINCT FROM` sobre
`escala_mensal_id/dia/categoria/dicionario_turnos_id`, **toda batida do terminal atravessaria a
checagem** e qualquer linha em conflito passaria a **derrubar o registro de ponto**.

⚠️ **Limpar tem que vir ANTES de ligar a trava** — com as linhas sobrepostas no lugar, os setores
envolvidos não conseguem salvar nada na competência.

⚠️ **Apagar a linha de `escala_diaria` não basta.** O "validar dias passados" do template grava
presença na grade, e o trigger de `20260808070000` converte isso em `marcacoes_ponto` sintéticas
`ajuste_coordenador` — **uma série por setor** (128 da CLEONEIDE, 27 do FAGNER em 08/2026, contra
5 e 7 batidas reais). `marcacoes_ponto` é INSERT-only: a porta é `marcacoes_tratamentos` com
`desconsiderar`.

⚠️ **Limpar a célula na grade desconsidera TAMBÉM a batida real.** A reversão automática
("Presenca revertida em escala_diaria") registra `desconsiderar` sobre o horário sintético **e**
sobre a batida de terminal. Se o dia ficar com o setor certo depois, a batida real precisa voltar
por `restaurar` — o último tratamento por `created_at` é o efetivo. **Só batida real volta**;
declaração retirada pelo coordenador continua retirada.

### 24. `GRANT ... TO authenticated` nunca restringiu nada — o REVOKE tem que ser de PUBLIC (27/08/2026)

🚨 **Medido em produção: 369 das 394 funções do schema eram executáveis por `anon`** — sem login
nenhum. Entre elas `fn_confirmar_presenca`, `fn_confirmar_presenca_manual`,
`fn_atestar_jornada_bulk` e `fn_registrar_ponto`: dava para **gravar presença em folha de ponto
com a chave anon**, que vai no bundle do navegador.

⚠️ **A causa é o padrão usado em todo o projeto.** No PostgreSQL, `CREATE FUNCTION` já concede
`EXECUTE` a **PUBLIC**. Escrever `GRANT EXECUTE ... TO authenticated, service_role` é inofensivo
e **inútil como restrição**: quem não está na lista continua entrando por PUBLIC. As únicas
funções que estavam fechadas eram as que escreveram `REVOKE ... FROM PUBLIC`
(`fn_ingerir_afd`, `fn_autenticar_*`, `fn_registrar_ponto_terminal_local`).

⚠️ **E `REVOKE` de quem NÃO é dono da função não falha: emite `WARNING` e segue.** A primeira
correção (`20260827030000`) "aplicou com sucesso" e não mudou **nada** — só se descobriu medindo
por fora. Desde então **toda migration de privilégio confere o próprio resultado**
(`has_function_privilege`) e **aborta** se ele divergir; a mensagem traz banco, usuário e o dono
de cada função pendente, que separa "rodei no banco errado" (armadilha 3) de "não sou o dono".

⚠️ **A verificação precisa olhar os DOIS sentidos.** Revogar demais derruba a tela do coordenador
com a mesma discrição: `20260827050000` aborta tanto se `anon` continuar entrando quanto se uma
função que a tela usa **perder** `authenticated`.

| grupo | regra |
|---|---|
| ninguém no app chama direto (só envelopes `SECURITY DEFINER`) | `REVOKE FROM PUBLIC, anon, authenticated` + `GRANT TO service_role` |
| a tela chama com usuário logado | `REVOKE FROM PUBLIC, anon` + **reafirmar** `GRANT TO authenticated` |
| rota de máquina (`CRON_SECRET`, HMAC do coletor, `createAdminClient`) | só `service_role` |

⚠️ **Não feche o que é público por desenho.** `accept_sobreaviso_call`,
`decline_sobreaviso_call`, `mark_sobreaviso_timeout` e `register_sobreaviso_arrival` são
chamadas por `/sobreaviso/[token]` **sem login** (`createClient` do navegador) — revogar ali
quebra o ciclo de sobreaviso inteiro. A defesa delas é o `magic_token` que todas exigem, não o
privilégio de execução.

ℹ️ **Duas contagens diferentes, e a confusão é fácil:** `pg_proc` diz 818 de 890 abertas a anon,
mas isso inclui as centenas de funções do PostGIS e as de **trigger** — que o PostgREST **não
expõe como RPC**. O que é alcançável de fora são as **324** que aparecem no OpenAPI com a chave
anon (`GET /rest/v1/` com `apikey: <anon>`). Função que retorna `trigger` não precisa de REVOKE.

**Ao criar função nova, escreva o `REVOKE ... FROM PUBLIC` na mesma migration** — é o único
momento em que você é comprovadamente o dono.

### 25. `fn_atestar_jornada_bulk` anunciava "0 registro(s)" mesmo tendo gravado (27/08/2026)

`fn_confirmar_presenca_manual_bulk` devolve **`processed_count`** (assim desde
`20260804040000`) e `fn_atestar_jornada_bulk` lia `total_processed`, que nunca existiu — nas
duas versões dela (`20260808120000` e `20260808130000`). O `COALESCE` resolvia para 0 sempre.

Nada era gravado errado; o que quebrava era a confiança de quem clicou — a Validação em Massa
funcionava e dizia que não tinha feito nada. É a armadilha 22 na forma pior: **relatar zero
quando mudou**. Corrigido em `20260827020000`.

## Papéis de RH: Geral vs da Unidade (12/08/2026)

`role = 'rh'` ("RH Geral") enxerga tudo; `role = 'rh_unidade'` ("RH da Unidade") é escopado por
`profile_unidades`, com acesso automático a **todos os setores** das unidades vinculadas (nunca
setor por setor — `acesso_todos_setores` é forçado no servidor pra esse papel em
`usuarios/actions.ts`, e a RLS de `escala_mensal`/`escala_diaria`/`folha_ponto`/
`servidores_eventos` também não exige essa flag pra ele especificamente). Ver
[`docs/evolucao/2026-08-12-desdobramento-do-perfil-rh.md`](docs/evolucao/2026-08-12-desdobramento-do-perfil-rh.md).

⚠️ **Duas formas de escopo coexistem no projeto, e um papel novo precisa das duas.** A maioria
das telas do dashboard usa `applyAccessFilters` (`src/utils/permissions.ts`), que monta a query
certa a partir de `permitted_unidades`/`permitted_setores`/`acesso_todas_unidades`/
`acesso_todos_setores` — mas é só o filtro do **lado do cliente**. A RLS é quem de fato restringe
os dados, e nem toda tabela reconhece todo papel: `escala_mensal`/`escala_diaria`/`folha_ponto`
tiveram suas policies escritas citando só `admin`/`coordenador` (`20260618080000`) **antes** de
`rh` existir (`20260811130000`, quase dois meses depois) — e nenhuma migration atualizou essas
policies até `20260812070000`. Resultado: `rh` tinha bypass total em `applyAccessFilters` (excesso
de acesso em várias telas) e ZERO linhas nessas três tabelas via RLS (falta total de acesso nas
telas que mais importam pra esse papel — `/escalas`, `/folha-ponto`, `/relatorios/rh`), ao mesmo
tempo. **Ao criar um papel novo, busque por `= ANY(ARRAY['admin'::user_role, 'coordenador'::user_role])`
nas migrations** pra achar toda policy que precisa do papel novo — não confie em `applyAccessFilters`
sozinho pra saber o que o papel alcança.

⚠️ **"Vincular a uma unidade garante acesso a todos os setores dela" nem sempre é verdade.** Nas
policies que checam `unidade_id IN profile_unidades` (ex.: `servidores`, `escala_mensal` antes de
`20260812070000`), essa condição normalmente vem **E**'d com `acesso_todos_setores = true` — só o
branch `setor_id IN profile_setores` funciona sem a flag. A nota que existe há tempos na tela de
Usuários promete o contrário; ela só era verdade nas tabelas que não checam papel (`servidores`).
Um papel pensado como "toda unidade vinculada, sem setor por setor" (como `rh_unidade`) precisa ou
de um branch de RLS próprio que não exija a flag, ou forçar `acesso_todos_setores = true` no
servidor sempre que esse papel for escolhido — os dois foram feitos pra `rh_unidade`.

### O RH passou a cadastrar usuários, e a tela nunca foi a defesa (22/08/2026)

`/usuarios` era `super_admin` puro. Desde 22/08/2026 **RH Geral e RH da Unidade também abrem a
tela** (item "Usuários" liberado dentro do grupo SISTEMA do menu; Configurações, Backup e
Segurança continuam exclusivos). **Diretor, Coordenador e Ass. Administrativo continuam de fora**
— decisão do usuário.

🚨 **O que a abertura revelou: NENHUMA das cinco server actions daquele arquivo conferia papel.**
`createUser`/`updateUser`/`resetPassword`/`deleteUser`/`toggleUserStatus` usavam `service_role`
direto, e a única autorização era o `if` da página. Server action é um POST cujo id sai no bundle
— qualquer autenticado podia criar um Administrador Geral para si. É a armadilha 12 outra vez
("tela filtrada não protege a RPC"), agora do lado do Next. Cada action passou a autorizar sozinha.

Fonte única das regras: **`src/utils/gestaoUsuarios.ts`**, aplicada nos três lugares — página (o
que a lista mostra), client (o que o `<select>` oferece) e actions (o que o servidor aceita).

| gestor | vê / administra | pode atribuir |
|---|---|---|
| `super_admin` | todos | todos |
| `rh` | todos, **menos** `super_admin` | todos menos `super_admin` |
| `rh_unidade` | só conta cujo escopo **cabe inteiro** dentro das unidades dele | `ass_adm`, `coordenador`, `rh_unidade` |

⚠️ **A lista de papéis do `rh_unidade` não é conservadorismo, é o fecho da escalada.** `rh` tem
bypass total em `applyAccessFilters` e `admin` carrega gestão ampla — criar uma conta dessas com
senha que ele mesmo define contorna o próprio escopo em um clique. Pelo mesmo motivo ele não
concede `acesso_todas_unidades` (a caixa "Acesso Total" some da tela **e** a action recusa).

⚠️ **A regra de gravação é uma só, e vale para criar e editar: o gestor não pode deixar no ar uma
conta que ele mesmo não enxergaria** (`validarPayload` chama `alcancaUsuario` sobre o resultado).
Isso resolve papel, "Acesso Total" e unidades/setores de uma vez, sem três listas de exceção. Em
`updateUser` o alcance é conferido **sobre o estado ATUAL** do alvo *antes* do payload — senão um
RH da Unidade "puxaria" uma conta de outra unidade para dentro do escopo só mandando as unidades
certas no formulário.

⚠️ **Conta vinculada só por `profile_setores` conta como sendo da unidade** (o caso do coordenador
sem a unidade-pai, ver `fn_unidade_alcancavel_por_setor`). O mapa setor→unidade vem dos setores já
carregados pela tela/action; setor desconhecido é tratado como **fora** do escopo — a dúvida fecha.

**Excluir usuário continua só com o Administrador Geral** (é irreversível e não gera log). O RH
inativa, que é reversível e auditado. Redefinir senha e ativar/inativar valem dentro do escopo.

⚠️ **`profiles` tem que ser lido pelo client ADMIN nessa tela.** A policy "Users can view own
profile" só libera a tabela inteira para `super_admin` — com a sessão do RH, a consulta devolvia
**uma linha só**. Quem restringe a lista é o filtro de escopo em JS, não a RLS.

⚠️ **`supabase.auth.admin.listUsers()` devolve no máximo 50 contas, em silêncio** (perPage padrão
do supabase-js — o mesmo tipo de corte da armadilha 8). Com 63 contas em produção, **13 pessoas
não apareciam** em `/usuarios`, e a checagem de e-mail duplicado de `updateServidor` deixava passar
conflito que o Auth recusaria logo depois. Fonte única desde 22/08/2026:
`listarTodosUsuariosAuth` (`src/utils/authAdmin.ts`), que pagina. **Nunca chame `listUsers()` cru.**

Portão (não há framework de teste): `node scratchpad/sim_gestao_usuarios.js` — 34 casos de
alcance/payload/exclusão. Transpile antes com
`npx tsc src/utils/gestaoUsuarios.ts --outDir scratchpad/_sim --module commonjs --target es2020`.

Diário em [`docs/evolucao/2026-08-22-gestao-de-usuarios-pelo-rh.md`](docs/evolucao/2026-08-22-gestao-de-usuarios-pelo-rh.md).

### RH também AVALIA transferência, e a policy que dizia `só super_admin` nunca restringiu (28/08/2026)

Aprovar/rejeitar um pedido de transferência de unidade/setor deixou de ser exclusividade do
Administrador Geral: **RH Geral (`rh`) avalia qualquer pedido; RH da Unidade (`rh_unidade`) avalia
dentro das unidades dele**. Os demais papéis continuam apenas **solicitando**.

🚨 **A policy `Avaliacao de solicitacoes_transferencia so super_admin` (`20260811110000`) nunca
restringiu nada.** Policies permissivas se somam com `OR`, e `20260818100000` criou na MESMA tabela
uma policy **`FOR ALL`** (ampliada para `ass_adm` em `20260818170000`). `FOR ALL` cobre `UPDATE`, e
sem `WITH CHECK` próprio ele cai para o `USING` — então **`admin`, `coordenador`, `rh_unidade` e
`ass_adm` podiam marcar um pedido como `aprovada` chamando o PostgREST direto**. O que os segurava
era o `if` da server action. É a **armadilha 24 em outra forma**: a policy estrita existe, e a
permissiva ao lado dela é que decide. `20260828100000` derruba a `FOR ALL` e escreve `SELECT`,
`INSERT` e `UPDATE` separados — quem SOLICITA não perde nada.

Fonte única da regra: **`src/utils/avaliacaoTransferencia.ts`**, aplicada nos três lugares — tela
(`podeAvaliar` resolvido no servidor, linha a linha), action (mensagem legível) e policy de
`UPDATE` (o que o banco grava).

⚠️ **`rh_unidade` aprova só com ORIGEM *e* DESTINO no escopo dele.** A policy de escrita de
`servidores` (`Scoped access for Admins and Coordinators`) só aceita `unidade_id ∈ profile_unidades`
nesse braço, e o `WITH CHECK` roda sobre a linha **nova** — transferência para outra unidade seria
recusada lá de qualquer forma, com o sintoma mudo *"Nenhuma alteração foi gravada"*. Rejeitar não
escreve em `servidores`, então basta a origem. E **`acesso_todas_unidades` NÃO vale como bypass**
para esse papel: aquele braço da policy não o reconhece, e honrá-lo aqui aprovaria o pedido para o
`UPDATE` de `servidores` falhar em seguida — o defeito de 10/08/2026 (KETTELE) de volta.

⚠️ **O destino é conferido pelo valor FINAL**, o do pedido ou o que o avaliador acabou de escolher
no `<select>` da aprovação — checar só o do pedido deixaria o RH da Unidade mandar alguém para fora
do escopo pelo próprio formulário.

⚠️ **`updateServidor` não mudou**: `super_admin` e `rh` transferem direto, todos os demais
(`rh_unidade` incluído) solicitam. E **`historico_transferencias` ficou de fora** — a `FOR ALL` de
lá tem a mesma folga, mas aquilo é log: escrever nele não move ninguém. Pendência conhecida.

⚠️ **Nome de setor sozinho não identifica setor, e a saída que estava sendo usada era batizar o
dicionário de "BLOCO A SHL".** "BLOCO A" existe embaixo de mais de um pai, e a linha da
transferência (`UNIDADE / SETOR`) e os `<select>` mostravam só a folha — escrever a hierarquia
dentro do nome duplica no cadastro o que o `parent_id` já sabe. **`buildSectorPathMap` /
`formatSectorPaths` (`src/utils/sectors.ts`)** montam o caminho completo (`SHL \ BLOCO A`).
Separador é **barra invertida** de propósito: a tela já usa `" / "` entre unidade e setor, e
repetir a barra normal apagaria essa fronteira. **Não substituem `formatSectorsHierarchy`** — o
recuo com `↳` serve para lista curta, onde o pai fica na linha de cima; o caminho serve para texto
solto e `<select>` longo, onde o pai sai da tela ao rolar.

⚠️ **O embed `setores(dicionario_setores(nome))` só traz a FOLHA** — é por isso que o caminho não
sai de graça em nenhuma consulta. `buscarCaminhosDeSetor(supabase)` faz a busca da árvore inteira
(paginada, armadilha 8: são 645 setores em 08/2026, perto demais do teto de 1000) e devolve o mapa
`id → caminho`. **Sem filtro por unidade de propósito**: bastaria um pai cadastrado em outra
unidade para o caminho do filho ficar curto, parecendo certo.

Aplicado até aqui em: `/servidores/pendencias` (linha da transferência, "sem CPF" e os dois
`<select>`), `/escalas` (label do card, busca por servidor e a seta "Próxima", todos via
`buscarEscalasMensais` — `setor_nome` nasce lá) e `/escalas/unidade/[id]` (cabeçalho "Setor:" e o
cabeçalho do PDF). **Ainda mostram só a folha** e são a fila natural: `/folha-ponto`,
`/afastamentos`, `/ferias-licencas`, `/justificativas`, `/marcacoes`, `/servidores` (lista e
ficha), `/auditoria` e os relatórios.

⚠️ **Nessa mesma passada apareceu um filtro que nunca filtrou:** os dois `<select>` de setor de
`/servidores/pendencias` fazem `.filter(s => s.ativo !== false)` para não oferecer setor
desativado, mas `page.tsx` montava a lista sem repassar `ativo` — e `undefined !== false` é
**sempre true**, então os 17 setores inativos continuavam aparecendo. O comentário no componente
descrevia um comportamento que o dado não sustentava. Ao montar lista para componente que filtra
por campo, **confira que o campo chega lá**.

Portões: `node scratchpad/sim_avaliacao_transferencia.js` (14 casos) e
`node scratchpad/sim_caminho_setor.js` (caminho, órfão, ciclo em `parent_id`, preservação de
`ativo`). Transpile antes com
`npx tsc src/utils/avaliacaoTransferencia.ts src/utils/sectors.ts --outDir scratchpad/_sim --module commonjs --target es2020`.
Diário em [`docs/evolucao/2026-08-28-avaliacao-de-transferencia-pelo-rh.md`](docs/evolucao/2026-08-28-avaliacao-de-transferencia-pelo-rh.md).

### 26. O teto de 300h era da GRADE, e a pessoa tem várias escalas (28/08/2026)

⚠️ **`configuracoes_globais.max_horas_escala_servidor` (300h) sempre foi um limite DA PESSOA no
mês, e a única conta que o defendia era a do SETOR.** `handleCellChange` simulava contra
`calculateTotals(servidorId)`, que soma o `gridData` daquela grade — servidor escalado em dois
lugares tinha duas contas dentro do teto e uma soma fora dele, com as duas telas mostrando um
número válido.

Caso real medido em produção: **JEANE CONCEICAO SILVA**, 09/2026, HMI — `SHL \ ACOLHIMENTO` 289h +
`SHL \ LAVANDERIA` 120h = **409h**. Mais EDIVONETE 314h e ERIKA SOUZA 302h, todas na mesma
competência. Plano em
[`docs/planos/2026-08-28-limite-de-horas-consolidado-entre-escalas.md`](docs/planos/2026-08-28-limite-de-horas-consolidado-entre-escalas.md).

⚠️ **E `handleCellChange` era o ÚNICO chamador da checagem em todo o repositório** — Aplicar
Template, Gerador Inteligente e `persistirMesesGerados` escrevem direto no `gridData` e nunca
consultaram o teto, nem dentro do próprio setor. É a **armadilha 14 e a 23 num terceiro eixo**: lá
o furo do template era afastamento (`20260820120000`) e sobreposição entre setores
(`20260826220000`); aqui era carga horária. **Não existia nada no banco** — `max_horas_escala_servidor`
aparecia em UMA migration, a que cria a chave.

✅ **Medido em 28/08/2026, e é o que tornou a correção barata:** `excecoes_escala_servidor` tinha
**0 linhas** em produção inteira — ninguém nunca exerceu o teto. E o problema **explodiu agora**: 49
servidores em 2+ escalas em 09/2026, contra 2 ou 3 em 06, 07 e 08.

| peça | onde |
|---|---|
| carga escala a escala do servidor no mês | **`fn_carga_mensal_servidor`** (`20260828120000`) |
| teto efetivo (global + autorização) | **`fn_teto_carga_servidor`** — as duas recebem **lista** de servidores |
| caminho do setor em SQL | `fn_setor_caminho`, espelho de `buildSectorPathMap` |
| fonte única do frontend | **`src/utils/limiteCargaMensal.ts`** (`avaliarCarga`, `descreverExcesso`, `avisoAoAdicionar`) |
| relatório fora da grade | `fn_carga_mensal_consolidada` (`20260828130000`) → `/relatorios/carga-consolidada` |

⚠️ **A Autorização Extraordinária passou a ser UMA por (servidor, mês, ano)** — a chave era
`(servidor, unidade, mês, ano)`. Com o teto consolidado, duas unidades concederiam +100h cada e o
teto viraria 500h sem que ninguém decidisse isso. `unidade_id` fica como registro de **onde** a
autorização foi dada. `fetchExcecoesEscala` perdeu o filtro por unidade pelo mesmo motivo: filtrar
faria uma grade ignorar a autorização concedida a partir do outro setor.

⚠️ **A escala DESTA grade é excluída da carga vinda do banco e substituída pelo total local.** O
banco tem o que foi salvo, a grade tem o que está sendo lançado — somar os dois conta o mesmo turno
duas vezes. Mesmo motivo de `encontrarConflitoExterno` receber `escalaMensalId`.

⚠️ **NÃO replicar `decomporPlantao` (armadilha 16) no SQL da agregação, e tentar isso é o erro.** O
total de `calculateTotals` é `pl12*12 + pl6*6 + pl4*4 + avulso`, que é **exatamente
`SUM(horas_computadas)`** — as unidades PL existem para as COLUNAS de pagamento, nunca para o total.
Somar por faixa de duração ali reintroduziria, dentro da trava, o bug de 21/08/2026 (44 dos 53
códigos contando errado).

⚠️ **Não há trigger no banco, e isso é decisão registrada** — o comportamento é aviso + autorização
do administrador, e um trigger duro exigiria a exceção gravada **antes** do upsert em lote, o que
inverte a ordem do fluxo. Consequência: a barreira do `handleSave` é a **última** defesa, então ela
**recusa em caso de falha de rede** (ao contrário da de sobreposição, que pode deixar passar porque
o trigger segura).

⚠️ **`calculateTotals` ganhou um segundo parâmetro `override`** para simular um lançamento antes de
escrevê-lo. Sem ele, Template e Gerador teriam que reimplementar a fórmula de horas — inclusive o
teto líquido da jornada, que é fácil de esquecer.

⚠️ **O motor de compliance tem o MESMO ponto cego e continua com ele.** `runComplianceCheck`
(`complianceEngine.ts`) recebe só o `gridData` local, então **interjornada e DSR não enxergam o
outro setor**: a mesma pessoa pode ter `MT` num setor e `N` no outro em dias vizinhos sem nenhum
dos dois alertas disparar. Fora do escopo da correção de 28/08/2026.

Portão: `node scratchpad/sim_limite_carga.js` (45 casos). Transpile antes com
`npx tsc src/utils/limiteCargaMensal.ts --outDir scratchpad/_sim --module commonjs --target es2020`.
Medição em produção: `node scratchpad/an_limite_horas.mjs`.

### 27. Excluir setor com vínculo é FUSÃO, e cascata está descartada (29/08/2026)

⚠️ **`fn_excluir_setor` (`20260827010000`) só alcança setor sem vínculo nenhum, e isso é quase
nada.** Medido em produção em 29/08/2026 chamando `fn_dependencias_setor` para os **646** setores:
apenas **200** eram excluíveis, e dos **16 já inativos** — os que alguém quer justamente tirar do
cadastro — **7 estavam presos**. A recusa listava os vínculos e não oferecia ação nenhuma.

**`fn_fundir_setor(origem, destino)` (`20260829110000`)** move TODO vínculo para outro setor da
mesma unidade e só então apaga. Varredura dinâmica de `pg_constraint` (14 colunas de FK com uso
real hoje), pelo mesmo motivo de `fn_dependencias_setor`: as tabelas base não estão versionadas.

🚨 **Cascata foi considerada e descartada, e não deve voltar.** As três maiores tabelas presas ao
setor são `marcacoes_ponto` (26.834 linhas), `escala_mensal` (1.658) e `servidores` (1.396) —
apagar em cascata é destruir registro de ponto, que é prova legal (Portaria 671/2021), para
resolver problema de cadastro.

⚠️ **A fusão RECUSA em bloco em vez de "dar um jeito"** (`fn_impedimentos_fusao_setor`, consultada
pela tela a cada troca do `<select>`): destino em outra unidade (mover servidor/escala de unidade
é **transferência**, tem tela e regra próprias), destino que é **subsetor** da origem (viraria pai
de si mesmo — ciclo em `parent_id` trava toda montagem de árvore), o mesmo servidor com escala nos
**dois** setores na mesma competência (unique de `escala_mensal`; juntar contaria as horas duas
vezes na folha, armadilha 23) e qualquer outra colisão de unicidade. As **duas** exceções em que a
colisão é descartada são `profile_setores` e `dispositivos_rep_setores`: a linha não tem dado
próprio, ela **é** o par.

🚨 **A migration abre a PRIMEIRA exceção no trigger de imutabilidade da marcação, e ela é estreita
de propósito.** Sem isso, os **107 setores** que já tiveram batida seriam infundíveis (a FK barra o
DELETE). O ramo novo de `fn_bloquear_alteracao_marcacao` exige o GUC `sisescala.fundir_setor`
(local à transação, como o `sisescala.reparse_afd`) **e** que o UPDATE altere exclusivamente
`setor_id` — a comparação é `to_jsonb(NEW) - 'setor_id' = to_jsonb(OLD) - 'setor_id'`, estrutural,
não uma lista de campos que envelhece: horário, servidor, origem, dispositivo e NSR continuam
impossíveis de alterar aí **mesmo depois de a tabela ganhar coluna nova**. Ao recriar essa função,
**os dois ramos precisam continuar** (reparse de AFD e fusão) — armadilha 1.

ℹ️ Conferido antes: `trg_enfileirar_aviso_ponto` e `trg_reconciliar_apos_marcacao` são **AFTER
INSERT**, então a fusão não dispara aviso nem reconciliação para as 26.834 marcações.

### 28. Inativo tem que sair da ESCOLHA e ficar no FILTRO (29/08/2026)

⚠️ **Desativar unidade ou setor não alcançava os formulários.** O `<select>` de unidade do modal do
Dispositivo REP listava as 33 unidades sempre, a inativa junto — escolher uma cria vínculo novo com
cadastro que alguém já aposentou, sem a tela dizer nada.

Fonte única: **`src/utils/opcoesAtivas.ts`** (`opcoesParaEscolha`, `rotularInativo`).

| onde | regra |
|---|---|
| escolher **onde algo vai ficar** (relógio, terminal, escopo de usuário, transferência, lotação) | inativo **não é oferecido** |
| filtro de listagem e relatório | inativo **continua listado**, rotulado `(inativo)` |

⚠️ **Filtrar na CONSULTA é o erro oposto, e era o que o modal do REP já fazia com setores:** o
relógio que atende um setor depois desativado continua atendendo, com a caixa **invisível** na
única tela que gerencia aquilo. Por isso `listarOpcoesFormulario` devolve tudo com a flag `ativo`
e quem esconde é a tela — que conhece a seleção atual.

⚠️ **O já selecionado NUNCA some**, mesmo inativo: tirá-lo faz o `<select>` exibir vazio para um
registro que aponta para ele, e o próximo "Salvar" grava a troca que ninguém pediu.

⚠️ **Em `usuarios/page.tsx` a consulta não pode filtrar por `ativo`** por um motivo a mais: o mapa
setor→unidade dali alimenta a checagem de escopo, e setor desconhecido é tratado como FORA do
escopo — o RH da Unidade perderia de vista a conta vinculada a um setor desativado.

Medido em 29/08/2026: **1 unidade inativa** de 33, **16 setores inativos** de 646, nenhum setor
ativo pendurado em unidade inativa ou em pai inativo.

### 29. Seleção de setor em árvore, e "toda a unidade" como MODO (29/08/2026)

**`src/components/setores/SeletorSetoresArvore.tsx`** — marcar um pai marca todos os descendentes,
estado parcial no pai, expandir/recolher, marcar todos/limpar e filtro por nome. O HMM tem **196
setores em 40 raízes e 3 níveis**; a lista plana anterior mostrava a hierarquia só como recuo no
texto e obrigava a marcar dezenas de caixas uma a uma.

⚠️ **"Toda a unidade" deixou de ser `setorIds.length === 0`.** Derivado da lista vazia, o botão
"Limpar" da árvore trocava o significado do formulário sozinho: desmarcar o último setor voltava
para "toda a unidade" e a árvore sumia. O banco continua guardando as duas coisas igual (nenhuma
linha em `dispositivos_rep_setores`), mas salvar sem setor nenhum agora é **recusado**.

⚠️ Durante a busca o ramo fica **sempre aberto** — recolher esconderia justamente o que casou.

A tela **/setores** ganhou o mesmo tratamento (expandir/recolher tudo por unidade, e o card da
unidade inteiro recolhível — são 33 unidades na página). O estado guardado ali é o **recolhido**,
nunca o aberto: o padrão continua tudo aberto e unidade nova não nasce escondida.

⚠️ **A busca daquela tela mostrava o subsetor SOLTO na raiz da unidade.** O filtro derrubava o pai
que não casava com o termo, e o laço da árvore promove a raiz todo setor cujo pai não está na
lista — a busca respondia "onde está" tirando a resposta. Os **ancestrais de quem casou** entram
na lista mesmo sem casar; ao mexer nesse filtro, não recorte o ramo pelo meio.

### 31. O histórico de sobreaviso oferecia acionar plantão vencido (29/08/2026)

⚠️ **O modal "Histórico de Acionamentos" trazia "Novo Acionamento neste Dia" sempre habilitado**,
inclusive em plantão de semanas atrás. Era decisão consciente da Fase 8 (a heurística de janela do
frontend divergia da do banco, então tirou-se a heurística e deixou-se a RPC recusar "com o
horário exato"). A metade que não se sustentou: num dia passado o botão **convida** a fazer algo
impossível, e quem clica só descobre depois de escrever o motivo.

✅ Nada era gravado — `fn_acionar_sobreaviso` já recusa fora da janela. O defeito era de oferta.

**A correção não reintroduz heurística:** o modal consulta `fn_janela_sobreaviso_dia` (a MESMA que
autoriza a gravação) pela linha de `escala_diaria` do dia e desabilita o botão fora do intervalo,
**com** a janela exata escrita ao lado — botão cinza sem explicação continua proibido. O caminho
para registrar atendimento passado segue sendo **Validar Este Chamado (Manual)**.

⚠️ **"Reenviar Notificação / Link" leva a mesma trava**: ele REABRE o modal de acionamento com o
motivo preenchido (gera chamado novo), não é reenvio passivo.

⚠️ **Ainda por alinhar:** o raio da célula da grade (`isTriggerAllowed`, `ScaleGrid.tsx`) decide
por **prefixo do código** (`N` → 19h–07h…), a mesma heurística que a Fase 8 tirou do modal. Coincidiu
nos casos medidos, mas é segunda conta para a mesma pergunta; alinhar exige a janela do mês inteiro.

ℹ️ **`/relatorios/carga-consolidada`: "onde estão as horas" é link para a grade** desde
`20260829130000` (`fn_carga_mensal_servidor` já devolvia `unidade_id`/`setor_id`; só o
`jsonb_build_object` do relatório não repassava). O destino é
`/escalas/unidade/{unidade_id}?setor={setor_id}&mes={mes}&ano={ano}`, mesmo padrão de Home,
Auditoria e ficha do servidor. Sem os ids a linha renderiza **sem** link, de propósito.

### 30. `ultimo_ip_origem` é o IP PÚBLICO da unidade, não o da máquina (29/08/2026)

⚠️ **Medido em 29/08/2026: os 23 dispositivos têm `45.173.x`/`177.55.x` em `ultimo_ip_origem`, e
as CINCO máquinas do HMI aparecem com o mesmo `45.173.175.9`.** Nem ele nem `endereco_ip` (que é o
**relógio**) levam ninguém até o computador do coletor, e o hostname sozinho também não — não há
DNS interno cobrindo as unidades.

**`dispositivos_rep.coletor_ip`** (`20260829120000`) guarda o IP da máquina na rede da unidade,
reportado no heartbeat pelo coletor **v0.13.0** (`ciclo.IPLocal`).

⚠️ **O IP vem de `net.Dial("udp", <relógio>)`, que não envia pacote nenhum** — só faz o sistema
escolher a rota e revelar a interface. Numa máquina com várias placas, "a primeira IPv4
não-loopback" acerta por sorte: medido na máquina de dev, a varredura devolvia primeiro um
`169.254.87.133` (link-local de adaptador virtual) enquanto o Dial devolveu o `10.110.2.111`
correto. O fallback por varredura ficou, pulando loopback **e** link-local.

Coletor anterior à v0.13.0 não manda o campo: a coluna fica `NULL` e a tela não mostra nada —
nunca um valor inventado pelo servidor.

Diário das armadilhas 27 a 30 em
[`docs/evolucao/2026-08-29-excluir-setor-com-vinculos-e-inativos-fora-da-escolha.md`](docs/evolucao/2026-08-29-excluir-setor-com-vinculos-e-inativos-fora-da-escolha.md).

### 32. Identidade que vem do cliente: COMPARAR não escala, DERIVAR sim (30/08/2026)

🚨 **A sessão do Portal do Servidor era o UUID do servidor em texto puro num cookie**, e
`findServidorByMatricula` — Server Action **sem autenticação**, numa rota isenta de login
(`src/utils/supabase/middleware.ts:115`) — devolvia esse UUID a partir da matrícula. `httpOnly`
impede o JS de **ler** o cookie; não impede ninguém de **montar** a requisição com ele.

Pior que o cookie: **12 das 30 ações do portal nem o liam.** Recebiam `servidorId`/`solicitacaoId`
do cliente, com `createAdminClient()` (que ignora RLS). Quatro delas **escreviam** — abrir e
cancelar pedido de férias, aceitar contraproposta em nome de outra pessoa.

**Fonte única desde então: `src/utils/portalSession.ts`** (HMAC, espelhando
`terminalLocalSession.ts`, que já rodava desde 11/08/2026).

⚠️ **A lição transferível não é "assine o cookie" — é DERIVAR em vez de COMPARAR.** Seis ações já
faziam `if (portalServidorId !== servidorId) return erro`, corretamente. Comparar funciona, mas
exige que **cada ação nova lembre**, e 12 não lembraram. Derivar do cookie torna o erro impossível
de cometer: não existe mais um `servidorId` do cliente para confundir com o da sessão. Portão:
`scratchpad/sim_portal_sessao.js` reprova qualquer ação do portal que volte a aceitá-lo.

⚠️ **Quem entrega identidade antes da credencial entrega a chave junto.**
`findServidorByMatricula` devolve só o **nome** agora; `validatePin` recebe **matrícula**, não
UUID. O identificador interno não transita pelo cliente.

⚠️ **Separação de domínio no HMAC permite reusar segredo entre contextos.**
`PORTAL_SESSION_SECRET` cai para `TERMINAL_LOCAL_SESSION_SECRET` (já no Coolify) para o deploy não
derrubar o portal — seguro porque `sisescala:portal-servidor:v1` entra na mensagem assinada, então
cookie de um contexto nunca valida no outro. **Isso não é o `|| 'literal'` proibido pela armadilha
18**: não há valor embutido, há uma segunda variável de ambiente. Sem nenhuma das duas, lança.

### 33. Server Action em arquivo `'use server'` é endpoint público — inclusive o motor (30/08/2026)

🚨 `sendWhatsAppMessageAction`/`sendEmailAction` (`src/app/actions/communication.ts`) eram Server
Actions **sem autenticação nenhuma**, e faziam
`{ ...dbConfigs, ...unidadeConfigs, ...(overrideConfigs || {}) }` — **o override do cliente
vencia**. Sem login: sobrescrever só `whatsapp_astracall_url` mandava a `X-API-Key` **real** ao
servidor do atacante; só `email_smtp_host` entregava usuário e senha do SMTP como AUTH; mais SSRF
a partir da VPS e relay aberto saindo do e-mail oficial da Secretaria.

⚠️ **Não dá para só acrescentar o guard**: `/api/avisos-ponto/despachar` (cron) e
`/api/avisos-ponto/webhook` chamam o envio **sem sessão de usuário** — exigir sessão ali derruba o
aviso de ponto. O motor foi para **`src/utils/comunicacao/enviar.ts`**, que **não** é `'use
server'` e só alcança quem o importa; `communication.ts` ficou com envelopes que exigem sessão
(`exigirSessao`) e, no caminho de teste, admin (`exigirAdminComunicacao`). Mesmo padrão de
envelope da armadilha 1.

⚠️ **Nunca reexportar `enviarWhatsAppInterno`/`enviarEmailInterno` de um arquivo `'use server'`** —
isso as transforma em Server Action de novo e reabre tudo acima.

ℹ️ `rejectUnauthorized: false` do SMTP saiu depois de medir: o host em produção é
`smtp.gmail.com`, certificado público válido — a "flexibilidade para certificado autoassinado" do
comentário não era usada por ninguém. Escotilha explícita: `email_smtp_tls_inseguro`.

### 34. Segredo dentro de JSONB não tem nome — denylist por chave não o alcança (30/08/2026)

🚨 `configuracoes_globais` tinha `FOR SELECT TO authenticated USING (true)`
(`20260523000000`): **qualquer conta logada** lia a senha do SMTP e a chave de API pelo PostgREST.
A policy de **escrita** já era admin-only desde a mesma migration — leitura e escrita tinham
públicos diferentes e ninguém notou.

⚠️ **A correção óbvia (denylist por nome de chave) NÃO funciona, e só medir mostra isso.** Das 59
chaves de produção, **só 2** têm nome que denuncia segredo (`email_smtp_senha`,
`whatsapp_astracall_key`). As outras 19 se chamam **`unidade_comunicacao_<uuid>`** e são **blobs
JSONB com `email_smtp_senha` e `whatsapp_astracall_key` aninhados dentro do valor** — nome nenhum
delas casa com `%_key`, `%senha%` ou coisa alguma. Duas têm chave preenchida hoje.

Fonte única: **`fn_config_e_sensivel(text)`** (`20260830100000`), usada **pela policy e pela
conferência da migration** — se as duas divergissem, a conferência não valeria nada. Combina o
prefixo `unidade_comunicacao_%`, a lista explícita e os padrões genéricos; as três formas ficam.

⚠️ **Ao esconder segredo, procure no VALOR, não só no nome.** Vale para log, export, relatório e
para o próprio script de auditoria — o meu mascarava por nome de chave e imprimiu por extenso a
chave de API que estava dentro de um desses blobs.

### 35. `verify_pin` estava aberta a `anon`, e o bloqueio de tentativas morava no TypeScript (30/08/2026)

🚨 Medido em produção: `POST /rest/v1/rpc/verify_pin` com a chave **anon** devolvia **HTTP 200**.
Criada em `20260523000000`, **nunca revogada de PUBLIC** (armadilha 24) — as três migrations
`20260827*` fecharam `fn_registrar_ponto`/`fn_confirmar_presenca` e passaram por cima desta.

E o bloqueio de 5 tentativas / 15 minutos vivia **inteiramente em `validatePin`**, no TypeScript.
A função SQL só compara o hash. Com PIN de **4 dígitos** (`Math.floor(1000 + Math.random()*9000)`
na tela de cadastro) são **9.000 possibilidades**, percorríveis em segundos, sem passar por
controle nenhum e sem deixar rastro em `pin_failed_attempts`.

`20260830110000` revoga e move a regra para **`fn_validar_pin_portal`** (matrícula + PIN, decisão
inteira numa transação com `FOR UPDATE`).

⚠️ **Contador de tentativas fora do banco tem CORRIDA, não só bypass.** Ler
`pin_failed_attempts`, decidir e só então gravar deixa N requisições simultâneas lerem 0 e passarem
juntas — e força bruta é, por definição, concorrente.

⚠️ **Antes de resolver login por matrícula, confira que ela é única.** Medido: **1385 ativos, 1385
matrículas distintas, zero duplicadas**. `SELECT INTO` com duplicata pega linha **arbitrária** e
abriria a sessão da pessoa errada — o código antigo usava `.single()`, que **errava** nesse caso.

ℹ️ Decisão do usuário (30/08/2026): **PINs de 4 dígitos já emitidos não serão trocados**; serão
substituídos naturalmente. Por isso fechar a força bruta importa mais, não menos.

⚠️ **Revogar não quebra função `SECURITY DEFINER` que chama por dentro** — `fn_confirmar_presenca`
e as demais executam com os privilégios do dono. Confira o chamador antes de temer a revogação.

### 36. Detector que não conhece o guard novo transforma correção em regressão aparente (30/08/2026)

⚠️ Depois de fechar o portal, a varredura de "Server Action com `createAdminClient` e sem checagem
de identidade" saltou de 15 para **29** achados. Nenhum era real: ela procurava a string
`portal_servidor_id`, que a correção **eliminou**. Ensinando-lhe `servidorDaSessao` /
`exigirSessao` / `exigirAdminComunicacao`, caiu para **4**, todas justificadas (o próprio login e
duas leituras de flag booleana).

**Ao reauditar depois de uma correção, atualize o detector junto.** Resultado muito **pior** logo
após uma correção é sinal de detector desatualizado antes de ser sinal de código quebrado.

⚠️ **E um portão que nunca falha não vale nada**: `sim_portal_sessao.js` foi validado injetando
uma regressão de propósito (ação voltando a aceitar `servidorId`) — reprova e sai com código 1.

### 37. Os 5 relatórios escreviam HTML sem escape, e `about:blank` herda a origem (30/08/2026)

🚨 As cinco telas que geram relatório montam HTML por template string e chamam
`win.document.write(...)` — e **não existia função de escape no projeto** (zero ocorrências de
`escapeHtml`, nenhuma biblioteca de sanitização no `package.json`).

⚠️ **`window.open('')` abre `about:blank`, que HERDA a origem da aplicação.** Script injetado ali
roda **como o SisEscala**, com a sessão de quem imprimiu — não numa página neutra.

🚨 **O caminho mais curto começa fora da aplicação:** `fn_log_tentativa_negada` grava **cru** o que
foi digitado no terminal de ponto (`matricula_digitada`, `mensagem_erro`), e `/auditoria` imprime
os dois. Quem tem acesso físico ao terminal digita HTML, a batida falha, e o script executa quando
um coordenador imprime. É escalada de quem está no corredor para a sessão de quem administra.

**Fonte única: `src/utils/htmlSeguro.ts`** — tag `h` que escapa toda interpolação, `raw()` como
única saída explícita. **42 literais** marcados, **3** `raw()`.

⚠️ **O ganho não é o escape, é a INVERSÃO DO MODO DE FALHA.** Chamar `escapar(...)` em cada um dos
116 sítios significa que esquecer **um** reabre o buraco em silêncio. Com a tag: esquecer de
marcar um fragmento HTML faz a tag aparecer como **texto** na tela — feio, visível, e consertado
no mesmo dia. Esquecer de escapar virou impossível.

⚠️ **Regex não acha template literal.** Eles aninham (`` `${ x ? `y` : '' }` ``) e regex não conta
profundidade. `scratchpad/gen_html_seguro.js` tem um scanner que rastreia aspas, comentários e a
profundidade de `${}`. Use-o como modelo.

⚠️ **`.join('')` DESFAZ a marcação, e o compilador quase não avisa.** `map(i => h\`…\`)` devolve
`HtmlSeguro[]`; `.join('')` vira string comum e o literal externo **escapa** aquelas linhas. `h`
já concatena array — os 13 `.join('')` saíram. Só 1 dos 13 foi pego pelo `tsc`.

⚠️ **Cuidado com variável local chamada `h`.** `folha-ponto/page.tsx` tinha `const h` (horas)
sombreando a tag importada — renomeado para `horas`. Não quebrava nada até alguém escrever um
literal marcado dentro daquela função: `h is not a function` em runtime, **sem erro de compilação**.

ℹ️ Conferido que o escape não danifica o que funcionava: **nenhum** bloco `<style>` interpola valor
(escapar `>` quebraria seletor CSS), e as 3 interpolações em `src="…"` são URLs, onde escapar
aspas é o que impede quebra de atributo.

⚠️ **Ao escrever portão de XSS, não confunda "a palavra aparece" com "a palavra executa".** Minha
primeira asserção procurava `onerror=` no HTML e falhava — a palavra **aparece** dentro do texto
escapado (`&lt;img src=x onerror=&quot;…`), onde é inerte. A asserção certa é que **toda**
ocorrência esteja em texto escapado.

### 38. CSP tem que nascer em Report-Only neste projeto (30/08/2026)

`next.config.js` não tinha `headers()` nenhum. Ganhou cinco: `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` e
**`Content-Security-Policy-Report-Only`**.

🚨 **Trocar o nome do cabeçalho para `Content-Security-Policy` sem antes ler os relatos quebra
quatro coisas de uma vez:**

1. os 5 relatórios carregam Tailwind de `cdn.tailwindcss.com`, e **`about:blank` herda a CSP**
   de quem abriu;
2. Tailwind por CDN gera CSS em runtime → exige `'unsafe-inline'` em `style-src`;
3. o Next injeta script inline de hidratação, e o layout raiz publica `window.__SISESCALA_TZ__`
   inline;
4. **o terminal de ponto fica aberto por DIAS e não recarrega sozinho** — CSP que o quebre não
   aparece para ninguém até alguém ir até o equipamento.

⚠️ **`Permissions-Policy` leva `geolocation=(self)`, não vazio** — a chegada do sobreaviso confere
GPS. `'unsafe-eval'` ficou de fora desde já (conferido: nada usa `eval`/`new Function`).

ℹ️ Achado 17, na mesma passada: `JSON.stringify` **não** escapa `</script>`, e dentro de um
`<script>` inline essa sequência fecha a tag mesmo dentro de uma string. Uma linha em
`layout.tsx`. Alcance real era admin→admin (só admin escreve `timezone`).

### 39. "Aberta ao `anon`" não é vazamento; **não filtrar por escopo** é (30/08/2026)

Sobravam **321** funções alcançáveis pelo papel `anon` depois das `20260827*`. Em vez de um REVOKE
em massa, foram **medidas** com a chave anon — e quase todas recusam de verdade:

| função | resposta ao anon |
|---|---|
| `get_my_role()` | `null` |
| `fn_unidade_no_escopo()` | `false` |
| `fn_setores_no_escopo()` · `fn_pendencias_biometria()` | array vazio |

Isso **confirma a hipótese** da `20260827050000`. 🚨 **Mas uma vazava:**
`fn_tentativas_negadas_diagnostico` devolvia **HTTP 200 com 684 linhas** contendo
`servidor_nome`, `matricula`, `unidade_nome` e `setor_nome` — dado pessoal, sem login.
`20260830120000` fecha essa e mais 16 funções de tela.

🚨 **QUATRO funções não podem perder `authenticated`, nunca:** `get_my_role`,
`fn_unidade_no_escopo`, `fn_unidade_alcancavel_por_setor`, `fn_setores_no_escopo`. Elas são
chamadas **de dentro de policies de RLS** (`get_my_role` em **38 migrations**), e a policy é
avaliada com os privilégios de **quem consulta** — revogar ali faz toda consulta daquele papel
falhar. Não é degradação, é a aplicação parando. A migration **aborta** se detectar isso.

⚠️ **As 252 do PostGIS dominam a contagem e devem ficar.** Geometria pura, sem acesso a dado — e
pertencem à extensão, então **não somos o dono**: o `REVOKE` só emitiria `WARNING` e a migration
"aplicaria com sucesso" sem mudar nada (armadilha 24).

ℹ️ A migration resolve as funções **por nome via `pg_proc`**, não por assinatura fixa: assinatura
envelhece a cada parâmetro novo, e sobrecarga esquecida deixa a porta aberta em silêncio.

⚠️ **Item 18 foi decidido como NÃO-FAZER, e o motivo vale mais que a correção.**
`servidores_jornadas_temporarias` e `excecoes_escala_servidor` têm `USING (true)`, mas são 6 e 2
linhas de UUID/data — sem nome, sem CPF — e escopar a segunda **quebraria a armadilha 26**, que
registra que o filtro por unidade foi removido de propósito (o teto de carga é consolidado entre
escalas). Fechar ali é "revogar demais" por ganho nulo.

### 40. Segredo em query string, e o `origin` que vinha do navegador (30/08/2026)

**Fonte única: `src/utils/segredoCron.ts`.** `?secret=` deixou de ser aceito nas duas rotas de
cron — query string vaza para log de proxy, histórico de terminal e `Referer`, e aquele segredo
autoriza **fechar escalas e folhas**. Só `Authorization: Bearer`, com `timingSafeEqual`.

⚠️ **O webhook do WhatsApp é a exceção deliberada.** Usa `WHATSAPP_WEBHOOK_SECRET` e **quem o
chama é um provedor externo** (AstraCall): exigir cabeçalho depende de o provedor suportá-lo, e se
não suportar a confirmação de aviso de ponto para de chegar **sem ninguém perceber**. Ganhou só a
comparação em tempo constante. Confirmado que o provedor manda cabeçalho? Feche a query string lá.

⚠️ **`enviarAcionamentoWhatsAppAction` montava o link mágico com `origin` do CLIENTE.** Esse link
vai por WhatsApp e carrega o **token do chamado** na URL — quem passasse `origin` próprio fazia o
SisEscala enviar, em nome da Secretaria, um link para o host dele com o token junto. A origem é
propriedade da **instalação**: agora vem só de `NEXT_PUBLIC_SITE_URL`, e a **ausência** dela
recusa com erro explícito em vez de montar link relativo dentro de uma mensagem.

⚠️ **`applyAccessFilters` devolvia a query SEM filtro quando o perfil não carregava.** Inofensivo
onde a query vem de `createClient()` (a RLS segura por baixo), **não** onde vem de
`createAdminClient()` — e existe um sítio assim (`justificativas/actions.ts`). Estava protegido
por um guard externo, mas o default de uma função de segurança é **negar**.

### 42. `RETURNS TABLE` cria variável com o nome da coluna, e `SET` não pode ser qualificado (30/08/2026)

🚨 **`fn_avisos_ponto_pendentes` ficou quebrada em produção** entre duas migrations, e nenhum
`tsc`, `lint` ou `build` pegou:

```
POST /rpc/fn_avisos_ponto_pendentes -> HTTP 400
42702: "It could refer to either a PL/pgSQL variable or a table column."
```

**A causa:** `RETURNS TABLE (… canal text, destino text, tentativas integer …)` declara parâmetros
de **saída** com esses nomes. No corpo,
`UPDATE avisos_ponto_fila f SET tentativas = …, canal = …, destino = …` referencia colunas com os
**mesmos nomes** — e **o alvo de um `SET` não pode ser qualificado** (`SET f.canal` é erro de
sintaxe), então não há como desambiguar escrevendo melhor.

**A correção é `#variable_conflict use_column`** logo após o `AS $fn$`, antes do `DECLARE`. Em
função assim, o parâmetro de saída nunca é lido como variável (o retorno é por `RETURN QUERY`),
então resolver sempre para a coluna é o que se quer. ⚠️ **Não remova essa linha ao regerar a
função.**

⚠️ **O modo de falha é o da armadilha 1, agravado:** plpgsql só resolve nome na **execução**, então
a função é criada sem reclamar. E como a migration tinha feito `DROP` da assinatura antiga (para
evitar `PGRST203`, armadilha 41), **a única versão existente passou a ser a quebrada** — o despacho
parou por completo, em silêncio, até alguém medir.

⚠️ **Verificação que confere se a função EXISTE não serve aqui.** Ela existia. A verificação
precisa **EXECUTAR** a função, com argumentos que não produzam efeito colateral (aqui,
`fn_avisos_ponto_pendentes(1, 0)`, que só alcança item de e-mail e não envia nada). Quem pegou o
erro foi a sonda por fora, não a migration.

### 41. Assinatura nova de função é objeto NOVO: `GRANT` não é herdado, e a ordem de deploy vira problema (30/08/2026)

`/api/rep/v1/pendencias` e `/remocoes` autenticam o relógio por HMAC e **já tinham o
`dispositivoId` em mãos** — mas repassavam o `fila_id` do corpo **cru** para a RPC, que também não
conferia nada: ela lê o `dispositivo_id` **da linha da fila**. Um relógio legítimo confirmava item
da fila de OUTRO, e o vínculo de servidor nascia no equipamento errado — batida atribuída a quem
não bateu, meses depois, sem log. `20260830130000` põe o guard dentro das duas RPCs.

🚨 **`CREATE OR REPLACE` com assinatura DIFERENTE cria um objeto NOVO — e objeto novo nasce com
`EXECUTE` para PUBLIC** (armadilha 24). Os `REVOKE`/`GRANT` precisam ser **reescritos** na
migration nova; sem eles, a função "só alterada" fica aberta a `anon`. E a assinatura antiga
precisa de `DROP`: duas sobrecargas fazem o PostgREST devolver `PGRST203` (foi o que aconteceu com
`fn_reparse_afd_dispositivo` em 22/08/2026).

⚠️ **Parâmetro novo OBRIGATÓRIO quebra a ordem migration/deploy nos DOIS sentidos.** Aqui ele
ganhou `DEFAULT NULL` de propósito, porque a janela custa caro — e isso foi medido: quando a
confirmação de cadastro falha, **o usuário JÁ FOI CRIADO no relógio** (`ciclo.go:415` só registra
um aviso), o item fica `pendente`, e no ciclo seguinte o coletor recria → o equipamento recusa por
duplicidade → a RPC trata recusa como **definitiva** e o item vai para `falhou`, exigindo
reenfileiramento manual.

⚠️ **O preço do default é que a checagem só vale se quem chama PASSAR o parâmetro.** Por isso
`scratchpad/sim_rep_fila_dono.js` reprova rota de `/api/rep/v1/` que consuma fila sem repassar o
dispositivo autenticado. **Ao trocar um guard obrigatório por um opcional, escreva o portão
junto** — senão o defeito volta na mesma forma silenciosa que tinha antes.

Diário das armadilhas 32 a 36 em
[`docs/evolucao/2026-08-30-fase1-auditoria-de-seguranca.md`](docs/evolucao/2026-08-30-fase1-auditoria-de-seguranca.md);
das 37 e 38 em
[`docs/evolucao/2026-08-30-fase2-xss-e-cabecalhos.md`](docs/evolucao/2026-08-30-fase2-xss-e-cabecalhos.md);
das 39 a 41 em
[`docs/evolucao/2026-08-30-fase3-fechar-anon-e-defesa-em-profundidade.md`](docs/evolucao/2026-08-30-fase3-fechar-anon-e-defesa-em-profundidade.md).
O plano completo da auditoria fica em `docs/security-audit/`, que **está no `.gitignore` de
propósito** — o repositório é público (armadilha 18) e aquele diretório descreve vulnerabilidades
ainda abertas.

### 43. Regra nova em credencial: aplique na ESCRITA, nunca na LEITURA (30/08/2026)

O servidor passou a **trocar o próprio PIN** no Portal (`fn_trocar_pin_portal`), e PIN **novo**
passou a exigir **6 dígitos**. Os 826 PINs de 4 dígitos já emitidos **continuam valendo, sem
prazo** — decisão do usuário de não forçar rotação.

⚠️ **Isso só é possível porque o login não conhece a regra.** `verify_pin` apenas compara hash
bcrypt: ele não sabe, nem precisa saber, quantos dígitos o PIN tem. A regra vive inteiramente em
`fn_validar_pin_novo`, chamada de dentro do **trigger de hash** — ou seja, **no caminho que
grava**. Forçar a troca dos antigos seria barrar no **login**, e aí sim tira gente do ar: é uma
decisão diferente, e não foi tomada.

🚨 **A refatoração razoável que quebraria tudo:** "uniformizar" fazendo `fn_validar_pin_portal`
chamar `fn_validar_pin_novo`. No mesmo instante, todo PIN de 4 dígitos para de entrar **no Portal
e no terminal de ponto**, e o sintoma é *"ninguém consegue bater o ponto hoje"*. A migration
`20260830170000` **aborta** se detectar isso (`prosrc ILIKE '%fn_validar_pin_novo%'` sobre
`fn_validar_pin_portal` e `verify_pin`), e `scratchpad/sim_troca_pin.js` reprova junto.

⚠️ **A regra mora no TRIGGER, não só na RPC.** `hash_servidor_pin` (`20260523000000`) já era o
funil por onde todo PIN passa antes de virar hash — as duas telas do coordenador e a RPC nova
caem nele. Validar ali é o padrão da armadilha 23: trigger como rede de segurança, RPC como
caminho que carrega a mensagem legível. **Os dois guards originais dele precisam sobreviver a
qualquer recriação** (armadilha 1): sem `NOT LIKE '$2a$%'` todo UPDATE em `servidores` aplica hash
sobre o hash e o parque inteiro perde acesso; sem `IS DISTINCT FROM OLD.pin_acesso` a validação
nova reprovaria os 4 dígitos **legados** em qualquer edição de ficha, e o coordenador não
conseguiria mais salvar o cadastro de ninguém.

🚨 **Este PIN não é só do Portal — é a credencial do terminal de ponto.** Quem troca à noite e
bate de manhã com o antigo **leva recusa**, e pela conformidade da v1.22.0 matrícula/PIN inválidos
é a única coisa que ainda recusa batida: vira `logs_tentativas_presenca` e some da folha. O aviso
em âmbar no topo de `TrocarPinSection` é o que impede a pessoa de descobrir isso na frente do
relógio; não o remova nem o esconda.

⚠️ **Exigir o PIN atual não é redundância com a sessão.** O cookie do Portal dura horas e a tela é
aberta em computador compartilhado de unidade: sessão aberta prova que *alguém* entrou, não que
quem está na frente agora seja a mesma pessoa.

⚠️ **E a troca REUSA o contador de tentativas do login.** Sem isso ela viraria um oráculo para
adivinhar o PIN atual sem trava nenhuma — exatamente o furo que a `20260830110000` fechou no
login, reaberto por uma porta ao lado.

⚠️ **Trocar o piso obriga a trocar o gerador junto.** `Math.floor(1000 + Math.random() * 9000)`
vivia nas duas telas do coordenador; deixá-lo lá faria o botão "Gerar PIN" produzir um valor que o
próprio banco recusa, e a tela pareceria quebrada. Fonte única em `src/utils/pin.ts` (`gerarPin`,
`conferirPinNovo`, `mensagemRecusaPin`) — o TypeScript **avisa antes de salvar e traduz o código
de recusa**, nunca substitui a checagem do banco.

⚠️ **Sortear às cegas não basta:** `000000` e `123456` estão no espaço amostral. `gerarPin`
redesenha até passar na própria regra, **com teto** — `while (true)` num gerador é um travamento
esperando um bug de regra.

ℹ️ `fn_pin_e_sequencia` é estrutural (todo par de dígitos vizinhos difere de +1 ou de −1) em vez
de lista de proibidos: lista envelhece e depende do tamanho do PIN.

Portão: `node scratchpad/sim_troca_pin.js` (56 casos). Transpile antes com
`npx tsc src/utils/pin.ts --outDir scratchpad/_sim --module commonjs --target es2020`.
**Validado injetando três regressões de propósito** (piso voltando a 4, trigger perdendo o guard
de não re-hashear, regra vazando para o login) — as três reprovam.

### 44. Allowlist de papel envelhece em silêncio, e a mensagem que manda "pedir a um Administrador" não tinha a quem pedir (31/08/2026)

⚠️ **Duas travas independentes, a mesma causa: papel escrito à mão numa condição que ninguém
revisita.** Diário em
[`docs/evolucao/2026-08-31-rh-autoriza-carga-e-coordenador-solicita.md`](docs/evolucao/2026-08-31-rh-autoriza-carga-e-coordenador-solicita.md).

**(a) O modal "Adicionar Servidor Externo" recusava o RH.** `get_external_servers_for_scale`
(06/2026) e `fn_buscar_servidor_para_escala` (31/08/2026) tinham allowlist fixa
`super_admin/admin/coordenador` — escrita antes de `rh`, `ass_adm` e `rh_unidade` existirem. A RLS
de `escala_mensal` **já autorizava os três** desde `20260818170000`: o banco deixava gravar a
escala, faltava poder escolher quem escalar. E o sintoma era diferente em cada caminho, sendo o
antigo o pior — a busca por nome dava "Acesso negado", mas o caminho Unidade → Setor **não trata o
erro do RPC** e devolvia lista **vazia**, indistinguível de "essa pessoa não existe".

`20260831110000` troca as duas por **denylist** (`fn_pode_escalar_servidor_externo`: fora só
`servidor` e `comum`, os papéis do Portal). Decisão do usuário: *"todos podem adicionar, desde que
dentro dos limites e regras; fora das regras, os RH autorizam"*. De quebra,
`get_external_servers_for_scale` **nunca teve `REVOKE FROM PUBLIC`** e estava aberta a `anon` desde
06/2026 (armadilha 24) — as `20260827*` e a `20260830120000` não a alcançaram.

**(b) O teto de horas mandava "Solicite a um Administrador" — e não existia como solicitar.**
Nem tabela, nem tela, nem registro: o pedido saía por WhatsApp e a decisão não ficava em lugar
nenhum. Medido em 31/08/2026: **5 pessoas** podiam conceder (2 super_admin + 3 admin) contra **96**
que lançam escala (73 coordenadores, 8 rh, 7 rh_unidade, 8 ass_adm), e as duas únicas autorizações
da base inteira foram do mesmo super_admin.

🚨 **A regra transferível: nunca instrua uma ação que o sistema não oferece.** Instrução que o
sistema não cumpre ensina a contornar o sistema — o teto vira algo que se resolve "falando com
alguém", e a decisão sobre carga horária de servidor público desaparece. É a armadilha 22 pelo
outro lado: lá se relatava o que não mudou, aqui se manda fazer o que não existe.

| peça | onde |
|---|---|
| quem **concede** | `fn_pode_autorizar_excecao_carga` (`20260831120000`) — +`rh`, +`rh_unidade` **no escopo dele** |
| quem **pede** | `fn_pode_solicitar_excecao_carga` — espelha a policy de escrita de `escala_mensal` |
| a fila | `solicitacoes_excecao_carga` (`20260831130000`) |
| decidir | `fn_avaliar_solicitacao_excecao_carga` — aprovar **grava a exceção na mesma transação** |
| tela | `/autorizacoes-escala` |
| fonte única no frontend | `src/utils/autorizacaoCarga.ts` |

⚠️ **A policy antiga foi DERRUBADA, não ganhou uma irmã** — permissivas se somam com `OR`, e a
migration **aborta** se achar mais de uma policy de escrita em `excecoes_escala_servidor`. Mesma
lição de `solicitacoes_transferencia_servidor` (armadilha registrada em 28/08/2026).

⚠️ **RH da Unidade precisa de escopo, e o motivo é a armadilha 26:** a autorização é UMA por
`(servidor, mês, ano)` e vale para **todas** as escalas da pessoa — quem autoriza mexe num número
que a outra unidade também usa. Daí `fn_excecao_carga_detalhe`, que faz o modal mostrar **quem
concedeu a vigente, de qual unidade e quando**, antes de gravar por cima. Sobrescrever continua
possível (reduzir excesso é legítimo); sobrescrever **sem ver**, não.

⚠️ **`solicitacoes_excecao_carga` não tem policy de escrita, de propósito** — só as RPCs
`SECURITY DEFINER` escrevem. Sem isso, qualquer autenticado marcaria o próprio pedido como
`aprovada` pelo PostgREST (armadilha 12).

⚠️ **Um pendente por (servidor, mês, ano)**, índice único parcial: dois pedidos abertos produzem
duas decisões sobre o mesmo número. O segundo é recusado **nomeando quem já pediu**; e existe
cancelamento para a trava não virar prisão. Na grade, pedido em aberto pinta o escudo de **azul**
em vez de vermelho — sem distinguir "travado e parado" de "travado e em andamento", quem já pediu
pede de novo.

⚠️ **Os quatro caminhos do teto na grade** (célula, Salvar Previsão, escudo da linha, Aplicar
Template) tinham a condição de papel escrita à mão, cada um com seu texto — trocados de uma vez por
`scratchpad/gen_autorizacao_carga_grade.js`, que aborta se qualquer das 11 substituições não bater
na contagem. **`isAdminRole` (linha ~4275) NÃO é sobre carga** (valida presença e ignora a trava de
previsão) e continua como está; o gerador confere que ele sobreviveu.

Portão: `node scratchpad/sim_autorizacao_carga.js` (69 casos). Transpile antes com
`npx tsc src/utils/autorizacaoCarga.ts --outDir scratchpad/_sim --module commonjs --target es2020`.
**Validado injetando três regressões de propósito** (voltar a admin-only, ressuscitar o texto
"Solicite a um Administrador", e dar autorização ao coordenador) — as três reprovam.

⚠️ **O Diretor ficou 3 dias autorizando a rede inteira, e o pedido para "acrescentá-lo" era, na
verdade, para FECHÁ-LO** (`20260903110000`, 03/09/2026). A `20260831120000` escopou `rh_unidade`
por `profile_unidades` e deixou `admin` no mesmo ramo de `super_admin`/`rh` — sem escopo nenhum.
Medido em 03/09/2026: os 3 diretores têm `acesso_todas_unidades = false` e **uma única unidade**
cada (2 SMS, 1 HMI), e os dois da SMS decidiam os 5 pedidos pendentes do HMI. Desde então `admin`
divide o ramo escopado com `rh_unidade`; sem escopo só `super_admin` e `rh` — e isso **não pode
ser fechado**, porque a autorização é uma por (servidor, mês, ano) e vale para a rede toda
(armadilha 26): quando duas unidades disputam o mesmo número, alguém precisa enxergar as duas.

⚠️ **Não escope pela unidade do PEDIDO.** `fn_pode_autorizar_excecao_carga` recebe
`(servidor, mês, ano)` e é avaliada em dois caminhos: a RPC de avaliação (onde há pedido) e a
**policy de escrita de `excecoes_escala_servidor`**, no escudo da grade (onde **não há**). Duas
regras para a mesma pergunta deixariam o escudo sem defesa. O critério é o do `rh_unidade`:
escala da competência **ou** lotação — o ramo de escala é o que preserva o Servidor Externo.

ℹ️ **Como se prova o que está aplicado sem conseguir ler a função:** a porta 5432 é bloqueada e
não há RPC de SQL cru. A prova veio do **efeito**: 1 das 3 exceções da base foi concedida por uma
`rh_unidade`, e só a versão de `20260831120000` permite isso. Diário em
[`docs/evolucao/2026-09-03-escopo-de-unidade-para-o-diretor-autorizar-carga.md`](docs/evolucao/2026-09-03-escopo-de-unidade-para-o-diretor-autorizar-carga.md).

### 45. A janela de batidas de uma tela não é o DIA CIVIL — e `07:02` sozinho é indecidível (03/09/2026)

⚠️ **O modal de validação manual filtrava as batidas por dia civil da célula**
(`new Date(iso).getDate() === dia`). Num turno que atravessa a meia-noite isso erra **dos dois
lados ao mesmo tempo**: metade das batidas do turno está no dia seguinte e é descartada, e as
batidas do turno da **véspera**, que caem neste dia civil, entram.

Caso real (NEURIAN, mat. 17227, SMS/REGULAÇÃO, 01/09/2026, Plantão `N` 19:00 → 07:00+1): ela
entrou 18:58 e saiu 07:02 do dia 02. O modal do dia 1 oferecia `07:00:00` e `07:02:00` — **as do
dia 01**, que são a saída do plantão da véspera — e escondia a saída real.

🚨 **Não era só falta de informação: o modal oferecia, como SAÍDA, uma batida ocorrida 12 horas
antes da entrada.** Marcada, gravava saída anterior à entrada.

Fonte única: **`src/utils/janelaBatidas.ts`**. Portão: `node scratchpad/sim_janela_batidas.js`.

| regra | por quê |
|---|---|
| a lista é a **união** do dia civil com a janela prevista do bloco | trocar um critério pelo outro **esconderia** batida que hoje aparece, e batida escondida vira ponto perdido em silêncio |
| toda batida carrega o dia relativo (`+1D` / `−1D`), com a data no `title` | num turno de 24h o `HH:MM` sozinho não identifica nada |
| batida fora da janela do turno continua **visível e selecionável**, mas rotulada | o coordenador é a autoridade; o que não pode é ele escolher às cegas |
| o palpite de passo ignora batida fora do turno | pré-selecionar a errada é pior que não pré-selecionar |

⚠️ **A chave de deduplicação precisa da DATA.** `07:02` do dia 1 e `07:02` do dia 2 são batidas
físicas diferentes, e a chave só de horário fazia a **segunda ser descartada** como repetida — o
mesmo valia para "horário já utilizado em outro passo".

⚠️ **Conferir a ordem por `HH:MM` não serve para batida SELECIONADA.**
`avaliarSequenciaPresenca` normaliza monotonicamente: num turno que cruza a meia-noite ela
**empurra para "+1 dia"** todo passo menor que o anterior. Correto para horário *digitado* (é o que
resolveu o plantão noturno em 01/09/2026); para batida selecionada o instante é conhecido, e
normalizar **esconde** exatamente o erro que se quer pegar. Por isso a seleção guarda o `instante`
e o envio confere a ordem pelos instantes reais. O `instante` **não trafega ao banco** — o que vai
é o `id`, e o servidor relê o timestamp da fonte.

ℹ️ **O banco estava certo nesse caso.** Bloco previsto, alocação (18:58 → 19:00, 2 min; 07:06 →
07:00+1, 6 min) e projeção, todos corretos — a linha só nunca fora reconciliada. Ver a armadilha 46.

### 46. Mudar a escala não dispara reconciliação, e a ingestão reconcilia o dia DA BATIDA (03/09/2026)

⚠️ `fn_ingerir_afd` chama `fn_reconciliar_marcacoes_dia` para `(m.ocorrido_em)::date` — **o dia da
batida**, nunca o dia do bloco. E `trg_reconciliar_apos_marcacao` (`20260820020000`) é **inerte**
enquanto nenhuma unidade estiver em `fonte_ponto_oficial = 'rep'` (Fase 5 não ligada). Então,
quando a escala é lançada ou ajustada **depois** de a batida chegar, ninguém reprojeta: a alocação
sabe a resposta e `escala_diaria` fica com o passo vazio, `reconciliado_em IS NULL`.

Sintoma: entrada gravada com origem `terminal` (escrita direta) e saída em branco, mesmo com a
batida do relógio já ingerida. Conserto: `fn_reconciliar_marcacoes_dia(servidor, dia)` — nada de
digitar horário, o cálculo já está pronto.

✅ Extensão medida em 08–10/2026: dos 65 turnos que cruzam a meia-noite com um passo faltando,
apenas **2 eram recuperáveis** (o mesmo evento). Não é epidêmico — mas não tem detecção nenhuma.

🚨 **E a solução NÃO é reconciliar em massa.** Remedido em 03/09/2026 sobre 09/2026 (1.614 pares
servidor/dia): **4 ganhos contra 43 trocas e 7 perdas** — uma delas tirava `16:36 → 12:02` de uma
saída já gravada. Bate com o registro de 19/08/2026 ("corrigia 4 dias e PIORAVA 11"). **Reconcilie
por lista fechada, com ensaio antes/depois** — `scratchpad/fix_pos_nivel2b.mjs` é o modelo, e ele
classifica cada campo em ganho / troca / perda antes de escrever.

⚠️ **"Perda" no ensaio nem sempre é perda.** Na aplicação de 03/09/2026 a única perda era a mesma
batida mudando de passo: FABIANA (29316) tinha **uma só** batida (19:21), gravada como *saída* do
bloco errado; com o bloco certo ela virou **entrada**, e a saída passou a ser a pendência que
sempre foi. Ler linha a linha é o que separa isso de apagar ponto.

### 47. Transferir de setor APAGAVA a escala em vez de movê-la (03/09/2026)

🚨 **`registrarTransferenciaEfetivada` (`servidores/actions.ts`) fazia quatro coisas, e as quatro
eram `DELETE`:** apagava os dias ≥ data da transferência na **origem**, os dias anteriores no
**destino** (só se a escala de destino já existisse), e as escalas inteiras dos meses seguintes na
origem e anteriores no destino.

O sistema **dividia por data** — intenção certa — mas a metade "depois da transferência" era
**destruída, nunca movida**, e a escala do setor novo **nunca era criada**. Não existia "escala
parcial no setor novo": existia um buraco.

Caso real medido: 4 servidores transferidos `AMBULATÓRIO CLÍNICO → MAIS MEDICOS` (data 09/09/2026)
ficaram com 08 e 09/2026 inteiramente no setor antigo, os dias ≥ 9 apagados, e MAIS MEDICOS sem
escala nenhuma. Diário em
[`docs/evolucao/2026-09-03-transferencia-de-setor-apagava-a-escala.md`](docs/evolucao/2026-09-03-transferencia-de-setor-apagava-a-escala.md).

⚠️ **E falhava em silêncio:** o bloco inteiro rodava num `try/catch` que só fazia `console.error`.
A transferência "dava certo" sem ter tocado em escala alguma. É a armadilha 22 na forma pior —
relatar sucesso sem ter mudado nada.

⚠️ **O `DELETE` não respeitava competência encerrada.** `trg_escala_diaria_guard_competencia` é
`BEFORE UPDATE` e só olha colunas de presença — `DELETE` passava.

✅ **`escala_diaria` NÃO tem setor nem unidade próprios — herda de `escala_mensal`.** É isso que
torna a correção barata: **mover** é `UPDATE escala_mensal SET setor_id, unidade_id` (uma linha, e
todos os dias vão junto); **dividir** é criar a segunda `escala_mensal` e repontar
`escala_diaria.escala_mensal_id` dos dias a partir do corte. Nos dois casos **nada é fabricado e
nada é apagado**: a presença viaja na própria linha, e `marcacoes_ponto` mantém o `setor_id` onde
a batida aconteceu.

| peça (`20260903120000`) | o que faz |
|---|---|
| `fn_validar_destino_escala` | **fonte única das recusas** — mover e dividir precisam das mesmas, e duas cópias divergiriam |
| `fn_mover_escala_mensal` | move a competência inteira |
| `fn_dividir_escala_mensal` | os dias ≥ corte vão para uma `escala_mensal` nova |
| `fn_pode_mover_escala_mensal` | exige poder lançar escala **nos dois lados** (reusa `fn_pode_solicitar_excecao_carga`) |
| `escala_mensal_movimentos` | histórico append-only; **sem policy de escrita**, só as RPCs gravam |
| `src/utils/transferenciaEscala.ts` | a regra de qual competência é movida e qual é dividida |

⚠️ **O default de `registrarTransferenciaEfetivada` é `'nao_mexer'`.** Quem chamar sem escolher
não apaga mês de trabalho por omissão. A tela **pergunta** (mover inteira / dividir na data / não
mexer) quando a lotação muda e há escala aberta.

⚠️ **A folha segue sozinha no MOVER e não segue no DIVIDIR.** `folha_ponto` aponta para
`escala_mensal_id` e **não guarda setor** — mover leva a folha junto sem regerar. Dividir deixa a
folha de origem cobrindo dias que foram embora, então a RPC **recusa** se houver folha fora de
Rascunho e devolve `folha_sincronizar`.

⚠️ **Dividir produz DUAS folhas parciais no mês** (decisão do usuário, 03/09/2026 — cada chefia
assina o período que chefiou). Já acontecia com 1 servidor em 08/2026.

⚠️ **Mês Fechado ou competência encerrada: recusa sempre.** A porta é reabrir em Configurações,
que já é ato registrado — e isso fecha de lado o defeito do `DELETE` acima.

⚠️ **Alcance é diferente nos dois caminhos, de propósito:** na **grade** é só a competência da tela
(o que se vê é o que muda); na **transferência** é o mês da transferência **e os posteriores**
(deixar escala futura no setor antigo seria o mesmo defeito de novo). Meses **anteriores** nunca
são tocados.

⚠️ **Não bloqueie a operação "porque tem ponto".** Mover preserva a presença na própria linha; é
justamente o dia com ponto que não pode ser apagado — e era o que o `DELETE` antigo poupava só por
acaso (`.is('presenca_entrada_em', null)`).

Portão: `node scratchpad/sim_transferencia_escala.js` (18 casos). Transpile antes com
`npx tsc src/utils/transferenciaEscala.ts --outDir scratchpad/_sim --module commonjs --target es2020`.
**Validado injetando três regressões** (`nao_mexer` voltando a planejar operação, divisão no dia 1
criando escala de origem vazia, relato deixando de citar o que não mudou) — as três reprovam.

### 48. Árvore de setor: seleção ÚNICA não é a múltipla com um item (03/09/2026)

⚠️ **`SeletorSetoresArvore` marca em CASCATA** — clicar num pai marca todos os descendentes. É o
certo para "este relógio atende a ALA - PSICOSSOCIAL inteira" (armadilha 29) e o **oposto** do que
se quer ao escolher a lotação de destino de uma transferência, que é **um** setor: cascata ali
transferiria a pessoa para um setor que ninguém escolheu.

São dois componentes com a **mesma árvore por baixo**:

| arquivo | papel |
|---|---|
| `src/components/setores/arvoreSetores.ts` | montagem, filtro por texto, nós recolhíveis, trilha até um nó |
| `SeletorSetoresArvore.tsx` | múltipla, **em cascata** (Dispositivo REP) |
| `SeletorSetorArvore.tsx` | **única**, sem cascata (destino de transferência, grade) |

⚠️ **O pai é selecionável** — há servidor lotado no setor-pai; desabilitar nó com filho tiraria da
tela lotação que existe no cadastro.

⚠️ **O caminho completo vai no RESUMO, não em cada linha.** A árvore já mostra a hierarquia pelo
recuo. Para isso `formatSectorPaths` passou a devolver **`nomeFolha`** junto com o caminho —
recortar o caminho pelo separador truncaria um setor cujo nome contenha a mesma sequência.

⚠️ **O ramo do já escolhido nasce aberto**, senão a tela abre sem mostrar em lugar nenhum o valor
que o formulário vai enviar.

Portão: `node scratchpad/sim_arvore_setores.js` (22 casos). ⚠️ **Ao injetar regressão em código
transpilado, confirme que a substituição foi APLICADA** — a primeira injeção foi um `replace`
no-op por diferença de indentação no JS compilado, e o portão "passou". Teste do teste que mente é
pior que não ter teste. Diário em
[`docs/evolucao/2026-09-03-arvore-de-setor-na-selecao-unica.md`](docs/evolucao/2026-09-03-arvore-de-setor-na-selecao-unica.md).

### 45. A folha media o INSTANTE da saída e nunca a entrada — atraso virava hora extra (04/09/2026)

🚨 **Medido em produção em 04/09/2026, competência 08/2026 (547 folhas, 6.412 dias com entrada e
saída): 622 dias e 141 pessoas chegaram atrasadas E saíram depois do previsto, gerando 489h09 de
hora extra — das quais 253h21 apenas REPÕEM o atraso.** 51% da hora extra da competência nasce em
dia que começou com atraso. Caso real: MARIA DE JESUS (mat. 10370), 8 dias, `14:29 → 18:12` numa
jornada 14H–18H — 12 min pagos como extra num dia em que faltaram 17 min para fechar a jornada.
E os **1.363 dias de atraso (646h27)** não apareciam em lugar nenhum da folha.

Diário em [`docs/evolucao/2026-09-04-folha-em-hhmm-e-compensacao-de-atraso.md`](docs/evolucao/2026-09-04-folha-em-hhmm-e-compensacao-de-atraso.md).

⚠️ **O modelo de instante NÃO está errado e não deve ser trocado pelo de duração.** Comparar
"trabalhou × devia" (o que o cartão antigo faz) **compensa sozinho**, e o Art. 7º da Portaria
382/2019-GAB-MAB/SMS exige autorização da chefia para atraso virar compensação. Fonte única nova:
**`src/utils/folha/calculoDia.ts`** — mede as duas pontas e **propõe**; a decisão é humana.

| regra | onde |
|---|---|
| teto de 2h/dia (Art. 7º §3º) · dia incompleto não compensa (§5º) | `calcularDia` |
| decisão do coordenador/RH (selo inline na linha do dia) | `decidirCompensacaoDia` |
| a decisão é cobrada no FECHAMENTO | `requerDecisaoCompensacao` em `salvarFolhaPonto` |
| a decisão sobrevive a "Sincronizar" | `carregarDecisaoCompensacao`, nas **4 cópias** da geração |

🚨 **`pendente` NÃO PODE ALTERAR VALOR NENHUM, e esse é o coração do desenho.** "É compensação por
padrão" tiraria 253h de extra de 141 pessoas de uma vez, numa folha que o servidor assina; "é hora
extra por padrão" mantinha o problema. Conferido contra produção: **0 de 1.164 folhas** (08 e
09/2026) mudam de valor com a mudança aplicada e nenhuma decisão tomada
(`scratchpad/an_confere_totais_novos.mjs`).

⚠️ **Previsto que não se sabe é `null`, nunca 08:00–17:00.** `parseJornadaNome` das actions cai
nesse default quando o nome não parseia — contido para hora extra, desastre para atraso (todo
mundo que entra depois das 08:00 apareceria atrasado todo dia). `previstoDaJornada` devolve `null`
e o dia simplesmente não é medido. O regex dela aceita **`ÁS` (A agudo)**: `08H ÁS 20H` e
`09H ÁS 21H` estão no catálogo e não casavam com o padrão original — sem uso hoje (0 dias em 06,
07 e 08/2026), mas selecionáveis.

⚠️ **`jornada_nome` vem VAZIO em 13,7% dos registros** (878 dias de 09/2026). O cálculo da geração
está certo (conferido contra a jornada da escala: 58 de 61 casos com extra batem exatamente), mas
quem calcular no cliente **precisa do fallback** `r.jornada_nome || jornada?.nome` — sem ele esses
dias caem sem previsto, ou pior, num previsto fabricado.

⚠️ **"Abono" NÃO é "dia de afastamento".** Contar dia com afastamento dava **1.173 "abonos"** em
08/2026 — Férias (304), Licença Prêmio (206), Licença saúde (197), Licença Maternidade (124).
Abono é **tempo relevado**: declaração de comparecimento e afins, por horas, com `regime_abono`
diferente de `a_compensar` (`minutosAbonadosDoDia`). Sai em HH:MM, e a geração grava
`abono_minutos` no registro; folha antiga mostra `0:00` — zero honesto, nunca número inventado.

⚠️ **A impressão em lote não pode ler `folha_ponto.total_horas_*`.** São decimais de 2 casas
(`parseFloat((minutos / 60).toFixed(2))`, gravados em **oito** lugares): de `0.18h` não se recupera
`11 min`, e o mesmo documento sairia com número diferente na tela e no papel. Os dois
renderizadores recalculam de `registros` via `totaisFolha`. A **listagem** continua lendo o decimal
(`formatarHorasDecimaisHHMM`), com erro de até 1 min — aceitável em tela de triagem, não em
documento.

⚠️ **`formatarMinutosHHMM` não tem `% 24`, e não pode ganhar.** O helper antigo das telas tinha —
correto para a extra de um dia, e faria `210h` virar `18:00` no total do mês.

⚠️ **O Portal do Servidor renderiza o MESMO `FolhaPontoEditor`** (`ConsultarEscalaClient.tsx`),
inclusive na impressão (`window.print()` sobre o mesmo DOM). Mudança na folha alcança o portal
sozinha — mas o selo de decisão não aparece lá: `podeDecidirCompensacao = podeReclassificar`
(exclui `isPortal`), e a Server Action reconfere o papel.

🚨 **A compensação ocorre DENTRO DO PRÓPRIO MÊS — nunca nos meses subsequentes** (decisão do
usuário, 04/09/2026). O Art. 7º caput da Portaria *admite* compensar até o fim do mês subsequente,
mas é teto, não obrigação. A implementação é compatível por construção — a compensação é do
**mesmo dia** —, e o atraso não compensado **morre no fechamento**, virando desconto ou
justificativa (Art. 7º §4º / Art. 19º I). **Não construir saldo que atravessa competência**: seria
banco de horas por outro nome, que segue sem decisão jurídica desde 14/08/2026.

Portão: `node scratchpad/sim_calculo_dia.js` (52 casos), **validado injetando 3 regressões de
propósito** — compensar sem autorização, `% 24` no total mensal, previsto fabricado.

### 46. `jornadas.horas_totais` é o VÃO do relógio, não o tempo de trabalho (04/09/2026)

🚨 **A folha somava esse campo por dia escalado, então o intervalo entrava como jornada.** O RH
questionou uma folha de **210h** onde esperava ~160h, e estava certo: `08H ÀS 18H` tem
`horas_totais = 10` (o vão entre entrar e sair) e `intervalo_minutos = 120`. **Medido em 08/2026,
415 folhas: 65.170h somadas contra 55.953h de trabalho real — 9.217h de intervalo lançadas como
jornada normal, 14,1%.** As batidas confirmam a jornada real: nos 19 dias completos daquela folha,
média de **8h07/dia**.

O número correto é **168h** (21 dias úteis × 8h), **não 160h** — 160h é referência contratual
(40h × 4 semanas), e todo mês tem 20, 21 ou 22 dias úteis. Relatório ao RH e base legal em
[`docs/evolucao/2026-09-04-folha-em-hhmm-e-compensacao-de-atraso.md`](docs/evolucao/2026-09-04-folha-em-hhmm-e-compensacao-de-atraso.md).

| fonte | o que diz |
|---|---|
| **Portaria 382/2019-GAB-MAB/SMS, Art. 3º I** | *"jornada de 8 (oito) horas, com intervalo de 2 horas"* — a norma do próprio ponto eletrônico separa as duas coisas na mesma frase |
| Lei 17.331/2008 (RJU de Marabá), Art. 17 | teto **diário** de 8h para quem cumpre 40h semanais |
| CLT, Art. 71 §2º | *"Os intervalos de descanso não serão computados na duração do trabalho"* |

Fonte única: **`horasNormaisDaJornada`** (`src/utils/folha/cargaDiaria.ts`), aplicada nos **12**
pontos que somam carga do dia — 4 cópias da geração, 4 recálculos, 2 renderizadores.

⚠️ **O sistema já usava as duas definições ao mesmo tempo, e ninguém notou:** a tela de escala
(`fn_carga_mensal_servidor`, `calculateTotals`) sempre calculou `horas_totais − intervalo/60`; só
a folha somava o vão. O mesmo servidor aparecia com dois totais em duas telas.

⚠️ **Vale a partir de 09/2026** (`horas_normais_liquidas_desde`, chave **separada** da
`compensacao_atraso_vigente_desde` — são duas regras, decididas juntas, que o RH pode precisar
mover em separado). Competência anterior é documento assinado.

🚨 **Três jornadas tinham `horas_totais` divergente do próprio nome** (`20260904110000`), e uma
delas seguia a convenção **oposta**: `08H ÀS 17H` guardava **8** (o líquido) enquanto o vão é 9h.
Descontar o intervalo dali daria **7h/dia** — a correção pioraria o número de 42 servidores. É por
isso que a migration de cadastro acompanha a mudança de código, e não vem depois.
`09H ÀS 18H` e `10H ÀS 19H` guardavam 12 onde o vão é 9h: **3h a mais por dia**.

⚠️ **`09H ÀS 18H` e `10H ÀS 19H` não são usadas em 08/2026; `08H ÀS 17H` é (32 folhas).** Reabrir
e salvar uma dessas folhas move os dias de 8h para 9h — mudança visível, preferida a congelar o
total, porque total que não acompanha a edição é defeito silencioso.

⚠️ **Duas falhas silenciosas apareceram só na revisão, e o `tsc` não pegaria nenhuma:** as quatro
consultas a `jornadas` selecionavam `'nome, horas_totais'` sem `intervalo_minutos` (o desconto
daria **zero**, devolvendo o valor bruto sem erro), e o laço de `autoCorrigirTodasFolhasPonto`
montava um mapa por folha e continuava usando o externo. Ao mexer em carga, **confira que a
consulta traz o campo e que o mapa usado é o do escopo certo**.

### 47. Reabrir folha fechada é ato de RH, não só de administrador (04/09/2026)

`Revisada → Gerada` era `admin`/`super_admin`, escrito à mão em **dois** lugares — a tela e
`salvarFolhaPonto`. É a allowlist que envelhece da armadilha 44. Desde 04/09/2026 **RH Geral e RH
da Unidade também reabrem** (decisão do usuário: *"eles vão precisar fazer vários ajustes após os
fechamentos"*), com fonte única em **`src/utils/folha/reabertura.ts`**.

⚠️ **Continua allowlist, e isso é deliberado:** reabrir documento que o servidor já assinou é ato
de autoridade, não de visibilidade — mesmo critério de `fn_pode_acionar_sobreaviso`.
`coordenador` e `ass_adm` ficam **de fora**: quem fecha a folha não a reabre sozinho para mudar o
que fechou.

⚠️ **O escopo não está nesse módulo, e não deve ir para lá.** Quem limita `rh_unidade` às unidades
dele é o `hasSectorAccess` que já roda antes, em `salvarFolhaPonto`. O módulo responde "tem o
direito?", nunca "alcança esta folha?".

⚠️ **Competência encerrada continua fechada para todos** — reabrir folha é trabalho de RH;
reabrir competência descongela dado guardado para auditoria.

Portão: `node scratchpad/sim_horas_liquidas.js` (33 casos, cobre as duas armadilhas), validado
injetando regressões de propósito — voltar a somar o vão bruto, e dar a reabertura ao coordenador.

### 49. Afastamento de MEIO PERÍODO anulava o dia inteiro, e a escala era APAGADA (04/09/2026)

🚨 **Um afastamento por slot `{M}` sobre um turno `MT` fazia o dia todo desaparecer da folha.** Não
era só bloqueio: `fn_clean_conflicting_shifts` (AFTER INSERT em `servidores_eventos`) **apagava a
`escala_diaria` do dia** — e apagava **sem olhar slot nenhum**, filtrando só por data e ausência de
presença. Sem linha na escala, a folha caía no ramo `!shift` e imprimia
`AFASTAMENTO PARCIAL: DECLARAÇÃO DE COMPARECIMENTO (M) | FOLGA`, sem horário, sem hora normal.
O `| FOLGA` é a assinatura do defeito. Caso real: LUANA JESUS DE OLIVEIRA (mat. 52705), DMAC/SMS,
25 e 27/08/2026, jornada `08H ÀS 18H` — trabalhou as duas tardes e a folha marcou folga. Diário em
[`docs/evolucao/2026-09-04-afastamento-parcial-anulava-o-dia-inteiro.md`](docs/evolucao/2026-09-04-afastamento-parcial-anulava-o-dia-inteiro.md).

**A regra passou a ser a CONTENÇÃO, nunca a interseção** (`20260904120000`; fonte única do
frontend em `src/utils/afastamentoParcial.ts`, espelho de `fn_afastamento_dia` /
`fn_afastamento_anula_turno` / `fn_afastamento_parcial_no_turno`):

| o afastamento do dia… | alcance | efeito |
|---|---|---|
| integral (sem slots) | `anula` | dia inteiro afastado (inalterado) |
| COBRE todos os slots do turno | `anula` | dia inteiro afastado (inalterado) |
| alcança PARTE dos slots | **`parcial`** | preserva a escala e não bloqueia (**novo**) |
| não alcança nenhum slot | `nao_alcanca` | não é parcial; a limpeza continua apagando (inalterado) |

🚨 **A última linha é deliberada e não pode ser "consertada" junto.** Há **Férias** e **Licença
Prêmio** em produção com `slots = {M,T}` sobre turno `N` — interseção **vazia**. É uso indevido do
campo, mas a escala precisa continuar sendo apagada: tratar isso como parcial deixaria a servidora
**escalada durante as próprias férias**. Por isso a limpeza pergunta `ehParcial`, e não `!anula`.

⚠️ **A leitura é do DIA, nunca de um evento isolado.** Duas declarações de comparecimento no mesmo
dia (`{M}` e `{T}` — KETHURY CHAVES, 14/08/2026) são parciais uma a uma e **juntas cobrem** o `MT`.
`fn_afastamento_dia` devolve a união; avaliar evento a evento faria um dia inteiramente afastado
passar como meio período.

⚠️ **O guard do `DELETE` tem que ler o `integral` da própria `fn_afastamento_dia`, nunca `FALSE`
fixo** — senão um afastamento integral convivendo com um parcial vira "parcial" e a escala do dia
inteiro deixa de ser apagada. E o `COALESCE(..., FALSE)` não é zelo: sem afastamento no dia o
subselect dá `NULL`, e `AND NOT NULL` é `NULL` — a linha não seria apagada. O default de uma
limpeza é "apaga como antes".

**Na folha**, o dia parcial soma **horas normais integrais** com o meio período em `abono_minutos`
(decisão do usuário, 04/09/2026) — a mesma regra que o afastamento por horas já seguia, não uma
segunda regra. E o registro ganha **`afastamento_slots`**, que existe para uma coisa só:

🚨 **impedir que o dia parcial vire ATRASO.** O `previsto` de `calcularDia` vem do nome da jornada e
vale para o dia inteiro — sem esse campo, quem tem declaração pela manhã e volta às 13:10 numa
jornada `08H ÀS 18H` aparece com **5h10 de atraso**, e com declaração da tarde, com 6h de "saída
antecipada". Vale o princípio que já rege `previstoDaJornada`: sem previsto confiável, não se mede
atraso. ⚠️ **A hora extra CONTINUA sendo medida** — ela compara a saída contra o fim previsto, que o
afastamento matinal não move.

⚠️ **Recortar o previsto pelo slot foi considerado e descartado**: onde cai o intervalo e a que
horas a declaração terminou não estão no dado. Um previsto `12:00–18:00` acusaria 2h de atraso em
quem volta às 14:00, que é o retorno normal de uma jornada com intervalo 12:00–14:00.

✅ **Medido em produção antes de aplicar** (`scratchpad/an_impacto_parcial.mjs`): 495
`servidores_eventos`, 48 por slot, 242 pares (servidor, dia). Com a escala viva: **0 dias parciais,
0 de cobertura, 1 de interseção vazia** — **nenhuma folha existente muda de valor**. Os 152 dias
parciais já tiveram a escala apagada e **não voltam sozinhos**: relançá-los é ato do coordenador.

🚨 **A migration quase foi copiada da fonte errada, e teria sido inofensiva.** A primeira versão do
gerador copiou as três funções de `20260820120000`. Mas `fn_check_shift_conflicts` foi reescrita
depois, em **`20260821100000`**, ganhando o 7º argumento `p_escala_mensal_id` (armadilha 15) — e é a
de **7** que o `ScaleGrid` chama. A cópia de 6 seria sobrecarga morta, e ressuscitá-la reabriria a
ambiguidade que aquela migration fechou com `DROP`. Só apareceu em homologação, como
`42725: function ... is not unique`. É a armadilha 1 na prática: **o gerador lê DUAS fontes** e
tem invariante próprio (`exclusao da propria celula preservada`) que aborta se alguém regerar da
fonte errada.

Portões: `node scratchpad/sim_afastamento_parcial.js` (62 casos) e
`node scratchpad/val_sim_afastamento_parcial.js`, que injeta 4 regressões e exige reprovação.
Transpile antes com
`npx tsc src/utils/afastamentoParcial.ts src/utils/afastamentos.ts src/utils/folha/afastamentosDia.ts --outDir scratchpad/_sim --module commonjs --target es2020`.
**Validado em homologação contra o banco real, 9 de 9.**
### 50. Cadastro duplicado de servidor: a confirmação de duplo vínculo apaga a diferença entre engano e vínculo real (04/09/2026)

⚠️ **`servidores` é "1 linha = 1 vínculo" e o índice único de CPF foi DERRUBADO de propósito**
(`20260810140000`, 110 CPFs com dois vínculos legítimos). O que sobrou no lugar é
`vinculo_multiplo_confirmado` — uma confirmação humana na tela de cadastro. Na prática **quem está
cadastrando marca a caixa para o sistema deixar salvar**, e a partir daí o engano fica
indistinguível do duplo vínculo de verdade.

Medido em 04/09/2026, em 2.075 servidores: **17 CPFs com dois cadastros ativos, e os 17 com a
confirmação marcada** em pelo menos um lado. Caso relatado: MARIA NAZARE (65567, USF HIROSHI
MATSUDA) recadastrada por outra unidade como `T2600103`, com a confirmação marcada.

E não havia saída: `/servidores/pendencias` **listava** as duplicidades
(`fn_possiveis_duplicidades_servidor`) sem oferecer ação — armadilha 44 na forma de apontar o
problema sem dar o que fazer com ele.

Fonte única desde `20260904130000`: **`fn_mesclar_servidores(origem, destino, motivo)`**, com
`fn_cadastros_duplicados` (os grupos, com o peso de cada lado),
`fn_impedimentos_mesclagem_servidor` (o que impede, consultado pela tela antes de confirmar) e
`fn_dependencias_servidor`. Só `super_admin`. No frontend, `src/utils/mesclagemCadastro.ts`.
Diário em
[`docs/evolucao/2026-09-04-mesclar-cadastros-duplicados-de-servidor.md`](docs/evolucao/2026-09-04-mesclar-cadastros-duplicados-de-servidor.md).

⚠️ **MOVE e INATIVA — não exclui**, ao contrário de `fn_fundir_setor`. A linha errada carrega uma
**matrícula** que pode ter sido impressa em folha, escala e relatório; apagá-la é apagar a única
explicação possível para aquele número. Ela fica `Inativo` com `mesclado_em_servidor_id` apontando
para quem a absorveu.

⚠️ **E move mesmo com ponto e escala do lado errado.** Medido: só **1 dos 17** casos tem o cadastro
errado vazio — exigir limpeza antes tornaria a ferramenta inútil em 16. A batida do lado errado não
é lixo: a pessoa bateu de verdade, a batida só foi atribuída à linha errada. Mover preserva o fato;
apagar destruiria prova (Portaria 671/2021).

🚨 **Terceiro ramo em `fn_bloquear_alteracao_marcacao`.** Sem ele nenhum cadastro com batida podia
ser mesclado. Mesma forma estreita do da fusão de setor: GUC `sisescala.mesclar_servidor` **e**
`to_jsonb(NEW) - 'servidor_id' = to_jsonb(OLD) - 'servidor_id'`. **Os TRÊS ramos** (reparse de AFD,
fusão de setor, mesclagem) precisam sobreviver a qualquer recriação da função — armadilha 1.

⚠️ **A varredura de unicidade é por `pg_INDEX`, não `pg_constraint`** — e copiar
`fn_impedimentos_fusao_setor` sem notar isso seria o bug. **Índice único PARCIAL não aparece em
`pg_constraint`**, e medido em 04/09/2026: dos **13** índices únicos que envolvem `servidor_id`,
**8 são parciais** (`uq_profiles_servidor_id`, solicitação pendente, férias não cancelada…). A
conta de usuário ficaria de fora e o `UPDATE` quebraria no meio da mesclagem.

⚠️ **E o PREDICADO do índice parcial entra na conta.** Ignorá-lo parece conservador e erra dos dois
lados: recusa mesclagem por colisão que não existe (duas solicitações **já decididas**) e, no
descarte de `rep_cadastros_fila`, apaga linha **histórica** em vez de só a pendente. Cada lado vai
numa subconsulta própria (`FROM (SELECT * FROM tab WHERE <pred>) o`), senão as colunas nuas do
predicado ficam ambíguas entre `o` e `d`.

⚠️ **A checagem de escala sobreposta tem que ser AQUI, não no trigger.**
`fn_prevent_cross_sector_shift_overlap` (armadilha 23) olha `escala_diaria`; a mesclagem move
`escala_mensal.servidor_id` e **passa por baixo dele**. Sem o impedimento, mesclar CRIA o estado que
aquele trigger existe para impedir — e a folha conta as mesmas horas duas vezes.

⚠️ **Campos de pessoa são allowlist explícita, ao contrário das FKs.** A varredura de FK é dinâmica
porque lista à mão envelhece e a tabela esquecida fica apontando para o cadastro inativado. Nos
**campos copiados** a assimetria se inverte: copiar por engano é pior que não copiar. Fora da lista,
de propósito: matrícula, cargo, vínculo, unidade, setor e jornada (são do *vínculo*) e dados
bancários (podem ser a conta do outro contrato). E **nunca sobrescreve** — só preenche o que está
vazio no cadastro que fica.

⚠️ **A tela não esconde o grupo já confirmado como duplo vínculo, e não pré-marca a sugestão.** Foi
uma confirmação marcada por engano que criou o caso; esconder o grupo confirmado esconderia o que a
ferramenta existe para desfazer. E a heurística (matrícula definitiva vence a temporária) **não
separa nada quando as duas são temporárias** — existe assim na base (ANA LUCIA, `T2600020` ×
`T2600056`).

⚠️ **A escala movida continua no setor onde foi lançada** — a mesclagem não adivinha qual escala é
a "de verdade". Quem resolve é a grade ou mover/dividir a escala (`20260903120000`). A tela avisa.

🚨 **INATIVAR em vez de excluir tem um preço, e ele apareceu no primeiro uso real:** o cadastro
mesclado continuava sendo enxergado pelas duas checagens de CPF, e **`fn_cpf_ja_cadastrado` é o
portão de `createServidor`/`updateServidor`** desde que o índice único caiu. Editar o cadastro
que FICOU passava a acusar "Este CPF já está cadastrado" contra a própria duplicata inativada — e
a saída oferecida era marcar a confirmação de vínculo adicional, **a mesma caixa cujo uso indevido
cria o problema que a mesclagem desfaz**. Como o mesclado nunca é apagado, o bloqueio era para
sempre. `20260904140000` tira quem tem `mesclado_em_servidor_id` das duas checagens
(`fn_cpf_ja_cadastrado` e `fn_possiveis_duplicidades_servidor`).

⚠️ **O critério é `mesclado_em_servidor_id`, nunca `status = 'Inativo'`.** Servidor inativado
por exoneração continua sendo alerta legítimo ao recadastrar o mesmo CPF; quem foi mesclado, não.
Ao acrescentar qualquer checagem nova sobre CPF repetido, **exclua os mesclados** — senão a
duplicata resolvida volta a bloquear pela porta nova.

Portão: `node scratchpad/sim_mesclagem_cadastro.js` (40 casos). Transpile antes com
`npx tsc src/utils/mesclagemCadastro.ts --outDir scratchpad/_sim --module commonjs --target es2020`.
**Validado injetando três regressões** (peso antes da matrícula definitiva, chute no empate, rastro
da mesclagem entrando no relato) — as três reprovam. A migration foi validada em **homologação**,
com ensaio revertido: mesclagem completa, recusa por escala sobreposta, recusa por CPF divergente,
imutabilidade da marcação mantida com o GUC ligado, e os 13 índices reais exercitados.

### 51. Turno de duração livre precisa da HORA junto, e ela vive noutro estado (04/09/2026)

⚠️ **Escrever `gridData` sem escrever `gridHoras` produz lançamento incompleto — e o `tsc` não vê.**
São dois estados paralelos em `ScaleGrid.tsx` (`gridData` = turnoId, `gridHoras` = a hora informada,
que vira `escala_diaria.hora_inicio_prevista`, o **nível 1** da cascata de precedência, que vence
todos os outros). Quem lança pela célula nunca esquece, porque `handleCellChange` **abre um modal**
pedindo a hora sempre que `precisaHoraInicio` é verdadeiro (turno cujo `dicionario_turnos.horario_inicio`
é nulo — ex.: `1N`, `1`, todos os de hora extra avulsa). Todo caminho em massa esquece por
construção.

Achado ao escrever o Revezamento de Vigias (v2.40.0): a 1h extra de passagem de turno saía sem
hora, a célula ficava **`?h`** na grade e a coluna ia **nula** ao banco — o previsto daquela hora
deixava de ser o fim da jornada (06:00 na jornada `18H ÀS 06H`, que é o que o coordenador informa
hoje) e passava a sair da cascata legada, que é o que alimenta terminal e reconciliação.

| regra | por quê |
|---|---|
| caminho em massa que lança turno **não ancorado** grava a hora junto | senão a tela mostra `?h` e o banco recebe NULL — e o coordenador teria que abrir dezenas de células à mão, anulando a automação |
| ao **reescrever** um dia, limpe `gridHoras` das mesmas categorias antes | o upsert manda `hora_inicio_prevista` para toda categoria que aceita hora (Plantão e Extra), então hora órfã de um turno anterior **sobrepõe a âncora** do turno novo |
| hora que não dá para derivar fica **vazia**, nunca inventada | `?h` é visível e o coordenador resolve; horário fabricado não |
| confira o `tipo` do turno contra a linha (`Normal`/`Plantão`/`Extra`) | o input da célula só aceita código com o `tipo` da linha; caminho em massa que não confere escreve o que a própria tela recusaria na digitação |

⚠️ **E o CÓDIGO da hora extra decide o percentual pago** — `calculateTotals` classifica por
`codigo.includes('N')`, então `1N` é HE 100% e `1` é 50%. Não fixe isso no código-fonte de uma
automação: deixe quem escala escolher. A hora de passagem de turno da portaria (06:00→07:00) está
**fora** da faixa noturna legal (22h–05h), então nem a leitura jurídica resolve sozinha qual é o
certo — é o que a unidade pratica que manda.

ℹ️ Ao checar afastamento/sobreposição num caminho em massa, use os slots **daquele dia**, não a
união de todos. O Revezamento confere `['N']` no dia normal e `['M','T','N']` no de 24h: a união
faria uma declaração de comparecimento **só de manhã** esvaziar um dia em que a pessoa só
trabalharia à noite (armadilha 21/49 pelo avesso — bloquear demais também é defeito).

Portão: `node scratchpad/sim_revezamento_vigias.js` (15 blocos). Transpile antes com
`npx tsc src/utils/vigiaRevezamento.ts --outDir scratchpad/_sim --module commonjs --target es2020`.
**Validado injetando regressões em duas rodadas**; a última desfez as três correções de uma vez
(slots voltando à união, hora da extra nunca resolvida, validação sem conferir `tipo`) e reprova em
7 asserções. Diário em
[`docs/evolucao/2026-09-04-revezamento-de-vigias-na-portaria.md`](docs/evolucao/2026-09-04-revezamento-de-vigias-na-portaria.md).

## Convenções

- **Idioma:** identificadores de domínio, comentários e mensagens de usuário em português.
  Migrations SQL sem acentos nos comentários.
- **Migrations:** `YYYYMMDDHHMMSS_descricao_em_ingles.sql`. Arquivos usam **CRLF** — scripts que
  fazem substituição de texto precisam tratar isso.
  ⚠️ **Confira se o prefixo já existe antes de criar** (`ls supabase/migrations | grep <prefixo>`).
  Em 22/08/2026 duas sessões trabalhando em paralelo geraram **duas** migrations
  `20260822100000_*` — a ordem de aplicação entre elas fica indefinida, e o nome deixa de
  identificar uma migration. A do plantão foi renumerada para `20260822120000`/`20260822130000`
  (a companheira precisou ir junto para não inverter a ordem do par), junto com as **26**
  referências ao número antigo espalhadas por migration, diário e script gerador.
- **Nunca** rode migration direto em produção sem validar em homologação antes.
- Timezone padrão: `configuracoes_globais`, fallback `America/Sao_Paulo`. ⚠️ **A tabela é
  chave/valor, com `valor` jsonb** — não existe coluna `timezone`. Em SQL, a forma usada por
  `fn_confirmar_presenca` e companhia é a única correta:
  `SELECT (valor#>>'{}')::text FROM configuracoes_globais WHERE chave = 'timezone'`.
  Uma nota anterior aqui dizia `configuracoes_globais.timezone`, e isso levou direto a um
  `column "timezone" does not exist` em produção (13/08/2026, `fn_cobertura_ponto_dispositivo`) —
  erro que só aparece em runtime, porque plpgsql não resolve nome de coluna na criação da função
  (armadilha 1).

## Verificação

```bash
npx tsc --noEmit     # type-check
npm run build        # build de produção
npm run lint
```

Não há testes automatizados. Mudanças em lógica de presença exigem verificação manual na grade
e no terminal, além da consulta de conferência incluída em cada migration de dados.
