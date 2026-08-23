# Changelog

All notable changes to this project will be documented in this file.

## [2.13.1] - 2026-08-23

### Added
- **Painel público de acompanhamento da implantação** — `/implantacao`. Link aberto, sem login, para a diretoria e a Secretaria acompanharem a chegada do ponto digital às unidades.
  - **Atualiza sozinho**: `revalidate = 300` regenera a página no servidor a cada 5 minutos, e um `meta refresh` mantém um telão vivo sem ninguém apertar F5. Nada depende de alguém rodar comando.
  - ⚠️ **Não podia ser um Artifact**: a CSP de uma página publicada bloqueia chamadas a servidores externos, então ela não conseguiria consultar o banco. Uma rota no próprio sistema resolve e ainda fica no domínio do município.
  - Mostra o funil da implantação (operando / em preparação / cadastrada), relógios ativos e data de ativação, servidores e setores por unidade, evolução mensal dos registros de ponto por origem, e o cronograma com os marcos de **01/09** (produção oficial) e **30/11** (cobertura total, incluindo a zona rural).
  - Gráficos em **SVG e CSS puros** — sem biblioteca nova para manter.
  - ⚠️ **Só dado agregado.** A consulta vive em `src/app/implantacao/dados.ts`, a única porta, e não devolve nome, matrícula, CPF nem horário de servidor. A página é aberta: o que não puder ser mostrado numa reunião de diretoria não pode ser consultado ali. Nome de unidade é informação pública; nome de pessoa, não.
  - **Ranking de uso** por unidade na competência corrente: volume de registros e **adesão** (fatia dos servidores escalados que efetivamente registrou ponto). Contagem apenas — nenhum servidor é identificado.
  - **Auditado contra o HTML publicado**, não só por desenho: os 500 servidores do cadastro foram cruzados com a página e **nenhum** nome, CPF, PIS, e-mail ou matrícula aparece. Só os 32 nomes de unidade, que são informação pública.
  - Entrou na lista de rotas que o middleware **não** redireciona para `/login` — sem isso a página aberta devolveria o formulário de login.

### Panorama na data (lido de produção)
- **33 unidades** cadastradas · **11 operando** (escala + relógio) · **22 a implantar**
- **13 relógios** ativos · **500 servidores** · 379 setores
- **895.406 registros** de AFD coletados · 2.991 sincronizações
- Marcações: jun **2.432** → jul **3.041** → ago **13.764** (2.708 já vindas do relógio)
- **Nenhuma unidade com escala está sem relógio** — o gargalo é cadastro e escala, não equipamento

## [2.12.2] - 2026-08-23

### Added
- **`docs/PENDENCIAS.md`** — índice único do que está aberto, com o cronograma. Aponta para o plano ou o diário que tem a medição; nunca é a fonte.
- **Plano da auditoria de segurança e LGPD** ([`docs/planos/2026-08-23-auditoria-de-seguranca-e-lgpd.md`](docs/planos/2026-08-23-auditoria-de-seguranca-e-lgpd.md)), pedida pelo usuário: o sistema escala rápido, guarda dado pessoal **sensível** (saúde em afastamentos, biometria, localização de sobreaviso) e roda em órgão público.
  - Cinco fases em ordem de **dependência**, não de gravidade: inventário → superfície de acesso → segredos → autenticação → documental/retenção.
  - A superfície tem **quatro portas para o mesmo dado** (RLS, RPC, server action, rota de API) e o histórico desta base já provou que elas divergem — cada uma é varrida por conta própria, com o comando de medição junto.
  - Registrado o que **não** tentar resolver na auditoria: reescrever a RLS, apagar histórico sem decisão jurídica, ou fechar o repositório por reflexo.

### Verificado em produção
- `20260823130000` confirmada: `position('fronteira_saida' in prosrc) > 0` → **true**. O terminal aceita a batida de transição.
- `20260823120000`: `tolerancia_extra_minutos_por_marcacao = 5`, `_diaria = 10`.
- `20260823110000`: `timezone` legível por anônimo — o terminal e o login passam a obedecer à configuração (antes a leitura devolvia vazio).
- Portão de projeção sobre 08/2026: **0 linhas invertidas, 0 durações impossíveis** em 283 dias.

## [2.12.1] - 2026-08-23

### Fixed
- **`20260823130000` foi recusada pelo Postgres na primeira aplicação** (`42601: "v_b_turnos_ini" is not a known variable`) e é corrigida aqui. `fn_confirmar_presenca` tem **dois blocos DECLARE com escopo próprio** — o cursor de ontem e o de hoje —, e a variável nova foi declarada só no de hoje, enquanto o gerador a usava nos dois. Nada chegou a ser aplicado: o `CREATE` falhou e a função anterior ficou intacta.
- O gerador ganhou a checagem que teria pego isso: **todo bloco que declara `v_b_ids` precisa declarar `v_b_turnos_ini`**, e os 9 usos são conferidos contra as declarações.
- `CLAUDE.md`, armadilha 1: registrada a distinção que essa falha expôs — **variável desconhecida o Postgres pega no `CREATE`** (`check_function_bodies`), enquanto coluna, função e operador inexistentes só falham em runtime. A recusa aqui foi barata; uma função inexistente teria passado e estourado no terminal.

## [2.12.0] - 2026-08-23

O terminal passa a **aceitar** a batida de transição entre turnos fundidos.

### Fixed
- **`fn_confirmar_presenca` ganhou os slots de fronteira** (migration `20260823130000`). A `20260819200000` os deu à reconciliação (`fn_blocos_previstos_dia`, `fn_alocar_marcacoes_dia`, `fn_projecao_marcacoes_dia`) e **não** ao terminal — quem batia na transição recebia `Fora da janela de presença permitida`. A batida não se perdia (virava marcação pendente), mas o **servidor via recusa e parava de bater**: AGNA (mat. 205) teve 13 recusas em 08/2026, e nos dias 5, 6 e 7 desistiu — a folha ficou com `REVISAR: SEM REGISTRO DE SAÍDA`.
  - Desde a `20260823100000` o dano financeiro já tinha acabado; o custo virou **trabalho manual** — sem a batida de transição, a saída do expediente fica vazia e vira pendência para o coordenador, dia após dia. Esta migration remove esse custo.
  - O bloco passa a carregar o previsto de **cada turno fundido**, e o laço ganha o passo **1.b**: na janela da fronteira, fecha o turno que termina ali; se já fechado, abre o seguinte. Grava na **linha** daquele turno, nunca no bloco inteiro.
  - ⚠️ **Posição no laço e desempate são deliberados.** Depois do checkin (não se fecha turno que não foi aberto) e **antes** do intervalo: em unidade de intervalo flexível o passo 2 aceita "qualquer momento após a entrada" e engoliria a transição, gravando-a como saída para o almoço (MAISA, mat. 32269, 18/08/2026). E o desempate contra o intervalo é por **proximidade**, o mesmo critério da alocação — senão terminal e reconciliação discordariam sobre a mesma batida.
  - **Nada é fabricado e nada passa a ser exigido**: sem batida na fronteira não há passo nenhum, como antes. Uma batida só continua bastando — ela fecha o turno e a reconciliação espelha para a entrada do seguinte.

### Verificação (armadilha 1 — seis regressões já saíram desta função)
- Corpo **copiado** da `20260822130000` por `scratchpad/gen_fronteira_no_terminal.js`, que **deriva** os arrays de turnos da própria lista de ids e aborta em qualquer divergência: 3 declarações, 22 atribuições, 9 cópias de bloco, 8 invariantes conferidos antes e depois.
- O gerador **abortou três vezes** antes de produzir a versão final — contagens de invariante erradas, âncora ambígua entre o cursor de ontem e o de hoje, e uma chamada a `fn_registrar_marcacao_terminal`, que **não existe** (em plpgsql isso só estouraria em runtime).
- Assinatura estrutural (`scratchpad/confere_estrutura_plpgsql.js`) **idêntica** à da versão em produção, item por item — os blocos abertos e fechados são exatamente os mesmos.

## [2.11.0] - 2026-08-23

Tolerância de variação no registro de ponto (CLT Art. 58 §1º), configurável.

### Added
- **Tolerância de variação no registro de ponto** — `src/utils/folha/toleranciaExtra.ts`, migration `20260823120000`, editável em Configurações → Regras.
  - Padrão da lei: **5 min por marcação, 10 min no dia**. **Zero nos dois desliga**, voltando ao comportamento anterior (cada minuto além da jornada virava hora extra).
  - ⚠️ **É um limiar, não uma franquia.** Súmula 366 do TST: ultrapassado o limite, computa-se a **totalidade** do excedente. Sair 4 min depois → 0; sair 12 min depois → **12 min**, não 2. Medido sobre 08/2026: como limiar deixa de pagar **18h24**; como franquia deixaria de pagar 120h55 — a diferença de 102h31 é o tamanho do erro de leitura.
  - **Os dois limites valem juntos.** Chegar 4 min antes e sair 4 min depois (8 min no dia) é tolerado; sair 8 min depois, sozinho, não é — estoura os 5 daquela marcação. É o que a lei diz, e é por isso que os dois parâmetros existem.
  - ⚠️ **A antecipação da entrada entra só na decisão, nunca no valor pago.** O SisEscala computa hora extra apenas pelo excedente da saída; ignorar a entrada faria um dia de 4+4 ser tolerado com o mesmo critério de um dia de 4 apenas.
  - Configurável porque o regime local pode divergir: o RJU de Marabá (Lei 17.331/2008) não disciplina tolerância, e a CLT vale subsidiariamente — a mesma lógica já aplicada ao intervalo intrajornada.
  - Aplicada nos **6 sítios** que calculam hora extra: as 4 cópias da geração, a auto-correção (`normalizarRegistrosFolha`) e a tela (`recalculateOvertimeForDay`). A tela precisa usar a mesma conta, senão o valor da folha muda só por alguém tocar na célula — o defeito corrigido em 21/08/2026.
  - Portão: `node scratchpad/sim_tolerancia_extra.js` — 24 casos (limites, desligamento, leitura de config, valor inválido, negativo e zero).

### Efeito
- **Não recalcula folha nenhuma.** O efeito aparece na próxima geração/sincronização/auto-correção. Sobre 08/2026 seriam 485h11 → 466h47.

## [2.10.2] - 2026-08-23

### Added
- **`POST /api/folha-ponto/regerar-competencia`** — regera as folhas de uma competência inteira em lote, reusando `executeGerarFolhaPonto` (a mesma função da tela e do cron; nenhuma regra de folha é reescrita).
  - `folha_ponto.registros` é um snapshot jsonb: corrigir a escala **não** corrige a folha. Depois de uma correção de dados ampla, alguém precisa regerar — e a tela só regera a unidade filtrada, exigindo de um perfil irrestrito escolher uma unidade antes de listar. "Regerar o município" viravam dezenas de cliques.
  - **Só mexe em folha `Rascunho`.** `Gerada`/`Revisada`/`Fechada` são puladas e reportadas: regerar uma folha revisada como rascunho a rebaixaria, perdendo o trabalho do coordenador em silêncio.
  - **Ensaio por padrão** — sem `{"aplicar": true}` no corpo, apenas relata quantas seriam regeradas.
  - Entrou na lista de rotas de API que o middleware **não** redireciona para `/login`. Quem chama é máquina, sem cookie de sessão: sem isso a chamada devolveria 307 + o HTML do login e "daria certo" sem fazer nada — o mesmo sintoma silencioso já corrigido para `/api/version` (09/08) e `/api/coletor-rep` (13/08).
  - Autoriza por `CRON_SECRET` ou `SUPABASE_SERVICE_ROLE_KEY` (comparação de tempo constante). A segunda não amplia privilégio: quem a possui já escreve direto em `folha_ponto` pelo PostgREST. **Sem nenhuma das duas no ambiente, devolve 500** — nunca um segredo embutido (armadilha 18).

## [2.10.0] - 2026-08-23

Fuso horário único em todo o sistema, vindo da configuração global. A mesma batida deixa de aparecer com horários diferentes conforme o computador de quem abre a tela.

### Fixed
- **A grade mostrava a hora em outro fuso que a folha de ponto**: a batida da AGNA CRISTINA RIBEIRO DO ROSÁRIO (mat. 205) de 10/08/2026 está gravada como `2026-08-10T11:03:40+00:00` — **08:03:40** em Marabá. A folha exibia `08:03` (formatava com fuso) e o tooltip da grade exibia `11:03` (não formatava, herdava o fuso da máquina). Três horas de diferença para o mesmo registro, no mesmo sistema.
- **Fonte única: `src/utils/horario.ts`**. Toda exibição de data e hora passa por ela, e ela **sempre** fixa o fuso — nunca herda o do navegador nem o do processo.
  - Medido em 23/08/2026: **96** formatações em `src/` não fixavam o fuso, contra 56 que fixavam. Das 96, **45** exibiam hora de timestamp e **22** exibiam data de timestamp — essas podiam errar o **dia inteiro** (a VPS roda em UTC, então as últimas 3 horas de todo dia já são "amanhã").
  - **125 chamadas reescritas em 31 arquivos** por `scratchpad/gen_fuso_unico.js`, com ensaio antes de aplicar. As 18 que sobraram sem fuso são todas nome de mês (`{ month: 'long' }`), que não depende de fuso.
  - Correção de brinde: `new Date('2026-08-01').toLocaleDateString('pt-BR')` exibia **31/07**. `formatarData` reconhece a forma `YYYY-MM-DD` como data de **calendário** e não converte nada.
- **O fuso vem de `configuracoes_globais.timezone`, não de literal espalhado.** A chave sempre existiu e as funções PL/pgSQL sempre a respeitaram; a tela nunca a editou e o frontend nunca a leu. Os 56 literais `'America/Sao_Paulo'` passam a ler a configuração.

### Added
- **Fuso Horário do Sistema** na tela de Configurações → aba Regras: Brasília/Pará, Manaus, Cuiabá, Porto Velho, Boa Vista, Rio Branco, Fernando de Noronha e UTC.
- **Migration `20260823110000`**: a policy "Portal access to public configs" passa a liberar a chave `timezone`. Sem isso o terminal de ponto, o login e o portal do servidor — todos anônimos — cairiam no padrão e não respeitariam a configuração. Mesmo caso e mesma correção da `20260814140000`.

### Changed
- O layout raiz lê o fuso e o publica no HTML (`window.__SISESCALA_TZ__`), em vez de o cliente buscá-lo. Sem fetch extra e sem piscar a hora errada antes de a configuração chegar. Falhou a leitura? Cai em `America/Sao_Paulo` — **nunca** no fuso da máquina.

### Não foi tocado
- `new Date(new Date().toLocaleString('en-US', { timeZone }))` — o padrão canônico do projeto para obter a hora local (armadilha 12). É **cálculo**, não exibição: o resultado alimenta `getDate()/getMonth()`, e trocá-lo quebraria a lógica de negócio. O ensaio do gerador pegou essa troca indevida antes de aplicar.

## [2.9.0] - 2026-08-23

Turno Regular emendado com Plantão: o passo do bloco deixa de ser copiado para todas as linhas dele, e uma batida solitária na transição passa a servir aos dois lados. Fim da dupla contagem que creditava 16h para 10h trabalhadas.

Diário completo em [`docs/evolucao/2026-08-23-dono-do-passo-do-bloco.md`](docs/evolucao/2026-08-23-dono-do-passo-do-bloco.md); plano e medições em [`docs/planos/2026-08-23-turno-regular-emendado-com-plantao.md`](docs/planos/2026-08-23-turno-regular-emendado-com-plantao.md).

### Fixed
- **O passo do bloco pertence a UM turno (`fn_projecao_marcacoes_dia`, migration `20260823100000`)**:
  - Turnos encostados fundem num bloco só (armadilha 6) e a projeção gravava o par entrada/saída do **bloco** em **todas** as linhas dele. Com duas batidas apenas (entrar e sair), a linha do **Regular** recebia a saída do **Plantão** — e a folha cobrava aquelas horas como **hora extra**, enquanto o anexo de plantões já as pagava. Caso real: AGNA CRISTINA RIBEIRO DO ROSÁRIO (mat. 205, LACEM), jornada `08H ÀS 14H` + Plantão `T`, dias 10 a 12 de 08/2026 — `EXTRA 04:03 (50%)` sobre um plantão de 6h.
  - Agora a **entrada** do bloco alcança só a linha do **primeiro** turno, a **saída** só a do **último**, e o **intervalo** só a do turno cuja janela o contém. Critério **posicional**, sem tolerância de horário nova.
  - **Nada é fabricado.** Sem batida na fronteira, a saída do expediente fica **vazia** e vira pendência de revisão — decisão explícita: o sistema não preenche onde o servidor **tem** como registrar (vedação 2 da Portaria 671/2021).
  - Bloco `Regular + Extra` é **neutro** na folha: `turnosDaFolha` mantém as duas linhas e o `min(entrada)/max(saída)` dá o mesmo resultado de antes.
- **Batida solitária na transição espelha para o slot irmão (`fn_alocar_marcacoes_dia`)**:
  - Os dois slots de uma fronteira são previstos no mesmo instante, mas o alinhamento é 1-para-1: uma batida ocupava um só. Quem batia **uma** vez na transição fechava o turno e não abria o seguinte, e o plantão voltava a exibir a entrada do expediente (AGNA, dias 3 e 4).
  - Isso encerra a regra folclórica de **"sair, esperar uns 5 minutos e bater de novo"**. O número real nunca foi 5 minutos: era **1 minuto**, o `rep_janela_duplicidade_segundos = 60` que descartava a segunda batida como duplicada — no dia 4 havia duas batidas às `14:00:00` e a segunda sumiu. Agora **uma** batida basta; duas continuam valendo mais e não regridem.
  - `fn_alocar_marcacoes_dia` passa a devolver a chave **`turnos`** (aditiva), com a ordem e a janela de cada turno do bloco.
- **Linha que perde todos os passos continua na projeção, com tudo nulo**: `fn_reconciliar_marcacoes_dia` grava a projeção inteira, nulos inclusive, **mas só alcança as linhas que a projeção devolve**. Sem isso a linha do Plantão de um dia em que só houve entrada ficaria para sempre com a entrada do expediente.

### Changed
- `CLAUDE.md`, armadilha 6: registrados os três fatos que mudam o conselho operacional — a janela de duplicidade de 60 s, `fn_confirmar_presenca` **não** ter os slots de fronteira (a batida de transição é recusada no terminal, vira marcação pendente e só a reconciliação a aproveita), e `fn_salvar_saida_bloco` **fabricar** os horários de transição a partir da escala.

### Produção — 08/2026
- Portão sobre os **283 dias** com 2+ turnos no mesmo dia: **0** linhas invertidas e **0** durações impossíveis na projeção.
- Reconciliação **restrita aos 131 dias medidos** (19 servidores), nunca em massa, com backup do estado anterior antes de qualquer escrita: **176 linhas** de `escala_diaria` alteradas.
- Hora extra nos 27 dias com plantão escalado: de **75h12** para **3h21**. Saldo nos 131 dias reconciliados: **26h a menos**.
- Auditoria de piora: **nenhuma real**. Os dias que "perdem a saída" perdiam horário **fabricado** ou uma saída que pertence ao Plantão; os que "ganham extra" são turnos **Extra escalados** que a folha, num snapshot anterior ao `turnosDaFolha` de 19/08, não tinha.
- **06/2026 e 07/2026 não foram tocadas.**

### Pendente
- **Auditoria das marcações sintéticas**: `fn_salvar_saida_bloco` fabrica horário de transição e a folha o exibe com origem `real`. Em 08/2026 são **533** marcações `sintetica` de origem `terminal`, 51 servidores, **244 já gravadas como presença**.
- **O terminal ainda recusa a batida de transição** (`fn_confirmar_presenca` sem slots de fronteira) — a batida não se perde, mas o servidor vê recusa e deixa de bater.
- **Reclassificar batida real entre linhas do mesmo dia**: `fn_reclassificar_passo_presenca` só move entre passos da **mesma** linha.

## [2.8.0] - 2026-08-22

Gestão de usuários liberada para os dois perfis de RH — com autorização de verdade nas server actions, que até aqui não existia — e o intervalo intrajornada do plantão deixando de ser herdado da jornada Regular do servidor.

Diários completos em [`docs/evolucao/2026-08-22-gestao-de-usuarios-pelo-rh.md`](docs/evolucao/2026-08-22-gestao-de-usuarios-pelo-rh.md) e [`docs/evolucao/2026-08-22-intervalo-do-plantao.md`](docs/evolucao/2026-08-22-intervalo-do-plantao.md).

### Added
- **RH Geral e RH da Unidade passam a cadastrar usuários (`src/utils/gestaoUsuarios.ts`)**:
  - O item **Usuários** do grupo SISTEMA foi liberado para os dois perfis de RH. Configurações, Backup e Segurança continuam exclusivos do Administrador Geral. **Diretor, Coordenador e Ass. Administrativo continuam sem acesso.**
  - **RH Geral** enxerga e administra todos os usuários **exceto os de perfil Administrador Geral**, e pode atribuir qualquer papel menos esse.
  - **RH da Unidade** enxerga apenas as contas cujo escopo cabe **inteiro** dentro das unidades dele, e só pode atribuir papéis escopados por unidade (Ass. Administrativo, Coordenador e RH da Unidade). Não concede "Acesso Total" a unidades: a caixa some da tela **e** a action recusa o payload.
  - A restrição de papéis do RH da Unidade fecha uma escalada de privilégio: `rh` tem bypass total em `applyAccessFilters` e `admin` carrega gestão ampla — criar uma conta dessas com senha que ele mesmo define contornaria o próprio escopo em um clique.
  - **Uma regra só para gravar**: `validarPayload` aplica `alcancaUsuario` sobre o **resultado** da gravação — o gestor não pode deixar no ar uma conta que ele mesmo não enxergaria. Isso cobre papel, "Acesso Total" e unidades/setores sem listas de exceção paralelas.
  - Conta vinculada apenas por `profile_setores` (coordenador sem a unidade-pai vinculada) conta como sendo da unidade; setor desconhecido é tratado como **fora** do escopo.
  - **Redefinir senha** e **ativar/inativar** liberados dentro do escopo. **Excluir usuário continua exclusivo do Administrador Geral** — é irreversível e não deixa log; o RH inativa, que é reversível e auditado.
  - Portão de verificação: `scratchpad/sim_gestao_usuarios.js`, 34 casos de alcance, payload e exclusão.
- **Intervalo do plantão como propriedade do turno (`20260822120000_plantao_interval_from_shift_dictionary.sql`)**:
  - Nova coluna `dicionario_turnos.intervalo_minutos` (nullable) e as funções `fn_intervalo_minimo_legal(duracao)` e `fn_intervalo_previsto_minutos(categoria, duracao, jornada, turno)` — fonte única que resolve `GREATEST(cadastro, piso legal)`.
  - Todos os 53 códigos de plantão ficam `NULL` de propósito: o piso derivado da duração (> 6h → 60 min) é o que torna a regra impossível de esquecer. Preencher a coluna serve apenas para **elevar** acima do piso, nunca para rebaixar.
  - Espelho no frontend em `src/utils/intervaloIntrajornada.ts` (`celulaTemPassosDeIntervalo`), consumido pelos dois sítios de `ScaleGrid.tsx`.

### Fixed
- **Nenhuma server action de `/usuarios` conferia papel (`src/app/(dashboard)/usuarios/actions.ts`)**:
  - `createUser`, `updateUser`, `resetPassword`, `deleteUser` e `toggleUserStatus` montavam um client com `SUPABASE_SERVICE_ROLE_KEY` e escreviam direto: a única autorização do módulo era o `if` da página. Server action do Next é um endpoint POST cujo id sai no bundle — **qualquer usuário autenticado podia criar para si um Administrador Geral**, sem passar por tela nenhuma. Falha pré-existente, anterior a esta versão. Cada action passou a autorizar sozinha, sobre o estado **atual** do alvo.
  - Em `updateUser` a ordem é deliberada: alcance sobre o que a conta **é hoje** antes de validar o que ela **vai virar** — invertendo, um RH da Unidade "puxaria" para dentro do escopo uma conta de outra unidade só mandando as unidades certas no formulário.
- **`supabase.auth.admin.listUsers()` devolvia no máximo 50 contas, em silêncio (`src/utils/authAdmin.ts`)**:
  - O `perPage` padrão do supabase-js é 50. Com 63 contas em produção, **13 pessoas nunca apareceram** em `/usuarios`; e a checagem de e-mail duplicado de `updateServidor` varria essa lista truncada, podendo deixar passar um conflito que o Auth recusaria em seguida — deixando login e ficha divergentes, exatamente o defeito que ela existe para evitar. Fonte única paginada (`listarTodosUsuariosAuth`) aplicada nos três pontos de chamada.
- **Intervalo do plantão herdado da jornada Regular (`20260822130000_plantao_interval_presence_functions.sql`)**:
  - `fn_jornada_tem_intervalo(duracao, intervalo_minutos)` recebia os dois argumentos de fontes diferentes: a **duração** já vinha do turno (`horas_computadas`) para Plantão/Extra, mas o **intervalo** vinha sempre de `jornadas.intervalo_minutos`. Como toda jornada de até 6h tem `intervalo_minutos = 0` — correto para o expediente dela —, esse zero **anulava o guard inteiro** em qualquer plantão daquela pessoa, de qualquer duração.
  - Caso real, mesmo sábado e mesmo turno `MT` de 12h: uma servidora de jornada 10h recebeu bloco 08:00–20:00 com intervalo 12:00–14:00; outra, de jornada 6h, recebeu 07:00–19:00 **sem intervalo nenhum**. O prejuízo já tinha ocorrido com batida assinada do relógio: batidas REP das 14:41 e das 13:00 foram gravadas como **saída** de plantões que iam até 19:00, sem gerar sequer tentativa recusada.
  - Simulado sobre as 10.152 linhas de `escala_diaria` de produção antes de aplicar: **106 plantões ganham** o passo de intervalo, **zero perdem**, `Regular` e `Extra` ficam inteiramente inalterados.

### Changed
- **`profiles` passa a ser lido pelo client admin em `/usuarios`**: a policy `"Users can view own profile"` libera a tabela inteira apenas para `super_admin` — com a sessão do RH, a listagem devolveria uma linha só. Quem restringe a lista é o filtro de escopo em JS. **Nenhuma policy de RLS foi alterada.**
- **Migrations do plantão renumeradas para `20260822120000` e `20260822130000`**: duas sessões de trabalho em paralelo geraram duas migrations com o prefixo `20260822100000`, o que deixa a ordem de aplicação indefinida. A companheira foi renumerada junto para não inverter a ordem do par, com as 26 referências ao número antigo atualizadas em migration, diário e script gerador.

## [2.7.1] - 2026-08-22

### Fixed
- **Segredos fora do código de um repositório público**: removido o JWT `service_role` de homologação embutido em `scripts/corrigir_folhas_banco.mjs` e o fallback de `CRON_SECRET` embutido em `/api/cron` e `/api/avisos-ponto/despachar`. As duas rotas passam a **falhar explicitamente** (500) sem a variável no ambiente — mesmo padrão já adotado para `TERMINAL_LOCAL_SESSION_SECRET`. Chaves de produção nunca entraram no histórico (conferido em todos os commits).
- **Snapshot do relógio passa a encerrar o vínculo de quem saiu (`20260822200000`)**: `rep_vinculos_servidor` nunca era reconciliado com o que o equipamento realmente tem — quem era apagado na telinha do relógio continuava vinculado aqui para sempre, e a aba Cobertura da Escala exibia `ok` para quem não estava mais no aparelho. Duas guardas: lista vazia nunca reconcilia, e vínculo criado há menos de 15 min é poupado.

### Added
- **Corte de ponto por dispositivo (`20260822210000`)**: nova coluna `dispositivos_rep.ponto_valido_desde`. A resolução de identidade caía para CPF e depois PIS **sem olhar a data da batida**, então o AFD inteiro de um relógio reaproveitado virava ponto atribuído já na ingestão — 9.626 marcações com dono anteriores a 07/2026, a mais antiga de 2019, em sete equipamentos. O corte age na **atribuição**, nunca na ingestão, o que o torna reversível.

## [2.7.0] - 2026-08-22

### Added
- **Vínculo explícito usuário ↔ servidor (`20260822100000_add_profiles_servidor_id.sql`)**: nova coluna `profiles.servidor_id` com índice único parcial. Até aqui a associação era recalculada a cada render casando por e-mail **ou** por nome iguais, e o `<input type="hidden" name="servidor_id">` da tela nunca era lido por action nenhuma.
- **E-mail do servidor propaga para o login (`auth.users.email`)**, restrito a `super_admin` e `rh`. Corrigir o e-mail na ficha deixava o login com o valor antigo, quebrava o casamento e derrubava o acesso do próprio servidor à escala dele em três telas.

## [2.6.0] - 2026-08-21

### Fixed
- **Dia vazio COM batida deixa de ser falta**: três servidores da SMS receberiam FALTA na folha de agosto tendo batida com NSR de AFD assinado, porque a falta automática olha só `escala_diaria`. FALTA cai de 321 para 318 em agosto; os três viram pendência de revisão. Inclui `20260821120000`, que recupera uma batida que apenas não tinha sido reconciliada.

## [2.5.1] - 2026-08-21

### Fixed
- **Hora extra passa a exigir ENTRADA registrada**: crédito de hora extra a partir de saída solitária, sem entrada — 31 dias, 12h16, em 27 folhas de agosto/2026 (2,6% da hora extra do mês). Alinha a geração ao que o editor e o normalizador já faziam.

## [2.5.0] - 2026-08-21

### Added
- **Dia incompleto sinalizado na folha de ponto**: "REVISAR: SEM REGISTRO DE ENTRADA/SAÍDA" no dia que tem batida mas não tem os passos necessários para saber quanto a pessoa trabalhou — 51,8% dos dias com turno da SMS em agosto estavam nesse estado, sem nenhuma sinalização.
- Recolhe também os commits de feature que ficaram sem tag depois da v2.4.0, entre eles a troca de turno com histórico e justificativa (`20260821110000`), o conflito que a célula fazia consigo mesma (`20260821100000`) e a decomposição do plantão em unidades de pagamento (`src/utils/plantaoUnidades.ts`).

### Changed
- `package.json` volta a acompanhar a tag: estava parado em 2.3.0 desde a v2.2.0. Isso importa porque `NEXT_PUBLIC_APP_VERSION` vem dali e é o que faz o terminal de presença detectar o deploy e recarregar.

## [2.4.0] - 2026-08-20

### Added
- **Infraestrutura da Fase 5 do REP**: a chave de corte por unidade (`unidades.fonte_ponto_oficial`, `20260820000000`), reparse acionado pela criação de vínculo (`20260820010000`), escrita direta neutralizada com aplicação da precedência em unidade `rep` (`20260820020000`) e exceção de ponto por (servidor, dispositivo) para quem administra o parque (`rep_excecoes_ponto`, `20260820030000`).
- **Afastamento passa a bloquear todos os caminhos de escrita da grade (`20260820120000`)**: "Aplicar Template" e Gerador Inteligente escreviam direto no estado sem passar pela validação da célula, e `Sobreaviso` nunca esteve coberto pelo nome da configuração que liberava plantão/extra. Fonte única no frontend em `src/utils/afastamentos.ts`.

## [2.3.0] - 2026-08-19

Alteração de jornada no meio da escala com vigência por data, histórico auditável da troca e correção do cálculo de carga horária quando o servidor cumpre jornadas diferentes no mesmo mês.

Diário completo da investigação e das medições em [`docs/evolucao/2026-08-19-mudanca-de-jornada-no-meio-da-escala.md`](docs/evolucao/2026-08-19-mudanca-de-jornada-no-meio-da-escala.md).

### Added
- **Histórico Auditável da Troca de Jornada (`20260819230000_audit_jornada_change_escala_mensal.sql`)**:
  - Nova tabela append-only `escala_mensal_jornada_historico`, alimentada pela trigger `trg_registrar_troca_jornada`, que registra valor anterior, valor novo, autor e data de **toda** alteração efetiva de `escala_mensal.jornada_id` — inclusive as feitas pelo upsert da grade. Até aqui a troca não deixava rastro nenhum, e o valor anterior era irrecuperável.
  - O filtro `IS DISTINCT FROM` garante que o "Salvar Previsão" (que reenvia todas as linhas da escala) não gere linhas de ruído.
  - Nova RPC `fn_alterar_jornada_escala_mensal(escala_mensal_id, jornada_id, justificativa)`: exige justificativa, recusa escala `Fechada` e publica o texto num GUC local à transação para a trigger consumir — um único ponto de gravação do histórico, dois caminhos de entrada.
- **Modal "Alterar Jornada" na Grade de Escala (`AlterarJornadaModal.tsx`, `jornadaActions.ts`)**:
  - Ao trocar a jornada de um servidor que **já possui ponto registrado no mês**, a grade passa a exigir uma decisão explícita entre dois caminhos distintos, em vez de aplicar a troca em silêncio:
    - **"Passou a cumprir o novo horário a partir do dia X"** — redução de jornada por decisão judicial, acordo interno ou mudança de setor. Cria a vigência por data e **não** altera a jornada do mês; os dias anteriores continuam julgados pelo horário que valia neles.
    - **"A jornada estava errada desde o dia 1"** — erro de cadastro. Reescreve o mês inteiro, com justificativa obrigatória registrada no histórico.
  - O dia de início vem pré-preenchido com o dia seguinte à última batida registrada, e o modal informa quantos dias já trabalhados seriam reavaliados pela troca.
  - Sem batida no mês, a troca continua acontecendo direto, sem modal.

### Fixed
- **Carga Horária Ignorava a Jornada Vigente por Data (`src/utils/folha/cargaDiaria.ts`)**:
  - O recálculo de totais da folha somava `horas_totais` da jornada do **mês** para todo dia com turno, enquanto o registro de cada dia já gravava a jornada correta em `jornada_nome`. Servidor com jornada alterada por vigência tinha o total do mês computado pela jornada errada — medido em produção: uma folha somava 76h onde o correto eram 100h.
  - A regra existia em **quatro** cópias (`salvarFolhaPonto`, `autoCorrigirFolhaPonto`, `salvarFolhaPontoServidor` e `autoCorrigirTodasFolhasPonto`, esta última aplicada a todas as folhas de uma vez). Todas passam a usar a fonte única `horasNormaisDoDia`.
- **Vigência de Jornada Voltava Sozinha ao Horário Antigo no Mês Seguinte (`intelligentScaleGenerator.ts`)**:
  - O Gerador Inteligente herdava `escala_mensal.jornada_id` do mês anterior sem consultar `servidores_jornadas_temporarias`. Uma mudança permanente registrada como vigência era **silenciosamente desfeita** na virada do mês. A herança passa a considerar a jornada vigente no **último dia** do mês anterior — critério que preserva o comportamento correto para vigências curtas no meio do mês, que continuam não sendo herdadas.
