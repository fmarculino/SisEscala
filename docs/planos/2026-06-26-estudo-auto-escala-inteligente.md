# Estudo Técnico e Arquitetural: Auto-Escala Inteligente
**SisEscala — Junho de 2026**

Este documento apresenta um estudo de viabilidade, análise técnica e proposta de implementação para a funcionalidade de **Auto-Escala Inteligente**, identificada originalmente no documento de melhorias como prioridade de longo prazo.

---

## 1. Localização da Proposta Original

A proposta original de implementação da auto-escala inteligente está documentada no arquivo de benchmark do SisEscala:
* **Arquivo:** [BENCHMARK_E_MELHORIAS.md](file:///c:/Users/Cliente/Projetos/SisEscala/docs/BENCHMARK_E_MELHORIAS.md#L51-L53)
* **Seção:** `3. Sugestões de Melhorias para o SisEscala` -> `🔵 Prioridade Baixa (Longo Prazo)`
* **Item:** `1. Auto-Escala Inteligente: Algoritmo que sugere a melhor escala baseada no histórico de folgas e preferências dos servidores.`

---

## 2. Reanálise e Diagnóstico de Oportunidade

Com as evoluções recentes do SisEscala (v0.6.0+), a base para a criação da Auto-Escala Inteligente já está amplamente pavimentada:
1. **Motor de Compliance Legal** ([complianceEngine.ts](file:///c:/Users/Cliente/Projetos/SisEscala/src/utils/complianceEngine.ts)): O sistema já possui regras programáticas para validar a interjornada de 11h e o DSR (Descanso Semanal Remunerado).
2. **Dimensionamento do Setor**: A tabela `public.setores` já armazena requisitos de quantidade mínima, ideal e máxima de servidores para os turnos da manhã, tarde e noite (ex: `servidores_manha_min`, `servidores_manha_ideal`).
3. **Gestão de Afastamentos**: A tabela `public.servidores_eventos` armazena férias, licenças e outros afastamentos, permitindo prever a indisponibilidade de servidores.
4. **Fechamento de Competência**: A recente implementação de congelamento de competência garante um histórico estático e íntegro das escalas de meses anteriores.

### O Problema da Geração Manual
Atualmente, criar uma escala exige que o coordenador aplique templates individuais para cada servidor (ex: "12x36") ou preencha a grade célula a célula. Ao fazer isso, o coordenador precisa:
* Lembrar se o servidor "A" terminou o mês anterior trabalhando ou folgando para manter a alternância de 12x36 correta.
* Consultar manualmente se o servidor tem férias no período.
* Ajustar a distribuição de turnos para que o setor não fique subdimensionado ou superdimensionado em dias específicos.

---

## 3. Modelo Conceitual do Algoritmo

O problema de escalação de equipes é um clássico **Problema de Satisfação de Restrições (CSP)**. Dividimos as regras em duas categorias:

### A. Restrições Rígidas (Hard Constraints) — Bloqueantes
Se alguma destas regras for violada, a escala gerada é inválida:
1. **Afastamento/Férias**: O servidor não pode ser escalado em dias que coincidam com registros na tabela `public.servidores_eventos`.
2. **Interjornada**: O servidor precisa ter no mínimo 11h de descanso consecutivo entre turnos.
3. **Limite de Jornada**: O servidor não pode exceder sua carga de trabalho contratual máxima semanal ou mensal (a definir no cadastro do servidor, com fallback para o vínculo).
4. **Conflito de Turno Duplo**: O servidor não pode trabalhar em mais de um turno regular no mesmo dia, a menos que seja sobreaviso/extra expressamente permitido.

### B. Restrições Flexíveis (Soft Constraints) — Critérios de Pontuação/Otimização
Regras que o algoritmo tenta satisfazer para atingir a melhor escala possível, pontuando positivamente as escolhas ideais:
1. **Continuidade Histórica (Crucial)**: Se o servidor trabalha sob o template 12x36, o algoritmo deve olhar a escala do último dia do mês anterior (`dia = 30` ou `31`) na tabela `escala_diaria`. Se ele trabalhou, a escala do dia 1 do mês atual deve ser de folga. Se ele folgou, deve trabalhar.
2. **Dimensionamento Mínimo/Ideal**: Garantir que cada dia do mês tenha a quantidade de servidores definida no dimensionamento do setor (`servidores_manha_min`, etc.).
3. **Equidade de Horas**: Distribuir a carga horária de forma justa entre servidores de mesma categoria/cargo.
4. **Preferência de Turno**: Se o servidor tem preferência cadastrada por um turno (ex: Manhã), priorizar escalá-lo nesse turno.

---

## 4. Análise de Alternativas de Algoritmo

Apresentamos três abordagens viáveis para a inteligência de geração:

| Dimensão | Opção A: Motor Backtracking (CSP) | Opção B: Heurística Gulosa com Pontuação (Recomendada) | Opção C: Programação Linear Inteira (MILP) |
| :--- | :--- | :--- | :--- |
| **Descrição** | Explora recursivamente a árvore de possibilidades, fazendo rollback (backtrack) ao encontrar um conflito. | Aloca os turnos sequencialmente dia a dia, escolhendo o servidor com a melhor pontuação de prioridade para aquela vaga. | Traduz as regras em equações lineares e resolve via solucionador matemático (ex: Simplex/Branch and Bound). |
| **Complexidade de Implementação** | Alta | Média | Altíssima |
| **Performance** | Variável (pode sofrer com "lags" se as restrições forem muito complexas) | Rápida (Executa em milissegundos) | Lenta e consome muitos recursos |
| **Tratamento de Inviabilidade** | Retorna "falha" se não achar solução perfeita, exigindo relaxar regras de forma complexa. | Sempre entrega uma escala (avisa onde não foi possível atingir o ideal, deixando os "furos" explícitos para o coordenador). | Requer bibliotecas externas pesadas e complexas de integrar no Next.js (como GLPK). |
| **Veredito** | Inviável devido à dificuldade em lidar com múltiplos perfis sem travar a thread. | **Vencedora**. Equilibra alta performance com entrega garantida e facilidade de ajuste pelo coordenador. | Descartada por complexidade desproporcional. |

---

## 5. Proposta de Solução: Heurística Gulosa de Priorização

Propomos um algoritmo estruturado em **3 Passos** rodando no backend (Next.js Server Actions) para garantir segurança e performance:

```
                  ┌─────────────────────────────────────┐
                  │ 1. INICIALIZAÇÃO E CONTINUIDADE     │
                  │ - Carrega servidores ativos         │
                  │ - Carrega eventos/afastamentos     │
                  │ - Determina offset do mês anterior  │
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
                  │ 2. ALOCAÇÃO DE TEMPLATES RÍGIDOS     │
                  │ - Aplica 12x36 e 5x2 respeitando    │
                  │   continuidade e afastamentos       │
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
                  │ 3. DISTRIBUIÇÃO E AJUSTE DE COBERTURA│
                  │ - Avalia subdimensionamentos        │
                  │ - Distribui plantões/extras usando  │
                  │   matriz de score de servidores     │
                  └─────────────────────────────────────┘
```

### Detalhamento do Cálculo de Score (Passo 3)
Para cada turno vago que necessita de cobertura, calculamos a pontuação de todos os servidores disponíveis. A fórmula de pontuação para o servidor $S$ no dia $D$ e turno $T$ seria:

$$\text{Score}(S, D, T) = W_{\text{pref}} \cdot P(S, T) + W_{\text{hist}} \cdot H(S, D) - W_{\text{carga}} \cdot C(S) - W_{\text{fadiga}} \cdot F(S, D)$$

Onde:
* $P(S, T)$: Preferência do servidor pelo turno ($1$ se prefere, $0$ neutro, $-1$ se evita).
* $H(S, D)$: Compatibilidade com o histórico de folgas do servidor ($1$ se está no dia correto de trabalho, $0$ se neutro).
* $C(S)$: Carga horária já acumulada no mês (evita sobrecarregar o mesmo servidor).
* $F(S, D)$: Indicador de fadiga ($1$ se trabalhou no dia anterior, diminuindo a atratividade para turnos subsequentes).
* $W$: Pesos ajustáveis que equilibram a importância de cada fator.

---

## 6. Proposta de Arquitetura de Banco de Dados

Para dar suporte a esta funcionalidade de forma robusta e otimizada, sugerimos a criação/ajuste das seguintes estruturas:

### A. Tabela de Preferências e Vínculos dos Servidores
Ajustes na tabela `public.servidores` para salvar preferências e carga horária contratual:
```sql
ALTER TABLE public.servidores 
ADD COLUMN preferência_turno TEXT CHECK (preferência_turno IN ('M', 'T', 'N', 'Flexível')),
ADD COLUMN carga_horaria_semanal INTEGER DEFAULT 40;
```

### B. Tabela de Cobertura de Referência (Dimensionamento)
Caso a proposta em [notificacoes_e_cobertura.md](file:///c:/Users/Cliente/Projetos/SisEscala/docs/planned_features/notificacoes_e_cobertura.md) ainda não esteja ativa, utilizaremos os campos de dimensionamento da tabela `public.setores` (`servidores_manha_min`, etc.).

---

## 7. Interface do Usuário Proposta (UX)

Recomendamos uma integração sutil, mas visualmente rica na grade de escalas do coordenador:

1. **Ação Principal**: Na barra de ferramentas da escala da unidade ([ScaleGrid.tsx](file:///c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/escalas/unidade/[unidadeId]/ScaleGrid.tsx)), ao lado de "Aplicar Template", adicionaremos o botão:
   * **"Gerador Inteligente"** (Ícone: Sparkles/Zap em tom roxo/gradiente).
2. **Modal de Configuração**:
   * O coordenador escolhe as opções do algoritmo:
     * `[x]` Manter continuidade do mês anterior.
     * `[x]` Respeitar limite de carga horária contratual.
     * `[x]` Priorizar preferências de turno dos servidores.
     * Modo de Preenchimento: `[Apenas Mínimo Necessário | Preencher até o Ideal]`.
3. **Grade de Pré-visualização (Draft)**:
   * A escala gerada é aplicada na tela do coordenador em modo rascunho com animações fluidas nas células modificadas.
   * Células geradas pelo assistente ganham uma pequena marcação visual (ex: um pequeno brilho ou borda tracejada roxa) com tooltip informando a justificativa: *"Gerado automaticamente com base no histórico de 12x36"*.
   * O coordenador pode ajustar manualmente e, por fim, clica no botão verde **"Salvar Previsão"** para gravar no Supabase de uma só vez.

---

## 8. Próximos Passos (Plano de Ação)

Se aprovado, o plano de implementação seguirá as seguintes etapas:
1. **Modelagem e Migração**: Adicionar colunas de preferências e carga horária na tabela `public.servidores`.
2. **Desenvolvimento do Engine**: Codificar a classe `ScaleGeneratorEngine.ts` em `src/utils/` contendo a lógica gulosa de alocação e verificação de continuidade do mês anterior.
3. **Desenvolvimento da Interface**: Integrar o assistente no grid do SisEscala.
4. **Homologação**: Testar a escala com cenários de servidores com férias no meio do mês para atestar que o algoritmo desvia corretamente desses dias.

---
*Estudo elaborado por Antigravity AI em 26/06/2026 para reanálise e aprimoramento do SisEscala.*
