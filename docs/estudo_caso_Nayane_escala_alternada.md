# Estudo de Caso: Flexibilidade de Turnos Diários na Jornada Regular (SisEscala)

Este documento registra a análise técnica e as propostas de solução para a situação atípica identificada na escala de servidores com jornadas fixas mensais que realizam trocas temporárias de turno diário.

---

## 1. Cenário e Contexto

*   **Servidora Exemplo:** Nayane Beatriz Brito Sales (Enfermeira, Unidade DMAC).
*   **Jornada Mensal Base:** `08H ÀS 14H` (Carga horária padrão de 6 horas, predominantemente no período da Manhã - `M`).
*   **A Situação Atípica:** Por acordo de trabalho, em determinados dias do mês (ex: dias 9, 11, 13, 15, etc.), a servidora cumpre sua escala de 6 horas no período da tarde (`T`), e não de manhã.
*   **Atividade Paralela:** Nos dias em que ela atua à tarde na unidade de origem, ela realiza plantões matutinos (`Plantão` de manhã) em outras unidades ou setores.

---

## 2. O Problema Técnico Atual

O sistema SisEscala calcula as janelas de ponto (entrada/saída) e faz validações de conflito de horários com base nas seguintes premissas rígidas:

1.  **Cálculo da Jornada Regular:** Quando o dia na escala está marcado como `Regular`, o sistema ignora o código do turno diário (`M`, `T`, `N`) no calendário e lê exclusivamente a coluna da Jornada padrão do servidor (`08H ÀS 14H`).
2.  **No Código da Folha de Ponto (`folha-ponto/actions.ts`):**
    A função `parseJornadaNome` extrai os horários fixando o início às `08:00` e término às `14:00` para todos os dias úteis.
3.  **No Banco de Dados (`fn_confirmar_presenca`):**
    A validação da batida de ponto via terminal extrai o horário de início diretamente do nome da jornada (`08` da jornada `08H ÀS 14H`), inviabilizando que ela registre a entrada às `14:00` no turno da tarde.
4.  **Conflito de Plantões:** Como o motor de regras entende que ela trabalhou de manhã na escala de origem, o sistema aponta um conflito de horário/duplicidade quando é lançado um plantão matutino para ela em outra unidade no mesmo dia.

---

## 3. Propostas de Solução para Discussão com o RH

Para resolver o problema mantendo a integridade e as regras de negócio das escalas, propomos três alternativas técnicas:

### Opção A: Detecção Dinâmica de Turnos na Jornada Regular
O sistema passa a analisar tanto a jornada mensal quanto o código do turno diário (`M`, `T`, `N`) alocado no calendário para definir as janelas de batida de ponto.
*   **Funcionamento:** Se a jornada base é de 6h (início às 08h) e o dia possui o marcador `T`, o sistema recalcula dinamicamente o horário esperado para tarde (ex: `14:00 às 20:00`).
*   **Impacto no Fluxo:** Mínimo para o coordenador, que apenas troca a letra no grid da escala.
*   **Impacto de Desenvolvimento:** Médio. Requer alteração na procedure de banco `fn_confirmar_presenca` e nas actions de sincronização da folha de ponto.

### Opção B: Parametrização de Horários no Dicionário de Turnos
Inserir campos de `Hora de Início Padrão` e `Hora de Fim Padrão` diretamente no cadastro de turnos (`dicionario_turnos`).
*   **Funcionamento:** O turno `T` de 6 horas passaria a ter cadastrado em banco o horário oficial de `14:00 às 20:00`. Quando a escala diária apresentar um turno divergente da jornada base, o sistema prioriza o horário explícito do turno diário.
*   **Impacto no Fluxo:** Requer configuração inicial dos horários no dicionário de turnos pela administração.
*   **Impacto de Desenvolvimento:** Médio/Alto. Requer migração de banco para adicionar novas colunas e ajustes em toda a validação de tolerâncias e regras de batida.

### Opção C: Registro de Acordos/Permutas de Escala
Criar um módulo ou tipo de evento no cadastro de afastamentos/ocorrências para documentar acordos de turnos alternados.
*   **Funcionamento:** O coordenador insere um registro informando que no dia $X$ o servidor trabalhará em turno alternativo devido a um acordo. Esse evento ajusta automaticamente a folha e libera o outro turno para plantões externos.
*   **Impacto no Fluxo:** Maior controle e rastreabilidade para o RH (saberá formalmente por que o turno foi alterado), porém exige que o coordenador faça um cadastro manual além de alterar o grid.
*   **Impacto de Desenvolvimento:** Alto. Envolve criação de novas interfaces e tabelas de histórico.

---

## 4. Tópicos de Alinhamento com o RH

Para definir a melhor solução, sugerimos levantar os seguintes pontos com a equipe de Recursos Humanos:

1.  **Regulamentação e Auditoria:** O RH precisa de um registro formal (justificativa de acordo) para auditar essas trocas temporárias de turno, ou a alteração visual no grid de escalas já é suficiente? *(Se precisarem de auditoria estrita, a Opção C é a ideal; se preferirem agilidade operacional, as Opções A ou B são melhores).*
2.  **Padronização de Horários:** Existe um horário padrão de início e fim bem estabelecido para cada turno (ex: todo turno da tarde "T" obrigatoriamente inicia às 13:00 ou 14:00)? *(Se sim, a Opção B garante que todos os setores sigam o mesmo padrão).*
3.  **Impacto na Folha:** Como essas horas cumpridas à tarde devem constar no espelho de ponto? Como horas normais ou adicionais noturnos (caso ultrapassem as 22h)?