- **Resolução de Jornada por Data Não Era Determinística (`20260819240000_journey_vigencia_determinism.sql`)**:
  - `obter_jornada_servidor_data` usava `SELECT ... LIMIT 1` **sem `ORDER BY`**: com duas vigências cobrindo a mesma data, a mesma batida podia ser julgada contra janelas diferentes em execuções diferentes. Passa a ordenar por `created_at DESC, data_inicio DESC, id DESC` (a decisão mais recente vence).
  - Nova trigger `trg_vigencia_jornada_sem_sobreposicao` recusa a criação de períodos sobrepostos para o mesmo servidor, com mensagem indicando o período conflitante. Períodos encostados (sem sobreposição real) continuam permitidos.
- **Seletor de Jornada Sem Bloqueio em Escala Fechada (`ScaleGrid.tsx`)**:
  - O seletor de jornada da grade nunca teve o guard de escala `Fechada` / competência encerrada que as células de turno já tinham — era possível alterá-lo na tela, e só o botão Salvar barrava depois. Passa a usar o mesmo critério.

### Changed
- **Nomenclatura: "Jornada Temporária" → "Alteração de Jornada por Período (vigência)"**:
  - O rótulo antigo afastava o coordenador do caminho correto: redução de jornada por decisão judicial não é "temporária", então quem precisava registrá-la não procurava essa aba e acabava trocando a jornada do mês, o que reescreve os dias já trabalhados. A tabela e a resolução por data sempre serviram aos dois casos.

## [2.2.0] - 2026-08-19

Verso oficial da Folha de Ponto com justificativas e anexo de plantão/sobreaviso, suporte a afastamentos fracionados (por horas), auto-reconciliação em massa de marcações REP com resolução por duplo vínculo, e coletor REP v0.7.0 com higiene automatizada em segundo plano e CI no GitHub Actions.

### Added
- **Verso da Folha de Ponto com Detalhamento de Justificativas (`FolhaPontoEditor.tsx`)**:
  - Implementado o verso oficial da Folha de Ponto com quadro analítico de ocorrências, justificativas registradas, atestados, declarações e histórico completo para prestação de contas aos órgãos fiscalizadores.
  - Carregamento administrativo seguro via `createAdminClient` no backend (`actions.ts`), garantindo exibição fidedigna sem recortes indevidos por políticas de RLS de visualização.
- **Relatório Anexo de Plantão e Sobreaviso (`RelatorioPlantaoSobreavisoAnexo.tsx`)**:
  - Novo relatório gerado em PDF e visualização para impressão consolidando plantões extras e escalas de sobreaviso cumpridas no mês.
  - Integração com `justificativas_eventos` e enriquecimento automático com código e descrição oficial do `dicionario_turnos`.
- **Afastamentos Fracionados por Horas (`20260817210000_add_afastamento_por_horas.sql`)**:
  - Suporte completo no banco de dados e na interface para afastamentos com definição de horários de início e fim (`tipo_periodo = 'horas'`, `hora_inicio`, `hora_fim`).
  - Abono parcial inteligente: permite registrar saídas antecipadas, consultas médicas ou convocações pontuais sem anular o dia inteiro de trabalho, calculando com precisão as horas abonadas e preservando o cumprimento da jornada no espelho de ponto e no Portal do Servidor.
- **Reprocessamento Retroativo e Auto-Vínculo de Batidas Órfãs (`fn_reparse_afd_dispositivo` e `fn_reprocessar_marcacoes_orfas_dispositivo`)**:
  - Ao vincular ou cadastrar um servidor no relógio ou no sistema, o SisEscala agora reprocessa retroativamente todas as batidas históricas daquele CPF/PIS no AFD que constavam como órfãs, vinculando-as ao servidor e disparando a auto-reconciliação das escalas do mês.
- **Consulta Otimizada de Batidas do Mês (`fn_marcacoes_mes`)**:
  - Nova RPC de alta performance (`20260818005000_add_fn_marcacoes_mes.sql`) consumida pelo `ScaleGrid.tsx` para carregar a origem e status real de todas as marcações mensais dos servidores da unidade sem gargalos de RLS.
- **Coletor REP v0.7.0 & Automação de Higiene de Cadastros**:
  - A rotina `HigienizarRemocoes` agora é executada automaticamente pelo ciclo de background do coletor a cada 5 minutos: cadastros marcados para exclusão no SisEscala são removidos do hardware REP e validados por relistagem sem intervenção manual.
  - Novos atalhos no menu da bandeja do Windows (Tray) para forçar sincronização imediata, disparo de higiene e verificação de atualizações.
- **Pipeline de Integração Contínua (CI) no GitHub Actions (`.github/workflows/ci.yml`)**:
  - Automação de validações a cada push na branch `main`: compilação de binários Go para Windows (`coletor-rep-cli.exe` e `coletor-rep-tray.exe`), checagem estática de tipos com TypeScript (`tsc --noEmit`), ESLint e teste de build do Next.js.
- **Governança e Permissões RLS Ampliadas**:
  - Perfil `ass_adm` (Assistente Administrativo) habilitado em políticas RLS para relatórios consolidados, frequência, distribuição, auditoria e visualização de escalas (`20260818170000_allow_ass_adm_in_rls_policies.sql`).
  - Perfil `rh` (`rh_geral` e `rh_unidade`) com permissões granulares em RLS para atualizações cadastrais de servidores e validações server-side reforçadas (`20260818100000_allow_rh_roles_in_servidores_rls.sql`).

### Fixed
- **Resolução de Identidade do Servidor no REP com Escopo de Unidade para Duplo Vínculo (`20260818200000_fix_rep_identity_and_auto_reconcile_all_punches.sql`)**:
  - Correção na função `fn_servidor_por_identificador_afd` para considerar o escopo da unidade do dispositivo REP, resolvendo ambiguidades em municípios onde o mesmo servidor possui dois vínculos funcionais ativos com o mesmo CPF.
  - Ingestão de AFD passa a acionar a auto-reconciliação imediata de marcações (`fn_reconciliar_marcacoes_dia`), eliminando a defasagem entre o recebimento da batida e o espelho de ponto.
- **Árvore Hierárquica de Setores em Justificativas**:
  - Ajustada a formatação dos seletores de setor na tela de justificativas (`JustificativasClient.tsx`), organizando subsetores com indentação visual baseada em `parent_id`.
- **Navegação e Sincronização no `ScaleGrid`**:
  - Correção no fluxo de navegação da célula da escala direto para a geração da Folha de Ponto e sincronização em tempo real de eventos e batidas.
- **Seleção de Colunas em `dicionario_turnos`**:
  - Corrigida a consulta em `actions.ts` da folha de ponto para buscar apenas as colunas existentes (`codigo`, `descricao`), eliminando exceções no carregamento de turnos.

## [2.1.0] - 2026-08-17

Identidade do relógio deixa de assumir CPF, e o push de cadastro passa a rodar sozinho.

### Fixed
- **Relógio cadastrado por PIS resolvia ZERO servidores, em silêncio** (migration `20260817170000`).
  "O identificador do AFD é o CPF" nunca foi propriedade do AFD — é propriedade de **como cada
  pessoa foi cadastrada em cada relógio**. O REP da SMS veio de outro sistema que cadastrava por
  PIS/NIS: dos 323 usuários dele, **292 validam como PIS e 13 como CPF** (conferido por dígito
  verificador). Consequências, todas sem erro visível: o snapshot resolvia 0 dos 323, a tela
  "Cobertura da Escala" rotulava `fora_do_relogio` **27 servidores que estão no equipamento com
  biometria e batem ponto todo dia**, e as 265.922 marcações ficaram sem dono.
  - Nova **fonte única** `fn_servidor_por_identificador_afd`: tenta vínculo vigente → CPF → PIS, e
    **recusa em vez de chutar** quando há ambiguidade (CPF de um sendo PIS de outro, ou dois
    servidores Ativos com o mesmo número). Dono errado lança ponto de uma pessoa em outra; sem dono
    é um problema visível na tela.
  - **Não** foi criada coluna "tipo de identificador" por dispositivo: seria errada desde o primeiro
    dia, porque a SMS vai ficar **misturada** (292 antigos por PIS + todos os novos por CPF, no mesmo
    equipamento). Misturado é o caso normal.
  - Conferido em produção antes de escolher o desenho: **0** números que sejam CPF de um servidor e
    PIS de outro, e **0** usuários de relógio que casariam com dois servidores — nos 4 dispositivos.
    Ampliar para PIS não muda nenhum casamento existente em LACEM, CEI ou Reg/TI/TFD.
  - Fecha de brinde um risco latente no snapshot: dois Ativos com o mesmo CPF multiplicavam a linha
    e estouravam `uq_usuario_dispositivo`, derrubando o snapshot inteiro. E a cobertura passou a usar
    `LATERAL ... LIMIT 1`, porque a mesma pessoa pode ter **dois** cadastros no equipamento.
- **Vínculo criado pelo push usava um identificador calculado por nós** (migration `20260817180000`).
  Era `lpad(cpf,12,'0')`, não o número que o equipamento guardou — no relógio da SMS isso produziria
  327 vínculos que jamais casariam com as linhas do AFD, em silêncio absoluto. Agora o coletor lê o
  identificador de volta do próprio relógio (por relistagem) e é **ele** que vira o vínculo; sem
  isso, cai no cálculo por CPF, correto nos outros três.
- **Toda falha do push era terminal.** `fn_confirmar_cadastro_rep` marcava `falhou` e o item saía da
  fila para sempre (`tentativas` nunca passava de 1). Com humano clicando o botão era tolerável; no
  ciclo automático, um relógio desligado por um minuto queimaria o cadastro de uma pessoa
  permanentemente e sem alarme. Agora: recusa do equipamento → `falhou` definitivo; falha de
  transporte → volta para `pendente` com espera de 5 min × tentativa, teto de 5.

### Added
- **Sincronização de cadastros automática** (coletor v0.6.0). Entra no ciclo de 5 min que já existe,
  em vez de um segundo temporizador: **a própria fila é o gatilho** — sem ninguém enfileirado nada é
  escrito no equipamento, e o custo em repouso é um GET que devolve lista vazia. Isso faz o botão
  "Sincronizar cadastros" da tela funcionar como comando remoto (ele enfileira; o próximo ciclo
  aplica), o que é o mais próximo de "push" que a topologia permite — o servidor não tem caminho de
  rede até a máquina da unidade. Teto de 20 por ciclo, porque o ciclo e os cliques do menu dividem
  uma goroutine. O botão manual continua, sem teto.
- **Varredura de formato do `add_users.fcgi`**, mesmo padrão já confirmado em campo para
  `remove_users.fcgi`: candidatos em ordem (`cpf` confirmado em 12/08 → `pis` → ambos), confirmando
  por relistagem que o usuário **realmente** apareceu — "sem erro" do equipamento não basta. O
  formato vencedor fica em cache para o resto do lote, e `cadastros-testar` passa a imprimir qual
  formato foi aceito e qual identificador o relógio atribuiu.
  ⚠️ **Não confirmado em hardware**: rodar `coletor-rep-cli cadastros-testar` na unidade antes de
  confiar. Se o equipamento validar o dígito verificador de PIS, mandar CPF no campo `pis` também
  será recusado — e aí o cadastro naquele relógio terá de ser por PIS de verdade.
- O `SincronizarCadastros` passou a relatar o **snapshot inteiro** ao SisEscala no fim (a listagem já
  era feita ali e era jogada fora depois de filtrar biometria). É o que torna o fluxo autocorretivo:
  mesmo que o identificador reportado falte, o snapshot reconcilia em seguida pela fonte única.

## [2.0.3] - 2026-08-17

### Fixed
- **Cursor de AFD nunca sairia de 1 enquanto o NSR 1 não tivesse chegado** (migration
  `20260817160000`, corrigindo a `20260817150000` do mesmo dia). A versão original abria com um guard
  "se não existe o NSR 1, peça o arquivo todo", que embutia a suposição de que todo AFD começa em 1 —
  premissa tirada dos 3 dispositivos que tinham dado real na hora.
  - Exposto na recuperação de ~268 mil registros do REP iDClass - SMS: o menor NSR apareceu como
    3001 e depois 501, **descendo**, porque a fila offline reenvia lote em ordem de nome de arquivo
    (`os.ReadDir` sobre `lote_id`, que é hash), não de NSR. Enquanto o NSR 1 não chegasse, o guard
    disparava em todo ciclo e o equipamento remontava o arquivo inteiro a cada 5 minutos — o ganho
    da coleta incremental era zero. (O piso real acabou sendo 1; o guard travaria de todo modo, e
    travaria para sempre num modelo que comece acima disso.)
  - A correção é uma **remoção**: o cálculo por trecho contíguo já tratava os dois casos, e passa a
    ancorar no **menor NSR do dispositivo** em vez de exigir que ele seja 1. Nunca houve risco de
    perder marcação — errar o cursor para baixo só rebaixa dado que já existe, e reingerir é de
    graça. Validado em homologação contra 5 cenários, incluindo regressão dos dispositivos com piso
    em 1 e o trailer `999999999`.
- **Fila offline do coletor se multiplicava sozinha, e isso travava o menu da bandeja**
  (coletor v0.5.2). `fila.Gravar` abria o arquivo com `O_APPEND`, mas o arquivo é nomeado pelo
  `lote_id` — que é hash determinístico do próprio conteúdo — e `fila.Pendentes` lê **cada linha
  como um lote a reenviar**. Então cada ciclo que falhava acrescentava outra cópia idêntica do mesmo
  lote: na máquina do RH da SMS, ~12 ciclos recusados por desvio de relógio transformaram ~80 lotes
  em cerca de **1.000 reenvios por ciclo**, crescendo a cada 5 minutos.
  - O sintoma que apareceu para quem estava na frente da máquina não foi "fila grande", foi **"o app
    travou"**: `executarCiclo` e os cliques do menu dividem uma goroutine só (`cmd/tray/main.go`),
    então um ciclo de vários minutos deixa "Verificar atualizacao" sem resposta. Um bug de
    duplicação em disco virou app que não atualiza.
  - `Gravar` passou a **substituir** o arquivo do lote, não acrescentar.
  - O reenvio da fila **desiste depois de 3 falhas seguidas** e deixa o resto para o próximo ciclo:
    falha sistemática (token, desvio de relógio, aplicação fora do ar) não muda no 900º lote, e a
    fila é persistente — nada se perde. Mesmo raciocínio que `HigienizarRemocoes` já usava.

## [2.0.2] - 2026-08-17

### Fixed
- **Relógio REP recém-instalado nunca sincronizava nada** (REP iDClass - SMS, 10.110.0.20,
  instalado em 14/08/2026). Em 17/08/2026 o dispositivo tinha `rep_sincronizacoes = 0` e
  `rep_afd_registros = 0`: o `sync` pedia o AFD **sempre a partir do NSR 1**, o equipamento leva
  mais de 30s (o timeout do coletor) para montar as ~40 mil linhas de um relógio reaproveitado, e
  todo ciclo morria em `context deadline exceeded ... while reading body` para recomeçar do zero 5
  minutos depois. O relógio comunicava o tempo todo — `login.fcgi` e `get_system_information.fcgi`
  respondiam na mesma rodada; só a coleta do AFD não cabia no tempo.
  - Coleta agora é **incremental**: `GET /api/rep/v1/estado` devolve o cursor de NSR
    (`fn_cursor_afd_dispositivo`, migration `20260817150000`) e o coletor pede só o incremento.
    Também deixa de reprocessar as ~36 mil linhas da LACEM a cada 5 minutos (pendência aberta
    desde 12/08/2026).
  - O cursor é o fim do trecho **contíguo** de NSR mais 1, deliberadamente **não**
    `ultimo_nsr + 1`: `ultimo_nsr` é o maior NSR de cada lote, então um NSR do meio que nunca
    chegasse ficaria para trás para sempre — batida descartada em silêncio, justamente quando o
    autoconserto (repedir o arquivo inteiro todo ciclo) acabou de ser removido. Lacuna puxa o
    cursor de volta; reingerir é de graça (`fn_ingerir_afd` é idempotente por dispositivo+NSR).
    Validado contra 6 cenários em homologação, incluindo envenenamento por registro de trailer
    com NSR `999999999`.
  - `get_afd.fcgi` ganhou timeout próprio (10 min, ajustável por `timeout_afd_segundos` no
    `config.yaml`). As outras chamadas ao relógio continuam em 30s de propósito — é o que faz
    equipamento fora do ar falhar rápido em vez de segurar o ciclo. `afd-raw` e `afd-exportar`
    também usam o teto folgado.
  - Coletor v0.5.0 (`ciclo.Versao`, `dist/VERSION` e os dois `.exe` recompilados).

- **Coletor parava de enviar tudo quando o relógio do Windows da máquina estava fora do ar**
  (coletor v0.5.1). Medido na máquina do RH da SMS depois que a coleta do AFD passou a funcionar: o
  arquivo baixava certo e os ~80 lotes iam **integralmente para a fila offline** com
  `HTTP 401 "Timestamp fora da janela permitida (anti-replay)"`, tela vazia e nenhuma pista do
  motivo. Não era só o heartbeat — `EnviarLote`, `pendencias` e `biometria` assinam com o mesmo
  HMAC, e a checagem de desvio (5 min) roda **antes** da validação do token, então o erro nunca
  indicou problema de credencial.
  - O coletor **deixou de depender do relógio local**: aprende o desvio pelo header `Date` de
    qualquer resposta HTTP (ponto médio envio/chegada, à la NTP) e assina com `local + desvio`. O
    próprio 401 de anti-replay já traz o `Date` correto, então a resposta que recusa é a que ensina
    a hora — um retry único (só quando o corpo contém `anti-replay`) cobre o arranque.
  - **Não** ajusta o relógio do Windows: isso exigiria `SeSystemtimePrivilege`, que usuário comum
    não tem, e quebraria a decisão de o app rodar sem administrador.
  - Não afrouxa o anti-replay: quem decide o que é "agora" continua sendo só o servidor. Desvio
    ≥ 1 min vira aviso explícito no log — compensar não é esconder, a hora errada continua sendo
    problema real da máquina.
  - Validado contra servidor de mentira 20 min adiantado (arranque com retry, operação seguinte sem
    retry, desvio medido com erro < 1s, e 401 de assinatura inválida **não** gerando retry) e o
    `Date` conferido contra o servidor real de produção.

## [2.0.0] - 2026-08-14

Salto de versão major: correção de dois bugs de produção com impacto direto em dado de ponto
(folha travando para perfis de RH/Admin, e horário de Regular sendo calculado como plantão de
12h), início do módulo de cadastro do relógio REP por pendrive, e faltas automáticas na folha —
mudança de comportamento visível para todo servidor, não só ajuste incremental.

### Fixed
- **Folha de Ponto travava ("URI too long") para Administrador Geral e RH Geral sem filtro de
  Unidade.** `getServidoresFolhaPonto` montava `.in('escala_mensal_id', scaleIds)` com uma escala
  de cada servidor do mês inteiro — 206 escalas só em agosto/2026 já estourava o limite de URI do
  gateway do Supabase. Corrigido filtrando `folha_ponto` por `mes`/`ano` (colunas próprias da
  tabela) em vez de lista de IDs, e a tela passa a **exigir Unidade antes de buscar** para os
  perfis que conseguem gerar essa busca sem limite (`isAccessUnrestricted`, novo helper em
  `permissions.ts`) — coordenador e RH da Unidade, já escopados, continuam com a busca automática
  de sempre.
- **Turno Regular usando um código também ancorado como plantão herdava o horário do plantão.**
  Uma jornada Regular "08H ÀS 17H" atribuída com o código de turno "MT" (mesmo registro usado
  para plantão de 12h no dicionário) virava 07:00–19:00 na folha em vez de 08:00–17:00 — a SQL
  (`fn_blocos_previstos_dia`) já priorizava corretamente o nome da jornada, mas duas cópias em
  JavaScript (`complianceEngine.ts`, `ScaleGrid.tsx`/`handleSave`) ignoravam a categoria e sempre
  aplicavam a âncora do código. Corrigido nos dois lugares; **116 linhas de agosto/2026 em 20
  servidores** (a maioria com o mesmo padrão) foram identificadas por auditoria em produção e
  corrigidas — horário recalculado a partir do previsto correto, marcado como ajuste manual com
  justificativa automática (nunca mais um horário fabricado se passando por batida real).
- **`coletor-rep-tray.exe` fechava o app inteiro se a janela de console fosse fechada.** Build sem
  a flag `-ldflags="-H=windowsgui"` documentada no `README.md` do coletor — corrigido (v0.4.6),
  com verificação por leitura direta do PE header (subsystem GUI, não console).

### Added
- **Faltas automáticas na folha de ponto.** Dia com turno previsto, sem afastamento/feriado/
  facultativo e **sem nenhuma marcação** (real ou manual) de entrada nem saída passa a virar
  `FALTA - AGUARDANDO JUSTIFICATIVA` — e só vira falta definitiva depois do prazo em dias úteis
  configurado (`justificativa_prazo_dias_uteis`, campo que já existia na tela de Configurações
  sem nunca ter sido lido em lugar nenhum). Nunca sobrescreve observação já preenchida
  manualmente, nem roda sobre competência fechada. Fonte única em
  `src/utils/folha/faltaAutomatica.ts`, aplicada nas 4 cópias de geração de folha e nos 3 lugares
  que recontam faltas a partir do que já foi salvo.
- **Exportação de cadastro do relógio REP por pendrive** (`coletor-rep-cli cadastros-exportar`).
  Formato descoberto examinando o par exportar/importar do próprio menu do equipamento (CSV `;`
  com cabeçalho, `cpf;nome;administrador;matricula;rfid;codigo;senha;barras;digitais`) e
  confirmado num ciclo real de exportar → aplicar via "Receber usuários" em hardware (REP-iDClass-
  CEI), com um usuário de teste somado aos 67 reais já existentes — aditivo, não substitui a
  lista. `digitais` sempre vazio: biometria continua exigindo alguém presencial no equipamento.
- **Exclusão de afastamentos restaurada**, restrita a Administrador Geral, RH Geral e RH da
  Unidade — tinha sido substituída por "editar" em maio/2026 sem nenhum motivo de conformidade
  documentado.
- **Hierarquia de setores no filtro de Servidores** (`formatSectorsHierarchy`, mesma função já
  usada na Folha de Ponto): setores com o mesmo nome em ramos diferentes (ex.: duas "ENGENHARIA"
  em polos distintos) agora aparecem com recuo sob o pai certo, em vez de duas linhas idênticas
  soltas na lista.

### Changed
- **Aviso de ponto por WhatsApp perde os modos "Entrada e saída" e "Todas as batidas"** — o
  número usado pelo recurso foi restringido pela Meta por volume de mensagem. Só restam "Resumo
  diário" (padrão) e "Resumo semanal"; os 7 servidores que estavam num dos dois modos removidos
  foram migrados para resumo diário. A batida fora do horário previsto deixa de furar o modo
  escolhido com mensagem individual imediata — continua aparecendo no resumo do dia, só não gera
  mais aviso na hora.

### Security
- Uma pasta com CPF, nome e template biométrico reais de servidores (exportados de um relógio REP
  físico durante o teste de `cadastros-exportar`) foi commitada por engano e chegou a subir para
  o GitHub. Removida do histórico do repositório (reescrita + force-push) e adicionada ao
  `.gitignore`.

### Notes
- **Banco de horas: estudo documentado, não implementado.**
  [`docs/planos/2026-08-14-estudo-faltas-automaticas-e-banco-de-horas.md`](docs/planos/2026-08-14-estudo-faltas-automaticas-e-banco-de-horas.md)
  mapeia o que existe hoje (`carga_horaria_semanal` cadastrada mas nunca usada em cálculo nenhum)
  e as decisões que dependem de RH/jurídico antes de qualquer código — nem todo vínculo da SMS é
  CLT, então o regime de compensação de horas pode variar por tipo de vínculo.
- `npx tsc --noEmit` limpo em toda a rodada.

## [1.66.0] - 2026-08-14

### Added
- **Importação por pendrive passa a aceitar o AFD cru exportado pelo próprio relógio**, além do
  `.sisrep` gerado por `coletor-rep afd-exportar`. Motivação: unidade em que **nem o coletor**
  alcança o equipamento (CEI, avaliado em 14/08). O `.sisrep` só existe quando alguma máquina
  consegue falar com o relógio por IP; sem isso, a única coleta possível é a exportação fiscal
  pela porta USB do próprio REP-C, que produz o AFD **sem cabeçalho nenhum**. `parseArquivoSisrep`
  recusava esse arquivo com "não parece um .sisrep válido", deixando a unidade sem caminho de
  coleta.
  - O formato passa a ser decidido pelo **início** do arquivo (marca `SISREP-`), não mais por
    "achei `---` em algum lugar dos 2000 primeiros bytes" — assim um AFD cru que por acaso
    contenha essa sequência não é truncado como se tivesse cabeçalho.
  - Arquivo sem cabeçalho só é aceito se a primeira linha não vazia tiver forma de AFD (9 dígitos
    de NSR + tipo de registro 1..9), com tolerância a BOM. Texto solto e PDF continuam recusados.
  - Arquivo que se declara `.sisrep` mas não traz o delimitador passa a ser recusado como
    **incompleto** (truncado na cópia), em vez de cair no caminho de outro formato.
  - ⚠️ AFD cru não carrega `dispositivo_id`: a escolha do dispositivo no formulário passa a ser a
    única fonte, e a aba avisa isso explicitamente. O `.sisrep` continua conferindo o cabeçalho e
    avisando quando ele aponta para outro dispositivo.

### Notes
- **Ingestão inalterada e sem migration.** Continua a mesma `fn_ingerir_afd` com
  `p_canal: 'pendrive'`, idempotente por (`dispositivo_id`, `nsr`) — reenviar o mesmo arquivo não
  duplica nada. Nada fora do import por pendrive foi tocado: nenhuma RPC, nenhuma mudança no
  coletor, na reconciliação ou em outra tela.
- **Verificado por simulação** sobre a linha de AFD real confirmada em campo (NSR 8, a mesma da
  migration `20260811190000`): `.sisrep` e AFD cru extraem o identificador `011111211111`; CRLF,
  LF e BOM passam; `.sisrep` truncado, texto solto e PDF são recusados; AFD cru contendo `---`
  atravessa intacto. `npx tsc --noEmit` e `npm run build` limpos.
- **Decisão do CEI (14/08/2026): garantir rede até o relógio**, com o pendrive reservado à
  contingência — o pendrive anda numa direção só (traz marcação, não leva cadastro), e o quadro da
  unidade ainda está sendo cadastrado no SisEscala. Guia de implantação em
  [`docs/planos/2026-08-14-implantacao-cei.md`](docs/planos/2026-08-14-implantacao-cei.md).
- Fica pendente confirmar, no menu do próprio relógio, se ele importa cadastro por USB. Se não
  importar, não há caminho de software para tornar o pendrive bidirecional.

## [1.65.0] - 2026-08-13

### Added
- **Relógio REP compartilhado por múltiplos setores da mesma unidade.** `dispositivos_rep.setor_id`
  era uma FK única e opcional — um relógio só podia ser "de um setor" ou "de toda a unidade",
  sem meio-termo. Caso real: o relógio da LACEM vai passar a ser usado por Informática +
  Regulação + TFD, cada setor com escala e coordenação próprias.
  - Nova tabela `dispositivos_rep_setores` (migration `20260813130000`) — 0 linhas continua
    significando "toda a unidade" (mesma semântica do antigo `setor_id NULL`), ≥1 linha restringe
    ao(s) setor(es) listado(s).
  - `fn_enfileirar_cadastros_rep`, `fn_cobertura_ponto_dispositivo` e `fn_cobertura_ponto_resumo`
    reescritas para ler o conjunto de setores em vez de um único valor (migration `20260813140000`,
    gerada por `scratchpad/gen_multi_setor_dispositivo.js` — cópia mecânica do corpo vigente de
    cada função, com conferência de invariantes e reconstrução byte a byte antes/depois).
  - Nova RPC `fn_definir_setores_dispositivo_rep`, escrita atômica (substitui o conjunto inteiro
    numa única chamada) chamada pela sessão do usuário — preserva `criado_por_id` e recusa setor
    de unidade diferente da do dispositivo.
  - `DispositivoRepModal.tsx`: o `<select>` único de Setor virou lista de checkboxes por setor da
    unidade, com "Toda a unidade" como estado especial. Aba Cobertura da Escala mostra a lista de
    setores atendidos em vez de um nome só.

- **Indicador de status de coleta na aba Dispositivos REP** — badge por dispositivo em
  `MarcacoesClient.tsx`, sem migration (reaproveita `dispositivos_rep.ultimo_contato_em` e
  `rep_sincronizacoes`, já existentes).
  - **Pull/fallback**: `Online` (contato ≤10 min — o coletor sincroniza a cada 5 min) →
    `Offline há Xh` (âmbar, <24h) → `Offline há X dias` (vermelho, ≥24h); nunca conectado também
    vermelho.
  - **Somente pendrive**: sem heartbeat — `fn_ingerir_afd` (via `importarPendriveAfd`) nunca
    atualiza `ultimo_contato_em`, só `fn_autenticar_dispositivo_rep` (rotas do coletor por token)
    atualiza. Sinal passa a ser a última sincronização concluída com `canal = 'pendrive'`:
    `Última coleta há X` (verde, <3 dias) → `Coleta não realizada há X` (âmbar 3–7 dias, vermelho
    >7 dias); nunca coletado também vermelho.
  - `listarDispositivosRep` ganhou uma segunda consulta (não agregada via RPC — pendrive é
    esporádico o bastante para trazer as linhas e reduzir no cliente) para achar a última
    `concluida_em` por dispositivo com `canal = 'pendrive'`.

- **Aviso de setor sobreposto entre relógios da mesma unidade** em `DispositivoRepModal.tsx` — só
  aviso, nunca bloqueio: um setor coberto por dois relógios pode ser intencional (ex.: duas
  entradas físicas para o mesmo pessoal). Dois casos: setor específico já marcado em outro
  dispositivo da unidade (anotado ao lado do checkbox), e outro dispositivo da unidade já em
  "Toda a unidade" (banner — qualquer setor marcado aqui se sobrepõe a ele). `MarcacoesClient.tsx`
  passa a lista de dispositivos já carregada para o modal; nenhuma consulta nova.

- **Filtros de unidade/setor (aba Pendências) e de relógio (aba Biometria Pendente)** — pedido do
  usuário: pra quem tem escopo amplo (RH Geral, admin) a lista vem inteira e fica grande demais
  pra rolar. Pendências filtra no **servidor**: `fn_marcacoes_pendentes_revisao` já aceitava
  `p_unidade_id`/`p_setor_id`, só não eram usados (`listarPendencias` passava `null` fixo) — troca
  de filtro agora refaz a consulta em vez de só esconder linha na tela, o que é o que resolve de
  verdade uma lista grande. Biometria filtra no **cliente**: a lista já vem com
  `dispositivo_nome`, e o volume por relógio é bem menor (só quem tem vínculo sem biometria), não
  compensa ida a mais ao banco.

### Fixed
- **`fn_ingerir_afd` quebrava para qualquer dispositivo com setor associado** — achado só ao
  validar a migration acima contra dados reais em produção (checkpoint), não pego por `tsc`,
  `npm run build` nem pela reconstrução byte a byte do script gerador: `SELECT count(*),
  min(setor_id) INTO ...` usava `min()` sobre uma coluna `uuid`, e **o Postgres não tem agregado
  `min()`/`max()` para esse tipo** (suporta `<`/`>`/`ORDER BY`, mas não tem operator class de
  agregação registrada). Isso derrubava toda sincronização de AFD dos dispositivos afetados
  (LACEM e TI) entre a aplicação da migration e a correção. Trocado por duas consultas
  (`count(*)` e, só quando igual a 1, um `SELECT` separado do valor) — sem efeito observável,
  já que nenhum consumidor lê esse campo hoje para marcação de origem `rep` (RLS usa só
  `unidade_id`; a alocação de batidas casa só por servidor+tempo; a aba de Pendências exclui
  origem `rep` explicitamente).

### Notes
- **Aplicado e verificado direto em produção** (sem homologação nesta sessão). Checkpoints
  reproduziram os dois dispositivos reais corretamente, incluindo um caso não previsto: o
  dispositivo da TI já tinha `setor_id` preenchido antes desta mudança (não só "toda a unidade"),
  e o backfill/agregação tratou esse caso certo também.
- **Incidente durante a verificação em produção**: o dispositivo real da TI teve seu setor limpo
  (voltou para "toda a unidade", inflando de 6 para 76 o número de escalados considerados
  candidatos àquele relógio). **Causa real, corrigida depois de uma primeira hipótese errada**: o
  checkpoint 3 (`fn_definir_setores_dispositivo_rep`) foi desenhado pra rodar contra
  `numero_serie = 'REP-TESTE-TI'`, seguindo o padrão de "dispositivo de teste seguro" já usado em
  migrations anteriores (`20260808090000`, `20260812000000`, `20260812010000`) — mas nesse
  ambiente `REP-TESTE-TI` **é o próprio número de série do relógio real da TI**, não um
  dispositivo separado. O passo de limpeza do checkpoint (`ARRAY[]::uuid[]`) rodou contra o
  dispositivo de produção. A hipótese inicial ("aba com bundle antigo") estava errada e foi
  corrigida depois de reexaminar a tela de edição do dispositivo. Restaurado via
  `fn_definir_setores_dispositivo_rep`. Lição: `numero_serie = 'REP-TESTE-TI'` não é garantia de
  dispositivo descartável — confirmar pelo `nome`/`endereco_ip` antes de qualquer escrita de
  teste em produção.
- Análise de impacto completa (por que a folha de ponto não depende deste campo hoje — a
  reconciliação que ligaria relógio→folha, Fase 5, não tem nenhum chamador em `src/`) e sequência
  de migração em
  [`docs/planos/2026-08-13-relogio-rep-compartilhado-por-multiplos-setores.md`](docs/planos/2026-08-13-relogio-rep-compartilhado-por-multiplos-setores.md).

## [1.61.3] - 2026-08-13

