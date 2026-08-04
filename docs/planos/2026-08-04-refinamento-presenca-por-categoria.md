# Refinamento dos Indicadores de Presença por Categoria e Despoluição Visual da Grade (v1.18.0)

**Data de Implementação:** 04/08/2026  
**Versão:** 1.18.0  
**Status:** Concluído e Publicado  

---

## 1. Contexto e Objetivos

Esta atualização teve como foco a **despoluição visual** da Grade de Escalas (`ScaleGrid.tsx`) e o **alinhamento das regras de presença com a realidade operacional de cada categoria de escala** (Regular, Extra, Plantão e Sobreaviso).

### Problemas Resolvidos:
1. **Poluição Visual (Barras em Células Vazias):** Células que não possuíam agendamento (hífen `-`) exibiam barras vermelhas de falta em sub-linhas de Extras, Plantões e Sobreaviso.
2. **Incompatibilidade da Hora Extra com Pausas de Intervalo:** Exigir 4 marcações (com almoço/intervalo) durante horas extras violava o dinamismo da hora extra (que é uma extensão do expediente regular ou trabalho continuado).
3. **Incompatibilidade do Sobreaviso com Presença Fixa:** Sobreaviso opera sob chamados sob demanda (via WhatsApp), não fazendo sentido possuir barrinhas estáticas de entrada/saída.

---

## 2. Regras por Categoria de Escala

### 2.1 Categoria REGULAR (Turno Principal)
- **Regra da Grade:** Exibe barras de presença **apenas nos dias onde há turno regular agendado**. Células sem agendamento ficam 100% limpas.
- **Segmentos:** 
  - **4 Segmentos** (`Entrada`, `Saída Int`, `Retorno Int`, `Saída Final`): Se a unidade estiver com `permite_marca_intervalo = true` E a jornada for > 4h.
  - **2 Segmentos** (`Entrada`, `Saída Final`): Se a unidade estiver com `permite_marca_intervalo = false` OU a jornada for $\le$ 4h.

### 2.2 Categoria EXTRAS (Horas Extras)
- **Regra da Grade:** Somente exibe o indicador se houver valor de horas extras lançado na célula (ex: `1`, `2`). Células vazias (`-`) ficam 100% limpas.
- **Regra de Marcação:** Nunca possui intervalo intrajornada (máximo 2 batidas isoladas ou extensão continuada da 4ª batida `Saída Final` do expediente do dia).

### 2.3 Categoria PLANTÕES (Plantões Avulsos)
- **Regra da Grade:** Somente exibe o indicador se houver plantão agendado na célula (ex: `MT`, `N`). Células vazias (`-`) ficam 100% limpas.
- **Segmentos:** 4 segmentos para plantões > 4h em unidades com intervalo ativo; 2 segmentos caso contrário.

### 2.4 Categoria SOBREAVISO (On-Call)
- **Regra da Grade:** **NUNCA exibe barrinhas normais de presença**.
- **Sinalização Visual:** Exibe apenas a célula limpa ou os ícones de chamado via WhatsApp (`Zap`, bolinhas de status `Aguardando`, `Aceito`, `Chegou`).

---

## 3. Garantias Rígidas de Estabilidade e Não-Regressão

- **Terminal Físico (`/presenca`)**: As regras de validação de PIN, bipada de entrada e saída, geolocalização e tolerância continuam operando de forma 100% idêntica e sem qualquer impacto.
- **RPC `fn_confirmar_presenca`**: Mantém a gravação precisa dos timestamps auditados.
- **Motor de Conformidade & Folha de Ponto**: Mantêm apuração exata de horas trabalhadas e descansos regulamentares.
