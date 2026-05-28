# Changelog

All notable changes to this project will be documented in this file.

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
