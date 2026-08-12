# SisEscala — guia para agentes

Sistema de gestão de escalas e ponto digital da **Secretaria Municipal de Saúde de Marabá (DMAC)**.
**Está em produção com dados reais de servidores públicos.** Erros aqui viram folha de ponto errada
e problema jurídico. Prefira investigar demais a supor de menos.

Ver também [`.agents/AGENTS.md`](.agents/AGENTS.md) — regras que **complementam** este arquivo.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind 4 · Supabase (Postgres + RLS + Auth)
Sem framework de testes. `npm run build` e `npx tsc --noEmit` são a única verificação automática.
(`npm run lint` **não roda** — o ESLint nunca foi configurado e o comando abre prompt interativo.)

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
- A SMS tem `permite_marca_intervalo = false` → o piloto exercita **só o fluxo de 2 batidas**.
  **A Fase 5 tem que começar por unidade sem marcação de intervalo**; as com intervalo exigem
  segundo piloto.
- Nenhum turno do grupo cruza a meia-noite → o cursor de "ontem" fica sem teste. Escalar um
  `Plantão N` no mês resolve.

### Coletor Go (`tools/coletor-rep/`) — dois binários, mesmo pacote interno

`rep/ sisescala/ fila/ terminal/ config/ ciclo/` são compartilhados por dois `cmd/`:

