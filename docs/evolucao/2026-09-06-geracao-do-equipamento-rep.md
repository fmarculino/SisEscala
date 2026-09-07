# A geração do equipamento: trocar o relógio deixa de descartar batida em silêncio

**06/09/2026 · v2.46.0 · coletor v0.16.0**
Plano: [`docs/planos/2026-09-06-troca-de-relogio-e-ciclo-de-vida-do-cadastro-rep.md`](../planos/2026-09-06-troca-de-relogio-e-ciclo-de-vida-do-cadastro-rep.md) (Prioridades 0 e 1a)

---

## 1. Antes de tudo: uma correção do que eu mesmo tinha escrito hoje de manhã

O balanço da semana listou **"Desfecho de plantão e sobreaviso — plano 23/08, nada implementado"**
como uma das duas pendências críticas. **Está errado, e o erro tem uma causa que vale registrar.**

Eu li o cabeçalho do plano — *"Status: plano, nada implementado"* — e tratei como estado atual.
O cabeçalho é de 23/08. **As fases 0 a 5 saíram em 24/08/2026**, no dia seguinte, nas versões
v2.15.0 → v2.17.2, com as migrations `20260824100000`, `110000`, `120000`, `140000` e `160000`.

Conferido no código, não no documento:

| onde | o que tem hoje |
|---|---|
| `RelatorioPlantaoSobreavisoAnexo.tsx` | `ehCumprido`, três subtotais, coluna Situação |
| `/relatorios/plantao-sobreaviso` | consome `fn_desfecho_eventos_escalas`; `plantaoHours` passou a ser cumprido |
| `/justificativas` | decisão de desfecho no modal |
| Configurações | a chave `desfecho_obrigatorio_fechar`, com aviso |

Os "65% das horas sem prova" foram fechados há duas semanas.

⚠️ **É exatamente a armadilha que o `CLAUDE.md` documenta sobre ele mesmo** — as "103 marcações de
intervalo" que eram 7. Cabeçalho de plano é uma foto do dia em que foi escrito, e este projeto
implementa rápido demais para que isso envelheça bem. **A fonte de verdade sobre o que está
pronto é o código e o `CHANGELOG`, nunca o campo `Status:` de um plano.**

O que de fato continua aberto no desfecho é menor e diferente: a chave
`desfecho_obrigatorio_fechar` **nasceu desligada e continua desligada**, porque ligá-la travaria o
fechamento de 08/2026 com ~210 eventos — e a maior parte deles não é conduta, é a batida de
transição que o terminal recusa (armadilha 6: `fn_confirmar_presenca` não tem os slots de
fronteira que `fn_blocos_previstos_dia` ganhou em 19/08). Esvaziar essa fila é atacar a causa,
não o gate.

---

## 2. O que esta entrega resolve

O REP do **CCE (HMM)** queimou e foi trocado por um equipamento novo, mesmo IP e mesma senha. O
diagnóstico de 06/09 já tinha destravado o **cadastro** (35 vínculos encerrados, 35 reenviados,
35 gravados, 0 falhas). Faltava a metade que ninguém tinha visto: **a batida do relógio novo não
estava chegando, e nada reclamava.**

### 2.1 O cursor travado

`fn_cursor_afd_dispositivo` devolve o fim do primeiro trecho contíguo de NSR, mais 1. Para o
CCE isso era **111.509** — do equipamento **anterior**. O relógio novo, cujo AFD recomeça no NSR
1, responde que não tem nada a partir dali.

E aí o modo de falha: `get_afd.fcgi` devolve vazio, `fn_ingerir_afd` processa zero linhas com
sucesso, e a sincronização é gravada como **`concluida`**. Todo ciclo, a cada 5 minutos.
**Sintoma: nenhum.** A tela mostra um relógio saudável, com contato recente, sincronizando.

### 2.2 E se a batida chegasse, seria pior

`uq_afd_dispositivo_nsr` e `uq_marcacao_rep_nsr` eram `(dispositivo_id, nsr)`. Os NSR 1..N do
equipamento novo colidiriam com os do antigo, e o `ON CONFLICT ... DO NOTHING` os descartaria
**como duplicados**. Sem erro, sem log, sem contagem — a batida some entre o equipamento e o
banco.

Nada se perde de verdade enquanto o AFD estiver no relógio. Mas o relógio tem memória finita, e
ninguém está olhando.

---

## 3. O modelo: uma coluna que diz QUAL equipamento disse aquele número

| peça | o que faz |
|---|---|
| `dispositivos_rep.geracao_atual` | qual aparelho está naquele ponto agora |
| `rep_afd_registros.geracao` · `marcacoes_ponto.geracao` | qual aparelho emitiu aquele NSR |
| `uq_afd_dispositivo_geracao_nsr` · `uq_marcacao_rep_geracao_nsr` | a unicidade passa a ser `(dispositivo, geracao, nsr)` |
| `fn_cursor_afd_dispositivo` | conta **dentro** da geração vigente — geração nova cai para 1 sozinha |
| `fn_ingerir_afd` | grava a geração, e encadeia o hash **dentro** dela |
| `fn_registrar_marcacao` | **deriva** a geração do dispositivo |
| `fn_registrar_substituicao_dispositivo` | incrementa a geração, guarda o que a anterior deixou |
| `dispositivos_rep_substituicoes` | histórico append-only, sem policy de escrita |

