# Changelog

All notable changes to this project will be documented in this file.

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
