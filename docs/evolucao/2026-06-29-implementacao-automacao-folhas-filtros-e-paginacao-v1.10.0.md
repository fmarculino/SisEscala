# Relatório de Evolução - Versão v1.10.0 (29/06/2026)

Este documento resume as melhorias e novos módulos integrados ao **SisEscala** no dia 29 de junho de 2026, com foco em automação do fechamento de escalas e geração de folhas de ponto (incluindo rotinas Cron), carregamento inicial flexível, filtros de período e status, e paginação de dados.

---

## 1. Automação do Fechamento de Escalas e Geração de Folhas de Ponto

### Contexto & Necessidade
Anteriormente, o fechamento de escalas e a consequente geração de folhas de ponto dependiam inteiramente da ação manual dos coordenadores de cada unidade ou setor. Na virada do mês, o sistema necessitava gerar rascunhos das folhas de ponto que porventura tivessem sido esquecidas e fechar automaticamente as escalas ativas cujos prazos de inativação regulamentares fossem atingidos.

### O que foi feito
- **Geração na Virada do Mês**: Implementamos a rotina `autoGenerateMissingTimesheets` no utilitário [autoClose.ts](file:///c:/Users/Cliente/Projetos/SisEscala/src/utils/autoClose.ts) para buscar todas as escalas ativas de uma competência e gerar automaticamente as folhas de ponto correspondentes como `Rascunho`, caso ainda não exista.
- **Fechamento Automático**: Atualizamos `autoCloseExpiredScalesAndTimesheets` para fechar as escalas expiradas com base nas configurações de inativação e, simultaneamente, promover suas respectivas folhas de ponto para o status definitivo de **`Revisada`** (ou criá-las diretamente caso ausentes).
- **Endpoint Cron Autenticado**: Criamos a rota de API segura `/api/cron` (no arquivo [route.ts](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/api/cron/route.ts)), protegida por chave secreta (token no header Bearer ou query parameter `?secret=...`), para orquestrar essas duas rotinas de forma automatizada via agendador externo.
- **Refatoração da Lógica de Cálculo**: Extraímos a lógica complexa de cálculo de horas normais, extras, feriados e faltas da server action `gerarFolhaPonto` para la função pura `executeGerarFolhaPonto` em [actions.ts](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/folha-ponto/actions.ts), permitindo seu reuso seguro em lote e no segundo plano pelo Cron.

---

## 2. Flexibilidade e Geração em Lote Irrestrita na Folha de Ponto

### Contexto & Necessidade
Para melhorar o fluxo de trabalho do administrador geral e coordenadores, a tela de Folha de Ponto não deve travar o carregamento inicial exigindo seleções prévias de Unidade e Setor. Além disso, o usuário precisa ser capaz de gerar folhas de ponto em lote para todos os setores aos quais tem acesso de uma só vez.

### O que foi feito
- **Carregamento Sem Barreiras**: Removemos a obrigatoriedade dos filtros de Unidade/Setor na tela de [Folha de Ponto](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/folha-ponto/page.tsx). Agora a página carrega inicialmente exibindo todos os servidores com escalas associadas na competência atual.
- **Ações em Lote Globais**: Modificamos a barra de botões de processamento em lote ("Gerar Rascunhos" e "Gerar Todas Definitivas") para ficar visível globalmente. Se os seletores estiverem vazios, a ação afeta todas as escalas às quais o usuário logado tem permissão regulamentar.
- **Segurança Otimizada**: Adaptamos a server action `getServidoresFolhaPonto` e `gerarFolhasEmLote` para aplicar filtros de RLS em nível de banco de dados (`applyAccessFilters`), garantindo que coordenadores apenas visualizem e processem dados pertencentes às suas unidades/setores autorizados.
- **Filtro Estrito por Escala Ativa**: Atualizamos a lógica para listar apenas servidores que possuam uma escala de serviço ativa cadastrada no mês/ano filtrado. Isso evita a listagem desnecessária de servidores que não trabalharam no período (por exemplo, exibindo uma tabela vazia no mês de agosto se nenhuma escala estiver cadastrada).

---

## 3. Paginação de Dados e Filtros de Status Estendidos

### Contexto & Necessidade
Em organizações com centenas de servidores, carregar todas as escalas ou folhas de ponto simultaneamente causava lentidão no carregamento e rolagem excessiva. Adicionalmente, era necessário refinar as buscas por status e período.

### O que foi feito
- **Paginação de Alta Performance**: Desenvolvemos um controle de paginação padrão (10 itens por página) para as telas de **Escalas de Serviço** e **Folha de Ponto**. A barra de paginação inclui navegação ("Anterior"/"Próxima") e botões numéricos dinâmicos, com reinicialização automática para a página `1` ao trocar qualquer filtro.
- **Filtro de Período Padrão (Escalas)**: O filtro de mês/ano da tela de Escalas de Serviço agora inicia configurado no mês e ano corrente por padrão, permitindo que os coordenadores visualizem o cenário atual instantaneamente e usem o seletor para navegar para outros meses.
- **Filtro de Status Simplificado (Escalas)**: Adicionamos um filtro de status da escala ("Todos", "Previsão" e "Fechada"). As escalas que não estão fechadas (Status `Rascunho` ou `Em Andamento`) são agrupadas sob o status de **"Previsão"** (badge âmbar), facilitando o entendimento visual do gestor.
- **Filtros de Status na Folha de Ponto**: Adicionamos duas dropdowns para filtragem em memória na listagem de servidores da Folha de Ponto:
  - **Escala Mensal**: Filtra registros por status da escala (`Todos`, `Rascunho`, `Em Andamento`, `Fechada`).
  - **Status Folha**: Filtra registros por status da folha de ponto (`Todos`, `Não Gerada`, `Rascunho`, `Gerada`, `Definitiva`).
