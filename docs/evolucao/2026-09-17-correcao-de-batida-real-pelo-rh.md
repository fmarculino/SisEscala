# Correção de batida real pelo RH, e falta em plantão que tem registro

**Data:** 17/09/2026 · **Versão:** 2.72.0
**Plano:** [`docs/planos/2026-09-17-correcao-de-batida-real-pelo-rh-e-falta-em-plantao.md`](../planos/2026-09-17-correcao-de-batida-real-pelo-rh-e-falta-em-plantao.md)

---

## 1. Como começou

Dois relatos do usuário no mesmo dia:

1. *"A Jessica bateu várias vezes e o sistema se perdeu. O RH tenta corrigir e não consegue —
   só o administrador pode."*
2. *"Uma pessoa estava de plantão MT e carga N. Faltou ao plantão, mas chegou muito cedo e bateu
   ainda no horário do plantão. O sistema acatou como saída do plantão, e o coordenador não
   consegue nem justificar e colocar a falta porque houve batida real."*

O segundo caso tinha nome e data: **EUZILENE DA SILVA RAMOS (mat. 68216), 12/09/2026**.

---

## 2. O que a medição mostrou

### 2.1 O caso EUZILENE, inteiro

Escala do dia: **Plantão `MT` 07:00→19:00** + **Regular `N` 19:00→07:00** (jornada `19H ÀS 07H`).
Cinco batidas, todas origem `rep`, todas no mesmo dispositivo:

| hora local | NSR | onde o sistema gravou |
|---|---|---|
| **12/09 18:21** | 29601 | **saída do Plantão `MT`** ← a batida antecipada |
| 12/09 19:24 | 29647 | entrada do Regular `N` |
| 12/09 21:03 | 29656 | saída do intervalo do `N` |
| 12/09 22:01 | 29662 | retorno do intervalo do `N` |
| 13/09 06:59 | 29710 | saída do `N` |

A batida das 18:21 está a **39 min** do slot "saída do MT", e `rep_tolerancia_alocacao_minutos`
é **360**. O DP prefere casar a não casar (custo de não casar = tolerância × 2). **O alinhamento
fez exatamente o que foi projetado para fazer** — e é por isso que a correção tinha de ser
humana e assistida, não uma mudança no algoritmo.

A linha do plantão ficou com **entrada NULL, saída 18:21, `presenca_confirmada = true`,
`confirmado_por_id = NULL`**.

### 2.2 Duas descobertas que mudaram o diagnóstico

