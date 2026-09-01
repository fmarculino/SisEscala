# PREFEITURA MUNICIPAL DE MARABÁ
## SECRETARIA MUNICIPAL DE SAÚDE — SMS
### NÚCLEO DE TECNOLOGIA DA INFORMAÇÃO — NTI
---
# MANUAL DE ORIENTAÇÃO OPERACIONAL
## Registro de Ponto Eletrônico, Tolerâncias Legais, Janelas de Presença e Transição de Escalas (SisEscala)

---

### 1. OBJETIVO
Este documento estabelece as diretrizes, regras técnicas, limites operacionais e tolerâncias legais aplicadas pelo sistema **SisEscala** no registro de frequência, apuração da folha de ponto e tratamento de escalas diferenciadas (Turnos Regulares, Plantões e Sobreavisos), em conformidade com a **Portaria MTP nº 671/2021**, a **CLT (Art. 58, § 1º e Art. 71)** e a jurisprudência consolidada do **Tribunal Superior do Trabalho (Súmula nº 366/TST)**.

---

### 2. LIMITES E JANELAS OPERACIONAIS NO REGISTRO DE PONTO

| Parâmetro Técnico | Limite / Configuração | Descrição e Regra de Aplicação |
|---|:---:|---|
| **Janela de Presença no Terminal** | **± 30 minutos** | Margem permitida para registro no terminal web/quiosque.<br>• *Exemplo (Turno das 07:00)*: Janela aberta das **06:30 às 07:30**.<br>• Batidas antes das 06:30 ou após as 07:30 são recusadas por segurança como *"Fora da janela de presença permitida"*. |
| **Deduplicação de Batidas Consecutivas** | **60 segundos** | Batidas no mesmo relógio físico efetuadas em menos de 1 minuto são registradas como duplicadas e não avançam os passos seguintes da escala (evita toque acidental repetido). |
| **Guarda de Intervalo Mínimo** | **60 minutos** | A saída para repouso/alimentação só pode ser registrada após decorrida **no mínimo 1 hora de trabalho** desde a entrada, impedindo que batidas repetidas na chegada queimem os horários de almoço. |

> **Caso Prático (Entrada às 07:17 para turno das 07:00):**
> O terminal aceita a batida normalmente porque 07:17 está dentro da janela de presença permitida (06:30 às 07:30). No entanto, como a variação excedeu o limite legal de 5 minutos, a apuração da folha aponta os 17 minutos de atraso até que haja a validação/abono pelo coordenador.

---

### 3. TOLERÂNCIAS LEGAIS NA APURAÇÃO DA FOLHA DE PONTO (CLT Art. 58, § 1º)

A legislação trabalhista e o sistema SisEscala adotam o critério de **limiar de tolerância** (e não franquia):

```
┌────────────────────────────────────────────────────────────────────────┐
│  • Limite Máximo por Marcação Isolada: até 5 minutos                  │
│  • Limite Máximo Diário (Soma das Variações): até 10 minutos          │
└────────────────────────────────────────────────────────────────────────┘
```

#### Aplicação Prática:
1. **Dentro da Tolerância (Variação ≤ 5 min / Diária ≤ 10 min)**:
   - As variações não são descontadas como atraso nem computadas como hora extraordinária.
   - *Exemplo*: Entrada às 07:04 e Saída às 13:04 -> **0 de atraso e 0 de hora extra**.
2. **Fora da Tolerância (Súmula 366 do TST)**:
   - Ultrapassado o limite, **a totalidade do tempo é computada**.
   - *Exemplo 1*: Entrada às 07:17 (17 minutos após o previsto) -> O sistema aponta **17 minutos de atraso**, necessitando de justificativa do servidor e validação do coordenador.
   - *Exemplo 2*: Saída às 13:12 (12 minutos após o previsto) -> O sistema aponta **12 minutos de hora extra** (e não apenas 12 - 10 = 2).

---

### 4. REGRAS PARA TRANSIÇÃO DE TURNOS EMENDADOS (REGULAR + PLANTÃO/EXTRA)

Quando o servidor possui jornada mista no mesmo dia (por exemplo, **Expediente Regular das 07:00 às 13:00** seguido de **Plantão/Extra das 13:00 às 19:00**):

```
  [07:00 Entrada Regular]  ───────►  [13:00 Fronteira de Transição]  ───────►  [19:00 Saída Plantão]
         (Turno 1: 6h)                           (Troca de Turno)                     (Turno 2: 6h)
```

#### 📌 Como o Servidor Deve Proceder no Relógio de Ponto:

1. **Procedimento Padrão Recomendado (2 Batidas na Troca)**:
   - **1ª Batida (às 13:00)**: Registra a **Saída do Turno Regular**.
   - **Aguardar 1 a 2 minutos** (para respeitar a janela de deduplicação).
   - **2ª Batida (às 13:01 ou 13:02)**: Registra a **Entrada do Plantão**.

2. **Tratamento Inteligente para Batida Única (Espelhamento Automático)**:
   - Se o servidor bater **apenas 1 vez na transição** (ex.: às 13:00):
   - O SisEscala aplica a regra de **espelho de batida de transição**, utilizando a mesma marcação para fechar o turno Regular e abrir o Plantão simultaneamente, sem gerar falta nem prejuízo de carga horária.

3. **Caso de Esquecimento da Batida de Transição (Bateu apenas às 07:00 e 19:00)**:
   - O sistema aloca as batidas nas pontas (07:00 na entrada do Regular e 19:00 na saída do Plantão).
   - O coordenador da unidade deve acessar a **Grade de Escalas** ou a **Fila de Justificativas** e realizar a **Validação Manual** inserindo o horário das 13:00 na transição com a justificativa motivacional: *"Cumprimento contínuo de escala emendada com plantão"*.

---

### 5. FLUXO DE JUSTIFICATIVAS E VALIDAÇÃO PELO COORDENADOR

```
   ┌─────────────────────────────────────────────────────────────┐
   │ 1. Ocorrência de divergência ou atraso (ex: batida 07:17)  │
   └──────────────────────────────┬──────────────────────────────┘
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ 2. Servidor ou Coordenador informa justificativa na Fila   │
   │    (/justificativas ou no modal de validação da escala)     │
   └──────────────────────────────┬──────────────────────────────┘
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ 3. Coordenador analisa e aprova a justificativa             │
   └──────────────────────────────┬──────────────────────────────┘
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ 4. Ocorrência regularizada: folha de ponto e Anexo Oficial  │
   │    são emitidos com o texto motivacional comprobatório      │
   └──────────────────────────────┘
```

---

### 6. RESUMO DE ORIENTAÇÃO RÁPIDA PARA OS SERVIDORES

**Checklist para o Servidor:**
- **Horário de Chegada:** Procure bater o ponto dentro da tolerância de até **5 minutos** do horário previsto para evitar débitos na folha.
- **Confirmação:** Não encoste o dedo repetidamente em menos de 1 minuto; aguarde a mensagem sonora/visual de confirmação do relógio.
- **Turno Emendado:** Ao término do expediente normal (ex.: 13h) para início do plantão, bata o ponto na saída e novamente 1 minuto depois para registrar o início do plantão.
- **Divergências:** Caso ocorra atraso justificado ou esquecimento, informe imediatamente a coordenação para registro na Fila de Justificativas antes do fechamento mensal da folha.

---
*Documento emitido para fins de padronização operacional dos setores e unidades da Secretaria Municipal de Saúde de Marabá — PA.*
