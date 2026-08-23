# Turno Regular emendado com Plantão — a batida de transição

Medido em produção em 23/08/2026, competência **08/2026** (todas as folhas envolvidas em
`Rascunho`; 06 e 07/2026 estão fechadas e **não são tocadas por nada deste plano**).

Caso que originou: **AGNA CRISTINA RIBEIRO DO ROSÁRIO** (mat. 205, LACEM/LIMPEZA), jornada
`08H ÀS 14H` + Plantão `T` diário.

---

## 1. O que está acontecendo

### 1.1 O bloco funde, e sem batida na fronteira o par vai para as DUAS linhas

`fn_confirmar_presenca` funde turnos encostados num bloco só (armadilha 6). No dia da AGNA:

```
Regular M  08:00 → 14:00  ┐
                          ├─ bloco único 08:00 → 20:00
Plantão T  14:00 → 20:00  ┘
```

`fn_projecao_marcacoes_dia` grava o par entrada/saída do **bloco** em **todas** as linhas dele.
Com só duas batidas (08:03 e 18:02), as duas linhas ficam `08:03 → 18:02`. Daí os dois sintomas
que você viu, que são o mesmo defeito:

| onde | o que aparece | por quê |
|---|---|---|
| folha de ponto | `EXTRA 04:03 (50%)` | a linha **Regular** recebeu a saída das 18:02; jornada acaba 14:00 |
| anexo de plantões | plantão com `ENTRADA REAL 08:03` | a linha **Plantão** recebeu a entrada do expediente |

E o mesmo tempo físico é creditado duas vezes: **6h de jornada + 4h de extra + 6h de plantão =
16h para 10h trabalhadas.**

### 1.2 A defesa existe desde 19/08 e funciona — quando há batida na fronteira

A migration `20260819200000` deu a cada fronteira interna do bloco **dois slots opcionais** (a
saída do turno que fecha e a entrada do turno que abre). Medido na própria AGNA:

| dia | batidas | resultado gravado |
|---|---|---|
| 17, 18, 19, 20, 21 | 4 batidas, 2 na fronteira | Regular `08:02→14:01`, Plantão `14:06→18:02` ✅ |
| 3 | 3 batidas, 1 na fronteira | Regular `08:06→14:00` ✅, Plantão `08:06→20:00` ❌ |
| 10, 11, 12 | 2 batidas, nenhuma na fronteira | as duas linhas com `08:03→18:02` ❌ |

**Então sim: a sua lembrança está certa.** Hoje o sistema só sabe separar expediente de plantão
se a pessoa bater na transição.

### 1.3 A regra dos "5 minutos" — o número real é **1 minuto**

O que descarta a segunda batida é a janela de duplicidade da alocação:

```sql
rep_janela_duplicidade_segundos = 60   -- configuracoes_globais, valor medido em produção
```

Batida com **menos de 60 s** da anterior vira pendência `duplicada` e é descartada. Foi
exatamente isso no **dia 4**: duas batidas às `14:00:00` — a segunda descartada, e a entrada do
plantão ficou com as 07:46 do expediente. Nos dias que deram certo os intervalos foram de
**2 a 10 minutos**.

Ou seja: **esperar ~5 minutos é margem de segurança de uma regra que exige 1 minuto.** Funciona,
mas é folclore operacional, não regra escrita — e é frágil.

### 1.4 O que quebra tudo: o terminal RECUSA a saída dela

13 tentativas recusadas da AGNA em agosto. Todas as saídas:

```
05, 18:00  Fora da janela de presença permitida.   (4x no mesmo minuto)
06, 18:00  Fora da janela de presença permitida.
07, 18:00  Fora da janela de presença permitida.
10, 18:02  Fora da janela de presença permitida.
11, 18:01  ...  12, 18:00  ...  13, 18:02
```

O bloco prevê saída às **20:00**; ela sai às **18:00**. A batida vira marcação pendente (não se
perde), mas o servidor vê recusa — e nos dias 5, 6 e 7 ela desistiu: a folha diz
`REVISAR: SEM REGISTRO DE SAÍDA`.