🚨 **Declarar falta naquele plantão JÁ ERA POSSÍVEL.** Ele está `em_avaliacao` ("Sem registro de
entrada"), e `fn_desfecho_evento_dia` diz, em código e em comentário, que o desfecho explícito
vence tudo, *"inclusive o ponto completo"*. O que faltava era **caminho**: quem vê o problema
está na grade, e a grade não levava até a fila. A prova está no número — **1 falta registrada em
toda a história do sistema**, contra 130 validados.

🚨 **O buraco de verdade é o plantão `registrado`** (os dois extremos preenchidos): ali a fila
nem oferecia a decisão. São **1.286** em 09/2026, contra 264 `em_avaliacao`. Bastaria ela ter
batido duas vezes e não haveria saída nenhuma.

### 2.3 Extensão (09/2026, dias passados, paginado por `Range`)

| medida | valor |
|---|---|
| linhas com apenas um extremo (entrada XOR saída) | **1.136** |
| destas, só saída — a assinatura do caso | **511**, sendo 469 de origem `rep` |
| **padrão exato da EUZILENE** (uma linha só com saída + outra completa no mesmo dia) | **46** |
| contas que passavam no gate da grade | **5** (2 `super_admin` + 3 `admin`) |
| contas de RH bloqueadas | **18** (8 `rh` + 10 `rh_unidade`) · 124 coordenadores |

---

## 3. Os quatro defeitos que a investigação encontrou

Nenhum deles estava no relato. Todos apareceram ao ler o caminho inteiro.

### D1 — reverter não limpava `origem` nem `marcacao_id`, e descartava o autor

`fn_reverter_presenca_manual` é de `20260804040000`; as colunas `presenca_*_origem` e
`presenca_*_marcacao_id` nasceram quatro dias depois, em `20260808020000`. Ela **nunca aprendeu
que existiam**.

Consequência: reverter e escolher outra batida gravava o horário novo com o `marcacao_id` e a
origem ANTIGOS (`fn_aceitar_marcacao_pendente` usa `COALESCE`). E ela recebia `p_validador_id`
sem gravá-lo em lugar nenhum — o mesmo defeito que `fn_aceitar_marcacao_pendente` tinha com
`v_servidor` antes de `20260812160000`.

### D2 — apagar batida real era o único ato sem justificativa

No handler da grade, `isReverting` pulava todas as validações. Num projeto onde trocar turno em
dia com ponto exige justificativa e apagar vigência de jornada exige motivo, **apagar o horário
que o servidor realmente bateu não exigia nada**.

### D3 — 🚨 a reversão não durava em 40% dos casos

O que dá durabilidade é o `desconsiderar` gravado por `fn_sincronizar_marcacoes_escala_diaria`.
O `INSERT` vivia sob:

```sql
IF NEW.confirmado_por_id IS NOT NULL OR OLD.confirmado_por_id IS NOT NULL THEN
```

**Batida de relógio nunca validada à mão tem `confirmado_por_id` NULO** — é o caso da linha da
EUZILENE. Medido: **4.471 de 11.242 linhas (39,8%)** com saída de origem `rep`. Nelas, reverter
limpava a tela e a batida voltava sozinha na reconciliação seguinte.

Dois defeitos menores no mesmo bloco: casava por `(servidor, ocorrido_em)` — alcançando qualquer
marcação daquele instante, de qualquer origem — e o `NOT EXISTS (tipo = 'desconsiderar')` impedia
regravar depois de um `restaurar`.

### D4 — 🚨 `reclassificar_passo` e `vincular_escala` não eram honrados por ninguém

Existem no `CHECK` desde `20260808000000`, e `fn_aceitar_marcacao_pendente` **grava**
`vincular_escala` a cada aceite. `fn_alocar_marcacoes_dia` só consultava tratamento para
`desconsiderar`.

Ou seja: **havia uma única alavanca durável — retirar.** E a reconciliação sobrescreve sem dó:
`fn_reconciliar_marcacoes_dia` faz `SET presenca_* = p.*` **sem `COALESCE`**.

> 🚨 **Regra transferível: correção sobre dia com batida de relógio só é durável se for expressa
> como TRATAMENTO.** Escrever em `escala_diaria` é escrever no cache.

---

## 4. O que foi construído

### Fase 0 — a base (`20260917100000`, `20260917110000`, `20260917120000`)

| migration | o quê |
|---|---|
| `20260917100000` | reverter limpa os três campos do passo **e grava quem reverteu** |
| `20260917110000` | `fn_marcacao_desconsiderada` (fonte única) + o trigger deixa de depender de `confirmado_por_id`, casa por `marcacao_id` e alterna com `restaurar` |
| `20260917120000` | a alocação **fixa** o passo declarado por tratamento |

🚨 **A fixação age POR CIMA do DP, nunca dentro dele.** O alinhamento é monotônico; furar um slot
no meio desalinharia todo o resto. O DP roda exatamente como hoje e depois o juízo explícito
sobrescreve o vencedor do slot — e o gerador confere que as ocorrências do custo de não-casar
continuam idênticas.

### Fase 1 — `fn_corrigir_passos_com_batidas` (`20260917130000`)

Recebe o **conjunto final** dos passos do dia e resolve tudo numa transação: grava
`reclassificar_passo` para as batidas designadas, `desconsiderar` para as retiradas, e aplica em
`escala_diaria` **sem `COALESCE`**. Nunca digita horário.

A matriz de papéis vive em `src/utils/folha/correcaoBatidaReal.ts`, espelhada no banco por
`fn_pode_corrigir_batida_real`:

| papel | passo vazio | trocar/retirar batida real | digitar por cima de batida real |
|---|---|---|---|
| `super_admin` · `admin` | ✅ | ✅ | ✅ |
| `rh` · `rh_unidade` | ✅ | ✅ **(novo)** | ❌ |
| `coordenador` · `ass_adm` | ✅ | ❌ | ❌ |

### Fase 2 — a tela

`CorrecaoBatidaModal`, aberto ao clicar no segmento verde de um passo com batida real. Mostra
todas as batidas do dia, **a distância de cada uma do previsto** e **onde cada uma está hoje** —
inclusive as que ocupam outro passo, que a tela antiga escondia como "horário já utilizado" e
que são justamente as que interessam na rajada.

### Fase 3 — falta em plantão registrado

`pedeDecisaoDeDesfecho` passou a incluir `registrado`. Falta contra o ponto exige confirmação
explícita (`exigeConfirmacaoContraRegistro`), validada **no servidor**, com `temRegistro` lido da
linha de escala e nunca do cliente. E a célula da grade ganhou o selo `F`/`V`.

---

## 5. Três decisões que a medição mudou no meio do caminho

### 5.1 🚨 Honrar `vincular_escala` teria mexido em 92 pontos de uma vez

A primeira versão do D4 honrava os dois tipos. Medindo antes de aplicar: **1.686 tratamentos
`vincular_escala` em produção**, 1.437 vigentes — e **92 DISCORDAM** do que está gravado hoje em
`escala_diaria`, incluindo competências fechadas e folhas revisadas.

`reclassificar_passo` tinha **ZERO** ocorrências. Honrar só ele é o corte, **sem data mágica
nenhuma**, e é o tipo semanticamente certo: o comentário do `CHECK` original já o define como
"força entrada/int_saida/int_retorno/saida".

### 5.2 🚨 `now()` não desempata — e quem achou isso foi o ensaio

A conferência da `20260917110000` falhou com *"restaurar não desfez o desconsiderar"*. Causa:
`created_at` tinha `DEFAULT now()`, que é o instante da **transação**. Dois tratamentos da mesma
marcação gravados juntos ficam com `created_at` idêntico — e como o predicado procura um
`desconsiderar` entre os empatados, **o desconsiderar vence sempre**.

Passou a `clock_timestamp()`. Conferido em produção que não há empate no histórico (2.795
tratamentos, 6 `restaurar`, **zero** pares `(marcação, created_at)` repetidos).

> **Isso não teria sido encontrado lendo o código.** Foi a conferência que EXECUTA (armadilha 42)
> que o expôs, e num cenário que parecia trivial.

### 5.3 A ordem cronológica recusou a primeira tentativa de ensaio

O ensaio inicial tentava inverter entrada e saída, e a RPC recusou: *"As batidas escolhidas ficam
fora de ordem"*. O guard funcionou como projetado — e o ensaio é que estava errado. Refeito para
o caso real (retirar a batida), passou inteiro.

---

## 6. Validação em homologação

| ensaio | resultado |
|---|---|
| D1 — reverter limpa os 3 campos, grava o autor, e **não** toca na entrada | ✅ (revertido) |
| D3 — reverter linha com `confirmado_por_id` NULO grava o tratamento; `restaurar` alterna | ✅ |
| D4 — fixação aplicada, `desconsiderar` posterior vence, `restaurar` devolve | ✅ |
| D4 — **fixação sobrevive a DUAS reconciliações** | ✅ |
| Fase 1 — matriz de papéis, 9 asserções | ✅ |
| Fase 1 — **caso EUZILENE com sessão de RH simulada**: retirar → passo vazio → 2 reconciliações → marcação preservada e desconsiderada | ✅ |
| Fase 1 — coordenador recusado com `insufficient_privilege` | ✅ |

⚠️ Não havia perfil `rh` em homologação: o ensaio troca o papel de um perfil existente **dentro
da transação revertida**.

---

## 7. Portões

| portão | cobertura |
|---|---|
| `scratchpad/sim_correcao_batida_real.js` | **64 asserções** — matriz de papéis, os dois vocabulários de origem, a ação derivada do estado do passo, as recusas com caminho, e a Fase 3 inteira |
| `scratchpad/val_sim_correcao_batida_real.js` | **8 regressões injetadas, 8 reprovadas** |
| `scratchpad/sim_manual.js` | 972 asserções (manual atualizado no mesmo commit) |

As regressões injetadas incluem: RH voltando a digitar sobre batida real, RH perdendo o
rearranjo, coordenador ganhando-o, `ehBatidaReal` deixando de reconhecer o vocabulário da folha,
a fila voltando a não oferecer falta em `registrado`, e a confirmação contra o ponto sumindo.

---

## 8. O que NÃO foi feito, e por quê

| ideia | por que não |
|---|---|
| apagar a marcação errada | `marcacoes_ponto` é INSERT-only e é o artefato legal |
| baixar `rep_tolerancia_alocacao_minutos` | medido em 19/08/2026: fecha a brecha e desliga `ignora_janela_presenca` |
| mexer no custo do DP | simulado e descartado em 19/08/2026 (corrige 2, quebra 3 dias saudáveis) |
| recusar "saída sem entrada" estruturalmente | são **511 linhas** em 09/2026, a maioria gente que só esqueceu de bater a entrada |
| deixar o RH digitar horário sobre batida real | vedação 4 da Portaria 671/2021 pela porta do RH |
| corrigir os 46 casos de 09/2026 | **Fase 4, ainda não feita** — exige lista fechada com ensaio antes/depois (armadilha 46) |

---

## 9. Pendente

- **Fase 4:** o mutirão dos 46 casos de 09/2026, por lista fechada com ensaio campo a campo.
  08/2026 fica de fora (competência fechada).
- **Aplicação em produção** das quatro migrations.
- ⚠️ `fn_alocar_marcacoes_dia` mantém o predicado de `desconsiderar` **inline**, por desempenho,
  enquanto o trigger usa `fn_marcacao_desconsiderada`. São espelhos: ao mudar a regra, mude os
  dois.
