# Documentação Técnica do SisEscala 📑

Este diretório contém a documentação técnica, manuais de integração, arquitetura e especificações do sistema **SisEscala** (v1.19.0).

## 📄 Arquivos Principais

- [`changelog.md`](file:///c:/Users/Cliente/Projetos/SisEscala/docs/changelog.md): Histórico completo de versões e alterações do sistema.
- [`GUIA_INTEGRACAO_COMUNICACAO_E_AUTH.md`](file:///c:/Users/Cliente/Projetos/SisEscala/docs/GUIA_INTEGRACAO_COMUNICACAO_E_AUTH.md): Guia de integração com provedores de WhatsApp API (AstraCalls, Chatwoot, Gateway Customizado), SMTP e Supabase Auth PKCE.
- [`BENCHMARK_E_MELHORIAS.md`](file:///c:/Users/Cliente/Projetos/SisEscala/docs/BENCHMARK_E_MELHORIAS.md): Análise de desempenho e otimizações de banco de dados.
- [`SEGURANCA.md`](file:///c:/Users/Cliente/Projetos/SisEscala/docs/SEGURANCA.md): Políticas de RLS, segurança de autenticação e logs de auditoria forense.
- [`ESCALABILIDADE.md`](file:///c:/Users/Cliente/Projetos/SisEscala/docs/ESCALABILIDADE.md): Recomendações de escalabilidade para alta demanda multi-unidade.

## 📌 Principais Recursos da Versão Atual (v1.19.0)

1. **Validação em Massa de Presença em Multi-Níveis**:
   - Modal por célula (batida individual, 1º/2º período ou dia completo).
   - Atalho por servidor (`<CheckSquare />`) para período de dias.
   - Botão global `⚡ Validar em Massa` para múltiplos servidores por unidade.
2. **Preservação de Horários Reais**:
   - Uso de `COALESCE` para garantir que batidas de ponto físicas efetuadas pelo servidor não sejam substituídas durante a homologação.
3. **Justificativa Obrigatória**:
   - Registro de justificativa textual em todas as validações manuais.
4. **Validação Manual de Sobreaviso**:
   - Homologação de sobreavisos pendentes ou que falharam diretamente no modal de histórico.
5. **Nomenclatura Atualizada ("PREVISÃO" / "PREV")**:
   - Unificação do termo de horas brutas na grade e relatórios.
