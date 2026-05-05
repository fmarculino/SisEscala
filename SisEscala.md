# Product Requirements Document (PRD)
## Sistema de Gestão e Auditoria de Escalas Municipais

### 1. Visão Geral e Objetivos
Desenvolver uma aplicação web para substituir planilhas complexas (Excel/VBA) na gestão de escalas de serviço, plantões e horas extras de servidores públicos. O sistema visa automatizar cálculos de folha, gerar relatórios padronizados (PDF) e, criticamente, auditar em tempo real o acionamento de profissionais em regime de sobreaviso. O MVP focará em unidades de saúde e laboratórios, com arquitetura multi-tenant para expansão a outras secretarias.

### 2. Stack Tecnológico
*   **Frontend:** Next.js (App Router), React, Tailwind CSS. (Hospedagem: Vercel)
*   **Backend/BaaS:** Supabase (PostgreSQL, Auth, Row Level Security, Realtime).
*   **Geração de Documentos:** Biblioteca de PDF no frontend/edge (ex: `pdfmake`, `jspdf` ou `@react-pdf/renderer`).
*   **Geolocalização:** API nativa do navegador (`navigator.geolocation`) e integração com API de Mapas para cálculo de rotas/ETA.

### 3. Modelagem de Dados Inicial (PostgreSQL / Supabase)
O Antigravity deve iniciar estruturando o seguinte Schema relacional:

*   **`users` / `profiles`:** Integrado ao Supabase Auth. Níveis de acesso: `super_admin` (Secretaria/RH), `coordenador` (Gestor da unidade), `servidor` (Leitura/Visualização).
*   **`unidades`:** ID, Nome (ex: HMM, CCE, Laboratório Central), Endereço, Coordenadas GPS (Lat/Long para Geofencing).
*   **`servidores`:** ID, Nome, Matrícula, Cargo (ex: ASG), Vínculo (Contratada, Concursada), Unidade_ID.
*   **`dicionario_turnos`:** Tabela de parametrização. Ex: Código (M8), Descrição (8h Manhã), Horas_Computadas (8), Tipo (Normal, Plantão, Sobreaviso).
*   **`escala_mensal`:** Mês, Ano, Servidor_ID, Unidade_ID, Status (Rascunho, Fechada).
*   **`escala_diaria`:** ID, Escala_Mensal_ID, Dia, Dicionario_Turnos_ID.
*   **`logs_sobreaviso`:** ID, Servidor_ID, Unidade_ID, Data_Hora_Acionamento, Status (Aguardando, Aceito, Recusado, Expirado), Token_Magic_Link, Data_Hora_Aceite, IP_Aceite, User_Agent, Lat_Aceite, Long_Aceite, ETA_Minutos, Data_Hora_Chegada, Tipo_Validacao_Chegada (GPS/QRCode/Manual).

### 4. Fases de Desenvolvimento

#### FASE 1: Autenticação, Cadastros e Dicionário de Turnos (CRUDs)
1.  Configurar Supabase Auth e RLS (Row Level Security) para garantir que coordenadores só vejam dados de suas unidades.
2.  Criar telas de gerenciamento (CRUD) para Unidades, Servidores e Dicionário de Turnos.
3.  Implementar importação em massa de servidores via CSV.

#### FASE 2: Interface do Grid de Escalas (UI/UX)
1.  Desenvolver interface em grid (estilo calendário) para alocação dos servidores nos dias do mês.
2.  Carregamento dinâmico de dias úteis e finais de semana baseado no mês/ano selecionado.
3.  Seleção de turnos a partir do `dicionario_turnos` via dropdown ou atalhos de teclado.
4.  Cálculo em tempo real, na última coluna do grid: Carga Horária Total (CH), Horas Extras (50% e 100% considerando domingos/feriados), Plantões (12h, 6h, 4h) e Sobreavisos.

#### FASE 3: Módulo de Auditoria de Sobreaviso (Real-Time)
1.  **Dashboard Operacional:** Tela com assinatura Supabase Realtime mostrando profissionais escalados para sobreaviso no momento.
2.  **Acionamento:** Botão `[Acionar]` que gera um Magic Link único atrelado a um registro na tabela `logs_sobreaviso` com status "Aguardando".
3.  **Tela do Profissional:** Rota pública (protegida pelo token do link) que exige permissão de GPS para exibir o botão `[Aceitar Chamado]`.
4.  **Auditoria e Telemetria:** Ao aceitar, o sistema grava Lat/Long, IP, User Agent e Timestamp no banco.
5.  **Validação de Chegada:** Botão `[Registrar Chegada]` que valida a localização atual contra as coordenadas da unidade (Geofencing).

#### FASE 4: Relatórios e Fechamento
1.  Função de "Trancar Escala" ao fim do mês (bloqueia edições e prepara para exportação).
2.  Geração de PDF do espelho da escala com layout tabular padronizado.
3.  Geração de PDF do relatório de resumo para o RH (Relação de plantões, sobreavisos e HE).
4.  Dashboard gerencial de auditoria com o histórico detalhado dos SLAs de sobreaviso.

### 5. Regras de Negócio e Validações Críticas
*   O sistema não deve permitir a exclusão de um turno se houver um `log_sobreaviso` atrelado a ele.
*   Cálculo de HE 100% deve ser acionado automaticamente para turnos classificados como hora extra que recaiam em domingos ou feriados cadastrados.
*   O Magic Link de sobreaviso deve ter um tempo de expiração configurável (ex: 15 minutos). Caso expire sem clique, o status muda para "Expirado" para fins de auditoria do RH.