### 3.1 `nsr` continua sendo o que o equipamento disse

A alternativa considerada — um `nsr_offset` por dispositivo, que evitaria reconstruir dois
índices sobre ~2,5M e ~2,4M linhas — foi **descartada**. `linha_bruta` ficaria intacta, mas a
coluna `nsr` passaria a mentir para qualquer auditoria que a leia. Num artefato que existe para
ser prova legal, isso não é otimização, é falsificação.

### 3.2 A cadeia de hash não pode atravessar equipamentos

`fn_ingerir_afd` busca o último elo com `ORDER BY nsr DESC LIMIT 1`. Sem filtrar por geração, o
primeiro registro do relógio novo encadeia no último do relógio velho — e a cadeia passa a
afirmar uma continuidade que **nunca existiu**, num campo cuja única função é provar sequência.

### 3.3 O SisEscala não troca a geração sozinho

Detectar substituição automaticamente é palpite: o equipamento pode só ter tido a memória lida
errado num ciclo. E incrementar a geração por engano cria um AFD paralelo que ninguém pediu.
Quem troca é **uma pessoa**, pelo botão "Trocamos o aparelho" no modal do dispositivo, com
motivo obrigatório, e fica registrado com o nome dela.

🚨 **Ordem em campo: registre a troca ANTES de ligar o aparelho novo na rede.** Um lote já em voo
do equipamento novo, coletado antes do registro, entraria na geração anterior e colidiria — que
é exatamente o descarte silencioso que isto resolve. É a única parte irreversível, e está escrita
na própria tela e no manual.

### 3.4 Por que `fn_registrar_marcacao` NÃO ganhou parâmetro

Assinatura nova é objeto novo (armadilha 41): exigiria `DROP` da de 16 argumentos, e **14
migrations a chamam por posição**. Derivar a geração de dentro da função tem, além disso, a
propriedade que este projeto prefere: **nenhum chamador futuro pode esquecer de passar**.

---

## 4. A metade do transporte: "li e havia zero" ≠ "não consegui ler"

A causa raiz do lado do cadastro era a guarda `IF v_total > 0` de
`fn_registrar_snapshot_usuarios_dispositivo` — o `DELETE` do snapshot roda **antes** dela, então
o relógio zerado esvaziava o snapshot e **não encerrava vínculo nenhum**.

🚨 **A guarda não sai, e isso não é conservadorismo.** A rota cai para `[]` quando o corpo vem
malformado, e encerrar os vínculos de uma unidade inteira por um POST torto é muito pior que o
bug do CCE.

✅ **A informação que separa os dois casos sempre existiu no coletor e era jogada fora no
transporte.** `ListarUsuarios()` que falha faz `return` e nunca publica; quem publica `[]` leu o
equipamento e achou zero. Desde a v0.16.0 o payload diz isso (`leitura_ok`), e a guarda vira
`IF v_total > 0 OR p_leitura_ok`.

| defesa | por quê |
|---|---|
| `body?.leitura_ok === true`, comparação **estrita** | campo ausente, `"true"`, `1`, `null` e corpo torto viram `false` e preservam o comportamento de hoje |
| `p_leitura_ok boolean DEFAULT false` | segura a janela migration → deploy: a rota antiga manda 2 argumentos e resolve na função nova |
| `leituraOK bool` **explícito** na assinatura Go | uma constante escondida dentro do client faria um chamador futuro afirmar "leitura boa" sem ter lido nada |
| a guarda dos **15 minutos** continua | protege a corrida entre ler o relógio paginado e publicar o snapshot, e vale também com leitura vazia |

E `dispositivos_rep.usuarios_lidos_em` / `usuarios_lidos_total` passam a guardar o rastro: sem
eles, leitura boa que devolve zero não deixa marca nenhuma, e "nunca ninguém leu" fica
indistinguível de "leu e o relógio está vazio" — que era exatamente por que a tela do CCE
continuava afirmando que os 35 estavam lá.

---

## 5. A janela de deploy, e o andaime que ela obrigou

⚠️ **O push na `main` dispara o deploy sozinho; a migration é aplicada à mão.** Entre um e outro,
a rota chamaria uma função de 3 argumentos que ainda não existe, e **todo snapshot de todo relógio
do parque falharia com 500** — a higiene e a Cobertura de Ponto parariam de ser atualizadas do
lado que ninguém olha.

A rota faz um retry sem o parâmetro quando o erro indica assinatura ausente, reproduzindo o
comportamento anterior. O erro é **registrado**, não engolido: se a linha aparecer no log depois
de a migration ter sido aplicada, é sinal de que ela não foi aplicada de verdade.