### Fixed
- **Relançamento automático após "Atualizar" continuou falhando mesmo depois do fix da v1.61.2**
  — segundo teste real (relógio da Informática, 13/08/2026): download, conferência de sha256 e
  troca do `.exe` funcionaram (a versão instalada passou a mostrar corretamente v0.4.1), mas o
  processo novo não apareceu sozinho, sem nenhum erro no log — `exec.Command().Start()` só
  confirma que o Windows aceitou *criar* o processo, não que ele chegou a executar de verdade.
  Hipótese mais provável, dado o histórico já documentado neste projeto: Smart App Control ou
  Defender inspecionando o `.exe` recém-escrito em disco (sem assinatura/reputação) antes de
  deixar rodar, silenciosamente, sem diálogo nenhum para quem não está com os olhos na tela
  naquele instante exato.
  - Isso está fora do alcance de qualquer correção de código — se o Smart App Control estiver
    "Ativado" na máquina, nenhum programa consegue forçá-lo a liberar a execução.
  - O que mudou: em vez de confiar cegamente no `Start()` e sumir, o processo antigo agora espera
    até 3s por um sinal de que o processo novo realmente assumiu o mutex de instância única
    (`aguardarNovoProcessoAssumirMutex`, via `OpenMutex` — nunca `CreateMutex`, para a própria
    sondagem não criar o mutex e fazer o processo novo pensar que já existe outra instância).
    Se não confirmar, **mantém a versão antiga rodando** (reocupa o mutex) e notifica
    explicitamente, em vez de deixar a bandeja sumir sem nada no lugar. Converte uma falha
    silenciosa em uma falha visível e segura — o app nunca fica totalmente fechado sem avisar.

### Notes
- `ciclo.Versao` (app de bandeja/CLI) e `dist/VERSION` foram para `0.4.2`.
- ⚠️ Se isso acontecer de novo, confira em Configurações do Windows → Privacidade e segurança →
  Segurança do Windows → Controle de aplicativos e navegador se o Smart App Control está
  "Ativado" na máquina — já documentado neste projeto como bloqueio sem exceção por app.

## [1.61.2] - 2026-08-13

### Fixed
- **Clicar em "Atualizar" no app de bandeja fechava o ícone e não reabria sozinho** — corrida real
  entre `aplicarAtualizacao` (que iniciava o processo novo *antes* de sair) e
  `garantirInstanciaUnica` (que todo processo novo roda logo no `main()`): o processo novo nascia,
  via o mutex nomeado ainda em mãos do processo antigo (que só o solta alguns instantes depois, em
  `systray.Quit()`), concluía que já havia outra instância rodando e saía em silêncio — sem log,
  sem notificação, porque isso acontece antes até do log ser configurado. Resultado observado em
  campo (teste no relógio da Informática, 13/08/2026): bandeja some depois de "Atualizar", só
  reabre com clique manual. Corrigido liberando o mutex explicitamente antes de iniciar o processo
  novo, e reocupando-o se o `Start()` falhar (processo antigo continua rodando normalmente nesse
  caso). Não era uma falha eventual — o `Start()` sempre vinha antes do `Quit()`, então a corrida
  era praticamente garantida.

### Added
- Item fixo no menu mostrando a versão instalada (`Versão instalada: vX.Y.Z`) — visível direto ao
  abrir a bandeja, sem precisar clicar em "Verificar atualização" pra saber.
- "Verificar atualização" agora deixa o resultado da última checagem no próprio título do item
  (`(você está atualizado)` / `(falha ao checar - ver log)`), em vez de depender só da notificação
  do Windows — que pode não aparecer (foco automático, permissões, app sem `AppUserModelID`
  registrado) sem deixar rastro nenhum pro usuário.

### Notes
- `ciclo.Versao` (app de bandeja/CLI) e `dist/VERSION` foram para `0.4.1`.

## [1.61.1] - 2026-08-13

### Fixed
- **`/api/coletor-rep/tray-version` e `/api/coletor-rep/tray-download` redirecionavam para
  `/login` (HTTP 307) em toda chamada sem sessão de navegador** — exatamente o mesmo bug já
  documentado e corrigido para `/api/version` em 09/08/2026 (middleware trata request sem `user`
  como "manda pro login"), mas as rotas do coletor-rep nasceram depois (Fase 4, 11/08/2026) e
  nunca entraram na lista de rotas públicas. Era por isso que "Verificar atualização" nunca
  funcionava de verdade em produção: o app de bandeja não tem sessão nenhuma, `http.Get` seguia o
  redirect até a página HTML de login, e o `json.Decode` estourava com `invalid character '<'`
  (o log melhorado da v1.61.0 já ia mostrar o HTML do login na próxima ocorrência, mas a causa era
  esta). Confirmado ao vivo com `curl`: os dois endpoints devolviam 307 para `/login`. Adicionado
  `/api/coletor-rep` à lista de rotas públicas do middleware — `download`/`download-cli` continuam
  protegidas por checagem própria de `admin`/`super_admin` dentro da rota, então não ficam abertas.

## [1.61.0] - 2026-08-13

### Fixed
- **`dist/coletor-rep-tray.exe` estava compilado sem `-ldflags="-H=windowsgui"`** — o binário do
  app de bandeja recompilado/commitado em v1.58.0 saiu com subsystem CONSOLE (confirmado lendo o
  cabeçalho PE: `Subsystem: 3`, deveria ser `2`), abrindo uma janela preta de terminal ao lado do
  ícone da bandeja. Fechar aquela janela matava o processo inteiro — não é um efeito colateral
  cosmético, é literalmente o host do processo. Achado ao instalar na LACEN em 12–13/08/2026.
  Recompilado com a flag correta desta vez.
- **`fn_registrar_snapshot_usuarios_dispositivo` derrubava a tela de Higiene inteira quando o
  relógio tinha o mesmo `identificador_afd` cadastrado mais de uma vez** — cenário real de
  dispositivo reaproveitado de outro sistema (exatamente o caso que motivou a Fase 7b). O `INSERT`
  em lote violava `uq_usuario_dispositivo`, a função inteira dava rollback (incluindo o `DELETE`
  anterior), e "Atualizar lista de cadastros do relógio" falhava sempre para aquele dispositivo.
  Confirmado em produção na LACEN: 64 usuários lidos do relé, HTTP 500 `duplicate key value
  violates unique constraint "uq_usuario_dispositivo"`. Migration `20260813000000` deduplica por
  `identificador_afd` antes do `INSERT`, preferindo o registro com biometria cadastrada quando um
  dos duplicados a tiver.
- `VersaoDisponivel` (verificação de atualização do coletor) logava só `invalid character '<'
  looking for beginning of value` quando a resposta não era JSON — sem status HTTP nem amostra do
  corpo, impossível saber se era a rota, um proxy no meio, ou um deploy em andamento. Agora loga os
  dois.