⚠️ **`fn_confirmar_presenca` não tem os slots de fronteira.** A `20260819200000` alterou
`fn_blocos_previstos_dia`, `fn_alocar_marcacoes_dia` e `fn_projecao_marcacoes_dia` — **não** o
terminal. Num bloco sem intervalo o terminal só conhece 2 passos (entrada e saída), então uma
batida às 14:00 seria recusada do mesmo jeito. **Instruir o servidor a bater na transição, hoje,
é instruí-lo a levar recusa.**

### 1.5 A escala da AGNA não descreve o que ela faz

Nos dias com relógio (17 a 21), o plantão real foi de `14:06 → 18:02` ≈ **3h55**. O código
escalado é `T` = **6h**. O dia 4 já está como `T4` (4h) e fecha certo.

Não é bug de software: ou o código do plantão deveria ser `T4`, ou ela está saindo 2h antes.
**Decisão do coordenador/RH, não do sistema** — mas enquanto for `T`, o terminal vai continuar
esperando 20:00 e recusando a saída das 18:00.

---

## 2. Quanto isso custa hoje — 08/2026

### 2.1 Hora extra indevida

| | dias | horas |
|---|---:|---:|
| hora extra total em 08/2026 | 862 | 423h36 |
| **em dia que TEM plantão escalado** | **27** | **75h12** |

7 servidores: ANDRESA MELO (41h44), AGNA (13h41), DORILENE MELO (12h01), LUCAS REIS (6h00),
ICARO HENRIQUE (1h03), MAISA MIRANDA (0h37), ELIZABETH COELHO (0h06).

Decomposição do que corrige cada coisa:

| ação | dias | horas que somem |
|---|---:|---:|
| **só regerar a folha**, com o código de hoje | 8 | **47h48** |
| correção no banco (§3) | 4 | **18h03** |
| casos individuais (coordenador) | 15 | 9h21 |

⚠️ As **47h48** já estariam corrigidas: a folha é um *snapshot* jsonb e está **anterior ao
`turnosDaFolha`** (19/08/2026), que já exclui a linha de Plantão da consolidação. Nenhum SQL é
necessário para essa parte.

⚠️ **9 dos 27 dias têm campo de origem `manual`** — `preservacao.ts` os preserva por desenho.
Nem regeneração nem correção de banco os alcança; exigem ação do coordenador.

### 2.2 Alcance da correção de banco

Simulado sobre os **223 dias** de 08/2026 com bloco de 2+ turnos fundidos:

- **154 linhas** de `escala_diaria` mudam, em **17 servidores**
- na folha, **10 dias** mudam — **8 para melhor** (perdem extra indevida), 2 mudam por minutos
- **213 dias** de bloco fundido ficam **idênticos**
- em bloco `Regular + Extra` a folha é **neutra**: `turnosDaFolha` mantém as duas linhas e o
  `min(entrada)/max(saída)` dá o mesmo resultado

### 2.3 Achado colateral, fora do escopo deste plano