**É andaime, não desenho.** Remover assim que `20260906130000` estiver em produção.

---

## 6. Como isto foi construído, e o que os portões pegaram

As três funções vivas foram **copiadas** da migration vigente de cada uma por
`scratchpad/gen_geracao_dispositivo.js`, com substituições contadas que abortam na divergência —
e as fontes não eram as que o nome sugere:

```
fn_cursor_afd_dispositivo  -> 20260817160000 (não a 20260817150000, que ela corrigiu)
fn_registrar_marcacao      -> 20260808070000
fn_ingerir_afd             -> 20260822210000 (não a 20260808080000 nem a 20260818200000)
```

O `diff` de cada função contra a fonte foi conferido linha a linha: **6 mudanças em
`fn_ingerir_afd`, 4 em `fn_registrar_marcacao`, 1 em `fn_cursor_afd_dispositivo`**, e nada mais.

### O que os portões acharam durante a construção

| achado | como apareceu |
|---|---|
| **Um índice de 2,5M linhas construído para nada** | a constraint `(dispositivo_id, geracao, nsr)` já é um btree e serve as duas consultas quentes, inclusive a leitura `DESC` do último elo. O índice DESC dedicado saiu antes de existir |
| **Uma asserção minha mal escrita** | `naoContem('geracao_atual + 1')` reprovava a própria RPC de substituição, que é o único lugar onde o incremento **deve** existir. Virou "a migration não cria gatilho nenhum" + "o incremento aparece exatamente uma vez, e depois da RPC" |
| **Três regressões que não regrediam** | o validador injetava substituições multilinha com `\n` contra arquivos em **CRLF** — três no-ops silenciosos. O guard da armadilha 48 pegou os três; sem ele, o "teste do teste" teria passado mentindo |

Portões: `node scratchpad/sim_geracao_dispositivo.js` (48 asserções — a Parte A afirma
invariantes sobre o **SQL realmente gerado**, a Parte B simula o algoritmo do cursor) e
`node scratchpad/val_sim_geracao_dispositivo.js`, que injeta **8 regressões e exige reprovação
nas 8**.

---

## 6b. O que a primeira execução real pegou, e nenhum portão pegaria

`fn_registrar_substituicao_dispositivo` escrevia **`ultimo_nsr = NULL`**, e a coluna é
`bigint NOT NULL DEFAULT 0` desde `20260808000000`. Morreu com `23502` na primeira vez que alguém
a chamou de verdade.

A intenção estava certa — manter o `ultimo_nsr` com o máximo da geração anterior faria a tela
afirmar que o aparelho novo já coletou 111 mil linhas. O **valor** é que estava errado: "nada
ainda" nesta tabela sempre foi **zero**, e o próprio `DEFAULT` da coluna dizia isso. Eu escrevi
`NULL` sem ler a definição.

⚠️ **É a armadilha 1 na forma mais pura, e é importante entender por que nenhum portão pegaria.**
plpgsql resolve nome de coluna e restrição só na **execução do statement**:
`CREATE OR REPLACE FUNCTION` aceitou a função feliz da vida, `tsc`, `build` e `lint` não veem SQL,
e o portão — que afirma invariantes sobre o **texto** do arquivo — não tem como saber que a coluna
é `NOT NULL`. Ele até tinha uma asserção sobre essa linha, e ela estava **afirmando o bug**.

**A defesa aqui não é mais um portão, é um hábito:** antes de escrever um valor numa coluna, leia
a definição dela.

```bash
grep -rn "ultimo_nsr" supabase/migrations/*.sql | grep "NOT NULL"
```

✅ **Nenhum dado ficou pela metade.** A chamada é um statement único, então o `INSERT` no histórico
e o `UPDATE` da geração voltaram atrás junto com o erro — o CCE-01 continuava na geração 1, com o
AFD intacto e `dispositivos_rep_substituicoes` vazia. O modo de falha foi o desejado: **abortar
inteiro em vez de deixar o dispositivo num estado meio trocado.**

⚠️ **`20260906120000` não foi regerada.** Ela já rodou em produção, e reescrever arquivo já
aplicado apaga o registro do que de fato foi executado. O conserto veio em `20260906140000`, com o
corpo **copiado** da aplicada e uma substituição contada — o `diff` entre as duas é de uma linha.

---

## 7. O que falta

- 🚨 **Aplicar as duas migrations.** `20260906120000` reconstrói dois índices únicos sobre ~2,5M e
  ~2,4M linhas — **medir em homologação antes**. A conferência está escrita no rodapé de cada uma.
- **Rodar `fn_registrar_substituicao_dispositivo` para o CCE-01** depois de aplicar. O cursor
  volta a 1 e o AFD do relógio novo entra de uma vez.
- Prioridades 1b (sinal duro de substituição no heartbeat), 1c (a tela parar de afirmar o que não
  sabe), 2 e 3 do plano continuam abertas.
- Retirar o andaime da rota depois que `20260906130000` estiver em produção.
