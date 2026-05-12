# Benchmark e Propostas de Melhoria - SisEscala

Este documento consolida os aprendizados obtidos através do estudo do site **Escala.app** e seu glossário de escalas, servindo como roteiro para futuras evoluções do SisEscala.

## 1. Glossário de Conceitos e Terminologias
Abaixo estão os conceitos fundamentais para gestão de escalas em conformidade com as melhores práticas de mercado e legislação (CLT/Estatutos):

- **Interjornada**: Período de descanso obrigatório de no mínimo **11 horas consecutivas** entre o término de uma jornada e o início da próxima.
- **Intrajornada**: Intervalo para repouso ou alimentação durante a jornada de trabalho (ex: 1h a 2h para jornadas superiores a 6h).
- **DSR (Descanso Semanal Remunerado)**: Garantia de pelo menos **24 horas consecutivas** de descanso por semana, preferencialmente aos domingos.
- **Escala 12x36**: Modelo onde o servidor trabalha 12 horas seguidas e descansa 36 horas. Muito comum em serviços essenciais (Saúde, Segurança).
- **Escala de Revezamento**: Quando os turnos dos servidores alternam periodicamente (manhã, tarde, noite) para garantir a cobertura 24/7 de um setor.
- **Dimensionamento (Staffing)**: Processo de calcular a quantidade exata de servidores necessários para cobrir a demanda de um setor, evitando sobrecarga ou ociosidade.

---

## 2. Análise Comparativa (Benchmark)

| Funcionalidade | SisEscala (Atual) | Escala.app (Benchmark) | Impacto |
| :--- | :--- | :--- | :--- |
| **Registro de Escala** | Manual na grade | Automação via templates | Médio |
| **Troca de Plantão** | Via administrativo | Autoatendimento via App | Alto |
| **Motor de Regras** | Validação de conflitos | Validação de Compliance (Interjornada) | Crítico |
| **Notificações** | Verificação manual | Alertas Push e Email automáticos | Alto |
| **Relatórios** | Administrativos básicos | BI e Dashboards de Absenteísmo | Médio |

---

## 3. Sugestões de Melhorias para o SisEscala

### 🟢 Prioridade Alta (Próxima Versão - 0.6.0)
1. **Motor de Compliance (Validação Legal)**: 
   - Implementar aviso visual se uma escala violar as **11 horas de interjornada**.
   - Validar o **DSR** (pelo menos uma folga a cada 7 dias).
2. **Templates de Escala**:
   - Criar botões "Aplicar 12x36" ou "Aplicar 5x2" que preenchem automaticamente o mês para o servidor selecionado.
3. **Portal de Solicitação de Trocas**:
   - Permitir que o servidor solicite uma troca de plantão no "Portal do Servidor", gerando uma pendência para aprovação do coordenador.

### 🟡 Prioridade Média (Versão 0.7.0)
1. **Sistema de Notificações Ativas**:
   - Enviar WhatsApp ou E-mail automático para o servidor quando sua escala mensal for publicada ou alterada.
   - Alertas para coordenadores sobre furos na escala (setores subdimensionados).
2. **Dashboard de Cobertura**:
   - Gráfico em tempo real mostrando se o setor possui o número mínimo de profissionais necessários para cada turno do dia.

### 🔵 Prioridade Baixa (Longo Prazo)
1. **Auto-Escala Inteligente**:
   - Algoritmo que sugere a melhor escala baseada no histórico de folgas e preferências dos servidores.
2. **Integração com Folha de Pagamento**:
   - Exportação automática de horas extras e adicionais noturnos calculados com precisão forense.

---
**Documentação gerada por:** Antigravity AI (Senior Systems Analyst)
**Data:** 11/05/2026
**Referência:** Escala.app (Glossário de Escalas 2025)