`fn_salvar_saida_bloco` — chamada por `fn_confirmar_presenca` — **fabrica** os horários de
transição do bloco a partir da escala (o próprio comentário dela diz "Esta funcao FABRICA os
horarios de transicao"). É o que faz a ANDRESA ter `Regular 08:01 → 12:00` sem nunca ter batido
às 12:00, e a folha exibir isso com origem **`real`**.

Em 08/2026 há **533 marcações `sintetica = true` com origem `terminal`**, 51 servidores, das quais
**244 já estão gravadas como horário de presença** em `escala_diaria`. Parte é backfill de
`20260808030000` (histórico), parte é fabricação viva. **Precisa de auditoria própria** — é
vedação 2 da Portaria 671/2021 (marcação automática com horário predeterminado), e é mais grave
que a hora extra.

---

## 3. A correção proposta

### C1 — passo do bloco só alcança a linha do turno dono  *(banco)*

Em `fn_projecao_marcacoes_dia`:

| passo do bloco | vai para |
|---|---|
| entrada | **só** a linha do **primeiro** turno do bloco |
| saída | **só** a linha do **último** turno do bloco |
| intervalo | só a linha do turno cuja janela contém o intervalo previsto |
| **fronteira** | continua indo para a linha específica dela (inalterado) |

É a mesma ideia que a `20260819210000` já aplica — *"a linha que tem batida de transição para de
herdar passo do bloco fora da sua janela"* — só que **sem exigir que exista batida de transição**.
Critério **posicional**, não por tolerância de horário: determinístico, sem número mágico novo.

Nada é fabricado. Sem batida na fronteira, a saída do Regular fica **vazia** e vira pendência
visível — que é a verdade: o sistema não sabe a que horas o expediente terminou.

### C2 — uma batida na fronteira serve aos dois lados  *(banco)*

Depois do DP, se um par de slots de fronteira tem **um preenchido e o irmão vazio**, espelhar a
mesma marcação para o irmão.

Precedente já registrado no `CLAUDE.md` (armadilha 6): *"batida de transição entre blocos
encostados aparecendo em dois passos é o caso vizinho e é desejado"*.

**Isto elimina a regra dos 5 minutos**: uma batida só na transição passa a fechar o expediente e
abrir o plantão. Duas batidas continuam valendo mais (dão o horário exato de cada lado) e não
regridem. Medido: **72 fronteiras** de 08/2026 seriam espelhadas.

### C3 — o terminal precisa aceitar a batida de transição  *(banco, alto risco)*

Levar os slots de fronteira para `fn_confirmar_presenca`, como a `20260819200000` fez do lado da
reconciliação.

⚠️ **É o item mais arriscado do plano** — armadilha 1: seis regressões reais já saíram de
`CREATE OR REPLACE` nessa função, cinco delas da mesma migration. Obrigatório: gerador com
contagem de ocorrências (`scratchpad/gen_*.js`), `diff` contra a versão vigente
(`20260822130000`) e conferência de que todos os guards continuam presentes.

⚠️ **Sem C3 a instrução operacional não funciona.** Com C3, a transição vira **verde** e o
servidor aprende a bater. Sem C3, ele vê recusa e para de bater — foi o que aconteceu nos dias
5, 6 e 7 da AGNA.

### C4 — reclassificar entre linhas do mesmo dia  *(a sua proposta)*

A peça já existe: **`fn_reclassificar_passo_presenca`** (`20260812150000`), com
arrastar-e-soltar no editor da folha. Limite documentado na própria migration:

> *"Origem e destino tem que ser passos da MESMA linha de escala_diaria - nao move entre
> turnos/categorias diferentes do mesmo dia."*

É exatamente esse limite que a sua proposta pede para levantar: mover a batida das 18:02 da
**saída do Regular** para a **saída do Plantão**, deixando a saída do expediente vazia para o
coordenador resolver.

Juridicamente é sólido e o projeto já aceitou o princípio: **não fabrica horário** — move um
horário **real** entre passos, com justificativa e rastro (Art. 82, parágrafo único, mesma base
de "Seleção da batida real", v1.26.0). `marcacoes_ponto` continua intocada.

Guards que precisam vir junto, replicando os da v1:
- só passo **vazio** no destino (sem troca);
- só batida **real** (`presenca_*_manual = false`);
- origem e destino no **mesmo dia e mesmo bloco** do mesmo servidor;
- competência **aberta**;
- guard de escopo dentro da própria RPC (armadilha 12 — tela filtrada não protege a RPC).

⚠️ **Mas C4 é o remédio residual, não a correção principal.** Se ele for a via principal, o
sistema continua produzindo 4h de extra indevida **por padrão** até alguém clicar, dia a dia,
servidor a servidor. Com C1, o caso da AGNA sai certo sozinho e o clique fica para a exceção.

### C5 — esqueceu de bater a entrada do plantão  *(a sua segunda pergunta)*

Esse caso **não** é reclassificação — não há batida real para mover. É **validação manual**, que
já existe e é o caminho certo: `fn_validar_presenca_manual` →
`fn_registrar_presenca_informada`, gravando o horário **informado** (não o derivado da jornada),
origem `ajuste_coordenador`, `sintetica = true`, com justificativa.

O que falta verificar antes de implementar: se o modal da grade alcança a **célula de PLANTÕES**
com escopo próprio (a categoria já é parâmetro de `fn_confirmar_presenca_manual`), e se ele
oferece as marcações pendentes daquele dia para seleção em vez de digitação.

---

## 4. Ajuste de agosto/2026 — ordem de execução

| # | ação | alcance |
|---|---|---|
| 1 | **Regerar/Sincronizar** as folhas dos 7 servidores afetados | −47h48 em 8 dias, **sem SQL** |
| 2 | Aplicar C1 + C2 em homologação, rodar `fn_conferir_reconciliacao` sobre 08/2026 | portão |
| 3 | Aplicar C1 + C2 em produção e reconciliar **só os 223 dias** de bloco fundido | −18h03 em 4 dias |
| 4 | Regerar as folhas de novo | leva a correção ao espelho |
| 5 | Coordenador trata os **9 dias com campo `manual`** e os 15 dias residuais | 9h21 |
| 6 | Corrigir a escala da AGNA (`T` → `T4`, ou justificar a saída às 18:00) | some a recusa diária |
| 7 | C3 e C4 entram depois, em migrations próprias | — |

**06/2026 e 07/2026 não são tocadas.** Nenhum passo acima alcança competência fechada.

⚠️ Reconciliar em massa é **proibido por decisão anterior** (memória
`nao-reconciliar-agosto-em-massa`): a projeção não é sempre melhor que o terminal. O passo 3 é
restrito aos dias de bloco fundido, que é onde C1/C2 mudam alguma coisa, e a lista sai da
simulação (`scratchpad/sim_fronteira.js`), não de um `UPDATE` por critério amplo.

---

## 5. Decisão tomada (usuário, 23/08/2026)

**Sem batida na transição, a saída do expediente fica VAZIA, com pendência de revisão.**

Descartado: fabricar o horário previsto e rotular como sintético. O sistema não marca ponto
sozinho com horário contratual — vedação 2 da Portaria 671/2021, e é o mesmo princípio já
registrado no `CLAUDE.md`: *"o sistema só preenche onde o servidor não tem como registrar"*.
Aqui ele tem como registrar; preencher é fabricar.

Consequência aceita: o dia 10 da AGNA passa a exibir `REVISAR: SEM REGISTRO DE SAÍDA` na linha
Regular, e o coordenador resolve. É trabalho a mais, e é a verdade.

⚠️ Isso **não** desfaz `fn_salvar_saida_bloco` — ela continua fabricando pelo caminho do
terminal (§2.3). Enquanto ela existir, o caso da ANDRESA continua saindo com `12:00` inventado.
Fica para a auditoria própria das 533 marcações sintéticas.

---

## Scripts de medição (só leitura, em `scratchpad/`)

| script | o que mede |
|---|---|
| `diag_agna.js` / `diag_agna2.js` / `diag_agna3.js` | o caso, batida a batida, com recusas |
| `diag_agna_proj.js <NOME>` | gravado × projetado hoje, por linha |
| `diag_fronteira_agosto.js` | dias de 08/2026 com 2+ turnos e o estado da fronteira |
| `diag_extra_vs_plantao.js` | hora extra em dia com plantão = dupla contagem |
| `sim_fronteira.js` | simula C1+C2 sobre `escala_diaria` |
| `sim_folha_efeito.js` | simula C1+C2 sobre a consolidação da folha |
| `sim_quadro_final.js` | folha atual × folha regerada |
| `diag_sinteticas_terminal.js` | marcações sintéticas de origem `terminal` |

⚠️ Todos paginam por `Range` **com `order=id`** (armadilha 8). Um deles rodou sem ordenação na
primeira versão e produziu contagem inflada — reconfira antes de citar número daqui.
