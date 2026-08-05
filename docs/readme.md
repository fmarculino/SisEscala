# Documentação Técnica do SisEscala 📑

Este diretório contém a documentação técnica, manuais de integração, arquitetura e especificações do sistema **SisEscala** (v1.19.1).

## 📄 Arquivos Principais

- [`changelog.md`](file:///c:/Users/Cliente/Projetos/SisEscala/docs/changelog.md): Histórico completo de versões e alterações do sistema.
- [`GUIA_INTEGRACAO_COMUNICACAO_E_AUTH.md`](file:///c:/Users/Cliente/Projetos/SisEscala/docs/GUIA_INTEGRACAO_COMUNICACAO_E_AUTH.md): Guia de integração com provedores de WhatsApp API (AstraCalls, Chatwoot, Gateway Customizado), SMTP e Supabase Auth PKCE.
- [`BENCHMARK_E_MELHORIAS.md`](file:///c:/Users/Cliente/Projetos/SisEscala/docs/BENCHMARK_E_MELHORIAS.md): Análise de desempenho e otimizações de banco de dados.
- [`SEGURANCA.md`](file:///c:/Users/Cliente/Projetos/SisEscala/docs/SEGURANCA.md): Políticas de RLS, segurança de autenticação e logs de auditoria forense.
- [`ESCALABILIDADE.md`](file:///c:/Users/Cliente/Projetos/SisEscala/docs/ESCALABILIDADE.md): Recomendações de escalabilidade para alta demanda multi-unidade.

## 📌 Principais Recursos da Versão Atual (v1.19.1)

1. **Cálculo da Hora Inicial do Turno `T` (Jornadas 12h-18h)**:
   - Funções `fn_confirmar_presenca` e `fn_confirmar_presenca_manual` ajustadas para definir `start_hour = 12` em jornadas 12h-18h com turno `T`.
2. **Visualização de Tentativas Recusadas no Modal para Gestores**:
   - Atualização RLS na tabela `logs_tentativas_presenca` permitindo a leitura por Coordenadores e Administradores no modal de validação manual.
3. **Escopos de Validação Manual (`completo`, `periodo_1`, `periodo_2`)**:
   - RPC `fn_confirmar_presenca_manual` atualizada para suportar homologações por dia completo e por períodos.
4. **Rótulos Dinâmicos na Interface (`ScaleGrid.tsx`)**:
   - Sub-rótulos calculados com base no turno agendado do dia (ex: `Manhã`, `Entrada Tarde`, `Entrada Noturna`).