| binário | papel |
|---|---|
| `cmd/cli` | diagnóstico manual: `sync`, `heartbeat`, `diagnostico`, `afd-raw` (busca e imprime o AFD cru, não grava nada), `afd-exportar` (grava `.sisrep` para pendrive, ver abaixo), `terminal abrir`. Não roda continuamente. |
| `cmd/tray` | o que roda o dia a dia numa unidade: ícone de bandeja (verde/vermelho conforme o ciclo), autostart via `HKCU\...\Run` (sem precisar de administrador — `kardianos/service`, que a CLI usava antes, foi **removido**, não adaptado: serviço do Windows roda na Sessão 0, isolada da área de trabalho desde o Vista, e por isso **nunca** pode mostrar ícone de bandeja nem abrir navegador na sessão do usuário), auto-instalação no primeiro uso (copia a si mesmo para `%LOCALAPPDATA%\SisEscala\coletor-rep\` e relança de lá). |

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
  antes de assumir uma coisa ou outra.
- `get_system_information.fcgi` (deriva de relógio no heartbeat) continua aproximação — não
  confirmado contra hardware real.
- `sync` sempre pede o AFD a partir do NSR 1 (não lê `dispositivos_rep.ultimo_nsr` antes) e
  confia na idempotência de `fn_ingerir_afd` para descartar o que já foi ingerido — funciona,
  mas reenvia o arquivo inteiro do relógio a cada ciclo. Antes de ligar em relógio de alto
  volume, trocar por uma leitura prévia do `ultimo_nsr`.
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

1. 103 marcações de intervalo existem em unidades com `permite_marca_intervalo = false`
   (artefatos da regressão de `20260804080000`). A reconciliação as **apagaria** — decisão
   explícita necessária, não pode ser efeito colateral.
2. As três regras de intervalo divergentes (armadilha 9) só convergem na Fase 8.
3. `fn_blocos_previstos_dia` e `fn_blocos_previstos_mes` são `SECURITY DEFINER` com `GRANT` para
   `authenticated` e **não validam acesso ao setor**. `fn_unidade_no_escopo(uuid)` já existe e é o
   helper certo. ⚠️ Pôr a checagem em `fn_blocos_previstos_dia` **propaga** para
   `fn_alocar_marcacoes_dia` → `fn_projecao_marcacoes_dia` → `fn_conferir_reconciliacao`: precisa
   de bypass para `service_role` (`auth.uid() IS NULL`). `fn_reconciliar_marcacoes_dia`, a única
   que escreve, já é `service_role` apenas.
   ⚠️ **`fn_unidade_no_escopo` em si só verifica `profile_unidades`, nunca `profile_setores`** —
   um coordenador cujo acesso vem inteiramente de setor vinculado (sem a unidade-pai vinculada
   também, ex.: o piloto da TI) passa `p_unidade_id IS NULL` mas falha em qualquer chamada real,
   mesmo tendo acesso legítimo pelo próprio setor. Descoberto e contornado em 12/08/2026
   (`fn_unidade_alcancavel_por_setor`, migration `20260812050000`) só para
   `importacao_rh_pendentes` — `fn_unidade_no_escopo` em si **não** foi corrigida, por prudência
   com o módulo REP que a usa e não foi auditado nessa sessão. Antes de usar
   `fn_unidade_no_escopo` sozinha em código novo, some `OR fn_unidade_alcancavel_por_setor(...)`
   ou confirme que quem vai chamar sempre tem `profile_unidades` preenchido.

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

⚠️ **`rep.RemoverUsuario` (`remove_users.fcgi`) NUNCA foi confirmada contra hardware real** — ao
contrário de `add_users`/`load_users.fcgi` (cinco rodadas de teste na Fase 7). O corpo da chamada
(`{"users": [{"pis": ...}]}`) é uma aproximação por simetria com `load_users.fcgi`, não uma
confirmação. Por isso `coletor-rep higiene` (só leitura) tem botão na bandeja, mas
`coletor-rep higiene-remover` (apaga cadastro de verdade) fica **só na CLI** — mesma prudência já
aplicada a `cadastros`/`cadastros-testar`. Validar contra um usuário de teste (o mesmo "SISESCALA
TESTE - PODE APAGAR" que `cadastros-testar` cria) antes de confiar nisso em cima de cadastro real.

`rep.ListarUsuarios` é só um refactor de `ListarUsuariosComBiometria` para devolver a lista
inteira, não filtrada — reaproveita a mesma paginação já confirmada, então herda a confiança dela
(`ListarUsuariosComBiometria` virou um filtro em cima de `ListarUsuarios`).

⚠️ **Confirmado com dado real (log da LACEN, 12/08/2026): `sync` reprocessa as ~36 mil linhas do
AFD inteiro a cada ciclo de 5 minutos**, não só na primeira vez — o item já registrado acima como
pendência ("Antes de ligar em relógio de alto volume, trocar por leitura prévia do
`ultimo_nsr`"). Não corrompe nada (o atalho de idempotência por lote de `fn_ingerir_afd` devolve
o resultado já calculado, `reenvio: true`, sem reprocessar — só o log do coletor não distingue
isso de reprocessamento de verdade), mas é candidato a prioridade agora que há volume real
medido em produção.

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

Intervalo só para jornadas **acima de 6h**. Fonte única:

```sql
public.fn_jornada_tem_intervalo(p_duracao_minutos, p_intervalo_minutos)
  -- duração > 360 min E intervalo_minutos > 0
```

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

### 10. O identificador do AFD é CPF com **um** zero à esquerda

O registro tipo 3 do AFD (a marcação) carrega apenas `NSR + data/hora + identificador(12) + CRC`.
**A matrícula não aparece em nenhuma marcação** — só no tipo 5 (cadastro) e no `load_users.fcgi`.
Por isso `rep_vinculos_servidor` é a única ponte, e precisa ser populada **antes** de qualquer
`remove_users.fcgi`: apagado o usuário do relógio, os NSRs antigos ficam órfãos para sempre.

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

Agrava: quem usa relógio tende a ter `cpf` nulo no SisEscala, e `pis_pasep` está vazio em 100%
dos registros. Auditor fiscal casa por PIS/NIS — é projeto de qualidade de dados da Fase 9.

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

## Convenções

- **Idioma:** identificadores de domínio, comentários e mensagens de usuário em português.
  Migrations SQL sem acentos nos comentários.
- **Migrations:** `YYYYMMDDHHMMSS_descricao_em_ingles.sql`. Arquivos usam **CRLF** — scripts que
  fazem substituição de texto precisam tratar isso.
- **Nunca** rode migration direto em produção sem validar em homologação antes.
- Timezone padrão: `configuracoes_globais.timezone`, fallback `America/Sao_Paulo`.

## Verificação

```bash
npx tsc --noEmit     # type-check
npm run build        # build de produção
npm run lint
```

Não há testes automatizados. Mudanças em lógica de presença exigem verificação manual na grade
e no terminal, além da consulta de conferência incluída em cada migration de dados.