### Added
- Feedback visual leve nos comandos do menu da bandeja (Sincronizar agora, Sincronizar cadastros
  agora, Atualizar lista de cadastros do relógio, Verificar atualização): o item muda de título e
  fica desabilitado enquanto roda, e sai uma notificação de início e de fim com números (ex.: "3
  cadastro(s) enviado(s) ao relé, 0 falha(s)."), em vez de só um aviso seco no final. Sem janela
  nova — usa só o que a bandeja já tinha (`systray` + `beeep`). `ciclo.SincronizarCadastros` e
  `ciclo.HigienizarListagem` passaram a devolver um resumo de contagens além do erro.

### Notes
- `ciclo.Versao` (app de bandeja/CLI) e `dist/VERSION` foram para `0.4.0`.

## [1.60.2] - 2026-08-13

### Notes
- **Migration `20260812160000` confirmada em produção, e v1.60.1 no ar** (`/api/version` devolve
  `1.60.1`). Os três guards sondáveis responderam com JSON limpo e **nenhuma escrita**:

  | sonda | resposta de produção |
  |---|---|
  | servidor divergente | `A batida é de outro servidor. Não é possível vinculá-la a esta escala.` |
  | data fora de `[D−1, D]` | `A batida de 08/08/2026 não pertence à escala de 05/07/2026. …` |
  | categoria Sobreaviso | `Sobreaviso não registra presença. Use o fluxo de sobreaviso.` |

  As sondas usaram **linhas de Sobreaviso de propósito**: se a migration não tivesse pegado, a
  constraint `chk_sobreaviso_sem_presenca` abortaria a escrita — os dois desfechos possíveis eram
  não-destrutivos. Conferido depois: `marcacoes_tratamentos` inalterada (32 antes e depois) e as
  três linhas sondadas continuam com os 4 campos de presença `NULL`.
- **A terceira sonda é também o teste positivo dos guards 1 e 2.** O par tinha o **mesmo
  servidor** e a **mesma data** da batida, e passou pelos dois guards antes de parar no de
  Sobreaviso — ou seja, eles não recusam par válido. O que não foi exercitado ao vivo é só o
  guard de competência (`08/2026` está aberta) e a escrita em si, que é código **byte a byte
  idêntico** ao vigente, conferido pelo gerador.
- **Uso real no intervalo, sem nenhuma divergência.** Entre a v1.60.0 e agora entraram 17
  tratamentos novos (12 `desconsiderar` em massa às 21:33 e 22:23 de 12/08, mais 5
  `vincular_escala` de passo `saida` entre 23:33 e 23:38). Reauditados os 16 `vincular_escala`
  existentes: **0 com dia divergente, 0 com servidor divergente**.
- Estado atual da fila: 74 marcações com observação de pendência — **11 já tratadas, 63
  aguardando decisão**. Sobra **1** com hora local ≥ 21:00 (12/08 às 21:57); a de 21:26 foi
  desconsiderada pelo coordenador às 21:33 do mesmo dia.
- ⚠️ **Não verificado:** a aba Pendências renderizando no navegador (exige sessão de
  coordenador). O build passou e as Server Actions foram exercitadas pelo banco, mas a tela em si
  só se confirma abrindo `/marcacoes`.

## [1.60.1] - 2026-08-12

### Security
- **`fn_aceitar_marcacao_pendente` não conferia nada sobre o par (marcação, escala) que recebia**
  — gravava o horário real da batida em qualquer linha de `escala_diaria` cujo id lhe fosse
  passado. A própria função já lia o servidor da marcação (`v_servidor`) e **descartava sem
  usar**: a checagem foi pensada e ficou pelo caminho. Migration `20260812160000`, gerada por
  `scratchpad/gen_guard_aceitar.js` (cópia mecânica da versão vigente + dois trechos inseridos,
  abortando se o resto não voltar byte a byte).
  - Era o que dava consequência real ao bug de fuso da v1.60.0: a tela listava as escalas do dia
    seguinte para batida noturna, e um clique gravaria o horário real na linha errada com
    `origem = 'terminal'` — registro de ponto falso, no dia errado, com aparência de batida
    legítima. A tela foi corrigida; o guard existe porque a RPC é `GRANT`ada a `authenticated` e
    alcançável direto por REST, sem passar por tela nenhuma.
  - **Quatro guards, todos antes de qualquer escrita:** (1) servidor da escala = servidor da
    marcação; (2) data da escala entre a véspera e o dia local da batida, nunca posterior;
    (3) categoria ≠ Sobreaviso; (4) competência não encerrada.
  - **Os itens 3 e 4 só existiam em `fn_validar_presenca_manual`.** A aba Pendências de
    `/marcacoes` chama `fn_aceitar_marcacao_pendente` **direto**, escapando dos dois — dava para
    gravar presença em mês congelado. Sobreaviso a constraint `chk_sobreaviso_sem_presenca` já
    barrava, mas com erro cru.
  - `fn_validar_presenca_manual` e `fn_aceitar_tentativa_recusada` **não foram tocadas** — herdam
    os guards por delegarem a esta, mesmo padrão de `fn_confirmar_presenca_manual_bulk`.
  - **O guard não checa se a batida cai na janela prevista, de propósito.** Pendência é, por
    definição, batida fora da janela — plausibilidade rejeitaria justamente o caso de uso.
    Decidir a que passo uma batida distante pertence é juízo do coordenador (Art. 82, parágrafo
    único). O guard barra o impossível, nunca o incomum.

### Notes
- **Auditoria de produção (12/08/2026, somente leitura): nenhum dado foi corrompido.** 27 linhas
  em `marcacoes_tratamentos` (11 `vincular_escala` + 16 `desconsiderar`); das 11 com escala
  vinculada, **0 com dia divergente e 0 com servidor divergente**. A exposição era pequena porque
  as unidades em operação hoje não têm escala noturna — não porque a função se defendesse: das
  58.154 marcações da base, 86 (0,1%) têm hora local ≥ 21:00, e das 74 pendências abertas apenas
  2 (ambas de 12/08, 21:26 e 21:57, ainda sem tratamento).
- **Simulação do guard sobre os dados reais antes de escrever o SQL:** os 11 tratamentos
  existentes passariam todos; das 74 pendências, 73 continuam com escala elegível em D ou D−1. A
  única exceção não é causada pelo guard — é uma batida cujo servidor não tem escala nenhuma em
  08/2026 (`Sem escala agendada para hoje`), que a tela já recusa hoje.
- **A janela D−1 precisa continuar valendo**, e é isso que impede um guard mais apertado: as
  jornadas `18H ÀS 06H` e `19H ÀS 07H` cruzam a meia-noite, então a batida das 06:05 do dia D é a
  saída legítima do turno de D−1. Já o **dia posterior é impossível**: dos 27 turnos ancorados o
  mais cedo começa 07:00 e das 17 jornadas a mais cedo é `07H` — nenhuma começa de madrugada.
  Ambos os números medidos em produção nesta data.
- **Considerado e descartado: definir `TZ=America/Sao_Paulo` no container do Coolify.** Corrigiria
  a classe inteira de uma vez, mas mudaria em silêncio o comportamento de toda data derivada em
  ~40 pontos do código de folha de ponto e portal, num sistema de ponto em produção, sem teste
  automatizado que cubra a diferença. O custo de verificação não se justifica para uma classe de
  bug que a auditoria mediu como tendo causado zero dano. O padrão do projeto
  (`configuracoes_globais.timezone` explícito) continua sendo a regra.

✅ **Migration aplicada e confirmada em produção em 13/08/2026** — ver v1.60.2 acima.

## [1.60.0] - 2026-08-12

### Added
- **O modal "Tratar marcação" (aba Pendências de `/marcacoes`) passa a mostrar o horário
  previsto do dia ao lado da batida real.** Antes ele mostrava só o horário que a pessoa bateu
  e pedia que o coordenador escolhesse o passo — sem dizer que horas aquele servidor deveria
  ter registrado. Quem decide não tinha o outro lado da comparação na tela e precisava abrir a
  grade em outra aba para saber se 13:31 era entrada atrasada, saída antecipada ou retorno de
  intervalo.
  - Uma tabela com os 4 passos (entrada / saída do intervalo / retorno do intervalo / saída),
    o horário previsto de cada um e **a distância da batida real até ele** ("2h31 depois",
    "4h29 antes"), com o passo mais próximo sinalizado.
  - O previsto vem de `fn_blocos_previstos_dia` — a **mesma** função que o terminal usa para
    decidir a janela e que a grade lê via `fn_blocos_previstos_mes` (Fase 3). Nenhuma regra
    nova de horário foi escrita: se a tela derivasse por conta própria, voltaria a mostrar ao
    coordenador um horário diferente do que o sistema cobrou do servidor.
  - Fusão de blocos é respeitada de graça: num dia de Regular + Plantão contíguos, as duas
    opções de escala apontam para o mesmo bloco, com uma entrada e uma saída — que é
    exatamente o que o terminal cobra. Conferido contra dados reais em homologação.
  - Em unidade com `permite_marca_intervalo = false`, os dois passos de intervalo aparecem como
    "não marca intervalo" em vez de em branco.
  - Turno que cruza a meia-noite mostra a data junto da hora quando o previsto cai no dia
    seguinte ao da batida.
  - **O sistema continua não pré-selecionando o passo.** "Mais próximo" é pista visual; a
    escolha segue sendo do coordenador (Portaria 671/2021, vedação 2).
  - O `<select>` de escala do dia agora mostra a faixa prevista de cada opção
    (ex.: `Regular — MT (07:00–19:00)`), e o `<select>` de passo mostra o previsto de cada passo.

- **A lista de pendências ganhou filtros e paginação.** Ela crescia sem limite e misturava o que
  já foi resolvido com o que ainda espera decisão.
  - Filtro por servidor e filtro de situação (**"Só pendentes" é o padrão** — o que já foi
    tratado sai da frente, mas continua acessível).
  - Paginação de 15 por página, com contador `x–y de z`.
  - Página atual é reancorada quando um filtro encurta a lista, para a tela não ficar vazia com
    resultados existentes.

### Fixed
- **`buscarEscalasCandidatas` derivava o dia da batida no fuso do processo Node, não no do
  município.** A VPS roda em UTC: uma batida às 22:00 de 11/08 vira 12/08 em UTC e a tela
  traria as escalas do dia seguinte. Agora converte pelo `configuracoes_globais.timezone`, a
  mesma fonte e o mesmo `AT TIME ZONE` que `fn_marcacoes_pendentes_revisao` já usa para devolver
  o campo `dia`. Ninguém tinha relatado — as pendências vistas até aqui foram todas diurnas.
- **`buscarEscalasCandidatas` usava `createAdminClient()` sem nenhuma checagem de sessão.** Server
  Action é endpoint alcançável; com o client de service role ela devolvia a escala de qualquer
  servidor a quem soubesse o UUID, sem RLS. Agora exige usuário autenticado antes de abrir o
  client admin. O escopo por unidade/setor continua vindo de `listarPendencias`
  (`fn_unidade_no_escopo` dentro de `fn_marcacoes_pendentes_revisao`) — o admin client segue
  necessário aqui porque é ele que faz o guard de `fn_blocos_previstos_dia` liberar
  (`auth.uid() IS NULL`).

## [1.59.0] - 2026-08-12

### Added
- **Reclassificar passo de presença na Folha de Ponto, arrastando com o mouse.** Achado em
  produção: dia 12/08/2026, um coordenador de TI trabalhou direto (sem marcar intervalo) e a
  batida real das 21:09 caiu em "SAÍDA INT." em vez de "SAÍDA" — a unidade permite marcação de
  intervalo, e o terminal só preenche o próximo passo vazio em sequência, sem saber que aquela
  é a última batida do dia. Nova função `fn_reclassificar_passo_presenca` (migration
  `20260812150000`) move o horário real entre os 4 passos (`entrada`/`intervalo_saida`/
  `intervalo_retorno`/`saida`) de `escala_diaria` — nunca toca `marcacoes_ponto` (a batida
  original continua imutável) e nunca fabrica horário, só corrige a classificação.
  - **Mais seguro que a capacidade que já existia**: hoje um `super_admin` pode digitar por
    cima de uma célula `origem = 'real'` na folha, mas isso (a) perde a marca de "real" e (b)
    só grava em `folha_ponto.registros` — nunca em `escala_diaria`, então a grade e o motor de
    compliance continuam vendo o dado errado. A ferramenta nova só **move** um valor real já
    existente (nunca digita um novo) e grava na fonte, então mantém a marca de "real" e reflete
    tanto na grade quanto na folha.
  - Só disponível na Folha de Ponto (nunca no Portal do Servidor), para
    coordenador/admin/super_admin/rh/rh_unidade — mesma régua de `hasSectorAccess`, replicada
    como guard **dentro da própria RPC** (não só na Server Action — mesma lição já aplicada
    nesta sessão em `fn_blocos_previstos_dia`, uma RPC `GRANT`ada a `authenticated` é alcançável
    direto por REST).
  - v1 só aceita soltar num passo vazio (sem swap), só move batida real (nunca um valor já
    digitado — a RPC recusa se `presenca_<passo>_manual = true`), e só entre passos da mesma
    linha de `escala_diaria` (não move entre turnos/categorias diferentes do mesmo dia).
  - Exige justificativa (mínimo 5 caracteres) e fica registrado em auditoria
    (`PRESENCA_RECLASSIFICADA`, com o diff dos 4 campos via `calcularAlteracoes`).
  - A correção reflete na folha imediatamente — reaproveita `sincronizarFolhaPonto` (que já
    re-deriva `registros` a partir de `escala_diaria`), sem duplicar lógica de geração.

Ver [`docs/evolucao/2026-08-12-reclassificar-passo-presenca-folha-ponto.md`](docs/evolucao/2026-08-12-reclassificar-passo-presenca-folha-ponto.md).

## [1.58.2] - 2026-08-12

### Notes
- **Migrations `20260812130000` e `20260812140000` (v1.58.1) confirmadas em produção** — as 7
  linhas da LACEM ficaram com os campos de intervalo `NULL` (entrada/saída reais preservadas),
  busca ampla sobre todas as unidades sem `permite_marca_intervalo` não achou mais nenhuma
  marcação remanescente, e `fn_blocos_previstos_dia` continuou respondendo normalmente via
  service role (sem regressão no caminho legítimo). O caminho negativo do guard (coordenador
  autenticado fora de escopo) não foi verificado nesta sessão — só é testável com sessão de
  usuário real no navegador, service role sempre bypassa por desenho.

## [1.58.1] - 2026-08-12

### Security
- **`fn_blocos_previstos_dia` ganhou guard de escopo** — era `SECURITY DEFINER` com `GRANT` para
  `authenticated` e nunca validava se quem chama tem acesso ao servidor consultado, permitindo
  que qualquer usuário autenticado consultasse a projeção de presença de qualquer servidor da
  base sabendo só o UUID. Migration `20260812130000` (gerada por `scratchpad/gen_escopo_blocos.js`,
  cópia mecânica da versão vigente + inserção pontual). Checa por **escala** do servidor no
  mês/ano consultado (`fn_unidade_no_escopo` OR `fn_unidade_alcancavel_por_setor`), não pela
  lotação atual — preserva o caso de "Servidor Externo" (v1.2.4). `service_role` (`auth.uid() IS
  NULL`) continua sem restrição — hoje o único caminho real de toda a cadeia de reconciliação
  (`fn_alocar_marcacoes_dia` → `fn_projecao_marcacoes_dia` → `fn_conferir_reconciliacao`), sem
  nenhum caller de aplicação ainda. `fn_blocos_previstos_mes` e o resto da cadeia **não foram
  tocados** — herdam a proteção por serem envelopes desta função. Fecha a pendência 3 da Fase 5
  do módulo REP.

### Fixed
- **7 marcações de intervalo sintéticas na LACEM** (unidade com `permite_marca_intervalo =
  false`, artefatos da regressão de `20260804080000` já corrigida) foram zeradas — só os campos
  de intervalo, entrada/saída reais preservadas. Migration `20260812140000`, por id explícito
  (nunca por critério amplo). A nota anterior no CLAUDE.md registrava 103 ocorrências; reconferido
  em produção antes de decidir, o número real era 7 — a nota estava desatualizada. Fecha a
  pendência 1 da Fase 5 do módulo REP.

## [1.58.0] - 2026-08-12

### Added
- **Coletor REP: atualização semi-automática do app de bandeja.** Duas rotas públicas novas
  (`GET /api/coletor-rep/tray-version`, `GET /api/coletor-rep/tray-download` — sem sessão, mesmo
  espírito de `/api/version`) permitem que `coletor-rep-tray.exe` compare sua própria versão
  (`ciclo.Versao`) com `dist/VERSION` no servidor. Quando há versão nova, o menu da bandeja ganha
  o item "Atualização disponível" e uma notificação — a troca do `.exe` só acontece com clique
  explícito (nunca sozinha), com conferência de sha256 antes de instalar. Reaproveita o mecanismo
  de renomear-e-relançar já usado pela auto-instalação (`autoInstalarERelancar`).
- **Import/export de AFD por pendrive**, para unidades sem rede até o relógio (ex.: LACEN).
  Novo subcomando `coletor-rep-cli afd-exportar <arquivo>.sisrep`, com estado local
  (`estado-pendrive.json`) para exportar só o que ainda não foi levado desde a última vez — nunca
  o AFD inteiro do dispositivo. Nova aba "Importar por Pendrive" em `/marcacoes` (admin) recebe o
  arquivo e chama a mesma `fn_ingerir_afd` do sync online (`p_canal: 'pendrive'`) — nenhuma
  migration nova foi necessária, a RPC já previa esse canal desde a Fase 0-3. Reenviar o mesmo
  arquivo depois não duplica nada (idempotência por `dispositivo_id` + NSR, já existente).

## [1.57.0] - 2026-08-12

### Fixed
- **"Aplicar Template" → "Validar automaticamente dias passados" só gravava entrada/saída,
  mesmo em unidade com marcação de intervalo habilitada (4 marcações)** — a feature nasceu antes
  do módulo de intervalo (v1.17.0) e nunca foi atualizada. Dois pontos, os dois em
  `ScaleGrid.tsx`:
  - O checkbox só marcava `presenceData` com `{ entrada: true, saida: true }`, sem olhar se a
    unidade e a jornada do dia exigem intervalo (`isUnitInterval`, mesma regra do indicador de
    presença da grade — unidade com `permite_marca_intervalo` + jornada com duração > 6h e
    intervalo cadastrado, CLT Art. 71). Passa a marcar as 4 flags quando aplicável, olhando a
    jornada efetiva do dia (respeitando jornada temporária, como o resto da grade já faz).
  - **Mesmo corrigido o passo acima, nada seria salvo**: `handleSave` ("Salvar Previsão") é quem
    de fato grava `escala_diaria` a partir de `presenceData`, e só conhecia as colunas
    `presenca_entrada_em`/`presenca_saida_em` — as colunas de intervalo
    (`presenca_intervalo_saida_em`/`presenca_intervalo_retorno_em`) nunca estavam no payload,
    então a marcação "desaparecia" ao salvar mesmo com o indicador mostrando os 4 segmentos
    verdes na hora. Passa a preencher as duas colunas usando a mesma fonte já estabelecida no
    arquivo (`getShiftForecastTime`/`blocoDaCelula`, "Fonte Única — Fase 3"): horário do bloco já
    salvo no banco quando existir, senão a cascata horário personalizado do servidor → padrão da
    jornada → fallback início+4h — nunca uma fórmula nova.
  - Não mexe em `fn_confirmar_presenca_manual` nem em nenhuma função de banco — o problema era
    inteiramente client-side, na duplicação (já existente antes desta correção) entre a lógica de
    presença da grade e a RPC de validação manual.

## [1.56.1] - 2026-08-12

### Fixed
- **"Atualizar cadastro existente" recusava com `Este CPF não corresponde mais ao cadastro
  informado` mesmo quando a tela já tinha detectado corretamente o conflito por matrícula** —
  achado testando a própria correção da v1.56.0 em produção, no cadastro da FLAVIA BARROS
  CAVALCANTE: a pendência dela tem um CPF preenchido que **não é** o CPF gravado no cadastro
  ativo (a colisão é só por matrícula). `fn_atualizar_cadastro_via_pendencia_rh` continuava
  revalidando o conflito **só** por CPF (`fn_cpf_ja_cadastrado`), herdado do fluxo antigo — não
  foi adaptado para o novo caminho de matrícula da v1.56.0. Migration `20260812120000`: a
  revalidação agora tenta matrícula primeiro (`fn_servidor_por_matricula`) — se bater com o
  `servidor_id` recebido, segue direto; só cai para checar CPF quando a matrícula não bate (o
  caso original, conflito descoberto só por CPF).

## [1.56.0] - 2026-08-12

### Added
- **CPF obrigatório no cadastro do servidor** (`createServidor`, `updateServidor`, importação em
  massa por CSV) — pedido do usuário, considerando explicitamente o vínculo duplo (v1.42.0): o
  segundo vínculo é a MESMA pessoa com o MESMO CPF, marcando "confirma vínculo adicional" — CPF
  obrigatório não conflita com isso, na verdade fortalece a detecção (antes um segundo vínculo
  sem CPF nenhum escapava por completo de `verificarCpfDuplicado`). **Não é retroativo**:
  servidor legado sem CPF (57 em produção em 08/2026) só é bloqueado na próxima edição, não
  travado de imediato — mesmo padrão já usado pro `CHECK` de dígito verificador (v1.38.0).
  `CampoDocumento` do CPF ganhou `required` nos dois formulários.

### Fixed
- **Promover uma pendência de importação do RH cujo servidor já está ativo estourava erro cru
  de Postgres** (`duplicate key value violates unique constraint "servidores_matricula_key"`) —
  achado em produção promovendo FLAVIA BARROS CAVALCANTE (matrícula 58144, já ativa na escala do
  DMAC). `fn_promover_pendencia_rh` só detectava conflito pelo CPF (`fn_cpf_ja_cadastrado`); se a
  pendência não tem CPF (ou o cadastro ativo também não tem — mesmos 57 servidores acima), a
  checagem nunca disparava e a função tentava o `INSERT` direto, que só então esbarrava na
  constraint de matrícula — a tela nunca chegava a perguntar "vínculo adicional ou atualização",
  só mostrava o erro do banco.
  - Nova função `fn_servidor_por_matricula` (mesmo padrão `SECURITY DEFINER` de
    `fn_cpf_ja_cadastrado`), verificada **antes** do CPF em `fn_promover_pendencia_rh` — colisão
    por matrícula nunca é um vínculo válido (matrícula é a própria chave que a fila usa pra
    identificar "esta pessoa ainda não tem cadastro"; se já existe alguém com essa matrícula, é
    sempre o MESMO registro). A tela (`buscarConflitoPendencia`, renomeada de
    `buscarConflitoCpf`) passa a checar matrícula e CPF numa só chamada, e a `LinhaPendente` só
    oferece **um** caminho quando o conflito é por matrícula ("atualizar cadastro existente") —
    nunca a opção de vínculo duplo, que não faz sentido nesse caso.
  - `fn_atualizar_cadastro_via_pendencia_rh` ganhou `p_cpf` opcional e passa a preencher `cpf`
    do cadastro existente por `COALESCE` (nunca sobrescreve) — antes CPF ficava de fora do
    `UPDATE` porque só era alcançada quando já tinha casado por CPF (logo já preenchido); agora
    também é alcançada por colisão de matrícula, onde o cadastro existente pode não ter CPF
    nenhum. Migration `20260812110000`.
  - `fn_promover_pendencia_rh` (criar cadastro novo) e `fn_atualizar_cadastro_via_pendencia_rh`
    (completar existente) passam a exigir CPF também nesse caminho — vem do CPF que a pendência
    já traz do relatório do RH ou, na falta dele, de um campo novo na própria linha da tela
    (`CampoDocumento`), sem que o coordenador precise sair pra outra tela.
  - "À medida que os cadastros forem sendo atualizados eles saem das pendências" já era o
    comportamento existente — `promovido_em` tira a linha da fila `WHERE promovido_em IS NULL`
    assim que a promoção ou atualização é confirmada; nada novo precisou aqui.

## [1.55.2] - 2026-08-12

### Changed
- **Diretor (`role = 'admin'`) perde o menu de catálogo global** (Cargos, Feriados, Jornadas,
  Dicionário de Turnos, Tipos de Afastamento) — pedido explícito do usuário. Antes Diretor
  dividia o mesmo bypass de RH Geral na sidebar (`isRhGeral || isAdmin`) e via os 5 itens junto;
  agora só RH Geral e Administrador Geral (`super_admin`) veem esse grupo.
  - Para Feriados, Dicionário de Turnos e Tipos de Afastamento isso é só limpeza de menu: o
    gate de página dessas 3 telas já era `super_admin`/`rh` desde a v1.55.0 — Diretor clicando
    ali já caía em "Acesso Negado".
  - **Cargos e Jornadas não têm gate de página** — Diretor continua alcançando `/cargos` e
    `/jornadas` digitando a URL direto. Jornadas já bloqueia a escrita por RLS (`super_admin`/
    `rh` apenas, nunca incluiu `admin`); Cargos **ainda aceita escrita de `admin` via RLS** — só
    o link do menu saiu, o acesso direto por URL não foi fechado. Sinalizado, não corrigido:
    não foi pedido remover a capacidade de Diretor gerenciar cargos, só o item do menu.

## [1.55.1] - 2026-08-12

### Fixed
- **A v1.55.0 tirou 3 telas do menu de RH da Unidade por engano, junto das 5 que deveriam sair
  de verdade** — o pedido original era: Férias e Licenças, Marcações e Pendências de Cadastro
  deveriam continuar visíveis pra RH da Unidade (só estavam bloqueadas indevidamente até pra RH
  Geral, e é isso que devia ser corrigido); só Cargos, Feriados, Jornadas, Dicionário de Turnos
  e Tipos de Afastamento (catálogo global, sem escopo por unidade) deveriam virar exclusivos de
  RH Geral. `itensSoRhGeral` (`sidebar.tsx`) ficou só com os 5 corretos; os gates de página de
  `/ferias-licencas`, `/marcacoes` e `/servidores/pendencias` voltaram a reconhecer
  `role === 'rh_unidade'` — em `/servidores/pendencias`, RH da Unidade entra pela mesma visão
  escopada por unidade que coordenador já usa (não pela visão irrestrita de RH Geral).
- **RH Geral (`role = 'rh'`) e RH da Unidade nunca tiveram acesso de fato às pendências de
  importação do RH nem às solicitações de transferência**, mesmo depois do gate de página da
  v1.55.0 — lacuna em duas camadas abaixo do gate, mesmo padrão "guard de papel escrito antes do
  papel existir" já visto 3 vezes nesta sessão:
  - RLS de `importacao_rh_pendentes` só tinha policy pra `super_admin`/`admin` (leitura geral) e
    `coordenador` (escopada) — um `rh` passando pelo gate de página caía numa consulta que a RLS
    zera em silêncio, a tela abrindo "funcionando" e mostrando zero pendências.
  - `fn_promover_pendencia_rh`, `fn_atualizar_cadastro_via_pendencia_rh` e
    `fn_buscar_pendencia_rh_por_termo` tinham checagem de papel restrita a
    `super_admin`/`admin`/`coordenador` — um `rh` clicando em "Concluir cadastro" recebia erro
    explícito de permissão insuficiente.
  - RLS de `solicitacoes_transferencia_servidor` (SELECT/INSERT) tinha a mesma lacuna.
  - Migration `20260812100000`: `rh` entra nas mesmas policies/checagens de `admin` (escopo por
    unidade já aceita `acesso_todas_unidades` como bypass, que é o que RH Geral tipicamente tem
    marcado); `rh_unidade` entra no mesmo escopo por unidade que `coordenador` já usa
    (`profile_unidades`/`profile_setores`, sem exigir `acesso_todos_setores`). UPDATE de
    solicitação de transferência (aprovar/rejeitar) continua `super_admin` apenas — não alterado.

## [1.55.0] - 2026-08-12

### Added
- **Oito telas viram explicitamente exclusivas de RH Geral, RH da Unidade não vê nem o menu**:
  Férias e Licenças, Marcações, Pendências de Cadastro, Cargos, Feriados, Jornadas, Dicionário
  de Turnos e Tipos de Afastamento — confirmado pelo usuário testando o papel novo em produção.
  `sidebar.tsx` ganhou `isRhGeral`/`isRhUnidade` separados (antes um `isRh` só tratava os dois
  igual) e uma lista `itensSoRhGeral` que tira esses oito itens do menu de `rh_unidade`.

### Fixed
- **RH Geral (`role = 'rh'`) não tinha acesso a nenhuma dessas oito telas** — os gates de página
  (`/ferias-licencas`, `/marcacoes`, `/servidores/pendencias`) e alguns nem admin/coordenador
  alcançavam por completo (`/feriados`, `/turnos`, `/tipos-eventos` eram **`super_admin` apenas**,
  mais restrito que Diretor). Corrigido nas seis páginas para reconhecer `role === 'rh'`.
  - RLS de escrita de `feriados`, `pontos_facultativos`, `dicionario_turnos`, `tipos_eventos`,
    `cargos` e `jornadas` (migration `20260812090000`) ganhou `'rh'::user_role` — sem isso a
    tela abriria mas qualquer tentativa de salvar seria recusada pela RLS, já que leitura sempre
    foi `USING (true)` para qualquer autenticado, mas escrita restrita a super_admin/admin.
  - `/marcacoes`: RH Geral entra na tela mas continua sem `isAdmin` (gestão de dispositivo REP/
    terminal é infraestrutura de TI, não foi pedido) — mesma aba "Pendências" que coordenador já
    usa.
  - `/servidores/pendencias`: RH Geral entra pelo caminho de admin/super_admin (visão irrestrita,
    sem escopo de unidade) — `isSuperAdmin` (que controla aprovar/rejeitar transferência)
    continua exclusivo de `super_admin`, decisão do v1.43.0 não alterada.

## [1.54.1] - 2026-08-12

### Fixed
- **Card "Sobreaviso Hoje" do dashboard veio vazio para RH da Unidade, mesmo com sobreaviso
  geral ativo no momento** — regra já documentada e deliberada desde a Fase 5 do acionamento de
  sobreaviso (`20260808190000`): "VER é global; ACIONAR é por abrangência". `fn_painel_sobreaviso_dia`
  e `fn_pode_acionar_sobreaviso` (ambas de 08/08/2026, antes de `rh` existir em 11/08 e de
  `rh_unidade` em 12/08) tinham o guard de papel escrito como **allowlist fixa**
  (`super_admin`/`admin`/`coordenador`) — mesma classe de lacuna já corrigida nesta sessão em
  outros lugares, só que dentro do guard de uma função em vez de numa policy de RLS.
  - `fn_painel_sobreaviso_dia`: guard vira **denylist** (só barra `servidor`/`comum`, os papéis
    do Portal, que não usam este dashboard) em vez de allowlist — um papel interno novo não
    reabre este buraco de novo na próxima vez.
  - `fn_pode_acionar_sobreaviso`: `rh`/`rh_unidade` ganham a mesma capacidade de
    admin/coordenador (mesma decisão de paridade já assumida pro resto de escala/folha de ponto
    em v1.54.0). `ass_adm` deliberadamente não entra — continua só vendo, não acionando; não foi
    pedido e é decisão de autoridade maior que visibilidade.
  - Migration `20260812080000`.

### Fixed
- **O perfil "Recursos Humanos" (`role = 'rh'`, v1.44) estava incompleto desde que foi criado** —
  o usuário reportou que, ao limitar um RH a unidades específicas na tela de Usuários, ele
  continuava vendo dados de outras unidades. Investigação encontrou dois problemas opostos:
  - **Excesso**: `applyAccessFilters` (`src/utils/permissions.ts`, usado em 20 telas —
    `/servidores`, `/escalas`, `/folha-ponto`, `/relatorios/*`, `/home`, `/afastamentos`,
    `/justificativas`, `/unidades`, `/setores`, `/auditoria`) tinha `role === 'rh'` num bypass
    incondicional — ignorava completamente o que estava gravado no perfil (unidades/setores
    vinculados), daí desmarcar "Acesso Total" não ter efeito nenhum nessas telas.
  - **Falta**: a RLS de `escala_mensal`, `escala_diaria` e `folha_ponto` (`20260618080000`, a
    versão vigente de cada uma) nunca foi atualizada para incluir `'rh'` — o papel foi adicionado
    ao enum depois dessa migration. Resultado: um usuário `rh` tinha **zero** linhas de escala e
    folha de ponto via RLS, não importa o que estivesse marcado no perfil — `/escalas`,
    `/folha-ponto` e `/relatorios/rh` (a tela batizada justamente pro RH) vinham vazias.

### Added
- **Perfil "Recursos Humanos" desdobrado em dois**, migrations `20260812060000`/`20260812070000`:
  - **RH Geral** (`role = 'rh'`, mantido — nenhuma migração de dado, todo `rh` existente continua
    sendo isso) — enxerga tudo, agora corretamente também em escala e folha de ponto.
  - **RH da Unidade** (`role = 'rh_unidade'`, novo) — escopado pelas unidades vinculadas
    (`profile_unidades`), com acesso automático a **todos os setores** dessas unidades (nunca
    setor por setor — `acesso_todos_setores` é forçado no servidor ao escolher esse papel em
    `usuarios/actions.ts`, e as novas policies de RLS também não exigem essa flag pra esse papel
    especificamente, então as duas camadas concordam).
  - Novo item no seletor "Nível de Acesso" em `/usuarios`; ao escolher RH da Unidade, o checkbox
    "Acesso Total" de Setores fica travado marcado, com nota explicando o porquê.
  - `escala_mensal`, `escala_diaria`, `folha_ponto` (SELECT/INSERT/UPDATE/DELETE) e
    `servidores_eventos` ganharam branches para os dois papéis nas policies de RLS.

Ver [`docs/evolucao/2026-08-12-desdobramento-do-perfil-rh.md`](docs/evolucao/2026-08-12-desdobramento-do-perfil-rh.md).

## [1.53.0] - 2026-08-12

### Fixed
- **Coordenador cujo acesso vem só de `profile_setores` (setor vinculado, sem a unidade-pai
  vinculada também) via a tela de Pendências de Cadastro sempre com "0"** — mesmo a unidade
  dele tendo pendências de importação do RH. Diagnosticado com consultas reais em produção
  (coordenador do piloto da TI: zero linhas em `profile_unidades`, acesso só via
  `profile_setores`). Causa: a RLS de `importacao_rh_pendentes` (`20260812030000`) e o parâmetro
  de escopo de `fn_promover_pendencia_rh`/`fn_atualizar_cadastro_via_pendencia_rh`
  (`fn_unidade_no_escopo`) só verificavam `profile_unidades` — o mesmo padrão que a policy de
  `servidores` (`20260618080000`) já soma corretamente (unidade-direta OU setor-vinculado), mas
  que nunca chegou a `fn_unidade_no_escopo`.
  - Nova função `fn_unidade_alcancavel_por_setor` (migration `20260812050000`), usada só nos dois
    lugares desta feature — `fn_unidade_no_escopo` em si não foi alterada (é usada por bastante
    coisa do módulo REP não auditada nesta sessão; mudar o comportamento dela é risco maior do
    que o necessário aqui). Fica registrada como lacuna conhecida no CLAUDE.md.
  - `permittedUnidades` em `/servidores/pendencias` (o seletor de unidade do formulário de
    promoção) ganhou a mesma união.

### Added
- **Busca cross-unidade de pendências de RH por nome/matrícula/CPF** — 1.284 das 3.361
  pendências (38%, medido em produção) têm `unidade_id` nulo porque a importação original
  (v1.42.0) não conseguiu casar o departamento de origem com nenhuma unidade do SisEscala, e
  nada persiste uma correção disso depois. Nenhum coordenador conseguia ver essas linhas (nem
  com o fix acima), porque `unidade_id IN (...)` nunca casa com `NULL` — só admin/super_admin
  alcançavam. Mas é o coordenador quem reconhece o próprio pessoal pelo nome. Nova seção "Não
  achou seu servidor? Busque em toda a base" em `/servidores/pendencias`, usando
  `fn_buscar_pendencia_rh_por_termo` — `SECURITY DEFINER` bypassando RLS de propósito (mesmo
  padrão de `get_external_servers_for_scale`/`fn_cpf_ja_cadastrado`), *bounded* por termo
  digitado (mínimo 3 caracteres, no máximo 20 resultados) — nunca lista a fila inteira.
- **Detecção automática de pendência de RH pelo CPF no cadastro/edição de servidor** (pedido do
  usuário: "o próprio sistema consultar" essa base, sem precisar saber que a tela de Pendências
  existe). Novo componente `PendenciaRhCpfBanner`, usado em `/servidores/novo` e na ficha de
  edição: ao digitar um CPF que bate com uma pendência não promovida, mostra um aviso oferecendo
  puxar os dados complementares. Reusa `fn_atualizar_cadastro_via_pendencia_rh` (já existente,
  v1.51.0) — que já só preenche campo vazio (nunca sobrescreve) e já marca `promovido_em`, então
  tirar da fila de pendências acontece automaticamente como parte de aplicar os dados, sem
  função nova pra isso.
  - No cadastro novo, como `createServidor` sempre termina em `redirect()` (nunca devolve o id
    pro cliente), o formulário só marca a intenção (`pendencia_rh_id` no `FormData`) e a própria
    action aplica a atualização — melhor esforço — depois que o `INSERT` já teve sucesso, antes
    de redirecionar.
  - Na edição, o botão aplica na hora (o servidor já existe) e dá `router.refresh()` pra
    refletir os campos novos.

## [1.52.0] - 2026-08-12

### Added
- **Higiene de cadastros do dispositivo REP (Fase 7b)** — instalação real na LACEN (primeira
  unidade fora do piloto da TI) revelou que o relógio, reaproveitado de outro sistema, chega com
  cadastros de gente que pode não fazer mais parte do quadro. Nova tela "Higiene do Relógio" em
  `/marcacoes` (admin/super_admin) lista quem está cadastrado no equipamento agora e se
  corresponde a um servidor ativo do SisEscala ou não, com opção de marcar candidatos sem
  correspondência para remoção.
  - `rep_usuarios_dispositivo`: snapshot do que existe no relógio, reportado pelo coletor
    (`load_users.fcgi`) — substituído por inteiro a cada relato, nunca reconciliado
    incrementalmente.
  - `rep_remocoes_fila`: fila de remoção, só populada por ação explícita na tela.
    `fn_enfileirar_remocao_usuarios_dispositivo` recusa quem tem `rep_vinculos_servidor` vigente
    para um servidor Ativo — a tela não oferece a opção, mas a RPC também não confia só na UI.
  - Rotas novas `/api/rep/v1/usuarios-dispositivo` (POST, snapshot) e `/api/rep/v1/remocoes`
    (GET/POST, fila) — mesmo esquema de autenticação por token+HMAC das demais rotas do coletor.
  - Coletor Go: `rep.ListarUsuarios` (refactor de `ListarUsuariosComBiometria`, que virou um
    filtro em cima dela — herda a confiança da paginação já validada contra hardware real) e
    `rep.RemoverUsuario` (`remove_users.fcgi`) — **esta última NUNCA foi confirmada contra
    hardware real**, ao contrário de `add_users`/`load_users.fcgi`; o corpo da chamada é uma
    aproximação por simetria, precisa validar contra um usuário de teste antes de confiar em
    produção. Por isso `coletor-rep higiene` (leitura, segura) tem botão na bandeja, mas
    `coletor-rep higiene-remover` (escreve/apaga no equipamento) fica só na CLI, como
    `cadastros`/`cadastros-testar` já fazem para escrita.
- Log de sync da LACEN (12/08/2026) também confirmou, com dado real, que o `sync` sempre pede o
  AFD inteiro do relógio desde o NSR 1 a cada ciclo de 5 minutos (item já registrado como
  pendência no plano) — sem duplicar nada no banco (o atalho de idempotência por lote de
  `fn_ingerir_afd` absorve o reenvio), mas reprocessando ~36 mil linhas sem necessidade. Não
  corrigido nesta versão; documentado no CLAUDE.md como candidato a próxima prioridade.

## [1.51.1] - 2026-08-12

### Fixed
- **`ass_adm` tinha sido liberado por engano para Servidores/Pendências de Cadastro junto com
  coordenador** (v1.51.0) — a v1.51.0 replicou o agrupamento `isCoord` (coordenador + ass_adm)
  que a sidebar já usava pra outras decisões de menu, mas o pedido original era só coordenador
  (e diretor, que já tinha). Corrigido em três camadas (migration `20260812030000`):
  - Sidebar: item de menu só aparece pra `coordenador`.
  - RLS de `importacao_rh_pendentes`: policy só cita `coordenador`.
  - `fn_promover_pendencia_rh`/`fn_atualizar_cadastro_via_pendencia_rh` ganharam allowlist de
    papel explícito (`super_admin`/`admin`/`coordenador`) — a RLS fecha a listagem pela UI, mas
    as RPCs continuavam alcançáveis direto (client Supabase, SQL) sem checar papel nenhum além
    do que `fn_unidade_no_escopo` já garantia (que não distingue `ass_adm` de outros papéis com
    `profile_unidades` preenchido).

## [1.51.0] - 2026-08-12

### Added
- **Coordenador/ass_adm ganham acesso a "Servidores" e "Pendências de Cadastro"** — a intenção
  original da importação de dados de RH (v1.42.0) era usar o backlog de "Importados aguardando
  cadastro" pra facilitar a inclusão de servidores, mas só quem tinha acesso admin conseguia
  fazer isso.
  - "Servidores" precisou só de mudança na sidebar — a RLS (`"Scoped access for Admins and
    Coordinators"`, `20260618080000`) já incluía `coordenador` explicitamente, escopado por
    unidade/setor.
  - "Pendências de Cadastro" ganhou uma versão enxuta pra coordenador/ass_adm: só a importação
    de RH da própria unidade (nova policy de RLS em `importacao_rh_pendentes`, migration
    `20260812020000`). As duas seções que enxergam a base inteira sem escopo (documentos com
    dígito inválido, duplicidades suspeitas) continuam admin/super_admin apenas — são
    `SECURITY DEFINER` de propósito, e abrir isso pra coordenador vazaria CPF/nome de servidor
    de outras unidades.
- **Nova opção "é atualização de um cadastro que já existe"** no conflito de CPF da importação
  de RH — antes só existia "confirmo que é vínculo adicional" (que sempre cria um cadastro
  novo). `fn_atualizar_cadastro_via_pendencia_rh` (migration `20260812020000`) só preenche campo
  vazio (nunca sobrescreve o que já está preenchido) e nunca toca matrícula/unidade/setor/status
  — mudar lotação continua exigindo o fluxo de solicitação com aprovação do Administrador Geral
  (v1.43.0, criado depois do incidente real da THIELE/KETTELE). Divergência de lotação vira só
  um aviso na tela.
  - O painel de conflito deixou de depender de uma mensagem de erro pra aparecer: nova action
    `buscarConflitoCpf` chama `fn_cpf_ja_cadastrado` (já existente, `20260809110000`) assim que
    a linha é aberta, e mostra as duas opções lado a lado, explícitas, em vez de uma checkbox
    escondida atrás de um erro.
  - `fn_promover_pendencia_rh` ganhou checagem de escopo (`fn_unidade_no_escopo`) — não validava
    papel nenhum antes, porque só era alcançável pela UI admin-only; agora que coordenador chama
    direto, só promove pra dentro da própria unidade.

## [1.50.6] - 2026-08-12

### Notes
- **Push de identidade (Fase 7) confirmado contra hardware real** — quinto e último teste de
  `coletor-rep-cli cadastros-testar` contra 10.110.2.89: `CriarUsuario` criou um usuário de
  teste real no relógio; `ListarUsuariosComBiometria` achou os 5 servidores reais do piloto com
  biometria já cadastrada, CPFs batendo. Documentação (`rep/client.go`, `CLAUDE.md`,
  `tools/coletor-rep/README.md`) atualizada de "não validado" para confirmado. Continua fora do
  ciclo automático da bandeja por prudência com escrita em equipamento de produção, não por
  dúvida sobre o formato — só roda por clique manual ou `coletor-rep cadastros`.

## [1.50.5] - 2026-08-12

### Fixed
- **Matrícula temporária alfanumérica (`T26xxxxx`) agora é aceita no push de identidade** —
  `CriarUsuario` remove o prefixo `T` antes de converter para número. Não é invenção: o usuário
  confirmou que é exatamente o que já foi feito manualmente para os servidores com matrícula
  temporária já cadastrados neste relógio (achado ao revisar por que o teste rejeitava matrícula
  não-numérica) — busca no repositório inteiro não achou essa convenção documentada em lugar
  nenhum antes disso.

## [1.50.4] - 2026-08-12

### Fixed
- **Terceiro teste real (`load_users.fcgi` bem-sucedido, 6 usuários do piloto devolvidos)
  revelou que este relógio não tem campo `"id"`** — só `pis`/`registration`/`code`/`rfid`/
  `templates`, todos como **número JSON**, não string. Isso explicava também o erro anterior de
  `CriarUsuario` (`'cpf' em formato incorreto`): o campo estava sendo enviado como string
  (`"11144477735"`) quando o relógio espera número.
  - `device_user_id` deixou de ser o identificador de referência entre SisEscala e relógio — não
    existe, de verdade, nesta linha de equipamento. Passa a ser sempre `identificador_afd`
    (mesmo formato de 12 dígitos já usado em `rep_vinculos_servidor` para o sentido AFD→servidor).
  - `CriarUsuario` envia `registration`/`cpf` como número; recusa cedo (sem chamar o relógio) se
    a matrícula não for numérica — **matrículas temporárias alfanuméricas (`T26xxxxx`) não podem
    ser representadas neste campo do equipamento**, limitação real do hardware, não do código.
  - `ListarUsuariosComBiometria` casa por `pis` (zero-padded para 12 dígitos — CPF que começa
    com zero perde esse zero virando número JSON, mesma classe de bug da armadilha 10) em vez de
    um `id` inexistente.
  - `fn_atualizar_biometria_vinculos` (migration `20260812010000`) muda de `bigint[]` para
    `text[]`, casando por `identificador_afd`.

Ver [`docs/evolucao/2026-08-12-push-identidade-rele-fase7.md`](docs/evolucao/2026-08-12-push-identidade-rele-fase7.md).

## [1.50.3] - 2026-08-12

### Fixed
- **Segundo teste real revelou mais dois problemas, ambos de dado enviado, não mais de
  comando errado.** `add_users.fcgi`/`load_users.fcgi` já são reconhecidos pelo relógio (a
  correção da v1.50.2 funcionou) — o que faltava:
  - `CriarUsuario`: o CPF de teste usado era `"000000000000"` (12 zeros) — o relógio **valida
    o dígito verificador de verdade** e recusou com `'cpf' em formato incorreto`. Trocado para
    `011144477735`, um CPF de teste sintaticamente válido (nunca emitido de verdade, usado em
    QA de sistemas brasileiros).
  - `ListarUsuariosComBiometria`: `load_users.fcgi` documentado com `limit` **máximo 100** por
    chamada — o código pedia `1000` de uma vez, causando `deves ser do tipo booleano` (mensagem
    de erro do firmware não nomeia o campo certo). Agora pagina em blocos de 100. Também passou
    a falhar alto (em vez de devolver lista vazia em silêncio) se nenhum usuário tiver o campo
    `id` esperado — a documentação consultada não confirmou esse nome de campo na resposta.

## [1.50.2] - 2026-08-12

### Fixed
- **Push de identidade usava a API errada da Control iD.** Primeiro teste real de
  `coletor-rep-cli cadastros-testar` contra o relógio de 10.110.2.89: `create_objects.fcgi` e
  `load_objects.fcgi` voltaram HTTP 400 "Invalid command" — esse padrão genérico "objects" é da
  Linha de Acesso (iDAccess/iDFlex/iDBlock) da Control iD, não da linha REP/iDClass deste
  equipamento. Reescrito para `add_users.fcgi` (criar) e `load_users.fcgi` (listar, com
  `templates: true` para saber quem tem biometria), confirmados na documentação oficial da
  Control iD. Usa `mode=671`/campo `cpf`, já que `get_afd.fcgi` deste device já roda em modo
  671. **Ainda não confirmado contra hardware** — só o comando errado foi eliminado; o próximo
  `cadastros-testar` dirá se o formato de campo/resposta bate desta vez.

## [1.50.1] - 2026-08-12

### Fixed
- **`coletor-rep cadastros-testar` era orientado sem existir em lugar nenhum baixável.** A CLI
  (`cmd/cli`) nunca foi distribuída — só o app de bandeja (`cmd/tray`, no `.zip` de "Baixar
  aplicativo") — então a máquina que precisava validar o push de identidade contra hardware real
  só tinha `coletor-rep-tray.exe`, que ignora argumentos de linha de comando (é um app de
  bandeja, sem console). Nova rota `GET /api/coletor-rep/download-cli` (admin/super_admin) serve
  `coletor-rep-cli.exe` avulso, sem zip — lê o `config.yaml` que já está instalado ao lado do
  app de bandeja na mesma máquina. Link adicionado no aviso da tela de Dispositivo REP.

### Added
- **Aviso explicando por que não existe (nem pode existir) botão "Testar conexão" na tela do
  SisEscala**: o relógio fica na rede interna da unidade, e o servidor do SisEscala (Coolify, na
  internet) não tem caminho até lá — um teste do lado do servidor falharia sempre, mesmo com
  IP/usuário/senha corretos. O teste real (`coletor-rep-cli diagnostico`, já existente) só pode
  rodar numa máquina dentro da rede da unidade.

## [1.50.0] - 2026-08-12

### Added
- **Push de identidade SisEscala → relógio de ponto (Fase 7, parte identidade)**. Instalar em
  mais unidades expôs uma lacuna: `rep_vinculos_servidor` (a ponte CPF-do-relógio↔servidor) não
  tinha tela nenhuma, e cadastrar cada servidor manualmente na telinha do equipamento não
  escala. A biometria em si continua exigindo alguém presencial no relógio (o template do dedo
  não é enviável por API) — o que passa a ser automático é matrícula/nome/CPF chegarem prontos
  antes disso.
  - `rep_cadastros_fila` (migration `20260812000000`) + `fn_enfileirar_cadastros_rep` (admin
    clica, enfileira ativos da unidade/setor do dispositivo sem vínculo vigente e com CPF
    preenchido — pula e conta quem não tem CPF).
  - `GET /api/rep/v1/pendencias` deixa de ser stub (sempre `[]`) e passa a servir a fila real;
    `POST` no mesmo caminho confirma sucesso/falha e cria/renova `rep_vinculos_servidor`; nova
    `POST /api/rep/v1/biometria` fecha o loop (só liga `tem_biometria`, nunca desliga sozinha).
  - Botão "Sincronizar cadastros" no modal de Dispositivo REP; nova aba "Biometria Pendente" em
    `/marcacoes`.
  - `coletor-rep-tray` ganha menu "Sincronizar cadastros agora"; `coletor-rep` (CLI) ganha
    `cadastros` (aplica a fila real) e `cadastros-testar` (diagnóstico — cria um usuário de
    teste isolado no relógio, não toca na fila do SisEscala).
  - ⚠️ **`rep.CriarUsuario`/`rep.ListarUsuariosComBiometria` nunca foram testadas contra
    hardware real** (API genérica "objects" da Control iD — `create_objects.fcgi`/
    `load_objects.fcgi`). Por isso nunca entram no ciclo automático de 5 min — só rodam por
    clique manual ou pelo subcomando `cadastros-testar`, que deve ser rodado contra o relógio de
    cada unidade nova antes de confiar no botão da bandeja.

Ver [`docs/evolucao/2026-08-12-push-identidade-rele-fase7.md`](docs/evolucao/2026-08-12-push-identidade-rele-fase7.md).

## [1.49.1] - 2026-08-12

### Fixed
- **`coletor-rep-tray` nunca se auto-instalava de verdade em nenhuma máquina real** —
  `cmd/tray/main.go` decidia "modo desenvolvimento, roda direto sem instalar" checando só se
  havia um `config.yaml` no diretório de trabalho atual. O Explorer do Windows abre um `.exe`
  com o diretório de trabalho igual à pasta do próprio executável — exatamente onde o `.zip`
  baixado sempre deixa o `config.yaml`, ao lado do `.exe`. Resultado: **todo** duplo-clique de
  um usuário real caía nesse atalho, rodava direto da pasta extraída, e nunca copiava para
  `%LOCALAPPDATA%`, nunca registrava autostart, nunca passava pela mesclagem de config.yaml da
  v1.48.2. "Reinstalar" rodando o mesmo `.exe` de novo era sempre um no-op — sempre o mesmo
  arquivo estático da extração original, inclusive um token de terminal já superado por um
  "Gerar token" mais recente na tela do SisEscala, produzindo "Terminal ou token inválido" na
  ativação. Corrigido detectando `go run` pelo caminho do binário (contém `go-build`, padrão do
  toolchain Go em qualquer SO) em vez de pela presença de um arquivo ao lado dele.
- `dist/coletor-rep-tray.exe` recompilado com a correção — quem baixar o aplicativo a partir de
  agora recebe o binário corrigido.

## [1.49.0] - 2026-08-11

### Fixed
- **Terminal local ativava mas nenhuma batida registrava — sempre caía em "Terminal não
  ativado".** `POST /api/presenca-local/ativar` gravava o cookie de sessão com
  `path: '/presenca-local'`; `/api/presenca-local/registrar` é um prefixo **irmão** desse path,
  não filho, então o navegador nunca enviava o cookie de volta na chamada de registro. A
  ativação em si "funcionava" (a tela abria normalmente) — só bater o ponto falhava, sempre.
  Corrigido para `path: '/'` em `src/app/api/presenca-local/ativar/route.ts`. Encontrado no
  primeiro teste de campo com hardware/rede reais.

### Added
- **Usuário e senha do relógio migram para a tela "Editar dispositivo REP"** (migration
  `20260811200000`, nova coluna `usuario_rep`/`senha_rep`/`porta`/`usa_https` em
  `dispositivos_rep`). Reabria, para essa credencial específica, o mesmo problema que a v1.48.2
  tinha acabado de fechar: `config.yaml` sempre saía com `usuario_rep: admin` e um placeholder de
  senha, e o admin tinha que editar o arquivo à mão depois de baixar. `POST
  /api/coletor-rep/download` passa a ler endereço/usuário/senha/porta direto do banco pelo `id`
  do dispositivo em vez de confiar no que estava digitado no formulário no momento do clique — o
  zip baixado sempre reflete o que está de fato salvo. Senha nunca volta ao formulário em texto
  claro (nem na lista, nem preenchendo o campo ao editar); deixar o campo em branco ao salvar
  preserva a senha já gravada.
- **Botão de excluir para Terminal Local e Dispositivo REP** — só existia editar/desativar.
  Terminal local exclui sempre (nenhuma tabela referencia `terminais_locais.id`). Dispositivo REP
  recusa a exclusão com mensagem explicativa quando já existe AFD/marcação vinculada (violação de
  FK 23503 — registro de ponto retido por 5 anos, nunca apagável), sugerindo desativar em vez de
  excluir; um dispositivo de teste sem histórico exclui normalmente.

Ver [`docs/evolucao/2026-08-11-cookie-terminal-local-credenciais-rep-e-exclusao.md`](docs/evolucao/2026-08-11-cookie-terminal-local-credenciais-rep-e-exclusao.md).

## [1.48.2] - 2026-08-11

### Added
- **`coletor-rep-tray` mescla `config.yaml` em vez de sobrescrever no auto-instalador.** Uma
  máquina que precisa das duas modalidades (relógio + terminal) baixava dois `.zip` diferentes
  — cada um com só uma seção preenchida — e o segundo instalador apagava a seção que o primeiro
  tinha acabado de gravar, exigindo mesclar o YAML manualmente. `instalarConfig`
  (`cmd/tray/main.go`) agora lê o `config.yaml` já instalado (se houver), faz o parse dos dois
  com `gopkg.in/yaml.v3`, preserva a seção que o novo download não trouxe, e escreve o
  resultado mesclado. Rodar os dois instaladores, em qualquer ordem, basta.

## [1.48.1] - 2026-08-11

### Fixed
- **`config.yaml` baixado em `/marcacoes` vinha com `sisescala.url: http://localhost:3000`.**
  `new URL(request.url).origin` não é confiável atrás do proxy do Coolify — refletiu o bind
  interno do servidor standalone (`localhost:3000`), não o domínio público, e ninguém percebeu
  até um download real embutir isso no `config.yaml` de uma instalação de campo (o app abria o
  navegador em `localhost:3000/presenca-local/ativar?...` → `ERR_CONNECTION_REFUSED`). Corrigido
  em `src/app/api/coletor-rep/download/route.ts`: usa `NEXT_PUBLIC_SITE_URL` (a mesma variável
  que o link de sobreaviso por WhatsApp já usa, `src/app/actions/sobreaviso.ts`, por este exato
  motivo), com `X-Forwarded-Host`/`X-Forwarded-Proto` como fallback caso a variável não esteja
  configurada. Antes falhava em silêncio embutindo uma URL errada; agora, sem nenhuma das duas
  fontes disponíveis, devolve erro explícito em vez de adivinhar.

## [1.48.0] - 2026-08-11

### Added
- **App de bandeja para o coletor-rep, substituindo o modelo de serviço do Windows.**
  `tools/coletor-rep/` virou dois binários compartilhando os mesmos pacotes internos: `cmd/cli`
  (diagnóstico manual, o que já existia) e `cmd/tray` (novo). `kardianos/service` foi removido,
  não adaptado — serviço do Windows roda na Sessão 0, isolada da área de trabalho desde o
  Vista, e por isso nunca pode mostrar ícone de bandeja nem abrir navegador na sessão do
  usuário. O app de bandeja é um processo comum, com autostart via `HKCU\...\Run` (sem precisar
  de administrador), auto-instalação no primeiro uso, ícone verde/vermelho conforme o ciclo de
  sync, notificação (`gen2brain/beeep`) após falhas seguidas.
- **Distribuição por download em `/marcacoes`**, em vez de copiar token à mão. Botão "Baixar
  aplicativo" nos modais de Terminal Local e Dispositivo REP; nova rota
  `POST /api/coletor-rep/download` empacota o binário pré-compilado
  (`tools/coletor-rep/dist/coletor-rep-tray.exe`) com um `config.yaml` já preenchido com o
  id/token daquele terminal/dispositivo específico. Zip montado sem dependência nova
  (`src/utils/zip.ts`, formato STORE + CRC32 manual). `next.config.js` usa
  `outputFileTracingIncludes` para incluir o binário no `output: 'standalone'` — ele fica fora
  de `src/` e do rastreamento automático.
- Windows 7 fica deliberadamente fora do escopo (Go 1.21+ já exige Windows 10+); sem
  certificado de assinatura de código nem AD/GPO central sobre as unidades, o aviso do Windows
  na primeira execução (SmartScreen na maioria das máquinas, ocasionalmente Smart App Control)
  não dá para eliminar nesta rodada, só documentar.

⚠️ Binário do app de bandeja não testado interativamente nesta sessão — Smart App Control
bloqueou até `go run` na máquina onde foi escrito. Compila limpo e cada API externa foi
conferida contra documentação real, mas o comportamento em tempo de execução precisa de
validação numa máquina sem esse bloqueio. Ver
[`docs/evolucao/2026-08-11-app-bandeja-coletor-rep.md`](docs/evolucao/2026-08-11-app-bandeja-coletor-rep.md).

## [1.47.0] - 2026-08-11

### Fixed
- **Campo de data/hora do AFD tem 12 dígitos (`DDMMYYYYHHMM`), não 24 (ISO 8601).**
  `fn_parse_linha_afd` (`20260808080000`) nascera assumindo o formato do exemplo ilustrativo do
  plano (`2023-11-08T08:46:00-0300`) como os bytes reais — não são: o exemplo era uma
  reformatação para leitura humana na documentação. O cast direto `::timestamptz` falhava
  silenciosamente (capturado pelo `EXCEPTION` já existente) para toda linha tipo 3, e
  `fn_ingerir_afd` nunca criava marcação nenhuma — uma sincronização trouxe 17.448 registros do
  histórico completo do relógio e zero marcações. `linha_bruta` sempre esteve correta; o bug
  era só na extração das colunas derivadas, recuperável via `parse_versao` sem tocar no
  artefato legal. Migration `20260811190000` corrige os offsets e roda
  `fn_reparse_afd_dispositivo` para todo dispositivo existente, recuperando retroativamente as
  marcações que deveriam ter sido criadas desde o início. Confirmado em produção: 21 marcações
  resolvidas para servidor (batidas reais do piloto, horários conferidos).
- **Middleware redirecionava `/api/rep/v1/*` e `/api/presenca-local/*` para `/login`** por
  falta de sessão Supabase — essas rotas autenticam por token de dispositivo ou cookie
  assinado, nunca por sessão de navegador. Sintoma enganoso: `405 Method Not Allowed` em vez de
  um redirect visível (o POST redirecionado caía numa página `GET`-only). Corrigido
  acrescentando as duas rotas a `rotasApiPublicas`.
- Windows: `cmd /c start` cortava a URL de ativação do terminal local no primeiro `&`
  (separador de comando do `cmd.exe`) — `terminal/terminal.go` passa a usar
  `rundll32 url.dll,FileProtocolHandler`.

Ver [`docs/evolucao/2026-08-11-terminal-local-e-fechamento-fase4-rep.md`](docs/evolucao/2026-08-11-terminal-local-e-fechamento-fase4-rep.md).

## [1.46.0] - 2026-08-11

### Fixed
- Ver 1.47.0 acima — o fix do middleware foi lançado nesta versão e re-detalhado ali junto do
  fix do AFD, feito na sequência no mesmo dia.

## [1.45.0] - 2026-08-11

### Added
- **Terminal local sem sessão de coordenador.** O terminal `/presenca` ativava com
  `supabase.auth.signInWithPassword()` rodando no navegador da máquina do terminal — como o
  fluxo real é "coordenador ativa e vai embora", aquele navegador ficava com uma sessão
  Supabase Auth completa de coordenador/admin por dias, e servidores com acesso físico à
  máquina usavam isso para alterações indevidas na retaguarda. Nova tabela `terminais_locais`
  (`20260811180000`) com token por dispositivo (mesmo esquema sha256 de
  `dispositivos_rep`); `fn_registrar_ponto_terminal_local` confere que a matrícula pertence à
  unidade/setor do terminal — recusando **antes** de checar o PIN — e delega para
  `fn_registrar_ponto` sem tocar nela. O navegador do terminal nunca mais chama
  `supabase.auth`: ativa por um cookie httpOnly assinado com HMAC
  (`src/utils/terminalLocalSession.ts`), revogável na hora via `terminais_locais.ativo`.
  `/presenca` clássico não foi alterado — continua existindo para unidades sem o app local.
- **Fechamento em código da Fase 4** do plano de integração com o relógio de ponto (parada em
  08/08/2026): rotas `/api/rep/v1/*` com autenticação por token de dispositivo + assinatura
  HMAC anti-replay, módulo `/marcacoes` (Terminais Locais, Dispositivos REP, Pendências), e o
  coletor local em Go (`tools/coletor-rep`).

Ver [`docs/evolucao/2026-08-11-terminal-local-e-fechamento-fase4-rep.md`](docs/evolucao/2026-08-11-terminal-local-e-fechamento-fase4-rep.md).

## [1.44.0] - 2026-08-11

### Fixed
- **Resumo de ponto por WhatsApp nunca disparava.** `fn_gerar_resumos_aviso_ponto()` devolvia `0`
  sempre, sem erro visível — a seção diária agrupava por uma expressão repetida no `HAVING` e
  numa subquery correlacionada, um padrão frágil no Postgres. Reescrita com CTE (`dia` vira
  coluna material antes de agrupar), eliminando a ambiguidade. `EXCEPTION WHEN OTHERS` passa a
  gravar em `logs_sistema` antes de devolver 0, em vez de só `RAISE WARNING` — próxima falha, se
  houver, fica consultável em vez de silenciosa. Migration `20260811120000`. Confirmado gerando
  e despachando em produção após aplicar. Ver
  [`docs/evolucao/2026-08-11-resumo-whatsapp-e-escopo-transferencia-v1.44.0.md`](docs/evolucao/2026-08-11-resumo-whatsapp-e-escopo-transferencia-v1.44.0.md).
- **Seletor de lotação da solicitação de transferência (v1.43.0) estava filtrado pelo escopo de
  quem edita** — um coordenador só via unidades/setores já dentro do próprio escopo, tornando
  impossível propor o destino real (fora do que administra), que é o próprio motivo de existir a
  aprovação do `super_admin`. `servidores/[id]/page.tsx` deixou de aplicar `applyAccessFilters`
  nas listas de unidades/setores; a escrita continua protegida por RLS + pela checagem de role em
  `updateServidor`.

## [1.43.0] - 2026-08-11

### Added
- **Situação "Afastado" alcançável na UI.** A migration `20260810150000` (v1.42.0) já tinha dado
  ao `status` do servidor um terceiro valor real, mas nenhuma tela sabia gravá-lo — `StatusToggle`
  só alternava Ativo↔Inativo. Virou um seletor de 3 estados; sair de Ativo (pra Afastado ou
  Inativo) continua exigindo motivo, voltar pra Ativo continua sem exigir nada. Lista de
  servidores ganhou o filtro e o badge (âmbar) correspondentes.
- **Transferência de unidade/setor passa a exigir aprovação do Administrador Geral**
  (`solicitacoes_transferencia_servidor`, migration `20260811110000`). Pedido do RH depois do
  incidente da THIELE e da KETTELE (v1.41.0 — duas transferências recusadas pela RLS sem
  mensagem clara, histórico chegou a registrar transferência que não aconteceu): só `super_admin`
  efetiva transferência na hora; coordenador/admin passam a **solicitar**, com os demais campos do
  formulário continuando a salvar normalmente na mesma submissão — só a lotação fica presa no
  valor atual até alguém decidir.
  - Modelo espelha `solicitacoes_ferias_licencas` (a mais madura das solicitações já existentes no
    projeto): `status` sob `CHECK`, colunas de aprovação/rejeição dedicadas, RLS granular por
    role. Não substitui `historico_transferencias` — continua sendo o log do que realmente
    aconteceu; a tabela nova é só a fila do que foi pedido.
  - `registrarTransferenciaEfetivada` (histórico + limpeza de escala conflitante) virou função
    compartilhada entre a transferência direta e a aprovação de pedido — uma cópia só, não duas
    divergindo com o tempo.
  - Nova seção "Solicitações de Transferência" em `/servidores/pendencias`: todo mundo vê os
    pedidos no seu escopo; só `super_admin` vê os botões Aprovar/Rejeitar.

## [1.42.0] - 2026-08-10

### Added
- **Importação dos dados cadastrais de RH (SFPRC01M)** — estudo, plano e execução completos em
  [`docs/planos/2026-08-10-estudo-importacao-dados-cadastrais-rh.md`](docs/planos/2026-08-10-estudo-importacao-dados-cadastrais-rh.md)
  e [`2026-08-10-plano-de-importacao-de-dados-cadastrais-rh.md`](docs/planos/2026-08-10-plano-de-importacao-de-dados-cadastrais-rh.md).
  O SisEscala cobria 191 das ~3.382 pessoas (5,6%) que aparecem como vínculo ativo no relatório de
  RH da SMS.
  - Schema novo: `financiamento_saude_blocos` (bloco de custeio do SUS, não é unidade física),
    `cargos_codigos_origem` (código do RH → cargo, sem fusão por regime — decisão do usuário: o
    RH separa concursado de contratado de propósito), `servidores_historico_vinculo` (carreira,
    ancorada por CPF, não por `servidor_id` — a matrícula muda, o CPF não), `importacao_rh_pendentes`
    + `fn_promover_pendencia_rh` (staging — nenhum vínculo novo entra em `servidores` sem setor
    confirmado por um humano).
  - `servidores_cpf_unico` (índice único de CPF) foi derrubado: o relatório mostrou 110 CPFs com
    dois vínculos ativos simultâneos de verdade. Vira gate de confirmação explícita
    (`vinculo_multiplo_confirmado`) em `createServidor`/`updateServidor`, não bloqueio de banco —
    trade-off documentado na migration `20260810140000`.
  - `status` ganha `Afastado` como valor real, com `CHECK`.
  - Resultado da carga: 117 servidores existentes ganharam PIS/PASEP (era 0% preenchido), 3.362
    vínculos novos na fila de pendências (2.077 com unidade já resolvida, 1.285 aguardando —
    **nenhuma unidade foi criada automaticamente**, decisão do usuário), 4.942 linhas de histórico
    de carreira, 6 casos ambíguos deixados para decisão manual.
  - Tela `/servidores/pendencias` ganhou a seção "Importados aguardando cadastro": busca, filtro
    por unidade resolvida/vínculo adicional, e formulário de conclusão (unidade/setor/cargo) que
    chama `fn_promover_pendencia_rh`.

### Fixed
- **Mojibake no CSV de origem** (UTF-8 relido com página de código errada, inconsistente campo a
  campo — `Bairro` tinha 4.360 ocorrências, `Nome` só 1, mas incluindo um nome de servidor real).
  `scratchpad/rh_csv_utils.js` corrige por valor (nunca o arquivo inteiro de uma vez, que
  introduzia caractere de substituição em campo que já estava certo).
- **PIS/PASEP inválido quase gravado**: o script de backfill não validava dígito verificador do
  PIS antes de tentar gravar — pego pelo `CHECK` do banco (`chk_servidores_pis_digito`, já
  existente desde v1.38.0) antes de qualquer corrupção, mas corrigido na fonte (script) também.

## [1.41.0] - 2026-08-10

### Fixed
- **Erro cru de RLS ao salvar a ficha do servidor** (`new row violates row-level security policy for
  table "servidores"`). Acontecia ao deixar o campo Setor como "Sem Setor": a policy
  `"Scoped access for Admins and Coordinators"` (`20260618080000`) é `FOR ALL` **sem `WITH CHECK`**,
  e nesse caso o Postgres reusa a expressão do `USING` como `WITH CHECK`. Para quem não tem
  `acesso_todas_unidades` nem `acesso_todos_setores` — 20 dos 30 perfis de produção — a única via
  que autoriza é `setor_id IN profile_setores`, e `NULL` não pertence a lista nenhuma. Agora setor
  vazio (ou fora do escopo de quem salva) é recusado com mensagem que diz o que fazer, no
  formulário **e** na server action, que é chamável direto.
  - A policy **não** foi alterada: servidor sem setor sairia do escopo de quem o soltou — a linha
    passaria a reprovar também no `USING` e só super_admin conseguiria editá-la de novo.
- **Histórico de transferência que nunca aconteceu.** O `INSERT` em `historico_transferencias`
  vinha **antes** do `UPDATE` em `servidores`; recusado o `UPDATE`, o registro ficava. Passou para
  depois, junto com a limpeza de escalas. Migration `20260810100000` remove os 5 órfãos de produção
  (3 da THIELE em 29–30/07, 2 da KETTELE em 10/08 — as duas seguem lotadas em DMAC).
- **Edição anunciada como salva sem ter salvo nada.** A policy de leitura é mais larga que a de
  escrita (`20260626225000` deixa ver quem está escalado na unidade), então dá para abrir a ficha
  de um servidor que não se pode gravar. `UPDATE` filtrado pelo `USING` devolve sucesso com zero
  linhas — a tela redirecionava como se tivesse gravado. Agora o `.update()` pede `.select('id')` e
  a ausência de linha vira erro explicado.
- **Lotação apagada sozinha pelo formulário.** Os `<select>` de unidade/setor são controlados; quando
  o valor atual não está entre as opções carregadas (setor inativo, ou fora do acesso de quem abriu
  a ficha), nenhuma `<option>` casa e o navegador submete `""`. `isLotaçãoChanged` não detectava,
  porque compara o *state*. A submissão passou a levar o state.

### Notes
- Diagnóstico a partir do banco de produção: os 5 registros com `setor_destino_id IS NULL` são a
  impressão digital da falha — todos com o servidor ainda lotado no setor de origem. A repetição em
  minutos ("Assumiu PSS" 3×, "Disponibilizada para RH" 2×) é a pessoa tentando de novo porque a
  mensagem não dizia o que estava errado.

## [1.40.0] - 2026-08-10

### Added
- **Divulgação do aviso de ponto por WhatsApp no terminal `/presenca`** — retoma a decisão de
  09/08/2026 que tinha adiado o anúncio deliberadamente. Linha estática abaixo do aviso "pode
  registrar a qualquer horário", informando que o aviso existe e onde ativá-lo ("Aviso de ponto
  no WhatsApp", no Portal do Servidor). Não é link nem convite para ativar no próprio terminal —
  ele é um quiosque compartilhado; ativar continua exigindo autenticação por PIN no Portal
  (double opt-in, v1.28.0–v1.34.0). `fn_registrar_ponto` e o fluxo de gravação não foram tocados.

### Notes
- Plano em [`docs/planos/2026-08-09-comprovante-de-ponto-por-whatsapp.md`](docs/planos/2026-08-09-comprovante-de-ponto-por-whatsapp.md)
  § "Divulgação no terminal". Com double opt-in, quem não sabe que a opção existe nunca ativa —
  adesão baixa até aqui não era sinal contra a feature, só ausência de divulgação. Agora que está
  visível, uma adesão ainda baixa passa a ser sinal real.

## [1.39.0] - 2026-08-10

### Added
- **Fase 5 do plano de validação de documentos — tela "Pendências de Cadastro"** (`/servidores/pendencias`, admin/super_admin): reúne o que já existia em banco e ninguém consumia — `fn_documentos_invalidos()`, `fn_possiveis_duplicidades_servidor()` e os servidores sem CPF/PIS — em um diagnóstico só. Puramente informativo: nenhuma ação daqui altera dado, a correção continua sendo abrir a ficha do servidor.
  - Cartões de resumo: documentos com dígito inválido, servidores sem CPF, duplicidades suspeitas, servidores sem PIS/PASEP.
  - Duplicidades agrupadas por critério (CPF, nome, telefone, e-mail), expansíveis, com link direto para a ficha de cada servidor do grupo.
  - Gate de acesso replicado de `/usuarios` (não a RLS de `servidores`): as duas funções são `SECURITY DEFINER` e enxergam a base inteira sem escopo de unidade/setor, de propósito — a tela precisa do mesmo gate.

### Notes
- Confirmado em produção antes desta tela: os 4 CPFs com dígito inválido da auditoria de 09/08 foram corrigidos e a migration `20260809230000` (o `CHECK`) foi aplicada — `fn_documentos_invalidos()` devolve 0 linhas e `scratchpad/confere_documentos.js` concorda em CPF, CNPJ e PIS.
- Fecha o plano [`docs/planos/2026-08-09-validacao-de-documentos.md`](docs/planos/2026-08-09-validacao-de-documentos.md). O que fica de fora por decisão própria: CPF obrigatório (57 sem) e preenchimento de PIS (Fase 9 do módulo REP).

## [1.38.0] - 2026-08-09

### Added
- **Validação de dígito verificador em CPF, CNPJ e PIS** (migrations `20260809220000`, `20260809230000`; plano [`docs/planos/2026-08-09-validacao-de-documentos.md`](docs/planos/2026-08-09-validacao-de-documentos.md)):
  - Fonte única em [`src/utils/documentos.ts`](src/utils/documentos.ts), espelhada em SQL (`fn_cpf_digito_valido`, `fn_cnpj_digito_valido`, `fn_pis_digito_valido`), cruzadas por `scratchpad/confere_documentos.js`.
  - Aviso âmbar em `CampoDocumento` (não bloqueia o submit) + recusa nas server actions + `CHECK` no banco — o `CHECK` só entra depois de corrigir os documentos já inválidos, e a migration aborta sozinha se sobrar algum.
  - `pis_pasep` deixou de gravar o valor mascarado.

## [1.37.0] - 2026-08-09

### Added
- **Fase F — retenção de logs configurável, e DESLIGADA por padrão** (migration `20260809210000`):
  - `fn_expurgar_logs(p_simular)` **simula por padrão**: chamar sem argumento não apaga nada. Operação destrutiva em produção não deve ser o comportamento acidental.
  - Só três categorias são expurgáveis, todas configuráveis por `configuracoes_globais`: `LOGIN`/`LOGOUT` de `logs_sistema`, `logs_webhook_whatsapp`, e `avisos_ponto_fila` **apenas com status `enviado`** — as **falhas ficam**, porque são elas que respondem "não recebi o aviso de ontem".
  - **Chave ausente ou zero = nunca expurgar.** Zero é lido como *"guardar para sempre"*, não como *"apagar tudo"* — a convenção oposta já destruiu dado em sistema demais. Aplicar a migration não apaga nada.
  - O expurgo real **deixa rastro na própria trilha** (`LOGS_EXPURGADOS`). Apagar log sem registrar que se apagou é o tipo de coisa que uma auditoria pergunta e ninguém sabe responder.
  - `fn_expurgar_logs_se_devido()` tem controle próprio de 24 h, então o worker pode chamá-la a cada minuto sem pensar. O JSON de `/api/avisos-ponto/despachar` ganha `logsExpurgados`.
  - Nenhuma tabela de **registro de ponto** entra: `rep_afd_registros`, `marcacoes_ponto`, `marcacoes_tratamentos`, `escala_diaria`, `escala_mensal`, `folha_ponto`, `logs_preferencia_aviso_ponto`, `logs_tentativas_presenca`, `logs_sobreaviso` e `historico_transferencias` são preservadas por 5 anos (prescrição trabalhista, CF Art. 7º XXIX), sem expurgo automático.

### Documentation
- **`docs/runbooks/2026-08-09-backup-dos-registros-legais.md`** — especificação do backup, que é a lacuna de maior consequência e a menos visível do estudo: **não existe backup próprio do SisEscala**, só o da VPS, se houver. E a aplicação e o banco moram no mesmo host, então um backup que viva ali não protege contra a perda que mais importa.
  - Dump lógico diário fora da VPS (com `servidores`, `unidades` e `setores` junto — ponto sem identidade é ilegível), export assinado do AFD por competência, e **conferência de restauração semestral**: backup nunca testado não é backup.
  - Registra por que réplica **não** é backup: ela copia o `DELETE` acidental junto.
  - Fica como especificação, não implementação — é infraestrutura da VPS, e depende de quatro decisões que não são de código.

### Notes
- Em 09/08/2026 o expurgo não teria efeito mesmo se ligado: o log mais antigo é de 23/05/2026, então nem os `LOGIN`/`LOGOUT` de 12 meses venceram. A rotina só passa a agir em 2027.
- Isto encerra as seis fases do estudo de auditoria (A a F).

## [1.36.0] - 2026-08-09

### Added
- **Fase D — aba "Avisos de Ponto" na Auditoria** (super_admin), reunindo três trilhas que existiam no banco sem nenhuma tela:
  - **Consentimento** (`logs_preferencia_aviso_ponto`) — quem pediu, quando, que texto leu, por qual origem e com que telefone. É a evidência que sustenta o envio: se alguém questionar *"por que o sistema manda meu ponto pro WhatsApp?"*, a resposta está aqui. Até agora só existia via SQL.
  - **Falhas de envio** (`avisos_ponto_fila`) — eram **invisíveis**. Quando um servidor dissesse "não recebi o aviso de ontem", ninguém respondia sem abrir o banco. Aparecem **no topo**, antes da trilha de consentimento: enterrá-las embaixo repetiria o erro da aba de tentativas negadas, onde o acionável ficava afogado.
  - **Envios recentes** com status, horário de enfileiramento e de entrega.
  - Cartões de resumo: consentiram · aguardando resposta · mensagens enviadas · falhas.

### Notes
- A tela explicita que **"consentiram" ≠ "quem recebe agora"**: depois de uma transferência para lotação não habilitada o consentimento continua válido (a pessoa não retirou nada) mas nada é entregue. Para contar quem recebe de fato, `fn_aviso_ponto_efetivo`.
- Erro de carregamento é tratado como **provável RLS** e explicado na tela — as tabelas são restritas a administradores desde a v1.35.0, e uma lista vazia sem explicação levaria a diagnóstico errado.
- Verificado que o ramo de renderização é o **primeiro da cadeia**, e portanto alcançável. Na v1.33.0 um guard colocado antes tornou o ramo do componente inalcançável, e `tsc` e `build` passaram — o JSX era válido e a tela simplesmente não renderizava.

## [1.35.0] - 2026-08-09

### Security
- **Fase E — RLS alinhada ao que as telas restringem** (migration `20260809200000`):
  - **Restringir só na tela não restringe.** O grupo *Auditoria & Gestão* é oculto para coordenadores desde a v1.2.1 e a aba de tentativas negadas é super_admin apenas — mas se a policy libera `SELECT`, um coordenador lê os mesmos dados pela API. É o mesmo raciocínio que fez o Portal do Servidor validar no servidor em vez de só desabilitar o input.
  - As três tabelas do aviso de ponto (`logs_preferencia_aviso_ponto`, `avisos_ponto_fila`, `logs_webhook_whatsapp`) passam a ser **admin/super_admin**. Foram criadas liberando `SELECT` também a coordenador — excesso das migrations `20260809120000` e `20260809130000`. Guardam consentimento, telefone e o **texto das mensagens**, que inclui os horários de ponto da pessoa.
  - `logs_sistema` deixa de expor as entradas de **perfil** a quem não é super_admin. Depois da Fase B a tabela carrega o diff de mudança de papel, de escopo de acesso e de redefinição de senha; a policy vigente libera por unidade, e um coordenador com `acesso_todas_unidades` passaria a enxergar **quem concedeu qual privilégio a quem** — governança, não operação.
  - A policy existente teve de ser **recriada**, não complementada: policies permissivas se somam com `OR`, então adicionar uma segunda só ampliaria o acesso. As quatro vias originais foram preservadas na íntegra.

### Notes
- ⚠️ **`logs_tentativas_presenca` NÃO foi tocada, e isso é deliberado.** A grade lista as batidas recusadas no modal de validação manual através de `fn_tentativas_recusadas_mes`, que é **`SECURITY INVOKER`** — é a RLS da tabela que autoriza. Apertar ali quebraria a validação manual em produção, justamente o fluxo que recupera horário real de batida negada por bug. O mesmo vale para `logs_sobreaviso`, lida direto pela grade, pelos relatórios e pelo `NotificationListener`.
- A **inserção** em `logs_sistema` segue liberada a qualquer autenticado: apertar a leitura não pode impedir ninguém de **produzir** trilha.
- Verificação que importa depois de aplicar: abrir a grade **como coordenador** e conferir que o modal de validação manual continua listando as batidas recusadas.

## [1.34.0] - 2026-08-09

### Added
- **Fase B da auditoria — as quatro lacunas graves passam a ser registradas.** Todas usam o helper único de `src/utils/auditoria.ts`, com `entidade`, `entidade_id`, autoria e **diff dos campos que mudaram**:

  - **Folha de ponto** (`FOLHA_EDITADA`, `FOLHA_STATUS_ALTERADO`) — é o documento legal do ponto, e até aqui guardava apenas `ultima_edicao_por_id`: **só a última edição**, com os horários num `jsonb` sobrescrito inteiro. Não havia como mostrar que a entrada do dia 12 era `08:03` e virou `08:00`, nem quem fez. O diff é **por dia e por campo** (`dia 12 · entrada`), e não o array inteiro — numa folha de 31 dias, a mudança de um horário ficaria escondida no meio de 30 dias idênticos.
  - **Usuários e permissões** (`USUARIO_PAPEL_ALTERADO`, `USUARIO_PERMISSOES_ALTERADAS`, `USUARIO_EDITADO`, `USUARIO_STATUS_ALTERADO`, `USUARIO_SENHA_REDEFINIDA`) — conceder `acesso_todas_unidades` amplia o alcance de uma pessoa sobre os dados de 183 servidores e não deixava rastro. Mudança de papel ganha ação própria: um coordenador virando admin não é o mesmo que corrigir a grafia de um nome, e numa lista cronológica ficariam indistinguíveis. O vínculo com unidades e setores entra no diff como lista ordenada.
  - **Competência** (`COMPETENCIA_ENCERRADA`, `COMPETENCIA_REABERTA`) — congela ou descongela um mês inteiro de folha e escala. **Reabrir é justamente o movimento que uma auditoria quer ver documentado**, e o único rastro era o `encerrado_por` dentro do jsonb — que some quando a competência é reaberta.
  - **Servidores** (`SERVIDOR_CRIADO`, `SERVIDOR_EDITADO`, `SERVIDOR_STATUS_ALTERADO`) — matrícula, CPF, telefone e lotação sustentam a identidade que ampara o ponto. `updateServidor` passou a buscar o registro inteiro para servir de "antes".

### Notes
- **Campo sensível nunca vai com valor.** `pin_acesso` é registrado como *alterado* sem o conteúdo, e a redefinição de senha grava `(omitido)` nos dois lados: o log precisa provar a troca e não pode contê-la.
- `foto_url` fica fora do diff — muda a cada upload e só produziria ruído.
- Falha ao registrar **nunca derruba a operação**: vira `console.error` e a ação segue. Perder uma linha de log é ruim; impedir um coordenador de fechar uma folha porque o log falhou é pior.
- Fases restantes do estudo: **D** (aba de Avisos de Ponto), **E** (RLS alinhado ao que a tela restringe) e **F** (retenção configurável).

## [1.33.0] - 2026-08-09

### Added
- **Trilha de auditoria estruturada** (migration `20260809180000`):
  - `logs_sistema` ganha `entidade`, `entidade_id`, `origem` e `alteracoes`, mais três índices e `fn_trilha_auditoria` — a pergunta "tudo que aconteceu com este alvo" passa a ter **uma** definição. Nenhuma escrita existente quebra.
  - `origem` resolve uma ambiguidade real: 403 das 2.995 linhas estão sem `user_id` e são rotina automática, mas sem esse campo *"rotina"* e *"falhou ao capturar o autor"* eram indistinguíveis — e auditoria não pode confiar na ausência de autor. As linhas históricas já foram marcadas.
  - `alteracoes` guarda **apenas os campos que mudaram**. A linha inteira inflaria o log e esconderia a mudança no meio do que ficou igual.
  - Helper único em `src/utils/auditoria.ts`, substituindo sete implementações soltas de `.insert()`. Campo sensível é registrado como *alterado* **sem o valor**: o log precisa provar que o PIN mudou e não pode conter o PIN.

- **Diagnóstico de tentativas negadas** (migration `20260809190000` + nova tela):
  - A aba era a mais usada pela coordenação, e para um fim operacional: achar por que a batida foi recusada e **corrigir a escala**. Mas das 981 tentativas de produção, **395 são erro de digitação** (`PIN inválido`) e **58 são comportamento correto** (`já registrou`) — 46% do que a tela mostrava não apontava problema, e afogava os 423 que apontavam. Como quem é recusado tenta 3 ou 4 vezes, um problema virava quatro linhas.
  - `fn_classificar_tentativa_negada` (identidade · já_registrado · sem_escala · horário_divergente · erro_sistema), `fn_desvio_tentativa_minutos` e `fn_tentativas_negadas_diagnostico/_resumo`, agrupando **981 tentativas em 495 casos**.
  - **A borda certa vem da mensagem**, e isso não é detalhe: medindo sempre pela borda mais próxima, FRANCISCA MACEDO AMORIM aparecia com 706 min de desvio contra um previsto `null–19:00` — quando o provável é que a jornada começasse às 07:00 e só o fim tenha sido gravado. **A pessoa estava certa e a tela ia acusá-la.** Agora `ENTRADA` mede contra o início, `SAÍDA` contra o fim, e a genérica marca `previsao_incompleta` (56 de 239 casos).
  - Tela nova com cartões por causa, ordenação por gravidade do desvio e link direto para a grade — reaproveitando a navegação que já existia na página.

### Notes
- Todos os números foram **validados por simulação em JS sobre os dados reais antes de o SQL ser escrito** (`scratchpad/simula_tentativas_negadas.js`), e conferidos depois em produção: 423/395/99/58/6, 495 casos, desvio mín 6 · p50 67 · p90 502 · máx 714 min. Bateram exatamente.
- O pior caso conhecido: VANESSA LEONCIO DA SILVA, 31/07, previsto 08:00–18:00, **714 min** — tentativa de saída por volta das 06:00 num turno que encerra às 18:00. Turno noturno cadastrado como diurno é a hipótese mais provável.
- **Sobre espaço:** o sistema inteiro tem 18,3 MB e os logs crescem ~14 MB/ano. O que cresce é `marcacoes_ponto` (36 MB/ano), que é registro de ponto e **não pode ser apagado**. Não há problema de disco a resolver — havia lacuna de registro. Estudo em `docs/planos/2026-08-09-auditoria-logs-retencao.md`.

## [1.32.0] - 2026-08-09

### Added
- **Caixa dedicada ao aviso de ponto** (`aviso_ponto_whatsapp_sid`, em Configurações → Comunicação):
  - O primeiro teste de ponta a ponta falhou por um motivo estrutural: o envio usa a sessão **global** do AstraCalls, e a resposta do servidor cai na caixa do Chatwoot correspondente a **essa** sessão — que hoje é uma caixa de atendimento ao público (Central de Regulação Ambulatorial). A regra de automação apontava para outra caixa, então nunca disparou e a confirmação nunca chegou.
  - Preenchendo a sessão dedicada, **só o aviso de ponto** passa a sair — e portanto a ser respondido — por uma caixa própria. PIN e sobreaviso continuam na sessão geral. Em branco, nada muda.
  - Resolução em `src/utils/avisoPontoCanal.ts`, **fonte única** usada pelo worker (que envia) e pelo webhook (que responde a cortesia). Se cada um resolvesse por conta própria, o aviso sairia por uma caixa e a confirmação por outra — que é exatamente a falha que isto corrige.
  - `url` e `key` são opcionais e herdam as globais: trocar de caixa dentro do mesmo provedor não muda endereço nem credencial.

### Fixed
- **Webhook guardava o conteúdo de mensagens que não têm nada a ver com o SisEscala**:
  - `logs_webhook_whatsapp` gravava o payload bruto de **tudo** que chegasse pela caixa configurada. Como essa caixa atende o público, isso colocaria **mensagem de paciente dentro do banco do SisEscala** — dado de terceiro, em sistema que não é o dele, sem relação nenhuma com ponto.
  - Agora o conteúdo só é guardado quando a mensagem é **de um servidor**. Nos demais casos a linha é gravada sem `payload`, sem telefone e sem texto — a contagem e o diagnóstico continuam existindo, o conteúdo não.
  - O discriminador é o campo `acao`, que `fn_confirmar_aviso_ponto` só devolve nos caminhos em que o telefone casou com exatamente **um** servidor. Não exigiu migration.
  - ⚠️ Ao acrescentar retorno novo àquela função, só inclua `acao` se um servidor tiver sido identificado — é isso que autoriza o armazenamento.

### Notes
- Diagnóstico do teste que falhou: opt-in registrado 21:47:09, mensagem enviada 21:48:06 (fila `enviado`), resposta **nunca chegou** ao webhook. A regra do Chatwoot filtrava `Caixa de Entrada = USF ENF ZEZINHA` enquanto a conversa estava em `CRA Central De Regulação AMBULATÓRIO`.
- O texto enviado não aparece no Chatwoot porque o envio **não passa por ele**: sai pela API do AstraCalls. O Chatwoot só observa a mensagem de entrada — dois sistemas na mesma linha.

## [1.31.0] - 2026-08-09

### Fixed
- **Opt-in de lotação não habilitada disparava WhatsApp** (migration `20260809170000`) — 🔴 o mais grave dos três:
  - `fn_solicitar_aviso_ponto` validava termo, servidor, telefone e pedido pendente, e **nunca consultava** `fn_aviso_ponto_habilitado`. Alguém de setor desabilitado clicava em *Ativar*, **o sistema enviava a mensagem de confirmação**, ele respondia `SIM` e ficava `ativo` — sem nunca receber aviso de ponto, porque o gatilho barra corretamente.
  - O dano não era o passo final: era a mensagem enviada por uma lotação que a coordenação não liberou, **no mesmo número que serve o acionamento de sobreaviso**. Durante o piloto da TI, qualquer pessoa da CAF, DMAC ou ALMOXARIFADO que achasse a aba furava o portão de rollout.
  - A checagem entra **antes** da do telefone: quem está fora do escopo está bloqueado de qualquer forma, e mandar corrigir o cadastro o faria consertar a coisa errada.
  - No Portal, o botão **Ativar aviso** nasce desabilitado com a explicação, em vez de deixar clicar e falhar depois de a mensagem já ter saído.
  - ⚠️ **Desativar continua sempre permitido** e **`PARAR` continua incondicional**: amarrar a saída à habilitação prenderia a pessoa numa preferência que ela não pode mudar, e ignorar `PARAR` é o caminho mais curto para denúncia e banimento.

### Added
- **`fn_aviso_ponto_efetivo(servidor_id)` — consentimento ≠ efetividade**:
  - Transferência para lotação não habilitada **nunca** gerou envio indevido: o gatilho resolve a habilitação no instante da batida, pela lotação da própria marcação. O defeito era de **dado** — `SELECT count(*) WHERE aviso_ponto_status = 'ativo'` passava a contar quem não recebe nada, e essa é justamente a consulta de uma auditoria de consentimento.
  - **Não se desativa o servidor na transferência.** Consentimento é sobre a pessoa e o canal; lotação é sobre disponibilidade. Transferir é ato administrativo — gravar como desativação atribuiria a ele uma decisão que não foi dele, no mesmo log que serve de prova. E voltando ao setor de origem ele refaria o double opt-in inteiro, incluindo mais **uma** mensagem no número que estamos protegendo.
  - `aviso_ponto_status` continua sendo o que a pessoa decidiu; `fn_aviso_ponto_efetivo` é o que relatórios de "quem recebe" devem consultar.
  - No Portal, o rótulo passa a **`Ativado — indisponível na sua lotação atual`** quando os dois divergem, em vez de um `Ativado` que não se cumpre.

- **Tela da unidade lista os setores que a sobrepõem**:
  - A precedência é `COALESCE(setor, unidade, false)` — é ela que viabiliza ligar a TI (6 servidores) sem ligar a SMS (78), e **não** foi alterada. O defeito era de visibilidade: quem desmarcava a unidade acreditava ter desligado tudo, enquanto um setor marcado como habilitado continuava enviando.
  - A tela passa a exibir quais setores têm configuração própria e em que estado.

### Notes
- Migration é **arquivo gerado** por `scratchpad/gen_elegibilidade.js`, que copia o corpo vigente de `fn_solicitar_aviso_ponto` e insere a checagem, abortando em qualquer divergência (CLAUDE.md, armadilha 1). Conferido: fora dos dois trechos alterados, ficou **byte a byte idêntica**.
- Análise dos três problemas em `docs/planos/2026-08-09-escopo-e-elegibilidade-do-aviso-de-ponto.md`.

## [1.30.0] - 2026-08-09

### Added
- **Aviso de ponto habilitado por SETOR, com herança da unidade** (migration `20260809150000`):
  - O toggle nasceu por **unidade**, e isso é grosso demais para o piloto: a TI da SMS tem **6** servidores, mas ligar a unidade SMS habilitaria os **78** da secretaria — 13× o escopo pretendido. O double opt-in impede que alguém receba sem pedir, mas tornaria a opção **visível** a 78 pessoas, e adesão fora do grupo desmontaria a leitura do piloto.
  - `setores.aviso_ponto_whatsapp` com três estados: `NULL` herda a unidade (padrão de todos os setores existentes), `true`/`false` sobrepõem. Mesma forma da geolocalização por setor (v1.7.0).
  - A precedência vive em **um lugar só**, `fn_aviso_ponto_habilitado(unidade_id, setor_id)`. Reimplementá-la em cada chamador é como o módulo de marcações acabou com três regras de intervalo divergentes.
  - Novo campo no cadastro do setor, e o Portal do Servidor passa a consultar a RPC em vez de ler a coluna da unidade.

### Removed
- **`unidades.aviso_ponto_eventos`** — a unidade deixa de escolher **quais** registros avisam (migration `20260809160000`):
  - Essa coluna e `servidores.aviso_ponto_modo` respondiam a **mesma pergunta** de dois lugares, e no gatilho eram dois `IF` consecutivos com o da unidade rodando **primeiro**.
  - Dano 1: o servidor escolhia "todas as batidas" e recebia só duas, porque a unidade tinha desmarcado os passos de intervalo — nada na tela dele explicava. O sistema prometia uma coisa e a unidade sobrepunha em silêncio.
  - Dano 2: `fora_janela` estava na lista da unidade e podia ser **desmarcado**, quebrando a única garantia válida em todos os modos. É justamente o caso em que o silêncio prejudica quem bateu.
  - Duas fontes para a mesma regra é como o módulo de marcações acabou com três regras de intervalo divergentes (armadilha 9). **A unidade decide SE envia; o servidor decide O QUE recebe.**
  - A coluna é **removida**, não apenas ignorada: coluna que ninguém lê e ninguém mostra é como `unidades.configuracoes_comunicacao` — fica anos parecendo que configura algo.

### Notes
- Migrations `20260809150000` e `20260809160000` são **arquivos gerados** (`scratchpad/gen_setor.js` e `gen_sem_eventos.js`), que copiam o corpo das funções vigentes e aplicam substituições pontuais, abortando se qualquer contagem ou guard divergir (CLAUDE.md, armadilha 1). Conferido: fora dos blocos intencionalmente alterados, `fn_enfileirar_aviso_ponto` ficou **byte a byte idêntica**.
- O `DROP COLUMN` vem **depois** do `CREATE OR REPLACE` na mesma migration: enquanto a versão anterior do gatilho estiver ativa ela ainda lê a coluna, e derrubá-la antes quebraria toda batida até a função ser recriada.
- Piloto redefinido: **SMS / TECNOLOGIA DA INFORMAÇÃO** (6 servidores, todos com telefone) → **USF ENFERMEIRA ZEZINHA** → demais. É o mesmo grupo do piloto do REP, com o coordenador como participante.
- Ligar um setor **não inscreve ninguém**: cada servidor ainda precisa ativar no Portal e confirmar pelo WhatsApp.

## [1.29.0] - 2026-08-09

### Added
- **Frequência do aviso escolhida pelo servidor** (migration `20260809140000`):
  - Quatro opções no Portal: **resumo semanal** (~4 msg/mês), **resumo diário** (~22, **padrão**), **entrada e saída** (~44) e **todas as batidas** (até 88).
  - O resumo diário é padrão por ser **evidência melhor**, não só por incomodar menos: uma mensagem com as quatro batidas do dia é uma peça só, que a pessoa acha depois — quatro fragmentos ao longo do dia ninguém recupera.
  - **Os resumos não saem do gatilho.** No instante da batida o sistema não sabe que ela é a última, e nos dias em que a saída não é registrada (esquecimento, ou batida fora da janela que virou pendência) o resumo nunca sairia — justamente o dia em que a pessoa mais precisa dele. Quem produz é `fn_gerar_resumos_aviso_ponto()`, chamada pelo worker a cada minuto: o dia fecha quando **todos** os turnos têm saída (entrega em ≤1 min, na prática "na última batida") ou quando o dia vira — este segundo sai marcado como **incompleto**, com orientação de procurar o coordenador.
  - Agregação por **(servidor, dia)**, não por linha de `escala_diaria`: um servidor pode ter duas linhas no mesmo dia (Regular + Plantão), e percorrer linha a linha entregaria um resumo com só um dos turnos — com o índice único engolindo o outro em silêncio.
  - Idempotência por `(servidor_id, tipo, referencia)`. Sem ela o worker, rodando de minuto em minuto, reenviaria o mesmo resumo indefinidamente — o pior comportamento possível para quem escolheu ser pouco incomodado.
  - `fora_janela` avisa **sempre**, em qualquer modo, e nunca entra em resumo.
  - Resumo mensal foi **descartado**: é a folha de ponto, que já existe no Portal com mais detalhe do que cabe numa mensagem. O resumo semanal leva o **link** do Portal no rodapé.

### Fixed
- **Webhook não entendia o payload do Chatwoot** (`src/app/api/avisos-ponto/webhook/route.ts`):
  - Confirmado com payload real de produção (`automation_event.message_created`): o Chatwoot envia a **conversa**, não a mensagem. O texto está em `messages[].content` e o telefone em `meta.sender.phone_number` — o parser anterior só olhava campos de topo e não achava nada.
  - O filtro de eco tinha o mesmo defeito: lia `message_type` no topo, onde vem `undefined`. Agora verifica dentro do array — payload cujo array só tem mensagens enviadas é eco e é descartado.
  - Verificado contra o payload real capturado em `logs_webhook_whatsapp`, mais os casos de eco, histórico misto e provedor genérico (Baileys).
- **Expiração de opt-in movida para dentro do worker**: este Supabase não tem `pg_cron` (`schema "cron" does not exist`). Uma tarefa que depende de alguém rodar SQL manualmente toda semana não é tarefa, é dívida.

### Notes
- O worker `/api/avisos-ponto/despachar` passa a devolver `optinsExpirados` e `resumosGerados` no JSON — serve como confirmação simples de que o deploy pegou.
- Trocar a frequência **não** dispara novo consentimento: o double opt-in já foi dado e continua valendo. Frequência é preferência, não autorização.
- Plano atualizado em `docs/planos/2026-08-09-comprovante-de-ponto-por-whatsapp.md`; passo a passo em `docs/runbooks/2026-08-09-ativar-aviso-de-ponto-passo-a-passo.md`.

## [1.28.0] - 2026-08-09

### Fixed
- **Rotas de API redirecionadas para `/login` — a v1.27.0 nasceu inerte em produção** (`src/utils/supabase/middleware.ts`):
  - A lista de exceções do middleware liberava apenas `/api/templates`. Todo o restante sob `/api` recebia **HTTP 307 para `/login`** quando não havia sessão de navegador — e quem chama essas rotas é **máquina, não gente**.
  - O sintoma é o pior possível: redirect não é erro. O `fetch` segue para `/login`, recebe HTML com status **200**, e a chamada "dá certo" sem fazer nada.
  - Efeito medido em produção em 09/08/2026 (`curl` devolvendo 307): a auto-atualização do terminal de ponto — a feature central da **v1.27.0** — fazia `fetch('/api/version')`, recebia o HTML do login, o `r.json()` estourava e o `catch` (que existe para tolerar rede instável de portaria) engolia em silêncio. **O terminal nunca se atualizou sozinho**, pela mesma classe de falha silenciosa que a v1.27.0 foi escrita para corrigir.
  - `/api/cron` estava igualmente bloqueada — convém conferir se o fechamento automático de escalas e a geração de rascunhos vinham de fato rodando.
  - As rotas públicas por natureza ou com autenticação própria passam a ser listadas explicitamente: `/api/templates`, `/api/version`, `/api/cron` e `/api/avisos-ponto`. Cada uma mantém sua própria defesa (`CRON_SECRET`, `WHATSAPP_WEBHOOK_SECRET`).

- **Configuração de comunicação da unidade nunca era gravada na coluna que o código tentava** (`src/app/(dashboard)/unidades/actions.ts`):
  - `updateUnidade` gravava em `unidades.configuracoes_comunicacao`, coluna que **não existe em produção**. O erro era invisível duas vezes: o `try/catch` não pegava nada (o supabase-js devolve `{ error }`, não lança) e o `catch` externo só cobria o `JSON.parse`. A tela sempre reportou sucesso.
  - Fonte única passa a ser `configuracoes_globais`, chave `unidade_comunicacao_<id>` — de onde `sendWhatsAppMessageAction` já lia. O erro do upsert agora **aparece na tela**.
  - `sharePinWhatsApp` passou a enviar `unidadeId`: sem ele o PIN saía sempre pelo canal global, ignorando o canal próprio da unidade.

### Added
- **Cadastro único de servidor por CPF** (migration `20260809110000`):
  - Produção tinha a mesma pessoa cadastrada duas vezes (VIVIAN MARTINS MACEDO, `T2600019` e `T2600014`, mesmo CPF/nome/e-mail/telefone).
  - Causa raiz: `servidores` tem `UNIQUE` só em `matricula` e **nada** em `cpf`; e com a matrícula em branco a trigger `trg_atribuir_matricula_temporaria` gera uma **nova**. Cadastrar a mesma pessoa duas vezes não colidia com nada — a única proteção de unicidade era contornada pelo caminho mais usado (15 matrículas temporárias em produção).
  - Agravante idêntico ao de `20260807110000`: checagem feita do frontend passa pela RLS, que escopa `servidores` por unidade — quem não enxerga a outra unidade não acha a duplicata.
  - Índice único parcial `servidores_cpf_unico` sobre o CPF normalizado (backstop real), `fn_cpf_ja_cadastrado` **`SECURITY DEFINER`** (mensagem útil, enxerga a tabela inteira), `fn_possiveis_duplicidades_servidor` (cobre os 31% sem CPF, que o índice não alcança) e `fn_cpf_digito_valido` (aviso, não `CHECK`: 4 CPFs já gravados reprovam).
  - Limpeza decide por **histórico, não por data** — o cadastro mais antigo era o fantasma (0 referências, setor ALMOXARIFADO) e o mais novo tinha 10 marcações de ponto (setor CAF). Aborta se dois cadastros do mesmo CPF tiverem histórico.
  - Checagem aplicada nas três portas de escrita, incluindo duplicidade **dentro do próprio CSV** na importação em massa, que antes não conferia nada.

- **Aviso de registro de ponto por WhatsApp, com double opt-in** (migrations `20260809120000` e `20260809130000`):
  - Quem bate no terminal não levava nada consigo — a tela some em 3 s (6 s no caso âmbar) — enquanto quem bate no REP-C sai com papel na mão.
  - É um **aviso informativo** e a mensagem diz isso: **não** é o Comprovante de Registro de Ponto do Art. 79 da Portaria 671/2021, que exige NSR, nº INPI, hash SHA-256 e assinatura ICP-Brasil — quatro campos hoje inatingíveis. O comprovante de verdade é o PDF no Portal (fase própria), que é o que atende o Art. 80.
  - **Double opt-in**: aceite do termo no Portal (autenticado por PIN) **+** resposta confirmando no próprio WhatsApp, via webhook. Resolve três coisas de uma vez — o sinal dominante de spam é conversa de mão única e a resposta transforma o número em interlocutor (o número é o **mesmo** do acionamento de sobreaviso); a resposta prova **posse** do aparelho, que o PIN não prova; e é a posição mais forte sob a LGPD.
  - Pedido não respondido **expira em 48 h e não é reenviado** — silêncio é resposta, e insistir é o que gera bloqueio. `PARAR` é honrado em qualquer estado.
  - Enfileiramento por gatilho em `marcacoes_ponto`, envio por worker (`/api/avisos-ponto/despachar`): nenhuma chamada HTTP entra no caminho de quem está batendo o ponto, e o disparo independe da versão do bundle do terminal. Todo o gatilho sob `EXCEPTION WHEN OTHERS`.
  - O passo (entrada/saída/intervalo) é **lido** de `escala_diaria`, não inferido: o trigger de sync já gravou o valor quando este dispara. Sem casamento = pendente de revisão = evento `fora_janela`. Nenhuma função de presença foi alterada.
  - Configuração por unidade (`aviso_ponto_whatsapp`, `aviso_ponto_eventos`) com `DEFAULT false`: aplicar a migration não envia nada a ninguém.
  - `logs_webhook_whatsapp` guarda o payload bruto de toda mensagem recebida — permite descobrir o formato real do provedor por `SELECT`, em vez de caçar em log de container, e serve como evidência da resposta que sustenta o consentimento.

### Notes
- O termo de ciência tem **fonte única** em `src/utils/avisoPonto.ts`: o texto exibido e o gravado em `logs_preferencia_aviso_ponto.termo_texto` são o mesmo literal, e a server action **não aceita** o termo vindo do cliente. Um registro que provasse ciência de texto diferente do lido perderia todo o valor.
- Casamento telefone → servidor pelos **últimos 8 dígitos** (o WhatsApp devolve o número brasileiro ora com, ora sem o 9º dígito). Se o sufixo casar com dois cadastros, a função **recusa decidir**. Medido em produção: zero sufixos ambíguos.
- Divulgação no terminal **adiada deliberadamente** — decisão de 09/08/2026, registrada no plano. Adesão baixa no piloto significará que ninguém foi avisado da opção, não que ela não interessa.
- Piloto definido: **HMM** (4 servidores, todos com telefone, pico de 4 batidas/dia). Expansão HMM → CTA → USF ENFERMEIRA ZEZINHA → SMS → LACEM; a ZEZINHA em terceiro por ser a única unidade com marcação de intervalo.
- Planos em `docs/planos/2026-08-09-comprovante-de-ponto-por-whatsapp.md` e `docs/planos/2026-08-09-cadastro-unico-de-servidor.md`. Passo a passo de ativação em `docs/runbooks/2026-08-09-ativar-aviso-de-ponto-passo-a-passo.md`.

## [1.25.0] - 2026-08-09

### Fixed
- **Plantão Diurno em Jornada Noturna (dobra de 24h)**:
  - Servidor com jornada Regular `18H ÀS 06H` escalado com **Plantão MT** no mesmo dia: a intenção é chegar às **06:00**, cumprir o plantão até as **18:00** e emendar o turno normal até as 06:00 do dia seguinte. O sistema calculava o plantão como **18:00 → 06:00**, sobreposto ao Regular.
  - Causa: a cadeia de precedência de horário tratava plantão como **sequência do expediente**. O nível 2 (âncora do dicionário, `MT = 07:00`) só vale quando não há Regular no dia; havendo Regular, a cascata legada alinhava o plantão pelo **início** da jornada — 18:00 com jornada noturna.
  - Efeito no terminal: a batida das **06:00** não casava com nenhum passo e virava pendência de revisão; a das **18:00** era gravada como **entrada** nos três registros do dia, apagando as 12h já trabalhadas; e a saída da manhã seguinte caía fora da janela.
  - Novo **nível 2-A** da cadeia — *âncora espelho da jornada noturna*: quando o Regular do dia cruza a meia-noite (`end_hour < start_hour`) e o plantão declara período diurno (`slots[1] IN ('M','T')`), o plantão ancora no **fim** da jornada. A "manhã" de quem faz noite começa quando a noite dela terminaria. Fica acima do nível 2 (a âncora fixa do dicionário não conhece a jornada do servidor) e abaixo do nível 1 (o coordenador continua vencendo tudo).
  - Efeito colateral corrigido de quebra: `ORDER BY start_hour` ficava **empatado** entre Regular e Plantão, deixando indefinido qual era o primeiro turno do bloco — e é isso que decide quais horários `fn_salvar_saida_bloco` fabrica no checkout.

- **Fusão de Blocos Apagando o Intervalo da Segunda Jornada**:
  - Um bloco carrega **um único intervalo** (`v_b1_int_ini := COALESCE(v_s1_int_ini_min, v_s2_int_ini_min)`). Plantão de 12h + Regular de 12h, cada um com 1h de intervalo, fundidos num bloco só resultariam em **12h seguidas sem repouso registrado** — em unidade com `permite_marca_intervalo = true`.
  - Novo guard de **não-fusão** para o plantão diurno em dia de jornada noturna, com a mesma forma dos guards de Sobreaviso de `20260807000000`, cobrindo os **12 sítios de fusão** das três funções. `Regular + Extra` continuam fundindo: a extra *é* sequência do expediente.

- **`fn_salvar_saida_bloco` Divergindo da Janela Cobrada pelo Terminal**:
  - A função vigente era de 06/07/2026 e **nunca recebeu os níveis 1 e 2** da ancoragem de 08/08/2026. Como é ela quem fabrica os horários de transição de um bloco com vários turnos, dividia o bloco num horário que o terminal nunca cobrou.
  - Passa a enxergar `escala_diaria.hora_inicio_prevista` (nível 1), a âncora do dicionário (nível 2) e a nova âncora espelho (2-A).

### Added
- **Batida de Transição**: fechado um bloco, se o bloco seguinte começa no mesmo instante em que este termina e ainda não tem entrada, a **mesma batida** abre o próximo, gravando a **hora real** — nunca a prevista. Sem isso o servidor teria de bater duas vezes no mesmo minuto, e quem esquecesse a segunda deixaria a jornada seguinte sem entrada.
- **Hora de Início em Turno Ancorado (`ScaleGrid.tsx`)**: o coordenador passa a poder informar a hora **também em código ancorado**, como sobreposição manual do nível 1 — a válvula de escape para a exceção que nenhuma regra prevê. O banco já aceitava; era a grade que apagava o valor. Em código ancorado a célula exibe em cinza o horário que o **banco** prevê (`fn_blocos_previstos_mes`, mesma fonte do terminal) e clicar sobrepõe.
- **Motor de Compliance ciente de jornada noturna** (`complianceEngine.ts`): nova `fimDeJornadaNoturna()`; `checkInterjornada` recebe a jornada por servidor e `getShiftStartHour`/`getShiftEndHour` espelham a âncora 2-A. Sem isso a grade calcularia interjornada sobre um horário que o terminal não cobra mais.

### Notes
- Alcance medido em produção antes de aplicar: **8 dias-servidor** (2 servidores, 1 unidade, 08/2026), **nenhum com presença gravada ou confirmada** — mudança inteiramente prospectiva, sem backfill. Simulação do motor de blocos sobre agosto inteiro: **8 alterados, 3.282 inalterados**.
- Migration `20260809000000` é **arquivo gerado** por `scratchpad/gen_dobra.js`, que copia o corpo das funções vigentes e aborta se qualquer contagem de ocorrências ou conferência estrutural divergir (CLAUDE.md, armadilha 1).
- Plano completo em `docs/planos/2026-08-09-plantao-diurno-em-jornada-noturna.md`.

## [1.21.0] - 2026-08-07

### Added
- **Intervalo Flexível por Servidor (`servidores.intervalo_flexivel`)**:
  - Nova flag no cadastro do servidor que libera o gozo do intervalo em **qualquer horário**, mesmo em unidades configuradas como intervalo **Rígido**, desde que a carga horária líquida seja cumprida.
  - Quando ativa, os campos `intervalo_inicio_personalizado` / `intervalo_fim_personalizado` deixam de ser horários obrigatórios e passam a definir apenas a **duração prevista** do intervalo.
  - Cálculo dinâmico da saída: `saída_esperada = fim previsto + (intervalo real − intervalo previsto)`. O excedente adia a saída e o tempo a menos antecipa (ex.: jornada 08h–18h com intervalo previsto de 2h — sai 14h e volta 17h ⇒ saída às 19h; sai 12h e volta 12h30 ⇒ saída às 16h30).
  - Nova função `public.fn_ajuste_intervalo_flexivel(boolean, timestamptz, timestamptz, integer)`.
  - No terminal: saída para intervalo aceita em qualquer momento antes de abrir a janela de saída final; retorno aceito a qualquer momento desde que a saída já tenha sido registrada.

### Fixed
- **Regressão do Guard de Intervalo Intrajornada (CLT Art. 71)**:
  - A migração `20260804080000` recriou `fn_confirmar_presenca` e **descartou** a verificação `(v_end_min - v_start_min) > 240 AND COALESCE(r.intervalo_minutos, 0) > 0`, fazendo com que jornadas de **4h e 6h** recebessem o fluxo de 4 batidas e gravassem a saída real como "saída para intervalo".
  - Guard restaurado nos dois laços de `fn_confirmar_presenca` e criado em `fn_confirmar_presenca_manual` (cobrindo também `fn_confirmar_presenca_manual_bulk`, que delega para ela).
  - Nova função `public.fn_jornada_tem_intervalo(integer, integer)` como fonte única da regra: duração superior a 360 min **e** `intervalo_minutos > 0`.
  - `ScaleGrid.tsx`: `isUnitInterval` passa a considerar a jornada efetiva do dia (respeitando jornada temporária) e a duração do turno para Plantão/Extra, exibindo 2 segmentos em vez de 4 para jornadas curtas.
  - Correção de 31 registros indevidos na competência 08/2026: campos de intervalo limpos e saídas faltantes reconstruídas a partir do término previsto da jornada. Os timestamps antigos **não** foram movidos por serem sintéticos (`início + 4h`), o que produziria registros de ponto falsos.

- **Sobreaviso Contaminando o Registro de Presença**:
  - O Sobreaviso era **fundido no bloco de trabalho contínuo** quando escalado no mesmo dia de um turno, deslocando a janela de saída para o fim do sobreaviso (tipicamente 06:00 do dia seguinte) e impedindo o servidor de registrar a saída do expediente.
  - `Regular`, `Extra` e `Plantão` continuam fundindo entre si normalmente (ex.: 08h–18h + 2h extra + Plantão N 12h formam um único bloco).
  - Sobreaviso removido da montagem de blocos em `fn_confirmar_presenca` e da escrita em `escala_diaria` por `fn_confirmar_presenca_manual`. O ciclo do sobreaviso (acionamento → aceite → chegada) permanece integralmente em `logs_sobreaviso`, e a validação manual de chegada segue funcionando.
  - Nova constraint `chk_sobreaviso_sem_presenca` em `escala_diaria`: barreira definitiva que impede qualquer caminho de escrita de gravar presença em linha de Sobreaviso.
  - Saídas recuperadas a partir de `logs_tentativas_presenca`, usando o horário real das batidas que haviam sido recusadas.
  - As checagens de **acesso** do coordenador continuam considerando Sobreaviso, para não bloquear o terminal de quem tem apenas sobreaviso no dia.

### Changed
- **Histórico de Acionamentos (`ScaleGrid.tsx`)**: chamado com chegada registrada e sem aceite passa a exibir **"Não registrado"** em vez de "Pendente", com tooltip explicativo — o servidor não aceitou a tempo, mas compareceu.

### Documentation
- `CLAUDE.md`: guia de arquitetura e armadilhas do projeto (regressões por `CREATE OR REPLACE`, schema base fora das migrations, divergência entre os dois bancos, horários derivados por regex do nome da jornada, limite de 1000 linhas do PostgREST).
- `.agents/AGENTS.md`: regras obrigatórias de preservação ao recriar `fn_confirmar_presenca*`.
- `docs/evolucao/2026-08-07-correcoes-presenca-sobreaviso-e-intervalo-flexivel-v1.21.0.md`: documentação técnica completa.
- `docs/planned_features/incoerencias-cronologicas-08-2026.md`: 4 registros com ordem cronológica impossível, pendentes de diagnóstico.

## [1.20.0] - 2026-08-05

### Added
- **Módulo de Justificativas Motivacionais de Eventos (`/justificativas`)**:
  - Fila Operacional de Eventos com KPI Cards (Total de Eventos, Pendentes de Justificativa, Sugestões dos Servidores, Progresso % de Preenchimento).
  - Preenchimento individual e em lote com seleção múltipla e seletor rápido de modelos pré-cadastrados.
  - Combobox de Busca em Tempo Real por Servidor (pesquisa instantânea por Nome e Matrícula com suporte a grandes volumes de servidores).
  - Aba **Sugestões dos Servidores** para análise, aprovação com/sem edição de texto e rejeição de justificativas submetidas pelo Portal do Servidor (`/consultar-escala`).
  - Auto-seed de 9 Modelos de Justificativa Padrão (3 para Hora Extra, 3 para Plantão e 3 para Sobreaviso).
  - Emissão de Relatórios Oficiais Municipais com Bloco Triplo de Assinaturas (Servidor, Coordenador e Diretor) e Hash SHA-256 de integridade.
- **Assinatura Digital Criptográfica com Certificado A1 (.pfx)**:
  - Assinatura em memória via PKCS#7 utilizando `node-forge` sem armazenamento de chave privada ou senha.
  - Registro auditável de assinaturas com hash de verificação na tabela `justificativas_assinaturas`.

### Changed
- **Paginação Padronizada**:
  - Aplicada a paginação oficial do SisEscala com contador de intervalo (`Mostrando X a Y de Z eventos`) e botões de navegação numerados.
- **Governança por Perfis**:
  - Restrição automática de visualização por Unidade e Setor permitidos (`applyAccessFilters`), isolando permissões entre Coordenadores e Super Admin.

### Fixed
- **Auditoria de Registros**:
  - Corrigida a gravação na tabela `logs_sistema` para utilizar o campo `user_id` e execução encapsulada em Server Actions com `createAdminClient()`.

## [1.19.1] - 2026-08-04

### Fixed
- **Cálculo da Hora de Início do Turno `T` para Jornadas 12h-18h**:
  - Atualizadas as funções PostgreSQL `fn_confirmar_presenca` e `fn_confirmar_presenca_manual` em [20260804050000_fix_shift_t_12h_jornada_start.sql](file:///c:/Users/ferna/projetos/SisEscala/supabase/migrations/20260804050000_fix_shift_t_12h_jornada_start.sql) para reconhecer o início às **12:00** em células de turno `T` com jornada regular cadastrada como `12H ÀS 18H` (janela permitida de 11:30 às 12:30).
- **Suporte aos Escopos de Validação Manual em `fn_confirmar_presenca_manual`**:
  - Adicionado tratamento para os parâmetros `'completo'`, `'periodo_1'` e `'periodo_2'` na RPC de validação manual, resolvendo o erro *"Tipo de presença inválido."*.
- **Permissão de Leitura RLS em `logs_tentativas_presenca`**:
  - Criada a política `Allow authorized users read logs` em [20260804060000_allow_coordinators_admins_read_denied_attempt_logs.sql](file:///c:/Users/ferna/projetos/SisEscala/supabase/migrations/20260804060000_allow_coordinators_admins_read_denied_attempt_logs.sql) para permitir que Coordenadores e Administradores consultem as recusas no modal de validação manual.

### Changed
- **Rótulos Dinâmicos do Escopo de Validação na Grade (`ScaleGrid.tsx`)**:
  - Substituídos os rótulos fixos `(Manhã)` e `(Tarde)` nos botões do modal de validação por descrições dinâmicas de acordo com a jornada agendada no dia (ex: `Manhã (07h-11h)`, `Entrada Tarde`, `Entrada Noturna`, `1º Turno / Entrada`).

## [1.19.0] - 2026-08-04

### Added
- **Validação em Massa de Presença em Multi-Níveis**:
  - **Nível 1 (Ação Rápida por Célula / Meio Período)**: Suporte no modal da célula a validações rápidas por batida individual, dia completo, 1º período (Manhã) ou 2º período (Tarde).
  - **Nível 2 (Validação por Servidor e Período)**: Adicionado ícone de atalho (`<CheckSquare />`) ao lado do nome do servidor para validação rápida por período de dias.
  - **Nível 3 (Validação Global em Massa)**: Adicionado botão **`⚡ Validar em Massa`** no topo da grade abrindo modal global para selecionar múltiplos servidores e categorias por intervalo de datas.
- **Exigência de Justificativa Obrigatória para Ajustes Manuais**:
  - Toda validação manual executada por Gestores/Administradores exige justificativa obrigatória registrada nos logs do sistema.
- **Validação Manual de Sobreaviso Pendente ou Falhado**:
  - Permitida a validação manual de chamados de sobreaviso no modal de histórico com justificativa obrigatória, retornando o horário à carga computada do servidor.
- **Alerta de Tentativas Negadas pelo Terminal**:
  - Leitura dos registros de `logs_tentativas_presenca` com selo ⚠️ e tooltip informando horários e motivos de recusa pelo terminal físico de ponto.
- **Bloqueio Rigoroso de Validação em Datas Futuras**:
  - Impedida a homologação de presenças para dias futuros no banco de dados (`MAKE_DATE(ano, mes, dia) > CURRENT_DATE`) e na interface (capping de inputs e limitações nos modais em massa e por célula).

### Changed
- **Atualização da Nomenclatura para "PREVISÃO" e "PREV"**:
  - Alterada a denominação da coluna e totalizadores de `PLANEJADO` para `PREVISÃO` (e de `PLAN` para `PREV`) na grade de escalas (`ScaleGrid.tsx`), relatórios e central de ajuda.

### Fixed
- **Preservação Integral de Batidas Reais de Servidores**:
  - Atualizada a função SQL `fn_confirmar_presenca_manual` com `COALESCE` em todas as etapas de batidas para que horários marcados nos terminais de ponto não sejam sobrescritos durante a validação em massa, preenchendo e justificando exclusivamente os horários faltantes.
- **Contagem do Rodapé de Sobreaviso ("Servidores por Turno")**:
  - Ajustada a função `shiftTotals` em `ScaleGrid.tsx` para contabilizar corretamente a presença de servidores de sobreaviso escalados no rodapé `SERVIDORES POR TURNO -> SOBREAVISO`, impedindo que um chamado com falha transmitisse a impressão de dia desatendido.

## [1.18.0] - 2026-08-04

### Added
- **Refinamento dos Indicadores de Presença por Categoria e Despoluição Visual**:
  - **Despoluição da Grade (`ScaleGrid.tsx`)**: Células sem agendamento (hífen `-`) em Extras, Plantões e Sobreaviso ficam 100% limpas sem exibir barrinhas vermelhas desnecessárias.
  - **Regras Diferenciadas de Marcação por Categoria**:
    - **Regular**: Exibe indicadores apenas nos dias com turno agendado (4 segmentos se intervalo ativo e > 4h; 2 segmentos se $\le$ 4h ou sem intervalo).
    - **Extra**: Exibe indicadores apenas em células com horas extras (ex: `1`, `2`). Mantém sempre no máximo 2 batidas (sem pausa para intervalo) ou consolida a extensão da 4ª batida (Saída Final) do turno regular continuado.
    - **Plantão**: Exibe indicadores apenas em células com plantão agendado (ex: `MT`, `N`).
    - **Sobreaviso**: Removida a exibição de barrinhas de presença tradicionais; mantida exclusivamente a sinalização por ícone de acionamento via WhatsApp (`Zap`, bolinhas de status `Aguardando`, `Aceito`, `Chegou`).
  - **Garantia de Estabilidade & Não-Regressão**: 100% de preservação das regras do terminal físico de presença (`/presenca`), RPC `fn_confirmar_presenca`, cálculo da folha de ponto e motor de conformidade.

## [1.17.0] - 2026-08-04

### Added
- **Suporte Parametrizado à Marcação de Intervalo (Pausas) por Unidade**:
  - Nova flag `permite_marca_intervalo`, `tipo_intervalo` ('flexivel' | 'rigido') e `tolerancia_intervalo_minutos` na tabela `unidades`.
  - **Modo Flexível**: Saída de intervalo livre com validação de retorno calculada somando a duração da jornada + tolerância.
  - **Modo Rígido (Abordagem Híbrida)**: Cascata de validação de horário fixo (Personalizado no Servidor $\rightarrow$ Padrão na Jornada $\rightarrow$ Cálculo Automático Fallback) aplicada a saídas e retornos.
  - **Decisão Automática 2 vs 4 Passos**: Jornadas $\le$ 4h ou sem intervalo cadastrado utilizam automaticamente o fluxo de 2 batidas.
- **Grade de Escalas Dinâmica (ScaleGrid)**:
  - Exibição condicional de 4 segmentos de presença (Entrada, Saída Int, Retorno Int, Saída Final) para unidades com intervalo ativo, ou 2 segmentos em unidades padrão.
  - Trava de governança: Batidas reais efetuadas via terminal físico são bloqueadas para edição/reversão por Coordenadores e reservadas exclusivamente para Administradores e Super Admins.
- **Formulários de Gestão**:
  - Novo painel de configuração de intervalo nos formulários de cadastro e edição de unidades (`UnidadeIntervaloSettings`).
  - Campos de horário padrão de intervalo em Jornadas e horários personalizados no cadastro de Servidores.
- **Documentação de Arquitetura**:
  - Adicionado estudo técnico e documentação completa da funcionalidade em `docs/planos/2026-08-04-marcacao-de-intervalos-por-unidade.md`.

## [1.16.5] - 2026-08-02

### Fixed
- **Restrição Estrita de Acionamentos à Janela Ativa do Turno**:
  - Implementada validação da janela de horário do plantão (`isShiftActiveNow`) em `ScaleGrid.tsx`.
  - Para dias passados (ex: dia 1º) ou fora do horário do turno, a criação de novos acionamentos é completamente bloqueada.
  - Ao clicar em dias passados com acionamentos, o modal de histórico abre exclusivamente em modo de consulta do histórico registrado.

## [1.16.4] - 2026-08-02

### Fixed
- **Resolução Definitiva do Status Atual da Célula (`latestLog`)**:
  - A checagem da célula de sobreaviso (`ScaleGrid.tsx`) foi atualizada para extrair o status do **último chamado ativo registrado no dia** (`latestLog`), corrigindo cenários com múltiplos acionamentos (ex: Chamado 1 `Chegou`, Chamado 2 `Timeout`, Chamado 3 `Aceito`).
  - O ícone do raio flutuante (`Zap`) é 100% ocultado e a célula exibe a bolinha de status ativo (verde para `Aceito`/Em Deslocamento ou laranja para `Aguardando`).
  - Clicar na bolinha abre diretamente o modal completo com o link preenchido e as 3 opções de reenvio (WhatsApp API Automático, WhatsApp Web Manual e Copiar Link).

## [1.16.3] - 2026-08-02

### Fixed
- **Otimização de Deployment Docker no Coolify (`next.config.js`)**:
  - Habilitada a opção `output: 'standalone'` no `next.config.js`, gerando o build enxuto para containers Docker/Coolify. Evita estouro de memória durante a coleta de traces do Nixpacks (erro exit code 255 em servidores de deploy).

## [1.16.2] - 2026-08-02

### Fixed
- **Ocultação Estrita do Ícone do Raio (`Zap`) em Deslocamento**:
  - Garantido que o botão flutuante de novo acionamento (`Zap`) é 100% ocultado na grade da escala (`ScaleGrid.tsx`) se o servidor estiver com chamado em status `Aceito` (Em Deslocamento) ou `Aguardando`.
  - A célula exibe a badge com a bolinha verde animada `Navigation2` (Em Deslocamento), que ao ser clicada reabre a janela de disparo de notificação.
- **Reenvio de Notificação Habilitado para Chamados `ACEITO`**:
  - No modal de histórico de acionamentos (`sobreavisoHistoryModal`), o card do chamado ativo com status **`ACEITO`** passa a exibir o botão **"📲 Reenviar Notificação / Link"**, que reabre a janela completa com as 3 opções (WhatsApp API Automático, WhatsApp Web Manual e Copiar Link).

## [1.16.1] - 2026-08-02

### Added
- **Destaque do Status `Em Deslocamento` no Dashboard (`/home`)**:
  - Quando um servidor aceita o chamado (`Aceito`), o card **SOBREAVISO ATIVO HOJE** passa a destacar com badge animada o status **🚗 Em Deslocamento**.
- **Trava de Segurança contra Acionamentos Duplicados em Deslocamento (`ScaleGrid.tsx`)**:
  - Enquanto o servidor estiver com status `Aceito` (Em Deslocamento) ou `Aguardando`, o botão para criar um novo acionamento no mesmo dia permanece travado com aviso explicativo. Um novo chamado só é liberado após a confirmação de chegada no local (`Chegou`) ou encerramento do chamado anterior.

## [1.16.0] - 2026-08-02

### Added
- **Reenvio de Notificação pelo Indicador Laranja (`Aguardando`)**:
  - Clicar na bolinha laranja de status pendente na célula de sobreaviso (`ScaleGrid.tsx`) reabre diretamente o modal de disparo com o link de aceite, permitindo reenviar a notificação via WhatsApp (API/Web) ou copiar a mensagem sem criar registros duplicados.
- **Suporte e Exibição de Múltiplos Acionamentos no Mesmo Dia**:
  - Novo modal `sobreavisoHistoryModal` na Grade de Escala que lista todos os acionamentos ocorridos no dia para aquele servidor, permitindo reenviar notificações, validar chamados individuais ou realizar novos acionamentos.
  - Badge numérico (ex: `2x`, `3x`) nas células com múltiplos chamados no dia.
  - Exibição de badge com contadores de chamados no card **SOBREAVISO ATIVO HOJE** no Dashboard (`/home`).

## [1.15.1] - 2026-08-02

### Fixed
- **Tratamento Automático do 9º Dígito do WhatsApp (Brasil DDDs >= 31)**:
  - Formatação inteligente em `communication.ts` (`getWhatsAppPhoneVariants`): converte automaticamente números de 13 dígitos com DDD >= 31 (`55` + `DDD` + `9` + `8 dígitos`) para o padrão oficial do WhatsApp de 12 dígitos (`55` + `DDD` + `8 dígitos`), com suporte a retry secundário automático.
- **Melhoria no Modal de Acionamento de Sobreaviso (`ScaleGrid.tsx`)**:
  - Disponibilizado o botão **"💬 Abrir no WhatsApp Web / App (Manual)"** sempre visível e funcional para contingência imediata caso a notificação via API precise ser re-enviada.

## [1.15.0] - 2026-08-02

### Added
- **Governança Globais Organizada em Abas (`/configuracoes`)**:
  - Divisão limpa em 4 abas visuais e responsivas: **💬 Comunicação & Notificações**, **⚙️ Regras de Escala & Ponto**, **⚡ Sobreaviso & Presença** e **🏛️ Institucional & Competências**.
- **Comunicação Customizada por Unidade de Saúde (`/unidades/[id]`)**:
  - Componente dedicado `UnidadeCommunicationSettings.tsx` para escolher entre usar as configurações gerais do sistema ou personalizar os canais de WhatsApp (AstraCalls, Chatwoot, API Custom) e E-mail SMTP de cada unidade.
  - Resolução dinâmica no motor `communication.ts` por `unidadeId` com herança automática do canal global.

## [1.14.0] - 2026-08-02

### Added
- **Integração Flexível de WhatsApp (Multi-Provedor)**:
  - Serviço unificado em `src/app/actions/communication.ts` com suporte nativo aos provedores **AstraCalls API** (`POST /api/sessions/{sid}/messages/text` com `X-API-Key`), **Chatwoot API** e **API HTTP Genérica Customizável** (suporte a Evolution API, Z-API, etc. com headers e template JSON configuráveis).
  - Suporte a envio de mensagens via modo manual tradicional (WhatsApp Web / App).
- **Mecanismo de Fallback Inteligente (Contingência Garantida)**:
  - Detecção automática de falhas ou desconexões na API do WhatsApp com transição suave e geração proeminente do botão **"Enviar via WhatsApp Web (Manual)"**.
- **Governança de Comunicação em Configurações (`/configuracoes`)**:
  - Painéis visuais para gestão de credenciais e parâmetros de WhatsApp e E-mail SMTP na tabela `configuracoes_globais`.
  - Modais interativos de teste em tempo real (**"Testar Conexão WhatsApp"** e **"Testar Envio de E-mail"**) com relatório do status HTTP retornado.
- **Atualização dos Fluxos de Disparo**:
  - Integração do envio automático no modal de **Acionar Sobreaviso** (`ScaleGrid.tsx`) e no compartilhamento de **PIN do Servidor** (`EditServidorForm.tsx` & `novo/page.tsx`).

## [1.13.0] - 2026-07-24

### Added
- **Ficha Cadastral do Servidor em PDF/Impressão (`FichaServidorPrintView.tsx`)**:
  - Emissão de Ficha Cadastral oficial timbrada em 4 blocos com Dados Pessoais, Funcionais, Endereço e Dados Bancários.
  - Carregamento automático da logo oficial da Prefeitura Municipal de Marabá / SMS (`configuracoes_globais`).
  - Áreas para foto 3x4 e campos para assinatura física/digital do servidor e da chefia/RH.
  - Botão verde `📄 Imprimir Ficha Cadastral (PDF)` integrado no cabeçalho da tela de cadastro de servidores.
- **Captura de Foto via Webcam & Preview High-Res**:
  - Modal interativo (`WebcamPhotoCaptureModal.tsx`) para captura de foto do servidor via webcam com streaming HTML5 em tempo real, enquadramento 1:1, captura instantânea, preview e opção de refazer foto sem tela preta.
  - Lightbox modal (`PhotoPreviewModal.tsx`) para pré-visualização da foto do servidor em alta resolução ao clicar no avatar.
- **Dados Bancários Completos & Migração SQL**:
  - Seção **5. Dados Bancários (para Folha de Pagamento)** na aba *Dados Complementares* com Banco, Agência, Conta Corrente, Tipo de Conta e Chave PIX.
  - Arquivo de migração SQL `supabase/migrations/20260724020000_add_dados_bancarios_to_servidores.sql`.
  - Tratamento de resiliência e fallback no salvamento (`actions.ts`) para lidar com atualizações de schema do Supabase.
- **Importação de Servidores via CSV Ampliada (`/servidores/importar`)**:
  - Parser flexível com suporte automático a delimitadores vírgula (`,`) e ponto e vírgula (`;`), aspas e caracteres especiais.
  - Mapeamento dinâmico de cabeçalhos insensitive a maiúsculas/acentos para inclusão de todos os dados cadastrais básicos e complementares.
  - Botão **"Baixar Modelo CSV Exemplo"** com download instantâneo do modelo `.csv` pré-formatado.
- **Módulo Férias e Licenças — Validações e Alertas (`/ferias-licencas`)**:
  - Bloqueio de duplicidade em solicitações para o mesmo exercício se houver solicitação ativa/deferida.
  - Exibição de solicitações indeferidas com destaque em vermelho para o **❌ Parecer do Indeferimento** e data de avaliação.
  - Correção exata dos contadores do **Resumo do Período** na aba Alertas para Pendentes, Deferidas, Indeferidas e Contrapropostas (incluindo contrapropostas aceitas/deferidas).

## [1.12.0] - 2026-07-23

### Added
- **Módulo de Solicitações de Férias e Licenças (`/ferias-licencas`)**:
  - Nova tabela no banco de dados `public.solicitacoes_ferias_licencas` com migration Supabase (`20260724000000_add_solicitacoes_ferias_licencas.sql`) e políticas de segurança RLS para controle de acesso por unidade e servidor.
  - Server actions para submissão, listagem, aprovação e indeferimento de requerimentos de férias, licenças médicas, licenças prêmio e outros afastamentos.
  - Interface interativa de acompanhamento com busca, estatísticas e gerenciamento de solicitações por status (*Pendente*, *Aprovada*, *Indeferida*, *Cancelada*).
  - **Componente de Impressão Timbrada (`RequerimentoPrintView.tsx`)**: Gerador de formulários oficiais com marca d'água municipal, timbre da Prefeitura de Marabá / SMS, cálculo exato de dias corridos, campos de assinatura física/digital e espaços para despachos administrativos da chefia e do RH.
- **Dados Complementares dos Servidores (`/servidores`, `DadosComplementaresModal.tsx`)**:
  - Tabela `public.servidores_dados_complementares` com suporte a migração de esquema.
  - Formulário modal com suporte a dados bancários (Banco, Agência, Conta, Tipo de Conta, Chave PIX), contatos de emergência (Nome, Parentesco, Telefone), endereço residencial completo, PIS/PASEP, Título de Eleitor (Zona/Seção) e Registro no Conselho de Classe.
- **Portal do Servidor e Consulta de Escalas Client-Side (`ConsultarEscalaClient.tsx`)**:
  - Reformulação da experiência de consulta de escala pelo servidor (`/consultar-escala`) com suporte a busca por CPF/Matrícula e validação via PIN de 4 dígitos.
  - Solicitação autenticada de permutas/trocas de plantão com seleção de substituto e justificativa direta no portal.
  - Exibição integrada de espelho de ponto e frequência mensal para conferência rápida do servidor.
- **Serviços de Processamento de Folha de Ponto**:
  - Server actions para fechamento, conferência e exportação de folhas de ponto (`/folha-ponto`) com integração ao componente `UnitClient`.

## [1.11.0] - 2026-07-22

### Added
- **Painel de Controle — Gráfico de Comparativo Histórico de Horas (`HistoricoChart`)**:
  - **Acompanhamento em Tempo Real do Mês Vigente**: Ajustada a consulta histórica em `src/app/(dashboard)/home/page.tsx` para não filtrar por status `Fechada` no mês atual, permitindo que a evolução das horas planejadas/executadas seja acompanhada dinamicamente ao longo do mês.
  - **Escala Vertical (Eixo Y) e Linhas de Grade**: Adicionado o eixo Y no lado esquerdo do gráfico com valores dinâmicos de horas (`0h`, `2k h`, `4k h`, etc.) e linhas horizontais de grade (*gridlines*) de fundo para facilitar a leitura.
  - **Seleção Interativa de Mês**: Adicionadas pílulas seletoras de mês (`MAI`, `JUN`, `JUL`) e suporte a clique diretamente nas colunas do gráfico, atualizando instantaneamente o detalhamento dos cartões inferiores (*Regular*, *Plantão*, *Sobreaviso*, *Extra*).
- **Recuperação de Senha Segura (Esqueceu a Senha)**:
  - Implementado o fluxo completo PKCE no Next.js App Router para recuperação de senha com Supabase Auth.
  - Criado o manipulador de callback `/auth/callback` (`src/app/auth/callback/route.ts`) para troca segura de token por sessão e redirecionamento para a redefinição de senha (`/resetar-senha`).
  - Liberadas as rotas de autenticação e recuperação no middleware (`src/utils/supabase/middleware.ts`).

### Fixed
- **Correção da Altura das Barras Verticais no Gráfico Histórico**:
  - Corrigido o bug visual no CSS Flexbox do componente `HistoricoChart.tsx` (ausência de `h-full` no contêiner da coluna de barras), garantindo que as barras sejam desenhadas proporcionalmente à altura total do gráfico (160px) em vez de ficarem colapsadas em 2px.
- **Integração SMTP Institucional (Google Workspace / Gmail + Supabase Self-Hosted)**:
  - Configuração do serviço SMTP (`smtp.gmail.com:587`) no Coolify usando conta institucional (`informatica.sms@maraba.pa.gov.br`) e Senha de App corporativa.
  - Mapeamento correto de variáveis de ambiente (`SMTP_*` e `GOTRUE_SMTP_*`) e alinhamento do `API_EXTERNAL_URL`.
- **Template de E-mail Personalizado em Português**:
  - Nova rota pública de API `/api/templates/recovery` (`src/app/api/templates/recovery/route.ts`) e template estático em `public/templates/recovery.html` com o visual oficial da Prefeitura Municipal de Marabá e Secretaria Municipal de Saúde.
  - Layout responsivo com botão de ação em destaque (`Redefinir Minha Senha`) e código de verificação de 6 dígitos em tamanho estendido (34px, negrito).
- **Internacionalização e Tradução de Erros**:
  - Módulo utilitário `src/utils/auth-errors.ts` com a função `translateAuthError` para converter mensagens de erro nativas em inglês do Supabase Auth para português amigável na interface.

## [1.10.1] - 2026-06-29

### Added
- **Filtro de Período na Gestão de Afastamentos**:
  - Implementado filtro por Mês/Ano na listagem de afastamentos, com mês e ano correntes pré-selecionados por padrão.
  - Lógica matemática de cruzamento de intervalos de datas para detectar de forma segura quais afastamentos (férias, licenças, etc.) sobrepõem o período selecionado.

## [1.10.0] - 2026-06-29

### Added
- **Automação de Competências e Fechamento**:
  - Nova rotina `autoGenerateMissingTimesheets` que gera automaticamente folhas de ponto como rascunho na virada do mês.
  - Fechamento automatizado de escalas expiradas com geração ou promoção de folhas de ponto para o status definitivo (`Revisada`).
- **Endpoint Cron Autenticado**:
  - Nova rota de API `/api/cron` protegida por chave secreta (token via Bearer ou query parameter) para orquestrar rotinas do sistema.
- **Filtros e Visualização de Escalas**:
  - Adicionado o seletor padrão iniciando no mês/ano correntes na listagem de escalas.
  - Nova classificação de status visual (Previsão / Fechada) com dropdown correspondente na barra de filtros.
- **Melhorias na Folha de Ponto**:
  - Carregamento irrestrito sem necessidade de pré-filtragem por Unidade/Setor na tela de Folha de Ponto.
  - Geração em lote global irrestrita para coordenadores/administradores de uma única vez.
  - Novos filtros de status de Escala Mensal e Status Folha.
  - Lista de servidores filtrada estritamente por escalas ativas na competência.
- **Paginação de Alta Performance**:
  - Paginação padrão (10 itens por página) implementada nas telas de Escalas de Serviço e Folha de Ponto, com controles responsivos e redefinição de página ao filtrar.

## [1.9.0] - 2026-06-28

### Added
- **Gestão de Afastamentos & Eventos**:
  - Nova interface de administração para cadastro e controle de Férias, Atestados Médicos, Licenças (Maternidade/Paternidade/Prêmio) e outros afastamentos.
  - Sincronização inteligente com a escala diária: remoção automática de escalas futuras e concorrentes sem presença confirmada e bloqueio estrito contra novos agendamentos no período de afastamento do servidor.
- **Dashboard de Relatórios Diagnósticos**:
  - Novo painel interativo exibindo métricas operacionais chaves e gráficos de performance de escala por período.
  - Análise quantitativa de plantões extras gerados e monitoramento detalhado de tempos de resposta e SLAs de aceitação de chamados de sobreaviso.
- **Filtros de Relatórios Modulares**:
  - Sistema de busca e filtragem por Data Início/Fim, Servidor, Cargo, Unidade e Setor com herança hierárquica e preenchimento dinâmico.
- **Impressão Dinâmica de Escala (ScalePrintView)**:
  - Exportação e formatação especializada de visualização de grade mensal (imprimir/PDF) integrada ao portal do servidor e coordenação.
- **Estudo e Plano de Diárias e Pernoites**:
  - Documentação completa do modelo de negócios e banco de dados para controle de deslocamentos e indenizações de motoristas, técnicos de TI e profissionais em ações de campo em zonas rurais/vilas/assentamentos.

## [1.8.2] - 2026-06-25

### Added
- **Herança de Jornada de Trabalho no Gerador Inteligente**:
  - O gerador inteligente agora busca a jornada de trabalho (`jornada_id` / coluna "Tipo") cadastrada na escala do mês anterior e a preenche automaticamente para cada servidor que não possuir uma jornada selecionada na grade atual.
  - Elimina o trabalho manual de selecionar a jornada de trabalho servidor por servidor após gerar a escala sugerida.

## [1.8.1] - 2026-06-25

### Fixed
- **Tratamento de Erros e Depuração no Gerador Inteligente**:
  - Adicionado tratamento de erros e exibição de exceções nas consultas de histórico de escalas e diárias do mês anterior em `src/utils/intelligentScaleGenerator.ts`.
  - Evita falhas silenciosas que exibem a mensagem genérica "Nenhum Histórico Encontrado" caso ocorram restrições de permissão RLS ou de conexão com o banco de dados.
  - Inseridos logs de depuração detalhados no console de desenvolvedor para ajudar a auditar as UUIDs de servidores, setores e contagem de registros processados em tempo real no frontend.

## [1.8.0] - 2026-06-25

### Added
- **Auto-Escala Inteligente (Fase 1)**:
  - Adicionado o botão **"Gerador Inteligente"** com ícone `Sparkles` animado e destacado na grade de escalas (`ScaleGrid.tsx`).
  - Novo módulo utilitário `src/utils/intelligentScaleGenerator.ts` para cálculo automático de escala baseado em:
    - Continuidade histórica de folgas (especialmente para a escala alternada 12x36) a partir do último dia trabalhado no mês anterior.
    - Evasão e limpeza automática de turnos nos dias com férias ou licenças agendadas em `servidores_eventos`.
    - Respeito às preferências de turno cadastradas ou detectadas do servidor.
  - Modal de configurações no grid permitindo ao coordenador selecionar quais regras aplicar (continuidade, afastamentos, preferências) e testar a escala localmente em modo rascunho (Draft) antes de salvar.
  - Novos campos `preferenca_turno` e `carga_horaria_semanal` na tabela `public.servidores` para guardar preferências e limites semanais dos servidores.
  - Novos inputs correspondentes nos formulários de criação (`novo/page.tsx`) e edição (`EditServidorForm.tsx`) de servidores.
- **Filtro de Turnos no Modal de Template**:
  - Ajustado o dropdown de seleção de turnos do modal de aplicação de template de escala para exibir apenas turnos normais/regulares (tipo `'Normal'`), ocultando extras, sobreavisos ou virtuais.

## [1.7.0] - 2026-06-23

### Added
- **Geolocalização por Setores com Fallback**:
  - Adicionado suporte para cadastro de geolocalização (`latitude`, `longitude` e `raio_geofence`) na tabela de `setores`.
  - Implementado fallback automático para as coordenadas da unidade se os dados de geolocalização do setor não forem preenchidos.
  - Atualização nas Server Actions de criação/edição e nas funções de banco de dados (`register_sobreaviso_arrival` e `get_sobreaviso_details`) para herança automática.
- **Formatação Hierárquica de Setores nos Dropdowns**:
  - Nova utilidade `src/utils/sectors.ts` para organizar e identar subsectores nos seletores da aplicação (ex: `↳ ENFERMAGEM` sob `ALA - PSICOSSOCIAL`).
  - Atualização dos dropdowns em Folha de Ponto, Afastamentos, Nova Escala, Novo Servidor, Editar Servidor e Filtros de Relatórios.
- **Migração de Dados (ALA - PSICOSSOCIAL)**:
  - Criada migração `20260624010000_migrate_ala_to_hmm_sector.sql` para converter com segurança a unidade ALA - PSICOSSOCIAL em setor sob a unidade HMM, vinculando suas escalas, servidores e logs históricos.

## [1.6.1] - 2026-06-12

### Added
- **Limpeza Inteligente de Escalas e Conflitos na Transferência**:
  - Implementada limpeza automática de turnos diários concorrentes (`escala_diaria`) sem presença confirmada durante a transferência de lotação de um servidor.
  - No setor de origem (para o mês da transferência), limpa todas as escalas diárias planejadas a partir da data de transferência (inclusive).
  - No setor de destino (para o mês da transferência), limpa quaisquer escalas diárias planejadas antes da data de transferência.
  - Para meses subsequentes à transferência, remove completamente as escalas mensais e escalas diárias residuais do setor de origem.
  - Para meses precedentes à transferência, remove quaisquer escalas mensais e escalas diárias residuais do setor de destino.
  - Preserva integralmente registros de presença confirmada ou batidas de ponto em ambos os setores, evitando qualquer perda de dados históricos.

## [1.6.0] - 2026-06-11

### Added
- **Histórico de Lotações e Rastreamento de Transferências**:
  - Nova tabela `historico_transferencias` para auditoria e linha do tempo de transferências de servidores entre setores e unidades.
  - Campos dinâmicos de Data de Transferência e Motivo/Justificativa no formulário de edição de servidor (`EditServidorForm.tsx`) revelados apenas sob mudança de lotação.
  - Aba de **Histórico & Relatórios** na visualização detalhada do servidor com linha do tempo de lotações, cálculo automático de tempo trabalhado em cada local e links rápidos para puxar todas as escalas e folhas de ponto de períodos passados.
- **Suporte a Transferências no Meio do Mês**:
  - Ajuste de restrição de unicidade na tabela `folha_ponto` no banco de dados para associar por `escala_mensal_id` em vez de `(servidor_id, mes, ano)`, permitindo múltiplas escalas e folhas parciais no mesmo mês para servidores transferidos.

### Fixed
- **Bug de Lotação Retroativa na Folha de Ponto**:
  - Correção na action `gerarFolhaPonto` para ler a lotação de forma segura a partir dos dados gravados na **escala** e não na lotação atual do cadastro do servidor, corrigindo o erro ao visualizar folhas passadas após transferência.

## [1.5.1] - 2026-06-11

### Changed
- **Melhorias na Geração e Regeneração de Folha de Ponto**:
  - A geração e sincronização da folha de ponto mensal agora são limitadas até o dia e turno atuais do momento de sua geração. Marcações e dias futuros permanecem limpos e sem registros fictícios.
  - A geração e regeneração da folha de ponto agora preservam todos os dias que possuem marcações ou observações inseridas manualmente (`origem = 'manual'`, `'FALTA'` ou `'MANUAL'`), evitando que o usuário perca ajustes anteriores ao regenerar.

## [1.5.0] - 2026-06-11

### Added
- **Condição Especial (Horário Livre) para Servidores**:
  - Nova flag `ignora_janela_presenca` adicionada aos servidores para permitir registro de entrada e saída em qualquer horário (livre), ignorando limites e restrições de janela de presença padrão, desde que haja escala prevista para o dia.
  - Exibição de campo checkbox destacado em amarelo ("Configurações Especiais") no formulário de edição do servidor apenas para usuários do tipo `super_admin`.
  - Tratamento da nova flag nas Server Actions (`createServidor` e `updateServidor`) e na função Postgres principal (`fn_confirmar_presenca`).

## [1.4.9] - 2026-06-11

### Changed
- **Divisão de Batidas de Ponto em Blocos Contíguos**:
  - Refatorada a confirmação de presença em terminal (`fn_confirmar_presenca` e a nova helper `fn_salvar_saida_bloco`) para tratar de forma inteligente escalas contíguas/sobrepostas (ex: Regular das 08h às 14h + Plantão T4 das 14h às 18h).
  - Quando o servidor realiza o checkout final, o sistema distribui automaticamente os horários: a primeira escala recebe a saída no limite de sua janela (ex: 14h), a escala contígua seguinte recebe a entrada nesse mesmo horário de transição (ex: 14h), e a última escala recebe a saída final real (ex: 18h). Isso impede sobreposição de carga horária e duplicidade na folha de ponto.

## [1.4.8] - 2026-06-11

### Added
- **Painel de Log de Tentativas Negadas de Presença**:
  - Nova aba "Tentativas Negadas" adicionada no módulo de Auditoria (`/auditoria`), visível exclusivamente para o Administrador Geral (`super_admin`).
  - Registro centralizado de tentativas malsucedidas de confirmação de presença via terminal (por PIN/matrícula inválidos, servidor fora de lotação/escala ou fora da janela permitida).
  - Exibição de informações diagnósticas ricas, incluindo o horário previsto, código do turno, categoria, unidade, setor, matrícula digitada e dump JSON completo do cruzamento de escala mais próxima.
  - Integração total com filtros de busca textual, período e lotação no painel de auditoria.
  - Exportação de relatório PDF/impressão consolidada atualizada para cobrir as ocorrências de tentativas negadas.

## [1.4.7] - 2026-06-11

### Changed
- **Padrão de Tema Claro**:
  - Ajustado o `ThemeProvider` no layout principal (`layout.tsx`) para iniciar por padrão no tema claro (`light`) e desabilitar o fallback automático baseado na preferência do sistema operacional (`enableSystem={false}`). Os usuários continuam podendo alternar o tema normalmente.

## [1.4.6] - 2026-06-11

### Added
- **Navegação de Retorno do Terminal de Presença**:
  - Adicionado botão "Voltar ao Painel" no cabeçalho do Terminal de Presença (`/presenca`) quando acessado por um supervisor autenticado.
  - Permite aos administradores/coordenadores retornarem diretamente ao painel principal (`/home`) sem necessidade de efetuar logout.

## [1.4.5] - 2026-06-11

### Added
- **Atalho de Confirmação de Presença na Sidebar**:
  - Adicionado botão premium "Confirmar Presença" na parte inferior da barra lateral (sidebar) para usuários logados (coordenadores e administradores).
  - Permite acessar diretamente a tela de presença (`/presenca`) sem a necessidade de efetuar logout e login novamente.
  - Implementado suporte dinâmico para os estados expandido e colapsado da sidebar.

## [1.4.4] - 2026-06-11

### Changed
- **Filtro de Servidores por CPF**:
  - Adicionado o campo `CPF` ao filtro de pesquisa textual geral na tela de listagem de Servidores.
  - Atualizado o placeholder do campo de busca para "Buscar por nome, matrícula, CPF...".

## [1.4.3] - 2026-06-11

### Added
- **Busca Avançada na Vinculação de Servidores**:
  - Implementado componente de dropdown autocompletar pesquisável (por nome, matrícula ou CPF) ao vincular novo usuário a um servidor existente, melhorando a experiência com grandes volumes de dados.
  - Adicionado campo `CPF` no cadastro de servidores (banco de dados e formulários de cadastro e edição de servidor).

## [1.4.2] - 2026-06-11

### Added
- **Vinculação de Servidores Existentes**:
  - Adicionado campo de seleção no formulário de "Novo Usuário" para importar nome e e-mail diretamente a partir de um servidor ativo cadastrado no banco de dados.

### Fixed
- **Validação de E-mail Duplicado em Tempo Real**:
  - Implementada verificação no frontend que bloqueia a submissão e exibe um alerta claro ao tentar cadastrar um usuário com e-mail já existente na base de dados de autenticação.

## [1.4.1] - 2026-06-11

### Added
- **Cadastros de Cargos Homônimos**:
  - Nova migration de banco de dados (`20260611154000_allow_duplicate_cargo_names_under_different_parents.sql`) alterando a restrição de unicidade para permitir cargos de mesmo nome sob pais diferentes (ex: `DIRETORIA / DMAC` e `COORDENAÇÃO / DMAC`).

### Changed
- **Edição Restrita de Marcações Reais**:
  - Usuários que não sejam o Administrador Geral (`super_admin`) agora possuem bloqueio de edição (tanto no frontend quanto no backend) para marcações de ponto do tipo **Real (Verde)**, impedindo alterações não autorizadas.

## [1.4.0] - 2026-06-11

### Added
- **Encerramento de Competência (Congelamento de Histórico)**:
  - Permite ao Administrador Geral (`super_admin`) trancar competências (mês/ano) nas configurações globais.
  - Congela permanentemente todas as escalas e folhas de ponto do período trancado, bloqueando edições para todos os perfis (inclusive administradores).
  - Adicionado painel visual nas configurações do sistema e banner vermelho premium de aviso nos editores.
  - Implementada Server Action `toggleCompetencyClosure` e a verificação defensiva de banco de dados `isCompetencyClosed`.
- **Fechamento Automático de Períodos (Prazo Expirado)**:
  - Rotina em lote (`autoCloseExpiredScalesAndTimesheets`) que inativa escalas e folhas expiradas com base em dias de inatividade configuráveis.
  - Implementada tolerância para reabertura manual por administradores: se a escala ou folha for reaberta ou editada após o prazo, ela não é re-fechada pelo sistema.
- **Turnos Multi-Tipo**:
  - Possibilidade de configurar um mesmo turno em múltiplas categorias (ex: "Normal, Plantão") simultaneamente.
  - Migração de banco de dados (`20260611010000_alter_dicionario_turnos_tipo_to_text.sql`) convertendo a coluna `tipo` de enum para `text`.

### Changed
- **Formulários de Turno**:
  - Substituição do campo `<select>` por checkboxes de múltipla seleção no cadastro e edição de turnos.
  - Badges coloridas individuais para cada tipo na listagem de turnos.
- **Dropdown e Filtros da Grade de Escalas**:
  - Datalists de turnos filtrados dinamicamente com base na categoria da linha no grid de escalas, impedindo misturar tipos diferentes de escala.
  - Validação rigorosa na entrada para assegurar conformidade do tipo digitado.

### Fixed
- **Bloqueio de Edição no Portal do Servidor**:
  - Removido o bloqueio visual do frontend que desabilitava totalmente a folha de ponto no Portal mesmo que o coordenador reabrisse o período.
  - Inclusão da validação server-side de consistência (`isCompetencyClosed`) no portal nas Server Actions `salvarFolhaPontoServidor`, `sincronizarFolhaPontoServidor` e `gerarFolhaPontoServidor`.

## [1.3.3] - 2026-06-06

### Fixed
- **Validação de Presença para Servidores Externos no Terminal**:
  - Corrigido o bug que impedia servidores lotados em outras unidades (ex: SMS/DMAC) de confirmarem sua presença (entrada/saída) em terminais de unidades onde estão escalados para plantão (ex: LACEM/administração).
  - A função de banco de dados `public.fn_confirmar_presenca` agora realiza uma verificação alternativa: se o coordenador não gerencia a lotação de origem do servidor, o sistema verifica se ele gerencia a unidade e o setor de alguma escala ativa (hoje ou ontem) daquele servidor, permitindo o registro de presença caso haja compatibilidade com o plantão.

## [1.3.2] - 2026-06-04

### Added
- **Logo de Cabeçalho da Instituição nas Configurações Globais**:
  - Implementado campo para upload e remoção da logo da instituição na tela de Configurações (/configuracoes), seguindo as políticas de armazenamento e validação de imagens.
  - Criada migração de banco de dados para a coluna `instituicao_cabecalho_url` na tabela `configuracoes_globais` e ajustada a política de RLS para permitir acesso de leitura pública (página de login anônima).
- **Logos nos Cards de Unidades**:
  - Exibição da logo de cada unidade diretamente na página de listagem (/unidades), substituindo o ícone padrão caso a unidade já possua uma logo configurada.
- **Logo da Instituição na Login Page e Sidebar**:
  - Integração da logo da instituição na tela de login, em tamanho ampliado correspondente ao espaço do logotipo verde padrão.
  - Exibição da logo da instituição no topo da barra de navegação lateral (Sidebar) com o título "SISESCALA" posicionado centralizado abaixo da imagem.
- **Logos nas Impressões de Escala e Folha de Ponto**:
  - Redesenho do cabeçalho de impressão da Escala Mensal (`ScalePrintView`) e da Folha de Ponto (`FolhaPontoEditor`) para exibir a logo da instituição e a logo da unidade de forma elegante.
  - Caso ambas as logos estejam cadastradas, elas são apresentadas lado a lado, separadas por um divisor vertical fino.
- **Logo da Instituição em Relatórios**:
  - Integração da logo da instituição no cabeçalho das visualizações e impressões de relatórios gerais (`ReportActions` e `report-templates.ts`).

## [1.3.1] - 2026-06-04

### Fixed
- **Respeito Estrito à Janela de Variação de Horários Fictícios**:
  - Corrigido o bug em que o horário fictício de retorno do intervalo (almoço) acumulava a variação da saída do intervalo com a variação do próprio retorno. Isso fazia com que a variação total em relação ao horário oficial alvo chegasse a quase 30 minutos (violando o limite de variação configurado de 15 minutos).
  - O motor foi ajustado em todas as Server Actions administrativas e do portal para basear a geração do retorno diretamente do horário oficial alvo (`officialRetornoIntervaloMin`), mantendo todas as marcações individuais rigorosamente dentro do limite da janela definida.

## [1.3.0] - 2026-06-04

### Changed
- **Desconsiderar Validação Manual do Coordenador na Folha de Ponto**:
  - Quando a entrada ou saída regular é validada manualmente pelo coordenador/administrador (registrado em `logs_sobreaviso` com `validacao_manual = true`), o sistema agora desconsidera esse registro manual e trata a marcação como fictícia/ausente na folha de ponto (variação determinística).
  - A lógica foi aplicada globalmente no motor de geração e sincronização tanto nas Server Actions administrativas (`src/app/(dashboard)/folha-ponto/actions.ts`) quanto nas do Portal do Servidor (`src/app/consultar-escala/actions.ts`), garantindo consistência total do espelho de ponto em ambas as visualizações.

## [1.2.9] - 2026-06-04

### Fixed
- **Exibição da Aba Folha de Ponto no Portal do Servidor**:
  - Corrigido o bug onde a aba "Folha de Ponto" não era exibida no Portal do Servidor. O problema ocorria porque a verificação se o módulo estava ativo consultava a tabela `configuracoes_globais` diretamente no cliente Supabase (em modo anônimo), o que falhava devido às políticas de RLS que restringem consultas de configurações a usuários autenticados.
  - Implementada a Server Action `checkFolhaPontoHabilitada` que consulta a configuração no backend de forma segura usando o `createAdminClient` e retorna o status para o portal.

## [1.2.8] - 2026-06-04

### Fixed
- **Inconsistência de Fuso Horário na Folha de Ponto**:
  - Corrigido o bug em que horários de entrada/saída reais baseados no terminal eram extraídos incorretamente com diferença de fuso horário (ex. mostrando 10:59 em vez de 07:59) devido ao fato do servidor NodeJS rodar em UTC. Agora, os horários reais de presença são formatados explicitamente usando a timezone local de Brasília (`America/Sao_Paulo`).
  - Ajustado o motor de cálculo de horas extras no backend e no frontend (`FolhaPontoEditor.tsx`) para utilizar horários locais (compensação UTC-3) para as datas de início/fim da jornada e loops de contagem de minutos de horas extras. Isso garante que a identificação de domingos, feriados e horas extras noturnas (entre 22h e 5h) ocorra com base no horário oficial brasileiro.

## [1.2.7] - 2026-06-04

### Added
- **Edição da Folha de Ponto pelo Servidor**:
  - Implementação de novas Server Actions seguras (`salvarFolhaPontoServidor`, `verificarDivergenciaEscalaServidor`, `sincronizarFolhaPontoServidor` e `gerarFolhaPontoServidor`) que validam a posse da folha de ponto usando o cookie HttpOnly seguro `portal_servidor_id`.
  - Reutilização do componente `FolhaPontoEditor` no Portal do Servidor em modo editável, desabilitando apenas os botões de revisão/fechamento de controle de status que são restritos a Coordenadores/Admins.
  - Implementação do botão para o próprio servidor gerar sua folha de ponto (Rascunho ou Definitiva) diretamente do Portal.
  - Ajustes de responsividade e otimização das classes CSS Print no Portal do Servidor para imprimir a folha de ponto em formato oficial limpo, ocultando cabeçalhos e navegação do portal.

## [1.2.6] - 2026-06-04

### Added
- **Módulo de Folha de Ponto (Timesheet)**:
  - Criação da tabela `folha_ponto` no banco de dados e ativação de políticas de segurança RLS para Coordenadores, Admins e Super Admins.
  - Implementação de opções dinâmicas de ativação e tolerância na página de configurações globais de Governança.
  - Adicionado item "Folha de Ponto" condicional ao menu lateral.
  - Painel administrativo para visualização e filtros de servidores por setor e mês, permitindo a geração em lote/individual.
  - Motor de geração de horários com base nos turnos regulares da escala, utilizando geração de horários fictícios com variação aleatória determinística (seed-based, entre -14 e +14 minutos, nunca terminando em :00), e respeitando folgas, feriados e afastamentos cadastrados.
  - Sincronização automática com preservação de edições manuais em caso de alteração da escala original usando fingerprints.
  - Editor interativo e estético de folha de ponto com cores por origem do registro (verde = real/presença confirmada, azul = fictício, amarelo = editado manualmente).
  - Cálculo de horas extras integrado com distinção de percentuais diurnos/noturnos/feriados/domingos (50% e 100%).
  - Disponibilização da visualização de folha de ponto em modo somente leitura no Portal do Servidor.
  - Estilização de impressão profissional CSS Print otimizada para folhas de ponto no formato A4 oficial.

## [1.2.5] - 2026-06-04

### Added
- **Upload de Logotipo para Unidades e Setores**:
  - Nova coluna `logo_url` adicionada nas tabelas `unidades` e `setores`.
  - Configuração do bucket público de armazenamento de logos (`logos`) no Supabase Storage com políticas de RLS adequadas.
  - Implementação de lógica de upload otimizada no backend (Server Actions de Unidades e Setores) com salvamento sob caminhos determinísticos (`unidade_ID.ext` e `setor_ID.ext`).
  - Atualização dos formulários de cadastro e edição no frontend, incluindo um campo para upload e um contêiner de pré-visualização quadriculada (checkerboard grid) para preservar a visualização de transparências (PNG/SVG).
- **Matrícula Temporária Automática**:
  - Suporte ao cadastro de novos servidores sem matrícula definitiva (deixando o campo em branco). O backend gera automaticamente um código temporário sequencial e único no formato `TYYNNNNN` (ex: `T2600001`).
  - Adicionado banner de alerta e destaque em tom âmbar/amarelo na tela de edição do servidor temporário para alertar sobre a regularização pendente.
  - Adicionada etiqueta visual (badge) de matrícula `Temporária` na listagem de servidores.
- **Filtros e Paginação no Dicionário de Turnos**:
  - Implementado filtro por tipo/categoria de turno na listagem de turnos.
  - Adicionado controle de paginação (limite de itens por página e navegação) no padrão estético do sistema.
- **Consolidação de Botões na Grade de Escala**:
  - Unificação dos controles horizontais na barra de ferramentas do grid de escala: os botões de adicionar todos os servidores e abrir modal de servidor externo foram agrupados dentro do menu suspenso principal `+ Adicionar Servidor...`.

## [1.2.4] - 2026-06-03

### Added
- **Seleção de Servidor Externo para Coordenadores/Admins**: 
  - Criação da função de banco de dados `get_external_servers_for_scale` (RPC com `SECURITY DEFINER`) para buscar servidores ativos de setores externos bypassing RLS de forma segura.
  - Atualização da política de RLS `Users can view relevant servers` na tabela `public.servidores` para permitir leitura de dados dos servidores quando estiverem escalados em escalas vinculadas às permissões do usuário logado.
- **Restrição Dinâmica de Acionamento de Sobreaviso**:
  - Implementada restrição horária de acionamento em tempo real no arquivo `ScaleGrid.tsx` baseando-se no prefixo do código do turno (ex: noturnos `N...` ativos das 19h às 07h; vespertinos `T...` das 13h às 19h; matutinos `M...` das 07h às 13h; diurnos `D...`/`MT` das 07h às 19h; 24h `MTN` das 07h às 07h). Isso impede acionamento de profissionais fora do período de sua escala.

### Fixed
- **Inconsistência na Seleção e Cálculo de Turnos de Sobreaviso**:
  - Corrigida filtragem do datalist `turnos-sobreaviso-list` para listar dinamicamente apenas turnos do tipo `Sobreaviso` (mostrando assim `D12` e `N12` no dropdown, em vez de plantões comuns que causavam erro de validação).
  - Atualizada validação de digitação de caracteres nas células para suportar prefixos de turnos de sobreaviso.
  - Correção na soma de horas de sobreaviso planejadas e validadas (no grid e nos relatórios consolidado e de RH) para ler dinamicamente o campo `horas_computadas` de cada turno, evitando que novos turnos como `D12` e `N12` somassem 0 horas.

## [1.2.3] - 2026-06-02

### Added
- **Suporte a Blocos de Trabalho Contíguos no Terminal de Presença**:
  - A função de banco de dados `fn_confirmar_presenca` foi refatorada para identificar e mesclar automaticamente turnos contíguos ou sobrepostos de um mesmo servidor em um único "Bloco Lógico de Trabalho".
  - **Cenário resolvido**: Servidor com horário regular `T` (13h–19h) que possui um plantão extra `M` (07h–13h) agora consegue registrar a entrada às 07h e a saída às 19h em uma única passagem pelo terminal, marcando ambas as categorias simultaneamente.
  - A janela de tolerância de ponto (+/- 30 min padrão) é aplicada ao **início do primeiro turno** e ao **fim do último turno** do bloco mesclado.
  - A lógica de mesclagem cross-midnight (plantão de ontem que termina hoje) foi preservada e estendida para o novo algoritmo.

### Fixed
- **Sobreposição de Funções no PostgreSQL (Function Overloading)**: A adição do parâmetro opcional `p_momento_simulado` à `fn_confirmar_presenca` gerava uma sobrecarga de função no Postgres, mantendo a versão antiga de 3 parâmetros ativa. Adicionado `DROP FUNCTION IF EXISTS public.fn_confirmar_presenca(text, text, uuid)` na migration para garantir que apenas a versão atualizada (4 parâmetros, com default `NULL`) permaneça ativa.
- **Compatibilidade Total**: Chamadas existentes com 3 parâmetros continuam funcionando sem alteração via valor padrão do parâmetro `p_momento_simulado = NULL`.

## [1.2.2] - 2026-06-01

### Added
- **Validação Cruzada de Escalas e Afastamentos (Banco de Dados)**:
  - Adicionada trigger `trigger_prevent_event_during_shift` na tabela `servidores_eventos` que impede o cadastro ou alteração de férias/afastamento se o servidor possuir escala prevista ou confirmada (`escala_diaria`) no mesmo período.
  - Adicionada trigger `trigger_prevent_shift_during_event` na tabela `escala_diaria` que impede o lançamento ou alteração de escalas em datas em que o servidor possua afastamento ativo (respeitando as regras globais de governança).

### Fixed
- **Validação Preventiva de Afastamento na UI**: Refatoração das funções `handleAddAfastamento` e `handleUpdateAfastamento` na tela de Gestão de Afastamentos (`/afastamentos`). O sistema agora impede preventivamente o cadastro/alteração caso exista qualquer escala agendada para o período e exibe um alerta orientando a remoção prévia na grade.
- **Resolução de Inconsistência de Carga Horária (Caso Raimundo da Cruz Ferreira)**: Exclusão de registro de escala e logs de ponto incoerentes para o dia 01/06/2026, eliminando a sobreposição visual de "Férias" com cômputo de horas trabalhadas na escala do servidor.

## [1.2.1] - 2026-05-31

### Added
- **Restrição de Auditoria & Gestão**: Ocultação completa do grupo de menus `AUDITORIA & GESTÃO` no menu lateral para coordenadores. Proteção adicional de rotas em nível de página nas rotas `/auditoria` e `/relatorios` (e todas as suas subrotas `/rh`, `/frequencia`, `/consolidado`, `/distribuicao`), retornando a tela de `Acesso Negado` caso sejam acessadas diretamente.

### Fixed
- **Correção de Permissões de Coordenadores**: Ajuste na lógica das funções de permissão (`applyAccessFilters` e `hasSectorAccess`) para permitir que usuários com perfil `coordenador` que possuem `acesso_todos_setores = true` (como o Fernando Marculino) herdem corretamente todos os setores das suas unidades vinculadas.
- **Grade de Escala (Muitos-para-Muitos)**: Refatoração da página de detalhe/grade de escala (`/escalas/unidade/[unidadeId]`) para carregar e validar as permissões a partir das tabelas relacionais `profile_unidades` e `profile_setores`, eliminando a dependência de colunas legadas `profile.unidade_id` e `profile.setor_id` (que ficavam nulas).
- **Gestão de Afastamentos**: Restrição na listagem e na edição de afastamentos (`/afastamentos`) para garantir que coordenadores só vejam e editem ausências de servidores vinculados a unidades/setores que eles gerenciam.
- **Validação de Setores no Registro de Frequência**: Atualização do script de migração da função de banco de dados `fn_confirmar_presenca` (em `supabase/migrations/20260528210000_update_fn_confirmar_presenca.sql`). O terminal de presença agora rejeita batidas de ponto de servidores cujas unidades/setores não estejam na lista de responsabilidades do coordenador ativo.

## [1.2.0] - 2026-05-28

### Added
- **Turnos de Horas Extras Virtuais**: Cadastro de códigos de hora extra (`1`, `1.5`, `2` para diurno/50%; `1N`, `1.5N`, `2N` para noturno/100%) em `dicionario_turnos` com slots vazios (`{}`) e tipo `'Extra'`. Isso permite o lançamento de horas adicionais sem gerar falsos positivos de conflitos/sobreposições com a escala normal do servidor (como o turno `MT`).
- **Preenchimento e Sugestões Inteligentes por Linha**: Adicionada a `<datalist id="turnos-extra-list">` no componente `ScaleGrid.tsx`, filtrando e exibindo exclusivamente os códigos de horas extras na linha de `EXTRAS` para simplificar a digitação do coordenador.
- **Validação de Governança e Limite de 2h**:
  - Validação no `handleCellChange` que restringe o lançamento apenas de turnos do tipo `Extra` na linha `EXTRAS` e turnos do tipo `Sobreaviso` na linha `SOBREAVISO`.
  - Bloqueio rígido que impede o lançamento de horas extras superiores ao limite legal de 2 horas diárias por servidor.
- **Opção 'Extra' no Cadastro de Turnos**: Integrada a opção de tipo `'Extra'` nos formulários de criação e edição do painel administrativo do dicionário de turnos.

### Changed
- **Lógica Otimizada de Frequência (Check-in/Check-out)**: 
  - Ajuste na RPC `fn_confirmar_presenca` para calcular dinamicamente o expediente total do servidor somando a jornada mensal regular (ex: 9h corridas para a jornada 07h-16h) com as horas extras do dia (ex: +2h de extras), definindo o horário final exato de saída do servidor (ex: 18h).
  - A confirmação de presença (check-in/check-out) no terminal físico agora grava o registro simultaneamente nas linhas `Regular` e `Extra` de forma síncrona, validando os totalizadores em uma única operação.

## [1.1.0] - 2026-05-28

### Added
- **Portal de Impressão de Escala por React Portal**: Refatoração completa da visualização de impressão (`ScalePrintView`) utilizando React Portals (`createPortal`), renderizando o componente diretamente em `document.body` e aplicando a regra CSS `body > *:not(.print-view-portal) { display: none !important; }` no escopo `@media print`. Isso oculta 100% da árvore do Next.js (headers, menus, sidebars) e elimina espaços em branco no topo, corrigindo o erro onde a escala começava no meio da página.
- **Mapeamento de Eventos no Portal do Servidor**: Carregamento automático de afastamentos e eventos (`servidores_eventos`) do banco na Server Action de escala e exibição correspondente na grade interativa do portal do servidor (e.g. exibição de tags `LIC` para licenças, etc.).
- **Destaque Visual ao Editar Afastamentos**: Destaque com borda âmbar suave nas linhas da tabela de afastamentos ao iniciar a edição para fornecer feedback visual imediato ao usuário.

### Changed
- **Edição em Substituição à Exclusão em Afastamentos e Eventos**: Remoção definitiva da opção de exclusão (lixeira) nas telas "Tipos de Afastamento" e "Gestão de Afastamentos" para garantir segurança jurídica do histórico. Ambas as telas agora possuem fluxo de edição dinâmico no painel lateral esquerdo com botões "Salvar" e "Cancelar" e controle de status instantâneo por clique direto na tabela.
- **Aumento da Capacidade de Impressão por Página**: Ampliação do limite de servidores por página impressa de 6 para 7 (`serversPerPage`), otimizando o preenchimento de espaço vertical em orientação paisagem.
- **Alinhamento do Rodapé de Totais**: Adicionado `colSpan={2}` na célula inicial de totais por turno (`SERVIDORES POR TURNO`) da visualização de impressão, alinhando perfeitamente as colunas de estatísticas com a tabela de grade.

## [1.0.0] - 2026-05-23

### Added
- **Criptografia de PINs de Acesso**: Criptografia de PINs baseada em trigger no PostgreSQL (`pgcrypto` com `bcrypt`) ao criar/atualizar servidores. Migração segura de PINs legados para hashes criptográficos.
- **Validação de GPS no Servidor**: O cálculo de distância do geofencing de sobreaviso (`ST_Distance`) agora é executado de forma inviolável no servidor (PostgreSQL) usando a extensão PostGIS, rejeitando registros fora do raio permitido da unidade de saúde.
- **Proteção IDOR em Detalhes de Escala**: Validação rigorosa na Server Action `getEscalaDetails` para impedir que um servidor visualize escalas de unidades às quais ele não possui vínculos ativos.

### Fixed
- **Otimização Crítica de Desempenho RLS**: Reescrita e reestruturação de todas as políticas de Row Level Security (RLS) envolvendo chamadas de funções como `auth.uid()`, `uid()` e `get_my_role()`, encapsulando-as em subconsultas `(SELECT ...)` para evitar reavaliações linha por linha. Redução de 63 para 0 alertas no Supabase Security Advisor.
- **Normalização de Políticas com Acentos**: Resolução de duplicidade de políticas antigas geradas por conflitos de UTF-8 (`usuários` e `inserção`).

### Changed
- **Lançamento Estável V1.0.0**: Transição do sistema de versão Beta para Estável de Produção.
- **Controle de Versão**: Adoção do padrão de versionamento semântico de produção (ex: melhorias futuras em ciclos de homologação `v1.0.1RC`, `RC1`, `RC2`, etc. até a liberação estável).
- **Limpeza do Ambiente**: Exclusão de arquivos SQL e scripts temporários (`scratch/*`) e garantia de que o diretório `scratch/` é ignorado no git.

## [0.7.1-Beta] - 2026-05-22

### Added
- **Documentação de Migração**:
  - Plano de implementação, lista de tarefas e relatório final da migração de banco de dados para a VPS, localizados na pasta [docs/migracao/](file:///c:/Users/DMAC-LAB/SisEscala/docs/migracao).
- **Scripts de Migração**:
  - Script utilitário [generate_dump.js](file:///c:/Users/DMAC-LAB/SisEscala/scratch/generate_dump.js) para automação de exportação/limpeza de dados pós-exportação de tabelas e esquemas.

### Changed
- **Migração do Banco de Dados**:
  - Migração do banco de dados relacional e schema de autenticação do Supabase legado para a nova infraestrutura Supabase VPS dedicada.
  - Correção de compatibilidade no GoTrue da VPS: conversão automática de tokens nulos (`NULL` em colunas como `confirmation_token`, `recovery_token`, etc. na tabela `auth.users`) por strings vazias (`''`), contornando a restrição e solucionando erros de login do serviço de autenticação.

## [0.7.0-Beta] - 2026-05-15

### Added
- **Normalização Estrutural de Setores**: 
    - Migração completa de nomes de setores para a nova tabela centralizada `dicionario_setores`.
    - Implementação de relacionamento `1:N` entre dicionário e instâncias de setores, permitindo nomes únicos compartilhados entre diferentes unidades.
    - Novo fluxo de cadastro de setores com sugestões baseadas no dicionário existente e normalização automática.

### Fixed
- **Estabilidade e Visibilidade de Dados**:
    - Refatoração de todas as queries do dashboard (`Escalas`, `Servidores`, `Relatórios`) para utilizar o join com `dicionario_setores`.
    - Eliminação de crashes de runtime causados pela remoção da coluna `nome` da tabela `setores`.
    - Implementação de mapeamento defensivo em componentes Client e Server para lidar com retornos polimórficos do Supabase (objeto vs array).
    - Correção do erro de compilação em `servidores/[id]/page.tsx` relacionado ao acesso de propriedades em tipos relacionais.
- **Indicadores de Conflito ("Bolinhas Azuis")**:
    - Hardening da lógica de detecção de conflitos externos no `ScaleGrid.tsx` com proteções contra dados nulos e normalização de strings (case-insensitive).
    - Verificação de integridade da RPC `fn_get_monthly_occupancy` para garantir visibilidade operacional cross-unit.

### Changed
- Limpeza técnica: Remoção definitiva da coluna redundante `nome` da tabela `setores` no PostgreSQL.
- Otimização de queries: Substituição de ordenações manuais por ordenações centralizadas no dicionário.

## [0.6.0-Beta] - 2026-05-13

### Added
- **Motor de Compliance Legal** (`complianceEngine.ts`):
    - Validação automática de **Interjornada** (mínimo 11h de descanso entre turnos consecutivos).
    - Validação de **DSR** (Descanso Semanal Remunerado): alerta quando servidor trabalha 7+ dias consecutivos sem folga.
    - Indicadores visuais (triângulo âmbar) diretamente nas células da grade na linha Regular.
    - Badge de contagem de alertas na toolbar: "⚠️ X alertas de compliance".
    - Validação **não-bloqueante** (informativa): o coordenador é alertado mas pode salvar normalmente.
    - Módulo puro, sem dependências de React/Supabase, recalculado via `useMemo` para performance.

- **Templates de Escala** (`scaleTemplates.ts`):
    - Preenchimento automático da grade com padrões predefinidos: **12×36**, **5×2** e **6×1**.
    - Modal completo na toolbar (botão "Aplicar Template") com seleção de servidor, modelo, turno, dia de início e opção de começar trabalhando ou folgando.
    - Escala **5×2** respeita o calendário real (seg-sex trabalha, sáb-dom folga).
    - **Proteção de integridade**: dias com presença já confirmada NÃO são sobrescritos.
    - Template preenche apenas a linha **Regular** e não grava no banco — exige "Salvar Previsão" explícito.

- **Portal de Solicitação de Trocas (Expansão e Estabilização)**:
    - **Suporte Multi-categoria**: Agora permite solicitar trocas para turnos de **Plantão** e **Sobreaviso**, além da linha **Regular** (Excluindo apenas Extra).
    - **Identidade Visual por Categoria**: Botões e listagens coloridos por tipo (Roxo: Regular, Vermelho: Plantão, Azul: Sobreaviso) para facilitar a identificação.
    - **Filtro de Dias Futuros**: O portal agora oculta automaticamente dias que já passaram ou o dia atual, permitindo solicitações apenas para datas futuras (a partir de amanhã).
    - **Auto-Refresh Inteligente**: O portal do servidor agora carrega as solicitações automaticamente ao selecionar a escala, eliminando a necessidade de cliques manuais (botão "Atualizar" removido por redundância).
    - **Feedback Visual (Toasts)**: Adicionado sistema de notificações no painel do coordenador para confirmar sucesso ou erro ao processar trocas.
    - **RLS Policy Fix**: Correção crítica nas políticas de segurança da tabela `solicitacoes_troca` para permitir que coordenadores (`authenticated`) aprovem trocas sem falhas silenciosas.
    - **Server-Side Guard**: Implementada validação de data na server action para impedir solicitações em dias passados via manipulação direta de API.

### Changed
- Refatoração do `ConsultarEscalaClient` para suportar agrupamento dinâmico de botões por categoria.
- Otimização do carregamento de dados do portal para maior fluidez.

### Security
- RLS ativado e corrigido na tabela `solicitacoes_troca`.
- Validação rigorosa de datas (bloqueio de dias passados) tanto no front quanto no back.
- Todas as server actions de troca validam sessão antes de operar.
- Anti-spam: limite de 3 solicitações pendentes por servidor.
- Rejeição exige motivo obrigatório (mín. 3 caracteres).

### Security
- RLS ativado na nova tabela `solicitacoes_troca`.
- Todas as server actions de troca validam sessão antes de operar.
- Anti-spam: limite de 3 solicitações pendentes por servidor.
- Rejeição exige motivo obrigatório (mín. 3 caracteres).


## [0.5.0-Beta] - 2026-05-11

### Added
- **Diagnóstico e Auditoria Sênior**: Realização de auditoria completa de segurança e performance, documentada na pasta `docs/`.
- **Endurecimento de Segurança (Security Hardening)**: 
    - Implementação de **Rate Limiting** para validação de PIN: bloqueio automático de 15 minutos após 5 tentativas falhas para mitigar ataques de força bruta.
    - Proteção contra **IDOR**: validação rigorosa de vínculo de servidor em consultas de detalhes de escala via cookies de sessão no Portal do Servidor.
- **Otimização de Performance**:
    - Implementação de **Database Indexes** estratégicos em tabelas de grande volume (`escala_mensal`, `escala_diaria`, `logs_sistema`, `servidores`).
    - Introdução de **Server-Side Caching** (`unstable_cache`) para dados estáticos (Turnos, Jornadas e Feriados), reduzindo a carga no banco de dados e acelerando o tempo de resposta em consultas frequentes.
    - Criação de documentação técnica detalhada para suporte a 10.000+ servidores (`docs/ESCALABILIDADE.md` e `docs/SEGURANCA.md`).

## [0.4.0-Beta] - 2026-05-10

### Added
- **Gestão Hierárquica de Setores**: 
    - Implementação de visualização em árvore recursiva na tela de permissões de usuário (`UserManagementClient`).
    - Sistema de **Seleção em Cascata**: marcar um setor "Pai" agora seleciona automaticamente todos os setores filhos e netos.
    - Indentação visual e indicadores de subdivisões para melhor navegação em estruturas complexas.
- **Geolocalização e Unidades**:
    - Novo componente `GeoLocationPicker` integrado ao cadastro de unidades.
    - Suporte a busca de endereço via API e captura automática de coordenadas GPS.
- **Máscaras de Entrada**:
    - Implementação de máscara de telefone padrão brasileiro `(00) 00000-0000` nos formulários de Servidores (Novo/Editar).

### Fixed
- **Motor de Cálculo de Carga Horária**:
    - Refatoração da função `calculateTotals` no `ScaleGrid` para respeitar turnos reduzidos (ex: M4 de 4h, M de 6h).
    - Implementada regra de teto contratual: a linha Regular agora usa `Math.min(horas_do_turno, horas_da_jornada)`, resolvendo a discrepância onde turnos curtos eram inflados pela jornada do servidor.
- **Estabilidade Next.js 15**:
    - Corrigido crash nas `server actions` de login/logout adicionando `await` nas chamadas de `headers()`.
- **Auditoria**:
    - Correção na captura de IP e metadados de sessão nos logs de auditoria.

## [0.3.0-Beta] - 2026-05-10

### Added
- **Governança de Presença (Ponto Digital)**:
    - Implementação de sistema bicolor de entrada/saída (Check-in/Check-out) vinculado à `escala_diaria`.
    - **Visualização Bicolor na Grade**: Barra de status dividida (Esquerda = Entrada, Direita = Saída) com lógica de cores: Verde (Confirmado), Vermelho (Falta/Esquecido), Âmbar Pulsante (Em Plantão).
    - **Terminal de Presença**: Interface otimizada para tablets exigindo autenticação prévia de supervisor e PIN individual do servidor.
    - **Validação de Janela de Tolerância**: Motor de validação que bloqueia registros fora da janela permitida (configurável, padrão +/- 30 min).
    - **Mapeamento Inteligente de Turnos**: Suporte para códigos de período ("M", "T", "N") convertidos automaticamente para horários reais (07h, 13h, 19h) para fins de validação de janela.
    - **Suporte a Plantão Noturno**: Lógica avançada para identificar saídas de plantões que cruzam a meia-noite (saída no dia seguinte).
- **Configurações Globais**:
    - Novo parâmetro `janela_presenca_minutos` para controle administrativo da tolerância de batida de ponto.
    - Integração da obrigatoriedade de presença: se ativa, apenas plantões com entrada confirmada contabilizam para os totais de carga horária.

### Fixed
- **Erro de Sintaxe no Terminal**: Corrigido crash `INVALID INPUT SYNTAX FOR TYPE INTEGER` ao tentar processar turnos com códigos alfabéticos nos slots.

## [0.2.0-Beta] - 2026-05-09

### Added
- **Validação Global de Conflitos de Escala**: 
    - Implementação de motor de validação cross-unit/cross-sector que impede que um servidor seja escalado em dois lugares simultaneamente.
    - **Indicadores Proativos**: Adição de marcador visual (ponto azul) em células onde o servidor já possui compromisso em outra unidade, com tooltip detalhado sobre o local e turno.
    - **Detecção de Sobreposição**: Mapeamento inteligente de turnos (slots M, T, N, S) para identificar choques de horário entre diferentes códigos (ex: MT conflitando com M ou T).
- **Cálculo de Carga Horária com Intervalo**:
    - Suporte a dedução de intervalos de almoço/descanso no cálculo da CH na linha Regular.
    - Nova coluna `horas_totais` e `intervalo_minutos` no cadastro de Jornadas.

### Fixed
- **Estabilidade da Grade**: Corrigido erro de runtime `Cannot read properties of undefined (reading 'Regular')` ao interagir com células de servidores recém-adicionados.
- **Auto-Conflito**: Refinada a lógica de validação para ignorar registros da própria escala atual, eliminando falsos positivos de conflito ao carregar a tela.

## [0.1.0-RC1] - 2026-05-09

### Added
- **Governança de Segurança e RBAC**: 
    - Implementação rigorosa de **Row Level Security (RLS)** no Supabase para isolamento de dados entre unidades e setores.
    - Suporte a vínculos muitos-para-muitos (`profile_unidades` e `profile_setores`) para administradores e coordenadores.
- **Isolamento de Cadastro**:
    - Telas de **Novo Setor** e **Novo Servidor** agora filtram automaticamente unidades e setores com base nas permissões do administrador logado.
    - Implementada auto-seleção de unidade única para otimização do fluxo de trabalho administrativo.
- **Gestão de Usuários Protegida**: 
    - Substituição de exclusão destrutiva por lógica de **Inativação/Reativação** para preservar integridade histórica.
    - Restrição de exclusão de contas órfãs exclusivamente para o papel de `super_admin`.
- **Localização Completa**: Tradução de dezenas de mensagens de erro do Supabase e Auth para o português.

### Changed
- **Privilégio Mínimo na Interface**: 
    - Menus de configuração estrutural (**Unidades, Cargos, Jornadas, Turnos**) agora são visíveis apenas para o **Administrador Geral** (`super_admin`).
    - Grupo de menu **SISTEMA** totalmente oculto para administradores padrão.
- **Dashboard Operacional**: Corrigida a lógica de contagem de cards para respeitar os filtros de acesso do administrador logado.

### Fixed
- **Visibilidade de Dados**: Resolvido problema que impedia administradores de visualizarem servidores e unidades vinculadas no painel principal.
- **Lógica de Sobreaviso**: Refinada a exibição do botão de acionamento para respeitar transições de turno (MT, N, MTN) e evitar disparos em horários incorretos.


## [0.0.3-RC2] - 2026-05-08

### Added
- **Auditoria de Sobreaviso Detalhada**: 
    - Implementada exibição de motivos de falha (ex: expiração de tempo de aceite/chegada) diretamente no modal de detalhes do acionamento.
    - Novo rastreamento de **Validação Administrativa**: o sistema agora registra e exibe o nome do administrador e o horário exato em que uma falha foi revertida manualmente, garantindo total transparência.
- **Lógica de Falha Cumulativa**: Refatorada a avaliação de status para suportar múltiplos chamados no mesmo dia; se qualquer chamado falhar, o dia é marcado como "Falhou" na grade e nos totais, conforme as regras de negócio.

### Fixed
- **Erro de Gravação da Escala**: Corrigida a falha de constraint `NOT NULL` (colunas `mes`, `ano`, `unidade_id`, `setor_id`, `servidor_id`, `status`) na operação de upsert da tabela `escala_mensal`.
- **Estabilidade de Build (Vercel)**:
    - Resolvido erro `Cannot find name 'useCallback'` devido a importação ausente do React.
    - Corrigida a visibilidade da função `getStatusForDay` movendo-a para o escopo do componente com `useCallback`.
- **Segurança (RLS)**: Ativada e configurada a Row Level Security na tabela de `jornadas`, protegendo contra edições não autorizadas.

## [0.0.3-RC1] - 2026-05-08

### Added
- **Gestão de Jornadas de Trabalho**: Novo módulo de cadastro de horários (ex: 07H ÀS 19H, 08H ÀS 18H) com suporte a inativação (soft-delete).
- **Seletor de Jornada na Grade**: A coluna "Tipo" na grade de escala agora é um seletor dinâmico, permitindo definir horários específicos por servidor.
- **Adição de Servidor Externo**: Novo fluxo para buscar e adicionar servidores de qualquer Unidade ou Setor do sistema à escala atual.
- **Destaque Visual de Origem**: Servidores externos são sinalizados com um ícone de globo e a indicação de sua unidade/setor original.
- **Exclusão de Servidor da Escala**: Adicionada opção de remover um servidor da grade (e seus lançamentos) enquanto a escala estiver em modo rascunho/previsão.
- **Utilitário Limpar Escala**: Botão para resetar rapidamente todos os lançamentos da grade atual com confirmação de segurança.

### Changed
- **Governança de Dados**: Jornadas não podem ser excluídas para preservar o histórico, apenas inativadas (deixando de aparecer para novas seleções).
- **Padrão de Jornada**: O sistema agora utiliza "07H ÀS 19H" como padrão automático ao adicionar novos servidores.

### Fixed
- **Estabilidade de Build (Vercel)**:
    - Corrigido erro de escopo da variável `isExternal` que travava o render da grade.
    - Resolvido erro de tipagem no ícone `Globe` (remoção da prop `title` direta).
    - Substituídas chamadas `toast` (não instaladas) por `alert` padrão para garantir sucesso do build.

## [0.0.2-RC2] - 2026-05-07

### Added
- **Resumo de Servidores por Turno**: Implementada tabela de rodapé na grade de escala e na impressão em PDF que contabiliza automaticamente o número de profissionais alocados em cada turno (Manhã, Tarde, Noite e Sobreaviso) para cada dia do mês.
- **Regras Avançadas de Sobreaviso (Configurações)**: Adicionada nova seção no painel de configurações para controle global de regras de sobreaviso.
- **Auditoria de Sobreaviso (GPS)**: A validação e o aceite do sobreaviso agora podem exigir obrigatoriamente a leitura de geolocalização do dispositivo do servidor.
- **Tempo Limite de Aceite e Deslocamento**: Implementados limitadores de tempo (configuráveis) que invalidam automaticamente o chamado se o servidor não aceitar ou não registrar a chegada dentro do prazo.
- **Penalização de Falha**: Escalas com falha no acionamento (por expiração de tempo) são agora automaticamente descontadas do total de carga horária e visualmente destacadas na grade (em vermelho com tooltip justificando a falha).
- **Validação Administrativa Manual**: Criado atalho na grade de escala para administradores sobreporem e validarem manualmente um sobreaviso que falhou.

### Changed
- O fluxo de aceite `/sobreaviso/[token]` agora avalia dinamicamente os parâmetros globais (`sobreaviso_exigir_localizacao`, `sobreaviso_tempo_aceite_minutos`, `sobreaviso_tempo_chegada_minutos`) configurados no banco de dados.

### Fixed
- Corrigido erro de compilação da tipagem do TypeScript (`ScalePrintViewProps`) no processo de build da Vercel.

## [0.0.2-RC1] - 2026-05-07

### Added
- **Data Governance Migration**: Implemented "Soft Delete" (Ativo/Inativo) across all core organizational modules (Unidades, Setores, Turnos).
- **StatusToggleButton**: New reusable Client Component for safe status toggling with confirmation dialogs.
- **Advanced Filtering**: Added search bars and "Show Inactive" toggles to Units, Sectors, and Shift Dictionary list pages.
- **Holiday Management (Feriados)**:
    - Blocked destructive deletion of holidays to preserve historical calculation integrity.
    - Implemented inline description editing for rapid corrections.
    - Locked date fields after creation to prevent data corruption.
    - Added a persistent warning banner explaining the immutability rules.

### Changed
- **Scale Integrity**: Updated `ScaleGrid` and "Nova Escala" flows to automatically exclude inactive units, sectors, and shifts from selection pickers.
- **UI/UX Overhaul**: Upgraded administrative lists to a high-density, premium aesthetic (SisTEA style) with improved contrast and modern spacing.
- **Shift Dictionary**: Renamed internal table references and added state-based visibility logic.

### Fixed
- Resolved "Event Handlers in Server Components" error by extracting toggle logic to client components.
- Fixed missing Lucide icon imports and Next.js Link definitions across edit pages.

## [0.0.1-RC3] - 2026-05-06

### Added
- Complete User Management Module (Módulo de Gestão de Usuários) restricted to `super_admin` and `admin`.
- "Meu Perfil" page allowing users to self-manage their name, email, and password.
- "Esqueceu a senha?" link on the login page and full password recovery flow.
- "Redefinir Senha" page for safe credential resets.
- Added `admin` and `comum` roles to the `user_role` database enum.
- Required `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` to securely create users via server actions without logging out the active admin.

### Changed
- Dashboard "Escalas Ativas" counter now accurately calculates the number of grouped active scales (by Unit, Sector, Month, and Year) instead of raw database rows, fixing UI discrepancies.
- Hid all public sign-up options to ensure the system is strictly invitation/admin-created.

## [0.0.1-RC2] - 2026-05-06

### Added
- Created a Theme Toggle component (Light, Dark, System) using `next-themes`.
- Added ThemeToggle to the Sidebar layout.

### Changed
- Standardized text contrast and background colors across the dashboard, ensuring great visibility in both Light and Dark modes.
- Replaced system OS dependent dark-mode fallback with explicit class-based variables in `globals.css`.
- Improved grid headers (`ScaleGrid.tsx`) contrast and updated text colors for data visibility in light mode.
- Formatted the generated WhatsApp message text to use bold markdown (`*`) and proper line breaks for clarity.

### Fixed
- Fixed Logout button reliability by using `try/catch` block and full page navigation via `window.location.href` to clear client-side cache and cookies.
- Resolved an issue causing invisible (white on white) text in the data grids when the OS is in Dark Mode while the application is in Light Mode.

## [0.0.1-RC1] - 2026-05-06

### Added
- Initial project structure and implementation based on PRD.
- Multi-tenant architecture for municipal scale management.
- Integration with Supabase for Auth, Database, and Realtime.
- Geofencing validation for overcall arrivals.
- PDF report generation structure.

### Changed
- Upgraded Next.js to 15.5.15 to fix critical security vulnerabilities.
- Updated PostCSS and TailwindCSS to latest versions.
- Optimized root layout to prevent hydration errors during development.

### Fixed
- **Security**: Removed `.env.local` from Git tracking and repository history.
- **Security**: Hardened Supabase RLS policies for `logs_sobreaviso` and `servidores`.
- **Security**: Restricted execution permissions for sensitive database functions.
- Fixed hydration mismatch error on the login page.
