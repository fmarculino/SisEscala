# Plano de Implementação & Documentação: Marcação de Intervalos por Unidade (Flexível vs Rígido)
**Data:** 04/08/2026  
**Versão do Sistema:** 1.17.0  
**Autor:** Antigravity AI / Engenharia de Software  

---

## 1. Visão Geral do Recurso

O recurso de **Marcação de Intervalos (Pausas)** permite que unidades de saúde (hospitais, UBS, laboratórios, postos) configurem opcionalmente o acompanhamento de 4 batidas diárias (Entrada, Saída para Intervalo, Retorno do Intervalo e Saída Final).

A funcionalidade atende ao **Art. 71 da CLT** e à **Portaria MTP 671/2021**, oferecendo aos coordenadores de unidade e gestores de RH a flexibilidade de escolher entre os modos **Flexível** e **Rígido** sem comprometer as unidades que optam por manter a validação padrão de 2 batidas.

---

## 2. Modos de Operação (Flexível vs Rígido)

### 2.1 Modo Flexível
- **Saída para o Intervalo:** Livre — o servidor pode iniciar a pausa em qualquer horário durante seu expediente.
- **Retorno do Intervalo:** Calculado automaticamente somando a duração do intervalo cadastrada na Jornada (`jornadas.intervalo_minutos`).
- **Tolerância:** Aplicada exclusivamente no momento do **retorno**, contra o horário esperado calculável (`Hora_Saída_Real + intervalo_minutos ± tolerancia_unidade`).

### 2.2 Modo Rígido (Abordagem Híbrida)
- **Cascata de Resolução de Horários Fofos/Fixos:**
  1. **Servidor (Personalizado):** Se o coordenador definiu horários específicos no cadastro do servidor (`intervalo_inicio_personalizado` / `intervalo_fim_personalizado`), estes prevalecem.
  2. **Jornada (Padrão):** Se não há personalização no servidor, o sistema utiliza o horário padrão cadastrado na Jornada (`intervalo_inicio_padrao` / `intervalo_fim_padrao`).
  3. **Cálculo Automático (Fallback):** Caso nenhum seja informado, o sistema calcula o meio da jornada $\pm$ metade da duração.
- **Tolerância:** Aplicada tanto na **saída** quanto no **retorno** contra o horário fixo determinado pela cascata.

---

## 3. Arquitetura e Decisão de 2 vs 4 Passos

A função RPC do banco de dados (`public.fn_confirmar_presenca`) determina o fluxo dinamicamente:

```
SE unidade.permite_marca_intervalo = FALSE
  OU jornadas.intervalo_minutos = 0 / NULL
  OU jornadas.horas_totais <= 4
ENTÃO → Fluxo de 2 passos (Entrada / Saída)
SENÃO → Fluxo de 4 passos (Entrada / Saída Int / Retorno Int / Saída Final)
```

---

## 4. Indicadores Visuais na Grade de Escala (ScaleGrid)

- **Unidade com Intervalo Desativado:** A barra de presença sob cada turno exibe **2 segmentos** (Entrada e Saída).
- **Unidade com Intervalo Ativo:** A barra de presença exibe **4 segmentos** (Entrada, Saída Int, Retorno Int, Saída Final).
- **Cores dos Segmentos:**
  - 🟩 **Verde (`bg-emerald-500`):** Batida confirmada.
  - 🟨 **Amarelo Pulsante (`bg-amber-400 animate-pulse`):** Etapa em andamento / servidor em expediente ou intervalo agora.
  - 🟥 **Vermelho (`bg-red-500`):** Horário ultrapassado sem batida (pendente/faltante).
  - 🔲 **Transparente:** Horário futuro programado.
- **Regra de Permissão (Trava de Segurança):**
  - Batidas manuais por coordenadores podem ser alteradas ou revertidas normalmente.
  - Batidas **reais efetuadas via terminal físico** são bloqueadas para edição/reversão por Coordenadores e reservadas **exclusivamente para Administradores e Super Admins**.

---

## 5. Estrutura do Banco de Dados (Migração SQL)

- **Tabela `unidades`**:
  - `permite_marca_intervalo BOOLEAN DEFAULT FALSE NOT NULL`
  - `tipo_intervalo TEXT CHECK (IN ('flexivel', 'rigido')) DEFAULT 'flexivel'`
  - `tolerancia_intervalo_minutos INTEGER DEFAULT 5 NOT NULL`
- **Tabela `jornadas`**:
  - `intervalo_inicio_padrao TIME NULL`
  - `intervalo_fim_padrao TIME NULL`
- **Tabela `servidores`**:
  - `intervalo_inicio_personalizado TIME NULL`
  - `intervalo_fim_personalizado TIME NULL`
- **Tabela `escala_diaria`**:
  - `presenca_intervalo_saida_em TIMESTAMP WITH TIME ZONE NULL`
  - `presenca_intervalo_retorno_em TIMESTAMP WITH TIME ZONE NULL`
  - `intervalo_nao_usufruido BOOLEAN DEFAULT FALSE`
  - `presenca_intervalo_saida_manual BOOLEAN DEFAULT FALSE`
  - `presenca_intervalo_retorno_manual BOOLEAN DEFAULT FALSE`
