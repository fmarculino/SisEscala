# Changelog

All notable changes to this project will be documented in this file.

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
