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
| `cmd/tray` | o que roda o dia a dia numa unidade: ícone de bandeja (verde/vermelho conforme o ciclo), autostart via `HKCU\...\Run` (sem precisar de administrador — `kardianos/service`, que a CLI usava antes, foi **removido**, não adaptado: serviço do Windows roda na Sessão 0, isolada da área de trabalho desde o Vista, e por isso **nunca** pode mostrar ícone de bandeja nem abrir navegador na sessão do usuário), auto-instalação no primeiro uso (copia a si mesmo para `%LOCALAPPDATA%\SisEscala\coletor-rep\` e relança de lá). |

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

Instalação: **"Baixar pacote da unidade (N relógios)"** no modal do dispositivo gera token novo
para cada um e monta o `.zip` com os N. ⚠️ Isso **invalida o token anterior** deles — instalação
antiga para de sincronizar (401) até receber o pacote. A rota recusa o pacote se **um** relógio da
lista não for encontrado: um config com três dos quatro roda sem erro e o quarto some da coleta.

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

🚨 **Fora do ciclo automático até alguém confirmar em campo.** Nenhum candidato de
`rep.formatosTemplate` foi validado contra hardware — diferente de `add_users`/`remove_users`, aqui
a varredura **é** o mecanismo, não a contingência. O portão é
`coletor-rep-cli biometria-testar --de <relógio> --para <relógio>`, que roda o caminho inteiro
contra o descartável "SISESCALA TESTE - PODE APAGAR" (com um dedo cadastrado **nele**, nunca o
template de um servidor real) e **imprime o formato aceito** — é esse nome que precisa voltar para
o código, como aconteceu com `remove_users.fcgi` depois da LACEM.

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
"atualização" para a mesma versão). Ordem: bump `ciclo.Versao` → recompilar os dois `.exe` →
escrever `dist/VERSION` com o mesmo número → `npm run build` → conferir
`find .next/standalone -iname VERSION -path "*coletor-rep*"` → commitar os três juntos.

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

**Update do app de bandeja é "avisa e espera clique", nunca automático** — decisão explícita do
usuário, mesma cautela já registrada para o Smart App Control bloquear o `.exe` sem aviso.
`cmd/tray/main.go` checa `ciclo.VersaoDisponivel` no máximo 1x/dia (não a cada ciclo de 5 min),
habilita um item de menu "Atualização disponível" e só troca o `.exe` (`ciclo.AplicarAtualizacao`
— confere sha256 do download antes de instalar, recusa se não bater) quando alguém clica.
Reaproveita o mesmo padrão de renomear-e-relançar de `autoInstalarERelancar`, não duplica lógica.

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
- `get_system_information.fcgi` (deriva de relógio no heartbeat) continua aproximação — não
  confirmado contra hardware real.
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

- **Fora do ciclo automático** de `cmd/tray` (o ticker de 5 min só roda `Sync`/`Heartbeat`). Só
  roda por clique manual no menu "Sincronizar cadastros agora" ou pelo subcomando
  `coletor-rep cadastros` da CLI — prudência com escrita em equipamento de produção, não dúvida
  sobre o formato.
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
| 3 | regex sobre `jornadas.nome` | categoria `Regular` |
| 4 | cascata legada (`LIKE 'M%'`, `slots[1]`, alinhamento ao Regular) | último recurso, **nunca removida** |

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

O seed é por `SELECT` sobre `dispositivos_rep` (todos menos o relógio onde a pessoa realmente bate),
e não por lista de UUID, **para que todo relógio novo já entre**.

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
