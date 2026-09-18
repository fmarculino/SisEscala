# A batida que o sistema não enxerga

**17/09/2026 · v2.73.0**
Migrations `20260917140000`, `20260917150000`, `20260917160000`, `20260917170000`.
Plano: [`docs/planos/2026-09-17-batida-que-nao-alcanca-a-escala-certa.md`](../planos/2026-09-17-batida-que-nao-alcanca-a-escala-certa.md)

---

## Como começou

Três relatos no mesmo dia, todos com a mesma cara: **a célula está vazia e a pessoa bateu o
ponto.**

1. A saída não apareceu na célula do plantão do CCE/HMM.
2. *"Depois que excluí os registros da escala errada e lancei a certa, o Preencher pelas Batidas
   não enxerga mais as batidas reais."*
3. Um print do modal da THAYNA (mat 69051, dia 3): **sete batidas listadas** e a linha da escala
   vazia.

Um levantamento anterior, feito por outra ferramenta, tinha diagnosticado o primeiro caso e
executado a correção direto em produção. O diagnóstico estava certo no mecanismo. O resto não.

---

## O que a verificação mudou no diagnóstico

O mecanismo do caso 1 confere, e dá para apontar a linha: `fn_ingerir_afd` fecha o lote
reconciliando **apenas o `servidor_id` da marcação**
([20260915100000:298](../../supabase/migrations/20260915100000_abrangencia_do_relogio_estrutura.sql#L298)),
enquanto `fn_alocar_marcacoes_dia` já enxerga o cadastro irmão desde 09/09. **A leitura vê os dois
lados, a escrita vê um só.**

Mas quatro coisas estavam faltando ou erradas:

| o levantamento dizia | o que a medição mostrou |
|---|---|
| "não havia como consertar" | **Ferramentas → Preencher pelas Batidas** (v2.49.0) faz exatamente isso, pela tela |
| corrigir `fn_ingerir_afd` resolve | são **5 chamadores** com o mesmo laço, e o pior deles é o gatilho **inerte** da Fase 5, que vira o caminho principal quando ela ligar |
| estender a reconciliação ao irmão | ela escreve **sem `COALESCE`** — medindo os 425 pares candidatos: **10 ganhos contra 13 trocas e 4 perdas** |
| "a digital está sob a 53729" | era inferência. Confirmado: existe vínculo vigente no CCE-01 apontando para ela, e é a **porta de prioridade máxima** da resolução — o desempate por escala nunca chega a rodar |

E a reconciliação executada às 17:58 daquele dia gravou como saída oficial uma **batida de teste**.
Às 18:11 o coordenador tentou corrigir pelo modal de validação manual e **não teve efeito**:
`fn_aceitar_marcacao_pendente` usa `COALESCE(presenca_saida_em, …)` — não sobrescreve o que já
existe. O tratamento foi gravado, a linha foi tocada, o valor continuou 17:18.

> **A ferramenta não faltava. O que faltou foi olhar o que seria gravado antes de gravar.**

---

## O segundo defeito, flagrado ao vivo

O relato 2 tinha uma causa própria, e ela estava acontecendo **naquele momento**.

`fn_sincronizar_marcacoes_escala_diaria` grava um tratamento `desconsiderar` sempre que um UPDATE
**zera** um passo de presença. É o que torna a reversão durável. O trigger não sabe **por que** o
passo está sendo zerado — e são duas intenções opostas:

- *"o horário está errado"* → a batida **tem** de sair de circulação;
- *"a escala está errada e vou relançar o dia"* → a batida real não tem nada de errado.

Depois disso `fn_alocar_marcacoes_dia` filtra a marcação, e o *Preencher pelas Batidas* responde
**"Nada a preencher neste dia"**.

**THAYNA, 03/09/2026.** Duas linhas no dia: `Regular MT` (07:00→19:00) e `Plantão N` (19:00→07:00).
Hoje, **entre 15:46 e 15:47**, quatro batidas `rep` foram desconsideradas:

| batida | NSR | situação |
|---|---|---|
| 07:08 · 14:51 · 15:51 · 19:00 | 27134 · 125716 · 125728 · 27294 | **desconsideradas hoje** |
| 19:05 · 22:01 · 23:01 | 27329 · 27354 · 27365 | vivas |

São exatamente as sete do print. As quatro retiradas **são o turno Regular MT inteiro**. A linha do
MT ficou vazia, `reconciliado_em` **nunca**, e o plantão ficou com a saída gravada em **07:08 do
próprio dia 3** — doze horas antes da entrada. Com quatro das sete candidatas fora, a projeção
passou a propor trocar a entrada em 176 min e perder o intervalo, e o botão recusou. **Ele estava
certo em recusar. A mensagem é que não dizia que a causa era reversível.**

### E tinha piorado naquele dia

A `20260917110000`, aplicada horas antes, removeu a condição `confirmado_por_id IS NOT NULL` do
tratamento. Ela está **certa** para o defeito que foi corrigir — reverter não durava em 39,8% das
batidas `rep`. O efeito colateral é que aquelas mesmas 39,8% escapavam **por acidente** do
desconsiderar ao limpar a célula. Era isso que fazia o fluxo funcionar parte do tempo.

Curva de `desconsiderar` por dia: 10 · 14 · 5 · 4 · 22 · 70 · 19 · 26 · 25 · 10 · 66 · **247**.
Dos 247 de hoje, **47 são batidas `rep`**, em 14 servidores.

---

## O que foi construído

Decisão do usuário: **perguntar no modal E dar o botão de restaurar** — prevenir e remediar.

| migration | o quê |
|---|---|
| `140000` | `fn_batida_fisica`, `fn_batidas_retidas_dia`; a prévia e a aplicação **contam e dizem** as batidas retidas |
| `150000` | a reversão **pergunta o motivo**; o trigger poupa a batida física quando a intenção é declarada |
| `160000` | `fn_restaurar_batidas_dia` — devolve só o que a reversão **automática** tirou |
| `170000` | `fn_reconciliar_pessoa_dia` nos **três chamadores de máquina**, só em **acréscimo puro** |

### As linhas que não podem ser cruzadas

🚨 **"O trigger nunca desconsidera batida física" era a correção de uma linha, e está errada.** Ela
quebra a reversão intencional — batida de teste voltaria sozinha, que é o defeito que a
`20260917110000` acabara de fechar. A intenção precisa ser **declarada**.

🚨 **Só o que a reversão automática tirou volta pelo botão do coordenador.** Batida retirada por
decisão continua fora e só retorna pela correção de batida real (RH/admin). Um botão de
coordenador não desfaz uma decisão que alguém tomou olhando para o caso.

🚨 **O irmão só recebe acréscimo puro.** Os números acima (10 × 13 × 4) são a razão, e eles não são
ruído: há deslocamento de 285 e 301 minutos em passos de intervalo.

⚠️ **Restaurar e preencher são dois cliques.** Um clique só faria a correção entrar sem ninguém ver
o que entrou.

---

## O que os ensaios pegaram

Nenhum destes seria encontrado lendo o código:

- `information_schema.parameters` **não** expõe coluna de `RETURNS TABLE` de forma confiável — a
  conferência reprovou a função **já correta**. Conferência que reprova o certo é pior que
  conferência nenhuma. Passou a ler `pg_get_function_result`.
- `RAISE EXCEPTION 'a ' || 'b'` dá `42601`, só na execução do `CREATE`. A armadilha já estava
  escrita no `CLAUDE.md`, e foi cometida de novo.
- O `DROP` + `CREATE` da prévia devolveu a função a `PUBLIC`: **o recorte da cópia mecânica vai até
  o delimitador, e o `REVOKE` da fonte fica fora dele.**
- `chk_marcacao_rep_completa` e `chk_marcacao_ajuste_justificado` só aparecem na execução.
- 🚨 **O ensaio da Fase 3 passou pelo motivo errado na primeira versão**: usava origem `terminal`,
  e **só batida de relógio disputa entre irmãos**. Ensaio que "passa" sem exercitar o caminho real
  é pior que ensaio nenhum.

E um defeito de desenho pego antes de aplicar: o `LEFT JOIN` da contagem casava por
`(servidor, data)` e **duplicaria cada divergência** de quem tem duas escalas no mês.

---

## Estado

✅ **Aplicado e conferido em produção em 17/09/2026**, por `ver_batida_retida_producao.mjs`, que
**executa** as funções: **18 de 18**, incluindo o dia da THAYNA — que deixou de responder
"sem_mudança" mudo.

**Pendente:** o dia 17 da mat 68152 (a batida de teste ainda é a saída oficial) e a restauração
das batidas já retidas — 173 físicas, 20 dias com escala e passo vazio. O botão as alcança uma a
uma, pela grade.

---

## A lição que vale além destes dois defeitos

As duas metades andam juntas: **o sistema não decide sozinho, e quem decide não decide às cegas.**

A correção do primeiro caso sem a do segundo teria trocado um erro silencioso por outro. E a
reconciliação executada à mão, sem ensaio, gravou uma batida de teste numa folha de servidor
público — usando a mesma ferramenta que a tela já oferecia, e que teria feito a mesma coisa. O
problema nunca foi o acesso à ferramenta.
